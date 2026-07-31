// MobileOnboarding — Ziggy Home native-app onboarding flow.
//
// Renders only inside the Capacitor shell. The PWA version of this page
// redirects home (we never want a browser user landing here).
//
// Branches based on the is_first_pair flag returned by /api/mobile/pair:
//
//   First-pair (kit-out-of-box, claim-tier code redemption — Prompt 7):
//     PAIR → CLAIM_OWNER → SENSORS → STARTER_PACK → NOTIFY → LOCATION → MOTION → DONE
//
//   Subsequent pair (owner already exists, PWA-issued user-tier code):
//     PAIR → PERSON → NOTIFY → LOCATION → MOTION → DONE
//
// First-pair extra steps (CLAIM_OWNER, SENSORS, STARTER_PACK) and the
// completion-telemetry POST at DONE all hit /api/onboarding/* — those
// endpoints landed in Prompt 7 chunks 3.1-3.4. Subsequent-pair flow is
// untouched from the parallel session's PERSON-step build.
//
// State persists across reloads via Capacitor Preferences (lib/native storage).

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  isNative,
  getDeviceInfo,
  plugin,
} from '../lib/native'
import {
  pair,
  registerDevice,
  getDeviceToken,
  claimOwner,
  setHomeLocation,
} from '../lib/mobileApi'
import { getPresencePersons, getPresenceZone, listPresenceZones } from '../lib/api'
import { parsePairPayload, applyPairingTarget, finalizeHome } from '../lib/pairingCapture'
import { useAuthStore } from '../stores/authStore'
import { useT } from '../lib/i18n'
// Platform-agnostic wizard steps + styles are shared with the web/PWA flow.
import { SensorsStep, StarterStep, NotifyStep, DoneStep, PermissionScreen } from './onboarding/steps'
import { primaryBtn, secondaryBtn, textInput, fieldLabel } from './onboarding/styles'

const STEP = {
  PAIR:         'pair',
  CLAIM:        'claim',         // first-pair: create owner account
  SENSORS:      'sensors',       // first-pair: name kit sensors
  STARTER:      'starter',       // first-pair: starter automation pack
  PERSON:       'person',        // subsequent-pair: bind phone to a presence person
  NOTIFY:       'notify',
  LOCATION:     'location',
  MOTION:       'motion',
  DONE:         'done',
}

