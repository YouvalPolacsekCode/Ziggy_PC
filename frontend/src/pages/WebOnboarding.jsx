// WebOnboarding — Ziggy Home web/PWA onboarding flow.
//
// The guided first-run wizard for a fresh, owner-less home opened in a BROWSER
// or PWA (not the native Capacitor app). Native users get MobileOnboarding; this
// is the web counterpart mounted by App.jsx `UnauthenticatedGate` when
// /api/auth/status reports the home has no owner yet.
//
// Spine B (see docs/superpowers/specs/2026-07-29-web-onboarding-path-design.md):
// there is NO device pairing on web. The owner is created via the already-
// tunnel-safe POST /api/auth/setup, which returns a super_admin SESSION token.
// That token drives the shared wizard steps (via their `authToken` prop) — the
// backend get_onboarding_principal dependency accepts it in place of a native
// device token. The LAN-only device-claim path is untouched.
//
// Step sequence:
//   SETUP (create owner) → SENSORS → STARTER → NOTIFY → LOCATION → DONE
//
// No QR pairing, no CLAIM device-token step, no background GPS / MOTION step.
// State is ephemeral (the session token lives in component state) and is only
// committed to the auth store at DONE — exactly like MobileOnboarding's
// afterDone — so flipping the app to "authenticated" never unmounts the wizard
// mid-flow.

import { useEffect, useRef, useState } from 'react'
import { setHomeLocation } from '../lib/mobileApi'
import { useAuthStore } from '../stores/authStore'
import { useT } from '../lib/i18n'
import { SensorsStep, StarterStep, NotifyStep, DoneStep } from './onboarding/steps'
import { primaryBtn, secondaryBtn, textInput, fieldLabel } from './onboarding/styles'

const STEP = {
  SETUP:    'setup',
  SENSORS:  'sensors',
  STARTER:  'starter',
  NOTIFY:   'notify',
  LOCATION: 'location',
  DONE:     'done',
}

export default function WebOnboarding() {
  const t = useT()
  const [step, setStep] = useState(STEP.SETUP)
  // The owner's super_admin session token from /api/auth/setup. Held in state
  // (NOT committed to the auth store) until DONE so the app stays on the
  // unauthenticated gate — and this wizard stays mounted — through every step.
  const [sessionToken, setSessionToken] = useState(null)
  const [sensorsConfirmedCount, setSensorsConfirmedCount] = useState(0)
  const [automationsAcceptedCount, setAutomationsAcceptedCount] = useState(0)
  const [errors, setErrors] = useState([])
  const startedAtRef = useRef(Date.now())

  const pushError = (msg) => setErrors(es => [...es, String(msg).slice(0, 200)])

  const afterSetup = (token) => { setSessionToken(token); setStep(STEP.SENSORS) }
  const afterSensors = (confirmed) => {
    if (typeof confirmed === 'number') setSensorsConfirmedCount(confirmed)
    setStep(STEP.STARTER)
  }
  const afterStarter = (accepted) => {
    if (typeof accepted === 'number') setAutomationsAcceptedCount(accepted)
    setStep(STEP.NOTIFY)
  }
  const afterNotify   = () => setStep(STEP.LOCATION)
  const afterLocation = () => setStep(STEP.DONE)
  const afterDone     = () => {
    // Commit the session token now, at hand-off. This flips the app to
    // authenticated, App re-renders into the dashboard, and the post-login
    // redirect lands the user home. super_admin is fixed — setup always
    // creates the owner.
    if (sessionToken) useAuthStore.getState().setToken(sessionToken, 'super_admin')
  }

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex', flexDirection: 'column',
      padding: '24px max(20px, env(safe-area-inset-left)) 24px max(20px, env(safe-area-inset-right))',
      boxSizing: 'border-box',
      background: 'var(--bg-1)',
      color: 'var(--ink)',
    }}>
      <div style={{ width: '100%', maxWidth: 480, margin: '0 auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <header style={{ marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{t('mobileOnboard.welcome')}</h1>
          <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--ink-faint)' }}>
            {step === STEP.SETUP    && t('mobileOnboard.subtitleClaim')}
            {step === STEP.SENSORS  && t('mobileOnboard.subtitleSensors')}
            {step === STEP.STARTER  && t('mobileOnboard.subtitleStarter')}
            {step === STEP.NOTIFY   && t('mobileOnboard.subtitleNotify')}
            {step === STEP.LOCATION && t('mobileOnboard.subtitleLocation')}
            {step === STEP.DONE     && t('mobileOnboard.subtitleDone')}
          </p>
        </header>

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {step === STEP.SETUP    && <WebSetupStep    onDone={afterSetup} onError={pushError} />}
          {step === STEP.SENSORS  && <SensorsStep     onDone={afterSensors} onError={pushError} authToken={sessionToken} />}
          {step === STEP.STARTER  && <StarterStep      userToken={sessionToken} authToken={sessionToken} onDone={afterStarter} onError={pushError} />}
          {step === STEP.NOTIFY   && <NotifyStep       onDone={afterNotify} />}
          {step === STEP.LOCATION && <WebLocationStep  onDone={afterLocation} onError={pushError} authToken={sessionToken} />}
          {step === STEP.DONE     && (
            <DoneStep
              onDone={afterDone}
              isFirstPair={true}
              startedAt={startedAtRef.current}
              sensorsConfirmedCount={sensorsConfirmedCount}
              automationsAcceptedCount={automationsAcceptedCount}
              errors={errors}
              onError={pushError}
              authToken={sessionToken}
            />
          )}
        </main>
      </div>
    </div>
  )
}

