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
  requestNotificationPermission,
  plugin,
} from '../lib/native'
import {
  pair,
  registerDevice,
  getDeviceToken,
  claimOwner,
  getOnboardingSensors,
  confirmSensors,
  getStarterPack,
  installAutomation,
  completeOnboarding,
} from '../lib/mobileApi'
import { getPresencePersons } from '../lib/api'
import { useT } from '../lib/i18n'

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

export default function MobileOnboarding() {
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
      const tok = await getDeviceToken()
      if (cancelled) return
      if (tok) { setPaired(true); navigate('/', { replace: true }); return }
      setLoading(false)
      startedAtRef.current = Date.now()
    })()
    return () => { cancelled = true }
  }, [navigate])

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
  const afterDone    = () => navigate('/', { replace: true })

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

// ── Steps ────────────────────────────────────────────────────────────────────

function PairStep({ onDone }) {
  const t = useT()
  const [codeEntry, setCodeEntry] = useState('')
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState(null)

  const submitWithCode = async (rawCode) => {
    const code = (rawCode || '').trim().toUpperCase()
    if (code.length < 4) { setError(t('mobileOnboard.codeTooShort')); return }
    setBusy(true); setError(null)
    try {
      const device = await getDeviceInfo()
      const result = await pair({ pairCode: code, device })
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
      const m = String(raw).match(/code=([A-Z0-9]+)/i) ?? [null, raw]
      const code = (m[1] || '').trim().toUpperCase()
      if (!code) { setError(t('mobileOnboard.noCodeInQr')); return }
      setCodeEntry(code)
      await submitWithCode(code)
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
    if (password.length < 4) { setError(t('mobileOnboard.claim.errShort')); return }
    setBusy(true); setError(null)
    try {
      const res = await claimOwner({ username: u, password })
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

// ── First-pair: SENSORS naming wizard ────────────────────────────────────────

function SensorsStep({ onDone, onError }) {
  // Walks the user through each kit-manifest sensor one screen at a time.
  // Pre-fills the name from the manifest's intended_label_en (English UI)
  // or intended_label_he (Hebrew UI), and the room from current_area_name
  // when HA already had it assigned.
  const t = useT()
  const [loading, setLoading] = useState(true)
  const [sensors, setSensors] = useState([])      // manifest × HA join
  const [index, setIndex] = useState(0)           // which sensor we're on
  const [draft, setDraft] = useState({})          // { ha_device_id: { name, room_name } }
  const [saving, setSaving] = useState(false)
  const [haUnreachable, setHaUnreachable] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await getOnboardingSensors()
        if (cancelled) return
        if (!res.ha_reachable) { setHaUnreachable(true); setLoading(false); return }
        const list = (res.sensors || []).filter(s => s.paired && s.ha_device_id)
        setSensors(list)
        // Pre-fill the draft from the manifest's intended labels.
        const langIsHe = /^he\b/i.test((typeof navigator !== 'undefined' && navigator.language) || '')
        const initial = {}
        for (const s of list) {
          initial[s.ha_device_id] = {
            name:      s.current_name || (langIsHe ? s.intended_label_he : s.intended_label_en) || '',
            room_name: s.current_area_name || (langIsHe ? s.intended_label_he : s.intended_label_en) || '',
          }
        }
        setDraft(initial)
        setLoading(false)
      } catch (e) {
        onError(`sensors_fetch:${e?.message || 'unknown'}`)
        setHaUnreachable(true); setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [onError])

  const total = sensors.length
  const current = sensors[index]

  const update = (field, value) => {
    if (!current) return
    setDraft(d => ({
      ...d,
      [current.ha_device_id]: { ...(d[current.ha_device_id] || {}), [field]: value },
    }))
  }

  const handleNext = () => {
    if (index + 1 < total) {
      setIndex(i => i + 1)
    } else {
      submitAll()
    }
  }

  const handleSkipOne = () => {
    if (!current) return
    // Drop this sensor from the draft so it's not sent to the server.
    setDraft(d => {
      const next = { ...d }
      delete next[current.ha_device_id]
      return next
    })
    if (index + 1 < total) setIndex(i => i + 1)
    else submitAll()
  }

  const submitAll = async () => {
    setSaving(true)
    const payload = Object.entries(draft).map(([ha_device_id, fields]) => ({
      ha_device_id,
      name:      (fields.name || '').trim(),
      room_name: (fields.room_name || '').trim(),
    })).filter(e => e.name || e.room_name)
    try {
      const res = await confirmSensors(payload)
      if (res?.failed?.length) onError(`sensors_confirm_partial:${res.failed.length}`)
      onDone(res?.confirmed ?? 0)
    } catch (e) {
      onError(`sensors_confirm:${e?.message || 'unknown'}`)
      onDone(0)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <section style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--ink-faint)' }}>{t('common.loading') || '…'}</div>
      </section>
    )
  }

  if (haUnreachable) {
    return (
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-faint)' }}>
          {t('mobileOnboard.sensors.haDown')}
        </p>
        <button onClick={() => onDone(0)} style={primaryBtn}>{t('mobileOnboard.sensors.next')}</button>
      </section>
    )
  }

  if (total === 0) {
    return (
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-faint)' }}>{t('mobileOnboard.sensors.empty')}</p>
        <button onClick={() => onDone(0)} style={primaryBtn}>{t('mobileOnboard.sensors.next')}</button>
      </section>
    )
  }

  const isLast = index + 1 === total
  const fields = draft[current.ha_device_id] || { name: '', room_name: '' }
  const progressLabel = (t('mobileOnboard.sensors.progress') || '{current} of {total}')
    .replace('{current}', String(index + 1))
    .replace('{total}', String(total))

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{t('mobileOnboard.sensors.title')}</h2>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-faint)' }}>{t('mobileOnboard.sensors.intro')}</p>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-faint)' }}>{progressLabel}</p>
      <div style={{
        padding: 12, borderRadius: 10,
        border: '1px solid var(--line)', background: 'var(--bg-2)',
        fontSize: 12, color: 'var(--ink-faint)',
      }}>
        <div>{current.vendor_model || current.device_type}</div>
        {current.zigbee_mac && <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{current.zigbee_mac}</div>}
      </div>
      <label style={fieldLabel}>{t('mobileOnboard.sensors.nameLabel')}</label>
      <input
        value={fields.name}
        onChange={e => update('name', e.target.value)}
        autoCapitalize="words"
        style={textInput}
        dir="auto"
      />
      <label style={fieldLabel}>{t('mobileOnboard.sensors.roomLabel')}</label>
      <input
        value={fields.room_name}
        onChange={e => update('room_name', e.target.value)}
        autoCapitalize="words"
        style={textInput}
        dir="auto"
      />
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button onClick={handleSkipOne} disabled={saving} style={{ ...secondaryBtn, flex: 1 }}>
          {t('mobileOnboard.sensors.skip')}
        </button>
        <button onClick={handleNext} disabled={saving} style={{ ...primaryBtn, flex: 2 }}>
          {saving ? t('mobileOnboard.sensors.saving') : (isLast ? t('mobileOnboard.sensors.finish') : t('mobileOnboard.sensors.next'))}
        </button>
      </div>
    </section>
  )
}