// `startFresh` is set when this wizard is mounted as the unauthenticated entry
// gate for a brand-new home (no owner account yet). In that mode we always
// begin at PAIR and never short-circuit home on a leftover device token — a
// token from a *previously* paired home is meaningless here and gets
// overwritten by the fresh pairing anyway.
export default function MobileOnboarding({ startFresh = false }) {
  const navigate = useNavigate()
  const t = useT()
  const [step, setStep]             = useState(STEP.PAIR)
  const [paired, setPaired]         = useState(false)
  const [loading, setLoading]       = useState(true)
  // First-pair vs subsequent-pair branching state. Captured from the
  // /api/mobile/pair response in PairStep — drives every routing decision
  // from that point on. Default false so a re-mount doesn't accidentally
  // walk a returning user through CLAIM_OWNER.
  const [isFirstPair, setIsFirstPair] = useState(false)
  // user_token from /api/onboarding/claim. Only used during STARTER_PACK
  // (POST /api/automations needs a user-auth token). Stays in component
  // state — not persisted — since the wizard only needs it for ~1 minute.
  const [userToken, setUserToken] = useState(null)
  // End-of-wizard summary for the completion telemetry post.
  const [sensorsConfirmedCount, setSensorsConfirmedCount] = useState(0)
  const [automationsAcceptedCount, setAutomationsAcceptedCount] = useState(0)
  const [errors, setErrors] = useState([])
  // Wall-clock start, captured the first time the component renders an
  // interactive step (i.e. after we know we're really onboarding, not just
  // bouncing home). Used by /api/onboarding/complete telemetry.
  const startedAtRef = useRef(null)

  // On mount: if not in the native app, redirect home. If already paired,
  // jump straight to home unless coming back via a re-pair link.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!isNative()) { navigate('/', { replace: true }); return }
      // Fresh-home gate: always start at PAIR, ignoring any stale device token.
      if (!startFresh) {
        const tok = await getDeviceToken()
        if (cancelled) return
        if (tok) { setPaired(true); navigate('/', { replace: true }); return }
      }
      if (cancelled) return
      setLoading(false)
      startedAtRef.current = Date.now()
    })()
    return () => { cancelled = true }
  }, [navigate, startFresh])

  if (loading) return null

  const pushError = (msg) => setErrors(es => [...es, String(msg).slice(0, 200)])

  // Step transitions are linear within the chosen branch. Centralising the
  // routing here keeps each step component dumb (just calls onDone).
  const afterPair = (firstPair) => {
    setIsFirstPair(!!firstPair)
    setStep(firstPair ? STEP.CLAIM : STEP.PERSON)
  }
  const afterClaim   = () => setStep(STEP.SENSORS)
  const afterSensors = (confirmed) => {
    if (typeof confirmed === 'number') setSensorsConfirmedCount(confirmed)
    setStep(STEP.STARTER)
  }
  const afterStarter = (accepted) => {
    if (typeof accepted === 'number') setAutomationsAcceptedCount(accepted)
    setStep(STEP.NOTIFY)
  }
  const afterPerson  = () => setStep(STEP.NOTIFY)
  const afterNotify  = () => setStep(STEP.LOCATION)
  const afterLocation = () => setStep(STEP.MOTION)
  const afterMotion  = () => setStep(STEP.DONE)
  const afterDone    = () => {
    // First-pair flow: CLAIM minted a real session token for the owner we just
    // created. Persist it as ziggy_token now (only at hand-off, so flipping the
    // app to "authenticated" doesn't unmount the wizard mid-flow). Without this
    // the main app — which authenticates via ziggy_token — would bounce the
    // finished customer straight back to the login page. claim always creates a
    // super_admin owner, so the role is fixed.
    if (userToken) useAuthStore.getState().setToken(userToken, 'super_admin')
    navigate('/', { replace: true })
  }

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex', flexDirection: 'column',
      padding: '24px 20px',
      background: 'var(--bg-1)',
      color: 'var(--ink)',
    }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{t('mobileOnboard.welcome')}</h1>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--ink-faint)' }}>
          {step === STEP.PAIR     && t('mobileOnboard.subtitlePair')}
          {step === STEP.CLAIM    && t('mobileOnboard.subtitleClaim')}
          {step === STEP.SENSORS  && t('mobileOnboard.subtitleSensors')}
          {step === STEP.STARTER  && t('mobileOnboard.subtitleStarter')}
          {step === STEP.PERSON   && t('mobileOnboard.subtitlePerson')}
          {step === STEP.NOTIFY   && t('mobileOnboard.subtitleNotify')}
          {step === STEP.LOCATION && t('mobileOnboard.subtitleLocation')}
          {step === STEP.MOTION   && t('mobileOnboard.subtitleMotion')}
          {step === STEP.DONE     && t('mobileOnboard.subtitleDone')}
        </p>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {step === STEP.PAIR     && <PairStep    onDone={(firstPair) => { setPaired(true); afterPair(firstPair) }} />}
        {step === STEP.CLAIM    && <ClaimStep   onDone={(userTok) => { setUserToken(userTok); afterClaim() }} onError={pushError} />}
        {step === STEP.SENSORS  && <SensorsStep onDone={afterSensors} onError={pushError} />}
        {step === STEP.STARTER  && <StarterStep userToken={userToken} onDone={afterStarter} onError={pushError} />}
        {step === STEP.PERSON   && <PersonStep  onDone={afterPerson} />}
        {step === STEP.NOTIFY   && <NotifyStep  onDone={afterNotify} />}
        {step === STEP.LOCATION && <LocationStep onDone={afterLocation} />}
        {step === STEP.MOTION   && <MotionStep  onDone={afterMotion} />}
        {step === STEP.DONE     && (
          <DoneStep
            onDone={afterDone}
            isFirstPair={isFirstPair}
            startedAt={startedAtRef.current}
            sensorsConfirmedCount={sensorsConfirmedCount}
            automationsAcceptedCount={automationsAcceptedCount}
            errors={errors}
            onError={pushError}
          />
        )}
      </main>
    </div>
  )
}

// Persist the device's language + timezone into the onboarding ledger (and,
// server-side, into config settings so time-based automations honour it).
// Fire-and-forget: a failure here must never block the wizard. Uses the
// device token set during PAIR — same relative-fetch + Bearer convention as
// lib/mobileApi.js. Runs right after CLAIM so the owner's picks are captured
// at the earliest point the device is authenticated.
async function persistOnboardingPrefs() {
  try {
    const token = await getDeviceToken()
    if (!token) return
    const language = (typeof navigator !== 'undefined' && /^he\b/i.test(navigator.language || '')) ? 'he' : 'en'
    let timezone = null
    try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch { /* older engines */ }
    await fetch('/api/onboarding/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ language, timezone }),
    })
  } catch { /* non-fatal — the wizard continues regardless */ }
}