// Best-effort: persist the browser's language + timezone via the first-boot
// prefs endpoint (allowed without auth while the hub is still unclaimed) so
// time-based automations honour them. Never blocks the wizard.
async function persistWebPrefs() {
  try {
    const language = (typeof navigator !== 'undefined' && /^he\b/i.test(navigator.language || '')) ? 'he' : 'en'
    let timezone = null
    try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch { /* older engines */ }
    await fetch('/api/onboarding/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language, timezone }),
    })
  } catch { /* non-fatal */ }
}

// ── SETUP: create the owner account (web equivalent of native CLAIM) ─────────

function WebSetupStep({ onDone, onError }) {
  // Creates the super_admin owner via /api/auth/setup (tunnel-safe, guarded by
  // "no owner exists yet"). Returns a session token we DON'T commit yet — we
  // hand it up to the wizard which uses it to authenticate the later steps.
  const t = useT()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async () => {
    const u = username.trim()
    if (!u || !password) { setError(t('mobileOnboard.claim.errEmpty')); return }
    if (password.length < 6) { setError(t('mobileOnboard.claim.errShort')); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 409 || res.status === 403) {
          // Someone already claimed this home (race, or a returning user hit
          // the fresh-home URL). Fall back to the normal sign-in page.
          setError(t('mobileOnboard.claim.errExists'))
          setTimeout(() => window.location.reload(), 1200)
          return
        }
        setError(data.detail || t('mobileOnboard.claim.errGeneric'))
        onError(`web_setup:${res.status}`)
        return
      }
      if (!data.token) { setError(t('mobileOnboard.claim.errGeneric')); onError('web_setup:no_token'); return }
      persistWebPrefs()   // fire-and-forget
      onDone(data.token)
    } catch (e) {
      setError(e?.message || t('mobileOnboard.claim.errGeneric'))
      onError(`web_setup:${e?.message || 'unknown'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{t('mobileOnboard.claim.title')}</h2>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
        {t('mobileOnboard.claim.body')}
      </p>
      <label style={fieldLabel}>{t('mobileOnboard.claim.username')}</label>
      <input
        value={username}
        onChange={e => setUsername(e.target.value)}
        autoCapitalize="none"
        autoComplete="username"
        autoCorrect="off"
        style={textInput}
        dir="auto"
      />
      <label style={fieldLabel}>{t('mobileOnboard.claim.password')}</label>
      <input
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        autoComplete="new-password"
        style={textInput}
        dir="ltr"
      />
      <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{t('mobileOnboard.claim.passwordHint')}</div>
      {error && <div style={{ fontSize: 12, color: 'var(--danger, #c00)' }}>{error}</div>}
      <button onClick={submit} disabled={busy} style={primaryBtn}>
        {busy ? t('mobileOnboard.claim.creating') : t('mobileOnboard.claim.create')}
      </button>
    </section>
  )
}

// ── LOCATION: one-time foreground home-coordinate capture (web) ──────────────

function WebLocationStep({ onDone, onError, authToken }) {
  // Background geofencing isn't available in a PWA. What DOES work over the
  // HTTPS tunnel (a secure context) is a single foreground position fix, which
  // we push to HA core config so sun/sunrise-sunset/weather are accurate. The
  // copy is explicit that automatic arrive/leave needs the native app.
  const t = useT()
  const [busy, setBusy] = useState(false)

  const allow = async () => {
    setBusy(true)
    try {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        onError('web_location:unsupported')
        onDone(); return
      }
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true, timeout: 15000, maximumAge: 60000,
        })
      })
      const lat = pos?.coords?.latitude
      const lon = pos?.coords?.longitude
      if (typeof lat === 'number' && typeof lon === 'number') {
        await setHomeLocation({ latitude: lat, longitude: lon }, authToken)
      }
    } catch (e) {
      // Denied / timed out — non-fatal, the user can set location later.
      onError(`web_location:${e?.message || 'denied'}`)
    } finally {
      setBusy(false)
      onDone()
    }
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{t('mobileOnboard.locationTitle')}</h2>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
        {t('mobileOnboard.locationBody')}
      </p>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
        {t('webOnboard.locationAppNote')
          || 'Automatic arrive/leave (turning things on as you get home) needs the Ziggy app on your phone — you can set that up later.'}
      </p>
      <button onClick={allow} disabled={busy} style={primaryBtn}>
        {busy ? t('mobileOnboard.confirmPlease') : t('mobileOnboard.allow')}
      </button>
      <button onClick={onDone} disabled={busy} style={secondaryBtn}>{t('mobileOnboard.skipForNow')}</button>
    </section>
  )
}