// ── First-pair: STARTER_PACK ────────────────────────────────────────────────

function StarterStep({ userToken, onDone, onError }) {
  // Renders the resolved starter-pack list from /api/onboarding/starter-pack.
  // User toggles accept/skip per card; "Install selected" POSTs each
  // accepted automation's ha_payload to /api/automations (user-authed —
  // uses userToken from the claim step).
  const t = useT()
  const [loading, setLoading] = useState(true)
  const [starters, setStarters] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [installing, setInstalling] = useState(false)
  const [haUnreachable, setHaUnreachable] = useState(false)
  const langIsHe = typeof navigator !== 'undefined' && /^he\b/i.test(navigator.language || '')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await getStarterPack()
        if (cancelled) return
        if (!res.ha_reachable) { setHaUnreachable(true); setLoading(false); return }
        setStarters(res.starters || [])
        // Default: select everything. User can deselect cards they don't want.
        setSelected(new Set((res.starters || []).map(s => s.id)))
        setLoading(false)
      } catch (e) {
        onError(`starter_fetch:${e?.message || 'unknown'}`)
        setHaUnreachable(true); setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [onError])

  const toggle = (id) => {
    setSelected(s => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const install = async () => {
    setInstalling(true)
    let installed = 0
    let failed = 0
    for (const s of starters) {
      if (!selected.has(s.id)) continue
      try {
        await installAutomation(s.ha_payload, userToken)
        installed += 1
      } catch (e) {
        failed += 1
        onError(`starter_install:${s.id}:${e?.message || 'unknown'}`)
      }
    }
    setInstalling(false)
    onDone(installed)
    // Note: the failed count is reported through onError above; we don't
    // surface a final toast here since DONE is rendered next.
  }

  const skipAll = () => onDone(0)

  if (loading) {
    return (
      <section style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--ink-faint)' }}>{t('common.loading') || '…'}</div>
      </section>
    )
  }
  if (haUnreachable) {
    return (
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-faint)' }}>{t('mobileOnboard.starter.haDown')}</p>
        <button onClick={skipAll} style={primaryBtn}>{t('mobileOnboard.starter.skipAll')}</button>
      </section>
    )
  }
  if (starters.length === 0) {
    return (
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-faint)' }}>{t('mobileOnboard.starter.empty')}</p>
        <button onClick={skipAll} style={primaryBtn}>{t('mobileOnboard.starter.skipAll')}</button>
      </section>
    )
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{t('mobileOnboard.starter.title')}</h2>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-faint)' }}>{t('mobileOnboard.starter.intro')}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
        {starters.map(s => {
          const on = selected.has(s.id)
          return (
            <button
              key={s.id}
              onClick={() => toggle(s.id)}
              disabled={installing}
              style={{
                textAlign: 'start',
                padding: '12px 14px', borderRadius: 10,
                background: on ? 'color-mix(in srgb, var(--accent) 10%, var(--bg-2))' : 'var(--bg-2)',
                border: on ? '1.5px solid var(--accent)' : '1px solid var(--line)',
                color: 'var(--ink)',
                cursor: installing ? 'wait' : 'pointer',
                display: 'flex', flexDirection: 'column', gap: 4,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {langIsHe ? (s.label_he || s.label_en) : (s.label_en || s.label_he)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
                {langIsHe ? (s.description_he || s.description_en) : (s.description_en || s.description_he)}
              </div>
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button onClick={skipAll} disabled={installing} style={{ ...secondaryBtn, flex: 1 }}>
          {t('mobileOnboard.starter.skipAll')}
        </button>
        <button onClick={install} disabled={installing || selected.size === 0} style={{ ...primaryBtn, flex: 2 }}>
          {installing ? t('mobileOnboard.starter.installing') : t('mobileOnboard.starter.install')}
        </button>
      </div>
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

function NotifyStep({ onDone }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const allow = async () => {
    setBusy(true)
    const status = await requestNotificationPermission()
    try { await registerDevice({ permissions: { notifications: status } }) } catch {}
    setBusy(false); onDone()
  }
  return (
    <PermissionScreen
      title={t('mobileOnboard.notifyTitle')}
      body={t('mobileOnboard.notifyBody')}
      onAllow={allow}
      onSkip={onDone}
      busy={busy}
    />
  )
}

function LocationStep({ onDone }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const allow = async () => {
    setBusy(true)
    const Geo = plugin('Geolocation')
    let status = 'denied'
    if (Geo) {
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

function MotionStep({ onDone }) {
  // Motion / Activity recognition is a custom plugin (ziggy-presence) — not
  // in any official Capacitor plugin. Phase 3 wires this up; for now we skip
  // gracefully so the onboarding completes.
  useEffect(() => { onDone() }, [onDone])
  return null
}

function DoneStep({
  onDone, isFirstPair, startedAt,
  sensorsConfirmedCount, automationsAcceptedCount, errors, onError,
}) {
  const t = useT()
  // Fire the completion telemetry once when we land here (only on the
  // first-pair branch — subsequent pairs don't run the kit setup loop).
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    if (!isFirstPair) return
    const elapsed = startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0
    completeOnboarding({
      time_elapsed_seconds:       elapsed,
      sensors_confirmed_count:    sensorsConfirmedCount,
      automations_accepted_count: automationsAcceptedCount,
      errors,
    }).catch(e => onError(`complete:${e?.message || 'unknown'}`))
  }, [isFirstPair, startedAt, sensorsConfirmedCount, automationsAcceptedCount, errors, onError])

  // Auto-advance after 1.5s, with a visible Continue button after 1s as a
  // fallback if the post-navigate redirect chain ever hiccups.
  const [showButton, setShowButton] = useState(false)
  useEffect(() => {
    const btnTimer = setTimeout(() => setShowButton(true), 1000)
    const navTimer = setTimeout(onDone, 1500)
    return () => { clearTimeout(btnTimer); clearTimeout(navTimer) }
  }, [onDone])
  return (
    <section style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <div style={{ fontSize: 48 }}>✓</div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{t('mobileOnboard.allSet')}</div>
      {showButton && (
        <button onClick={onDone} style={{
          marginTop: 8, padding: '12px 20px', borderRadius: 10, border: 'none',
          background: 'var(--accent)', color: 'white', fontWeight: 600,
          fontSize: 14, cursor: 'pointer',
        }}>
          {t('common.continue')}
        </button>
      )}
    </section>
  )
}

function PermissionScreen({ title, body, onAllow, onSkip, busy }) {
  const t = useT()
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{title}</h2>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-faint)', lineHeight: 1.5 }}>{body}</p>
      <button onClick={onAllow} disabled={busy} style={primaryBtn}>
        {busy ? t('mobileOnboard.confirmPlease') : t('mobileOnboard.allow')}
      </button>
      <button onClick={onSkip} disabled={busy} style={secondaryBtn}>{t('mobileOnboard.skipForNow')}</button>
    </section>
  )
}

const primaryBtn = {
  padding: '14px 16px',
  borderRadius: 10,
  border: 'none',
  background: 'var(--accent)',
  color: 'white',
  fontWeight: 600,
  fontSize: 15,
  cursor: 'pointer',
}
const secondaryBtn = {
  ...primaryBtn,
  background: 'transparent',
  color: 'var(--ink-faint)',
  border: '1px solid var(--line)',
}
const textInput = {
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid var(--line)',
  background: 'var(--bg-2)',
  color: 'var(--ink)',
  fontSize: 15,
  fontFamily: 'inherit',
}
const fieldLabel = {
  fontSize: 12,
  color: 'var(--ink-faint)',
  fontWeight: 500,
  marginBottom: -8,
}
