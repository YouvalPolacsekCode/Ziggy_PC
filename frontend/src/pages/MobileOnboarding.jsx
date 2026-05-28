// MobileOnboarding — Ziggy Home native-app pairing & permissions flow.
//
// Renders only inside the Capacitor shell. The PWA version of this page redirects
// home (we never want a browser user landing here). The flow:
//
//   1. Pair (enter 6-char code from PWA settings page → POST /api/mobile/pair)
//   2. Permissions (notifications, location while-using, motion)
//   3. Bind to a person (Phase 2 — TODO once persons list is fetched)
//   4. Done → redirect to home
//
// State persists across reloads via Capacitor Preferences (storage helper).

import { useEffect, useState } from 'react'
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
} from '../lib/mobileApi'
import { useT } from '../lib/i18n'

const STEP = {
  PAIR:        'pair',
  NOTIFY:      'notify',
  LOCATION:    'location',
  MOTION:      'motion',
  DONE:        'done',
}

export default function MobileOnboarding() {
  const navigate = useNavigate()
  const t = useT()
  const [step, setStep]       = useState(STEP.PAIR)
  const [paired, setPaired]   = useState(false)
  const [loading, setLoading] = useState(true)

  // On mount: if not in the native app, redirect home (this page is mobile-only).
  // If already paired, jump to home as well unless coming from a re-pair link.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!isNative()) { navigate('/', { replace: true }); return }
      const tok = await getDeviceToken()
      if (cancelled) return
      if (tok) { setPaired(true); navigate('/', { replace: true }); return }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [navigate])

  if (loading) return null

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
          {step === STEP.PAIR    && t('mobileOnboard.subtitlePair')}
          {step === STEP.NOTIFY  && t('mobileOnboard.subtitleNotify')}
          {step === STEP.LOCATION && t('mobileOnboard.subtitleLocation')}
          {step === STEP.MOTION  && t('mobileOnboard.subtitleMotion')}
          {step === STEP.DONE    && t('mobileOnboard.subtitleDone')}
        </p>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {step === STEP.PAIR     && <PairStep    onDone={() => { setPaired(true); setStep(STEP.NOTIFY) }} />}
        {step === STEP.NOTIFY   && <NotifyStep  onDone={() => setStep(STEP.LOCATION)} />}
        {step === STEP.LOCATION && <LocationStep onDone={() => setStep(STEP.MOTION)} />}
        {step === STEP.MOTION   && <MotionStep  onDone={() => setStep(STEP.DONE)} />}
        {step === STEP.DONE     && <DoneStep    onDone={() => navigate('/', { replace: true })} />}
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
      await pair({ pairCode: code, device })
      onDone()
    } catch (e) {
      setError(e.message || t('mobileOnboard.pairFailed'))
    } finally {
      setBusy(false)
    }
  }

  const submit = () => submitWithCode(codeEntry)

  // Scan QR via @capacitor/barcode-scanner (official Ionic, AVFoundation-based).
  // Registers under either `CapacitorBarcodeScanner` (v2.x) or `BarcodeScanner`
  // depending on Capacitor version — try both for resilience. Graceful no-op on
  // web. Arm64-simulator-clean (unlike the MLKit fork we removed on 2026-05-28).
  const scan = async () => {
    setError(null)
    const Scanner = plugin('CapacitorBarcodeScanner') || plugin('BarcodeScanner')
    if (!Scanner) {
      setError(t('mobileOnboard.scannerUnavailable'))
      return
    }
    try {
      // @capacitor/barcode-scanner v2: scanBarcode({ hint }) → { ScanResult: "..." }
      // Older plugins: scan() → { content } or { barcodes: [...] }
      const res = (await (Scanner.scanBarcode?.({ hint: 17 /* ALL */ }) ?? Scanner.scan?.())) ?? {}
      const raw = res.ScanResult
                ?? res.barcodes?.[0]?.rawValue
                ?? res.barcodes?.[0]?.displayValue
                ?? res.content
                ?? ''
      // Accept either a raw 6-char code or a ziggy://pair?code=XXX URL.
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
  // Motion / Activity recognition is a custom plugin (ziggy-presence) — not in
  // any official Capacitor plugin. Phase 3 wires this up; for now we skip
  // gracefully so the onboarding completes.
  useEffect(() => { onDone() }, [onDone])
  return null
}

function DoneStep({ onDone }) {
  const t = useT()
  // Auto-advance after 1.5s, but also expose a manual button after 1s in case
  // anything in the post-navigate redirect chain hiccups. The button is a
  // visible fallback the user can always tap — no more stuck screens.
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