// ── Steps ────────────────────────────────────────────────────────────────────

function PairStep({ onDone }) {
  const t = useT()
  const [codeEntry, setCodeEntry] = useState('')
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState(null)

  // `target` carries the per-home routing info parsed from a scanned QR
  // ({ code, baseUrl, relayUrl, homeId }). For a manually typed code it's null;
  // routing then relies on the active/default home (correct for the founder
  // single-home build and for re-pairing an already-known home).
  const submitWithCode = async (rawCode, target = null) => {
    const code = (rawCode || '').trim().toUpperCase()
    if (code.length < 4) { setError(t('mobileOnboard.codeTooShort')); return }
    setBusy(true); setError(null)
    // Point the pair request at the home the QR names *before* it fires, so a
    // fresh Canary Home (never contacted before) is reachable.
    if (target?.baseUrl) applyPairingTarget(target)
    try {
      const device = await getDeviceInfo()
      const result = await pair({ pairCode: code, device })
      // Persist this home's per-home base URL (from the pair response) and make
      // it the active routing target for every request from here on.
      try { finalizeHome({ parsed: target, pairResponse: result }) } catch { /* non-fatal */ }
      // Pass is_first_pair back so the parent can branch into the
      // claim-owner flow vs. the existing person-bind flow.
      onDone(!!result?.is_first_pair)
    } catch (e) {
      setError(e.message || t('mobileOnboard.pairFailed'))
    } finally {
      setBusy(false)
    }
  }

  const submit = () => submitWithCode(codeEntry)

  // Scan QR via @capacitor/barcode-scanner. Accepts either a raw 6-char code
  // or a ziggy://pair?code=XXX URL (LAN /pair page + box-top sticker both
  // emit the URL form — see backend/routers/first_boot_router.py).
  const scan = async () => {
    setError(null)
    const Scanner = plugin('CapacitorBarcodeScanner') || plugin('BarcodeScanner')
    if (!Scanner) {
      setError(t('mobileOnboard.scannerUnavailable'))
      return
    }
    try {
      const res = (await (Scanner.scanBarcode?.({ hint: 17 /* ALL */ }) ?? Scanner.scan?.())) ?? {}
      const raw = res.ScanResult
                ?? res.barcodes?.[0]?.rawValue
                ?? res.barcodes?.[0]?.displayValue
                ?? res.content
                ?? ''
      // Parse the full payload: 6-char code + the per-home routing target
      // (base / relay / home_id) the QR carries. Supports a bare code or the
      // ziggy://pair?code=...&base=... deep-link form.
      const parsed = parsePairPayload(raw)
      const code = parsed.code
      if (!code) { setError(t('mobileOnboard.noCodeInQr')); return }
      setCodeEntry(code)
      await submitWithCode(code, parsed)
    } catch (e) {
      setError(e?.message || t('mobileOnboard.scanCancelled'))
    }
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 13, color: 'var(--ink-faint)' }}>
        {t('mobileOnboard.pairHelp')}
      </p>
      <input
        autoFocus
        autoCapitalize="characters"
        maxLength={8}
        value={codeEntry}
        onChange={e => setCodeEntry(e.target.value.toUpperCase())}
        placeholder="ABC123"
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 28, letterSpacing: 6,
          padding: '14px 16px',
          borderRadius: 10,
          border: '1px solid var(--line)',
          background: 'var(--bg-2)',
          color: 'var(--ink)',
          textAlign: 'center',
        }}
      />
      {error && <div style={{ fontSize: 12, color: 'var(--danger, #c00)' }}>{error}</div>}
      <button
        onClick={submit}
        disabled={busy || codeEntry.length < 4}
        style={primaryBtn}
      >
        {busy ? t('mobileOnboard.pairing') : t('mobileOnboard.pair')}
      </button>
      <button
        onClick={scan}
        disabled={busy}
        style={secondaryBtn}
      >
        {t('mobileOnboard.scanQr')}
      </button>
    </section>
  )
}

// ── First-pair: CLAIM_OWNER ─────────────────────────────────────────────────

function ClaimStep({ onDone, onError }) {
  // Creates the super_admin owner account against the just-claimed device.
  // The device record is in claim_pending state until this succeeds —
  // /api/onboarding/claim flips it. We pass the returned user_token up so
  // STARTER_PACK can use it for /api/automations (user-authed endpoint).
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
      const res = await claimOwner({ username: u, password })
      // Capture language + timezone now that the device is authenticated and
      // an owner exists. Fire-and-forget — never blocks the wizard.
      persistOnboardingPrefs()
      onDone(res?.user_token || null)
    } catch (e) {
      if (e?.status === 409) {
        setError(t('mobileOnboard.claim.errExists'))
      } else {
        setError(e?.message || t('mobileOnboard.claim.errGeneric'))
      }
      onError(`claim:${e?.message || 'unknown'}`)
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

// ── Subsequent-pair: person picker ───────────────────────────────────────────

function PersonStep({ onDone }) {
  // "Who is this phone for?" — binds the freshly-paired device to a presence
  // person record so geofence enter/exit events from this phone update that
  // person's home/away state (handled by services/mobile_app._handle_location).
  //
  // Reuses the existing /api/presence/persons endpoint (no new backend route).
  // Binding posts to /api/mobile/register, which mobile_app.update_device
  // writes into the device record. Skipping is allowed — the user can bind
  // later from Settings → Ziggy Home (mobile).
  const t = useT()
  const [persons, setPersons] = useState(null)   // null = loading
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let cancelled = false
    getPresencePersons()
      .then(list => { if (!cancelled) setPersons(Array.isArray(list) ? list : []) })
      .catch(e => { if (!cancelled) { setError(e?.message || 'load failed'); setPersons([]) } })
    return () => { cancelled = true }
  }, [])

  const pick = async (person_id) => {
    setBusy(true); setError(null)
    try {
      await registerDevice({ person_id })
      onDone()
    } catch (e) {
      setError(e?.message || 'bind failed')
      setBusy(false)
    }
  }

  if (persons === null) {
    return (
      <section style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--ink-faint)' }}>{t('common.loading')}…</div>
      </section>
    )
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
        {t('mobileOnboard.personBody')}
      </p>
      {persons.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '8px 4px' }}>
          {t('mobileOnboard.personEmpty')}
        </div>
      )}
      {persons.map(p => (
        <button
          key={p.id}
          onClick={() => pick(p.id)}
          disabled={busy}
          style={{
            padding: '14px 16px', borderRadius: 10,
            border: '1px solid var(--line)',
            background: 'var(--bg-2)', color: 'var(--ink)',
            display: 'flex', alignItems: 'center', gap: 12,
            cursor: busy ? 'wait' : 'pointer', fontSize: 15, fontWeight: 500,
            textAlign: 'left',
          }}
        >
          <span>{p.name || p.id}</span>
        </button>
      ))}
      {error && <div style={{ fontSize: 12, color: 'var(--danger, #c00)' }}>{error}</div>}
      <button onClick={onDone} disabled={busy} style={secondaryBtn}>
        {t('mobileOnboard.skipPerson')}
      </button>
    </section>
  )
}

// ── Permissions + done ──────────────────────────────────────────────────────

function LocationStep({ onDone }) {
  // Uses the custom ziggy-presence plugin (Phase 3 — real background coverage).
  // Falls back to @capacitor/geolocation foreground-only if ziggy-presence
  // isn't registered (older builds, missing cap sync, etc).
  const t = useT()
  const [busy, setBusy] = useState(false)
  const allow = async () => {
    setBusy(true)
    const Pres = plugin('ZiggyPresence')
    const Geo  = plugin('Geolocation')
    let status = 'denied'

    if (Pres) {
      try {
        // Always-on coverage matches the architecture: SLC + region monitoring
        // need background authorisation. The plugin chains WhenInUse → Always
        // on iOS; Android prompts foreground then background sequentially.
        const res = await Pres.requestPermissions({
          location: 'always',
          motion: false,
          notifications: false,
        })
        status = res?.location || 'denied'

        // Start background pumps + register the canonical home + near-home
        // geofences, plus any extra zones the backend already knows about
        // (Work, Gym, School, …). Failures here are non-fatal — onboarding
        // continues even if geofences can't be added so the user isn't blocked.
        // iOS: kick off background significant-location (no notification).
        // Android: stay notification-free — geofences (below) + LAN cover it;
        // the continuous tracker only runs while approaching home (smart-boost
        // in App.jsx). So don't start it here.
        if ((status === 'always' || status === 'while_using') && window?.Capacitor?.getPlatform?.() !== 'android') {
          try { await Pres.startBackgroundLocation({ accuracy: 'balanced' }) } catch {}
        }
        if (status === 'always') {
          await registerInitialGeofences(Pres).catch(() => {})
        }
      } catch {}
    } else if (Geo) {
      // Legacy fallback: foreground-only @capacitor/geolocation. No background,
      // no geofences. Onboarding still completes; the user just won't get
      // arrive/leave triggers when the app is closed.
      try {
        const res = await Geo.requestPermissions({ permissions: ['location'] })
        status = res?.location === 'granted' ? 'while_using' : 'denied'
      } catch {}
    }

    try { await registerDevice({ permissions: { location: status } }) } catch {}
    setBusy(false); onDone()
  }
  return (
    <PermissionScreen
      title={t('mobileOnboard.locationTitle')}
      body={t('mobileOnboard.locationBody')}
      onAllow={allow}
      onSkip={onDone}
      busy={busy}
    />
  )
}

// Builds the initial geofence set: home + near-home outer ring + every
// configured backend zone (capped at the iOS 20-region limit).
async function registerInitialGeofences(Pres) {
  // Wipe stale entries first — re-onboarding after a zone-radius change should
  // pick up the new value, not the OS's cached version.
  try { await Pres.clearAllGeofences() } catch {}

  let homeLat = null, homeLon = null
  // 1) Prefer the backend's configured home zone (set via PWA Settings or
  // pulled from HA core config).
  try {
    const z = await getPresenceZone()
    if (z?.configured && typeof z.lat === 'number' && typeof z.lon === 'number') {
      homeLat = z.lat
      homeLon = z.lon
    }
  } catch {}

  // 2) Fall back to this phone's current position — only sane if the user is
  // physically at home during onboarding, which is the common case.
  if (homeLat == null) {
    try {
      const Geo = plugin('Geolocation')
      if (Geo) {
        const pos = await Geo.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 })
        homeLat = pos?.coords?.latitude  ?? null
        homeLon = pos?.coords?.longitude ?? null
      }
    } catch {}
  }
  if (homeLat == null || homeLon == null) return  // nothing usable

  // Push the real home location into HA so sun/sunrise-sunset/weather are
  // accurate (otherwise the hub stays at the imaging default). Best-effort.
  try { await setHomeLocation({ latitude: homeLat, longitude: homeLon }) } catch {}

  // Home — small ring, fires on a real arrival.
  try {
    await Pres.addGeofence({ id: 'home', lat: homeLat, lon: homeLon, radius_m: 150 })
  } catch {}

  // Fetch backend zones once. The home-level "Near Home" approach ring
  // (auto-created when home is set) supplies the home_near radius; the rest
  // sync as their own geofences.
  let backendZones = []
  try { backendZones = (await listPresenceZones()).zones || [] } catch {}
  const nearZone = backendZones.find(z => (z?.name || '').toLowerCase() === 'near home')
  const approachRadius = Math.max(nearZone?.radius_m || 2000, 100)

  // Near-Home approach ring — drives "approaching home" + Pre-cool automations.
  try {
    await Pres.addGeofence({ id: 'home_near', lat: homeLat, lon: homeLon, radius_m: approachRadius })
  } catch {}

  // 3) Sync extra backend zones (Work, Gym, …). iOS caps at 20 total; we've
  // used 2 for home + home_near, so add up to 18 more. Skip "Near Home" — it is
  // already registered as the home_near ring above; double-registering it as
  // its own geofence would double-fire the approach automations.
  try {
    let added = 0
    for (const z of backendZones) {
      if (added >= 18) break
      if (!z?.id || z.id === 'home' || z.id === 'home_near') continue
      if ((z?.name || '').toLowerCase() === 'near home') continue
      if (typeof z.lat !== 'number' || typeof z.lon !== 'number') continue
      try {
        await Pres.addGeofence({
          id: z.id,
          lat: z.lat,
          lon: z.lon,
          radius_m: Math.max(z.radius_m || 200, 100),
        })
        added++
      } catch {}
    }
  } catch {}
}

function MotionStep({ onDone }) {
  // Motion / Activity recognition via ziggy-presence. Used by the plugin to
  // defer geofence enters that fire while driving — i.e. "drove past home"
  // false-positives. Skippable; the rest of the presence stack works fine
  // without it.
  const t = useT()
  const [busy, setBusy] = useState(false)
  const allow = async () => {
    setBusy(true)
    const Pres = plugin('ZiggyPresence')
    if (Pres) {
      try {
        await Pres.requestPermissions({ motion: true })
        // Best-effort: even if the OS prompt was denied, calling
        // startActivityRecognition is cheap and surfaces a clear error path
        // through the plugin's promise rejection.
        try { await Pres.startActivityRecognition() } catch {}
      } catch {}
    }
    setBusy(false); onDone()
  }
  // No ziggy-presence plugin (older build) → skip silently as before.
  useEffect(() => {
    if (!plugin('ZiggyPresence')) onDone()
  }, [onDone])
  return (
    <PermissionScreen
      title={t('mobileOnboard.motionTitle')}
      body={t('mobileOnboard.motionBody')}
      onAllow={allow}
      onSkip={onDone}
      busy={busy}
    />
  )
}
