/**
 * Parked v1 — kit ships via mobile-first MobileOnboarding.jsx flow. See docs/ONBOARDING_AUDIT.md §3.2 for context. Revisit for BYO-hardware v1.1+ tier.
 *
 * Onboarding — first-run wizard at /onboarding/*
 *
 * Routed unconditionally from App.jsx when the auth-status endpoint reports
 * `configured=false` (no owner account yet) OR `/api/onboarding/state` returns
 * `completed=false`. The user can still reach Settings during onboarding —
 * we don't want them locked out if they need to fix something — but everything
 * else is gated until the required steps (account, home_name, rooms) are done.
 *
 * Steps reuse the existing PairingWizard / IRWizard / SwitcherPairingFlow
 * components for device pairing so this file owns presentation + wizard chrome
 * only. Each step persists progress via patchOnboardingState — closing the
 * browser mid-flow resumes from the same place on the next login.
 */
import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, ArrowRight, Check, Home, MapPin, Bell, Mic,
  Smartphone, Wifi, Zap, Loader2,
  Sofa, Bed, CookingPot, Bath, Briefcase, Baby, Lightbulb, Tv,
} from 'lucide-react'
import { T_ENTER } from '../lib/motion'
import { useAuthStore } from '../stores/authStore'
import { useUIStore } from '../stores/uiStore'
import { setLang, useT } from '../lib/i18n'
import {
  getAuthStatus,
  getGeneralSettings, patchGeneralSettings,
  getOnboardingState, patchOnboardingState, completeOnboarding,
  probeHA, patchHaSettings,
  savePresenceZone,
  getRooms, createRoom,
  getSuggestedTemplates, getAutomationTemplates,
  patchVoiceSettings,
  getHealth,
} from '../lib/api'
import { PairWithPhone } from '../components/PairWithPhone'

const PairingWizard = lazy(() =>
  import('../components/PairingWizard').then(m => ({ default: m.PairingWizard }))
)

// ─── Step registry ─────────────────────────────────────────────────────────
// Canonical order — mirrors services/onboarding_state.STEP_IDS. Renderers
// live further down; we just match by id here.
const STEPS = [
  { id: 'language',              required: false },
  { id: 'account',               required: true  },
  { id: 'home_name',             required: true  },
  { id: 'timezone',              required: false },
  { id: 'connect_ha',            required: false }, // skip-able in cloud mode
  { id: 'coordinator',           required: false },
  { id: 'home_zone',             required: false },
  { id: 'rooms',                 required: true  },
  { id: 'device_categories',     required: false },
  { id: 'devices',               required: false },
  { id: 'notifications',         required: false },
  { id: 'suggested_automations', required: false },
  { id: 'voice',                 required: false },
  { id: 'mobile',                required: false },
  { id: 'done',                  required: false },
]

const STEP_IDS = STEPS.map(s => s.id)

// ─── Shell ─────────────────────────────────────────────────────────────────

export default function Onboarding() {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const setToken = useAuthStore(s => s.setToken)
  const authenticated = useAuthStore(s => s.authenticated)
  const addToast = useUIStore(s => s.addToast)

  const [bootstrapping, setBootstrapping] = useState(true)
  const [state, setState]                 = useState(null)   // onboarding state
  const [currentId, setCurrentId]         = useState('language')
  const [draft, setDraft]                 = useState({})     // shared across steps

  // Bootstrap: figure out which step to land on. If no account yet, force
  // language → account; otherwise resume from `next_pending`. If onboarding is
  // already done (e.g. user typed /onboarding manually), bounce home.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const auth = await getAuthStatus()
        if (cancelled) return
        if (!auth.configured) {
          setState({ steps_completed: [], skipped: [], completed: false, next_pending: 'language' })
          setCurrentId('language')
          setBootstrapping(false)
          return
        }
        // Already have an owner account — read onboarding state.
        const s = await getOnboardingState().catch(() => null)
        if (cancelled) return
        if (s?.completed) {
          navigate('/', { replace: true })
          return
        }
        setState(s)
        // Skip language + account; resume from the first not-done, not-skipped step.
        const resume = s?.next_pending || 'home_name'
        setCurrentId(resume === 'language' || resume === 'account' ? 'home_name' : resume)
        setBootstrapping(false)
      } catch {
        if (!cancelled) {
          setState({ steps_completed: [], skipped: [], completed: false })
          setBootstrapping(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [navigate])

  const stepIndex = STEP_IDS.indexOf(currentId)
  const stepMeta  = STEPS[stepIndex] || STEPS[0]
  const totalShown = STEPS.length - 1   // exclude "done" from progress bar

  const goTo = useCallback((id) => {
    setCurrentId(id)
  }, [])

  const goNext = useCallback(async (opts = {}) => {
    const { skipped = false, mergeDraft } = opts
    if (mergeDraft) setDraft(d => ({ ...d, ...mergeDraft }))
    // Only persist for steps that exist post-account.
    if (currentId !== 'language' && currentId !== 'account' && authenticated) {
      try {
        const next = await patchOnboardingState({ step_id: currentId, skipped })
        setState(next)
      } catch {
        // Persistence failure shouldn't trap the user — just log.
        console.warn('[Onboarding] failed to persist step', currentId)
      }
    }
    // Pick the next id linearly. We don't auto-skip based on state — the user
    // can always Back into a "done" step to redo it.
    const next = STEPS[stepIndex + 1]
    if (next) setCurrentId(next.id)
  }, [currentId, stepIndex, authenticated])

  const goBack = useCallback(() => {
    // Don't allow back past Account once it's been created (irreversible).
    if (authenticated && (currentId === 'home_name' || currentId === 'language' || currentId === 'account')) {
      // Block back from the first authenticated step.
      return
    }
    const prev = STEPS[stepIndex - 1]
    if (prev) setCurrentId(prev.id)
  }, [stepIndex, currentId, authenticated])

  const finish = useCallback(async () => {
    try { await completeOnboarding() } catch {}
    addToast(t('onboarding.done.toast') || 'All set!', 'success')
    navigate('/', { replace: true })
  }, [addToast, navigate, t])

  if (bootstrapping) {
    return <FullScreenSpinner />
  }

  return (
    <div style={shellStyles.page}>
      <header style={shellStyles.header}>
        <ProgressBar current={Math.min(stepIndex, totalShown)} total={totalShown} />
      </header>

      <main style={shellStyles.main}>
        <AnimatePresence mode="wait">
          <motion.div
            key={currentId}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={T_ENTER}
            style={{ width: '100%', maxWidth: 480 }}
          >
            <StepRouter
              id={currentId}
              draft={draft}
              onDraftChange={setDraft}
              onNext={goNext}
              onBack={goBack}
              onFinish={finish}
              onSetToken={setToken}
              addToast={addToast}
              t={t}
            />
          </motion.div>
        </AnimatePresence>
      </main>

      {!stepMeta.required && currentId !== 'language' && currentId !== 'account' && currentId !== 'done' && (
        <footer style={shellStyles.footer}>
          <button
            onClick={() => goNext({ skipped: true })}
            style={shellStyles.skipBtn}
          >
            {t('onboarding.skipForNow') || 'Skip for now'}
          </button>
        </footer>
      )}
    </div>
  )
}

function FullScreenSpinner() {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <Loader2 size={24} className="z-spin" style={{ color: 'var(--ink-mute)' }} />
    </div>
  )
}

function ProgressBar({ current, total }) {
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={current + 1}
         style={{ display: 'flex', gap: 4, padding: '0 20px', maxWidth: 520, margin: '0 auto' }}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            flex: 1, height: 8, borderRadius: 999,
            background: i <= current ? 'var(--ink)' : 'var(--line)',
            transition: 'background var(--dur-state) var(--ease-standard)',
          }}
        />
      ))}
    </div>
  )
}

// ─── Step router ──────────────────────────────────────────────────────────

function StepRouter({ id, draft, onDraftChange, onNext, onBack, onFinish, onSetToken, addToast, t }) {
  switch (id) {
    case 'language':              return <StepLanguage onNext={onNext} draft={draft} onDraftChange={onDraftChange} t={t} />
    case 'account':               return <StepAccount onNext={onNext} draft={draft} onDraftChange={onDraftChange} onSetToken={onSetToken} addToast={addToast} t={t} />
    case 'home_name':             return <StepHomeName onNext={onNext} onBack={onBack} draft={draft} onDraftChange={onDraftChange} t={t} />
    case 'timezone':              return <StepTimezone onNext={onNext} onBack={onBack} draft={draft} onDraftChange={onDraftChange} t={t} />
    case 'connect_ha':            return <StepConnectHA onNext={onNext} onBack={onBack} addToast={addToast} t={t} />
    case 'coordinator':           return <StepCoordinator onNext={onNext} onBack={onBack} t={t} />
    case 'home_zone':             return <StepHomeZone onNext={onNext} onBack={onBack} addToast={addToast} t={t} />
    case 'rooms':                 return <StepRooms onNext={onNext} onBack={onBack} addToast={addToast} t={t} />
    case 'device_categories':     return <StepDeviceCategories onNext={onNext} onBack={onBack} draft={draft} onDraftChange={onDraftChange} t={t} />
    case 'devices':               return <StepDevices onNext={onNext} onBack={onBack} draft={draft} t={t} />
    case 'notifications':         return <StepNotifications onNext={onNext} onBack={onBack} addToast={addToast} t={t} />
    case 'suggested_automations': return <StepSuggestedAutomations onNext={onNext} onBack={onBack} t={t} />
    case 'voice':                 return <StepVoice onNext={onNext} onBack={onBack} addToast={addToast} t={t} />
    case 'mobile':                return <StepMobile onNext={onNext} onBack={onBack} t={t} />
    case 'done':                  return <StepDone onFinish={onFinish} t={t} />
    default:                      return null
  }
}

// ─── Step components ─────────────────────────────────────────────────────

function StepLanguage({ onNext, draft, onDraftChange, t }) {
  const guess = (typeof navigator !== 'undefined' && /^he\b/i.test(navigator.language)) ? 'he' : 'en'
  const [chosen, setChosen] = useState(draft.language || guess)
  useEffect(() => { setLang(chosen) }, [chosen])

  return (
    <StepLayout
      title={t('onboarding.language.title') || 'Welcome to Ziggy'}
      subtitle={t('onboarding.language.subtitle') || 'Choose your language to get started.'}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <LangTile flag="🇺🇸" label="English" selected={chosen === 'en'} onSelect={() => setChosen('en')} />
        <LangTile flag="🇮🇱" label="עברית"  selected={chosen === 'he'} onSelect={() => setChosen('he')} />
      </div>
      <PrimaryBtn
        onClick={() => { onDraftChange({ ...draft, language: chosen }); onNext() }}
        style={{ marginTop: 24 }}
      >
        {t('onboarding.continue') || 'Continue'}
      </PrimaryBtn>
    </StepLayout>
  )
}

function LangTile({ flag, label, selected, onSelect }) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        minHeight: 56, padding: '20px 12px', borderRadius: 'var(--r-card)',
        background: selected ? 'var(--surface-2)' : 'var(--surface)',
        border: `0.5px solid ${selected ? 'var(--line-2)' : 'var(--line)'}`,
        cursor: 'pointer', fontFamily: 'inherit',
        transition: 'background var(--dur-state) var(--ease-standard), border-color var(--dur-state) var(--ease-standard)',
      }}
    >
      {/* Country flags are the one emoji allowed as a glyph. */}
      <span style={{ fontSize: 34, lineHeight: '41px' }} aria-hidden>{flag}</span>
      <span style={{ fontSize: 15, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)' }}>{label}</span>
    </button>
  )
}

function StepAccount({ onNext, draft, onDraftChange, onSetToken, addToast, t }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')

  const submit = async () => {
    if (!username.trim()) { setError(t('onboarding.account.usernameRequired') || 'Username required'); return }
    if (password.length < 6) { setError(t('onboarding.account.passwordTooShort') || 'Password must be at least 6 characters'); return }
    if (password !== confirm) { setError(t('onboarding.account.passwordsMismatch') || "Passwords don't match"); return }
    setBusy(true); setError('')
    try {
      const guessTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
          language: draft.language || 'en',
          timezone: guessTz,
          // Country is inferred from the language pick for Israel-first launch;
          // user can correct later in Settings.
          country: (draft.language === 'he') ? 'IL' : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.detail || 'Setup failed'); return }
      onSetToken(data.token, data.role)
      onDraftChange({ ...draft, username: username.trim(), timezone: guessTz })
      onNext()
    } catch (e) {
      setError(e?.message || 'Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepLayout
      title={t('onboarding.account.title') || 'Create your account'}
      subtitle={t('onboarding.account.subtitle') || 'This account owns the home. You can invite family later.'}
    >
      <FormField label={t('common.username') || 'Username'}>
        <input
          autoFocus
          value={username}
          onChange={e => { setUsername(e.target.value); setError('') }}
          autoCapitalize="none"
          autoComplete="username"
          style={inputStyle}
        />
      </FormField>
      <FormField label={t('settings.newPassword') || 'Password'}>
        <input
          type="password"
          value={password}
          onChange={e => { setPassword(e.target.value); setError('') }}
          autoComplete="new-password"
          style={inputStyle}
        />
      </FormField>
      <FormField label={t('common.confirmPassword') || 'Confirm password'}>
        <input
          type="password"
          value={confirm}
          onChange={e => { setConfirm(e.target.value); setError('') }}
          autoComplete="new-password"
          style={inputStyle}
        />
      </FormField>
      {error && <ErrorText>{error}</ErrorText>}
      <PrimaryBtn onClick={submit} disabled={busy} style={{ marginTop: 16 }}>
        {busy ? (t('onboarding.account.creating') || 'Creating…') : (t('onboarding.account.create') || 'Create account')}
      </PrimaryBtn>
    </StepLayout>
  )
}

function StepHomeName({ onNext, onBack, draft, onDraftChange, t }) {
  const [name, setName] = useState(draft.home_name || (t('onboarding.homeName.default') || 'Home'))
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      await patchGeneralSettings({ /* general doesn't carry home name; admin/setup did */ })
    } catch {}
    onDraftChange({ ...draft, home_name: name.trim() })
    setBusy(false)
    onNext()
  }

  return (
    <StepLayout
      title={t('onboarding.homeName.title') || 'What should we call your home?'}
      subtitle={t('onboarding.homeName.subtitle') || 'You can change this anytime.'}
    >
      <FormField label={t('onboarding.homeName.label') || 'Home name'}>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          dir="auto"
          style={inputStyle}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
        />
      </FormField>
      <Row>
        <SecondaryBtn onClick={onBack}>{t('onboarding.back') || 'Back'}</SecondaryBtn>
        <PrimaryBtn onClick={submit} disabled={busy || !name.trim()}>
          {t('onboarding.continue') || 'Continue'}
        </PrimaryBtn>
      </Row>
    </StepLayout>
  )
}

function StepTimezone({ onNext, onBack, draft, onDraftChange, t }) {
  const guess = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const [tz, setTz] = useState(draft.timezone || guess)
  const options = [
    'UTC','Asia/Jerusalem','Europe/London','Europe/Paris','Europe/Berlin',
    'America/New_York','America/Chicago','America/Los_Angeles','Asia/Tokyo','Australia/Sydney',
  ]
  if (!options.includes(tz)) options.unshift(tz)

  const submit = async () => {
    try { await patchGeneralSettings({ timezone: tz }) } catch {}
    onDraftChange({ ...draft, timezone: tz })
    onNext()
  }

  return (
    <StepLayout
      title={t('onboarding.timezone.title') || 'Confirm your timezone'}
      subtitle={t('onboarding.timezone.subtitle') || 'Used for time-based automations and reminders.'}
    >
      <FormField label={t('settings.timezone') || 'Timezone'}>
        <select value={tz} onChange={e => setTz(e.target.value)} style={inputStyle}>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </FormField>
      <Row>
        <SecondaryBtn onClick={onBack}>{t('onboarding.back') || 'Back'}</SecondaryBtn>
        <PrimaryBtn onClick={submit}>{t('onboarding.continue') || 'Continue'}</PrimaryBtn>
      </Row>
    </StepLayout>
  )
}

function StepConnectHA({ onNext, onBack, addToast, t }) {
  const [url, setUrl]       = useState('http://homeassistant.local:8123')
  const [token, setToken]   = useState('')
  const [busy, setBusy]     = useState(false)
  const [probe, setProbe]   = useState(null)
  const [error, setError]   = useState('')

  const test = async () => {
    if (!url.trim() || !token.trim()) {
      setError(t('onboarding.ha.bothRequired') || 'URL and token are required')
      return
    }
    setBusy(true); setError(''); setProbe(null)
    try {
      const r = await probeHA({ url: url.trim(), token: token.trim() })
      setProbe(r)
      if (!r.ok) setError(r.error || 'Probe failed')
    } catch (e) {
      setError(e?.message || 'Probe failed')
    } finally {
      setBusy(false)
    }
  }

  const saveAndContinue = async () => {
    setBusy(true); setError('')
    try {
      // Use a fresh probe so we don't persist a bad token.
      const r = probe?.ok ? probe : await probeHA({ url: url.trim(), token: token.trim() })
      if (!r.ok) { setError(r.error || 'Connection failed'); setBusy(false); return }
      await patchHaSettings({ url: url.trim(), token: token.trim() })
      addToast(t('onboarding.ha.connected') || 'Connected to Home Assistant', 'success')
      onNext()
    } catch (e) {
      setError(e?.message || 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepLayout
      title={t('onboarding.ha.title') || 'Connect Home Assistant'}
      subtitle={t('onboarding.ha.subtitle') || 'Ziggy uses your Home Assistant install for device control. Paste its address and a long-lived access token.'}
    >
      <FormField label={t('onboarding.ha.urlLabel') || 'Home Assistant URL'}>
        <input
          autoFocus
          value={url}
          onChange={e => { setUrl(e.target.value); setProbe(null) }}
          dir="ltr"
          className="z-code"
          style={inputStyle}
        />
      </FormField>
      <FormField
        label={t('onboarding.ha.tokenLabel') || 'Long-lived access token'}
        hint={t('onboarding.ha.tokenHint') || 'HA → Profile → Long-lived access tokens → Create'}
      >
        <input
          type="password"
          value={token}
          onChange={e => { setToken(e.target.value); setProbe(null) }}
          dir="ltr"
          style={inputStyle}
        />
      </FormField>
      {probe?.ok && (
        <div style={successBox}>
          <Check size={20} strokeWidth={2} style={{ color: 'var(--ok)', flexShrink: 0 }} /> {t('onboarding.ha.connectedV', { v: probe.ha_version || '' }) || `Connected${probe.ha_version ? ` · HA ${probe.ha_version}` : ''}`}
        </div>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <Row>
        <SecondaryBtn onClick={onBack}>{t('onboarding.back') || 'Back'}</SecondaryBtn>
        <SecondaryBtn onClick={test} disabled={busy}>
          {busy ? '…' : (t('onboarding.ha.test') || 'Test')}
        </SecondaryBtn>
        <PrimaryBtn onClick={saveAndContinue} disabled={busy || !url.trim() || !token.trim()}>
          {t('onboarding.continue') || 'Continue'}
        </PrimaryBtn>
      </Row>
    </StepLayout>
  )
}

function StepCoordinator({ onNext, onBack, t }) {
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try { setHealth(await getHealth()) } catch { setHealth(null) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const connected = !!health?.coordinator_title
  const haOnline  = !!health?.ha_connected

  return (
    <StepLayout
      title={t('onboarding.coord.title') || 'Zigbee coordinator'}
      subtitle={t('onboarding.coord.subtitle') || 'Optional — needed only for Zigbee devices (sensors, bulbs, switches).'}
    >
      <div className="z-card" style={{ padding: 12 }}>
        {loading ? (
          <Loader2 size={20} className="z-spin" style={{ color: 'var(--ink-mute)' }} />
        ) : !haOnline ? (
          <p className="z-body" style={{ color: 'var(--ink-mute)' }}>
            {t('onboarding.coord.haOffline') || "Your hub is offline — we can't check for a coordinator right now."}
          </p>
        ) : connected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Check size={24} strokeWidth={2} style={{ color: 'var(--ok)', flexShrink: 0 }} />
            <div>
              <p className="z-headline">
                {health.coordinator_title}
              </p>
              <p className="z-subhead">
                {t('onboarding.coord.detected') || 'Detected and ready for pairing.'}
              </p>
            </div>
          </div>
        ) : (
          <div>
            <p className="z-body" style={{ marginBottom: 8 }}>
              {t('onboarding.coord.notFound') || 'No Zigbee coordinator detected.'}
            </p>
            <p className="z-subhead">
              {t('onboarding.coord.howTo') || "For Zigbee devices, plug in a coordinator (SMLIGHT, Sonoff, ConBee). Don't have one yet? Skip — Ziggy will pick it up the moment you add one."}
            </p>
          </div>
        )}
      </div>
      <Row>
        <SecondaryBtn onClick={onBack}>{t('onboarding.back') || 'Back'}</SecondaryBtn>
        <SecondaryBtn onClick={load}>{t('onboarding.coord.recheck') || 'Re-check'}</SecondaryBtn>
        <PrimaryBtn onClick={onNext}>{t('onboarding.continue') || 'Continue'}</PrimaryBtn>
      </Row>
    </StepLayout>
  )
}

function StepHomeZone({ onNext, onBack, addToast, t }) {
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const [radius, setRadius] = useState(100)
  const [locating, setLocating] = useState(false)
  const [saving, setSaving] = useState(false)

  const locate = () => {
    if (!('geolocation' in navigator)) {
      addToast(t('onboarding.zone.noGeo') || 'Geolocation not available', 'error')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLat(String(pos.coords.latitude))
        setLon(String(pos.coords.longitude))
        setLocating(false)
      },
      err => {
        setLocating(false)
        addToast(err.code === 1 ? (t('onboarding.zone.denied') || 'Permission denied') : (t('onboarding.zone.failed') || 'Could not get location'), 'error')
      },
      { enableHighAccuracy: true, timeout: 12000 },
    )
  }

  const save = async () => {
    if (!lat || !lon) { onNext({ skipped: true }); return }
    setSaving(true)
    try {
      await savePresenceZone({
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        radius_m: parseFloat(radius) || 100,
      })
      addToast(t('onboarding.zone.saved') || 'Home location saved', 'success')
      onNext()
    } catch (e) {
      addToast(e?.message || 'Failed to save', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <StepLayout
      title={t('onboarding.zone.title') || 'Where is your home?'}
      subtitle={t('onboarding.zone.subtitle') || 'Used for presence-based automations like "turn off lights when everyone leaves."'}
      icon={MapPin}
    >
      <PrimaryBtn onClick={locate} disabled={locating} style={{ marginBottom: 12 }}>
        {locating ? (t('onboarding.zone.locating') || 'Locating…') : (t('onboarding.zone.useMyLocation') || 'Use my location')}
      </PrimaryBtn>
      <Row>
        <FormField label={t('onboarding.zone.lat') || 'Lat'} style={{ flex: 1 }}>
          <input value={lat} onChange={e => setLat(e.target.value)} style={inputStyle} dir="ltr" />
        </FormField>
        <FormField label={t('onboarding.zone.lon') || 'Lon'} style={{ flex: 1 }}>
          <input value={lon} onChange={e => setLon(e.target.value)} style={inputStyle} dir="ltr" />
        </FormField>
      </Row>
      <FormField label={`${t('onboarding.zone.radius') || 'Radius'} (m)`}>
        <input type="number" min={20} max={2000} value={radius} onChange={e => setRadius(e.target.value)} style={inputStyle} dir="ltr" />
      </FormField>
      <Row>
        <SecondaryBtn onClick={onBack}>{t('onboarding.back') || 'Back'}</SecondaryBtn>
        <PrimaryBtn onClick={save} disabled={saving}>
          {saving ? '…' : (t('onboarding.continue') || 'Continue')}
        </PrimaryBtn>
      </Row>
    </StepLayout>
  )
}

const ROOM_PRESETS = [
  { icon: Sofa,       key: 'rooms.preset.living',  default: 'Living Room' },
  { icon: Bed,        key: 'rooms.preset.bedroom', default: 'Bedroom' },
  { icon: CookingPot, key: 'rooms.preset.kitchen', default: 'Kitchen' },
  { icon: Bath,       key: 'rooms.preset.bathroom', default: 'Bathroom' },
  { icon: Briefcase,  key: 'rooms.preset.office',  default: 'Office' },
  { icon: Baby,       key: 'rooms.preset.kids',    default: "Kid's Room" },
]

function StepRooms({ onNext, onBack, addToast, t }) {
  const [selected, setSelected] = useState(() => new Set(['Living Room', 'Bedroom', 'Kitchen']))
  const [custom, setCustom]     = useState('')
  const [existing, setExisting] = useState([])
  const [saving, setSaving]     = useState(false)

  useEffect(() => {
    getRooms().then(rs => setExisting(Array.isArray(rs) ? rs : (rs.areas || rs.rooms || []))).catch(() => {})
  }, [])

  const toggle = (name) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const addCustom = () => {
    const n = custom.trim()
    if (!n) return
    setSelected(prev => new Set([...prev, n]))
    setCustom('')
  }

  const save = async () => {
    const existingNames = new Set(existing.map(r => (r.name || '').toLowerCase()))
    const toCreate = [...selected].filter(n => !existingNames.has(n.toLowerCase()))
    if (toCreate.length === 0 && selected.size === 0) {
      addToast(t('onboarding.rooms.pickAtLeastOne') || 'Pick at least one room', 'error')
      return
    }
    setSaving(true)
    let created = 0
    for (const name of toCreate) {
      try { await createRoom(name); created += 1 } catch {}
    }
    setSaving(false)
    if (created > 0) addToast(t('onboarding.rooms.created', { n: created }) || `Created ${created} rooms`, 'success')
    onNext()
  }

  return (
    <StepLayout
      title={t('onboarding.rooms.title') || 'Pick your rooms'}
      subtitle={t('onboarding.rooms.subtitle') || 'These help organize your devices and automations.'}
      icon={Home}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 12 }}>
        {ROOM_PRESETS.map(p => {
          const name = t(p.key) || p.default
          const on = selected.has(name)
          const RoomIcon = p.icon
          return (
            <button
              key={p.default}
              onClick={() => toggle(name)}
              aria-pressed={on}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, minHeight: 48,
                padding: '12px 16px', borderRadius: 'var(--r-ctl)',
                background: on ? 'var(--surface-2)' : 'var(--surface)',
                border: `0.5px solid ${on ? 'var(--line-2)' : 'var(--line)'}`,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'start',
                transition: 'background var(--dur-state) var(--ease-standard), border-color var(--dur-state) var(--ease-standard)',
              }}
            >
              <RoomIcon size={24} strokeWidth={1.75} aria-hidden style={{ color: 'var(--ink-2)', flexShrink: 0 }} />
              <span style={{ fontSize: 15, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)', flex: 1, minWidth: 0 }}>{name}</span>
              {on && <Check size={20} strokeWidth={2} style={{ color: 'var(--ink)', flexShrink: 0 }} />}
            </button>
          )
        })}
      </div>
      <Row>
        <input
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addCustom() }}
          placeholder={t('onboarding.rooms.customPh') || 'Add a custom room'}
          style={{ ...inputStyle, flex: 1 }}
          dir="auto"
        />
        <SecondaryBtn onClick={addCustom} disabled={!custom.trim()}>
          {t('onboarding.rooms.add') || 'Add'}
        </SecondaryBtn>
      </Row>
      <p className="z-footnote z-mono" style={{ marginTop: 4 }}>
        {t('onboarding.rooms.selectedN', { n: selected.size }) || `${selected.size} selected`}
      </p>
      <Row>
        <SecondaryBtn onClick={onBack}>{t('onboarding.back') || 'Back'}</SecondaryBtn>
        <PrimaryBtn onClick={save} disabled={saving || selected.size === 0}>
          {saving ? '…' : (t('onboarding.continue') || 'Continue')}
        </PrimaryBtn>
      </Row>
    </StepLayout>
  )
}

// `icon` is a Lucide component; `flag` is a country flag (the one emoji
// allowed as a glyph) for the Israel-only Switcher category.
const DEVICE_CATEGORIES = [
  { id: 'zigbee',   icon: Lightbulb, key: 'onboarding.cat.zigbee',   defaultLabel: 'Zigbee (bulbs, sensors)' },
  { id: 'wifi',     icon: Wifi,      key: 'onboarding.cat.wifi',     defaultLabel: 'Wi-Fi devices' },
  { id: 'ir',       icon: Tv,        key: 'onboarding.cat.ir',       defaultLabel: 'TV / AC (IR)' },
  { id: 'switcher', flag: '🇮🇱',     key: 'onboarding.cat.switcher', defaultLabel: 'Switcher (Israel)' },
]

function StepDeviceCategories({ onNext, onBack, draft, onDraftChange, t }) {
  const [picked, setPicked] = useState(new Set(draft.device_categories || []))
  const toggle = (id) => {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  return (
    <StepLayout
      title={t('onboarding.cat.title') || 'What do you want to add?'}
      subtitle={t('onboarding.cat.subtitle') || 'You can skip and add devices later.'}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {DEVICE_CATEGORIES.map(c => {
          const on = picked.has(c.id)
          const CatIcon = c.icon
          return (
            <button
              key={c.id}
              onClick={() => toggle(c.id)}
              aria-pressed={on}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                minHeight: 56, padding: '20px 12px', borderRadius: 'var(--r-card)',
                background: on ? 'var(--surface-2)' : 'var(--surface)',
                border: `0.5px solid ${on ? 'var(--line-2)' : 'var(--line)'}`,
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'background var(--dur-state) var(--ease-standard), border-color var(--dur-state) var(--ease-standard)',
              }}
            >
              {CatIcon
                ? <CatIcon size={24} strokeWidth={1.75} aria-hidden style={{ color: 'var(--ink-2)' }} />
                : <span style={{ fontSize: 20, lineHeight: '24px' }} aria-hidden>{c.flag}</span>}
              <span style={{ fontSize: 13, lineHeight: '20px', fontWeight: 600, color: 'var(--ink)', textAlign: 'center' }}>
                {t(c.key) || c.defaultLabel}
              </span>
            </button>
          )
        })}
      </div>
      <Row>
        <SecondaryBtn onClick={onBack}>{t('onboarding.back') || 'Back'}</SecondaryBtn>
        <PrimaryBtn onClick={() => { onDraftChange({ ...draft, device_categories: [...picked] }); onNext() }}>
          {t('onboarding.continue') || 'Continue'}
        </PrimaryBtn>
      </Row>
    </StepLayout>
  )
}

function StepDevices({ onNext, onBack, draft, t }) {
  // The wizard reuses the existing PairingWizard modal as a full-screen step.
  // Users can pair multiple devices, then hit "I'm done" to advance.
  const [open, setOpen] = useState(true)
  const cats = draft.device_categories || []

  if (cats.length === 0) {
    // User skipped category selection — just offer the choice.
    return (
      <StepLayout
        title={t('onboarding.devices.titleEmpty') || 'No device types selected'}
        subtitle={t('onboarding.devices.subtitleEmpty') || 'You can add devices anytime from the Devices page.'}
        icon={Zap}
      >
        <Row>
          <SecondaryBtn onClick={onBack}>{t('onboarding.back') || 'Back'}</SecondaryBtn>
          <PrimaryBtn onClick={onNext}>{t('onboarding.continue') || 'Continue'}</PrimaryBtn>
        </Row>
      </StepLayout>
    )
  }

  return (
    <StepLayout
      title={t('onboarding.devices.title') || 'Add your first devices'}
      subtitle={t('onboarding.devices.subtitle') || 'Pair as many as you want — you can always come back to /devices for more.'}
      icon={Zap}
    >
      <Suspense fallback={<Loader2 size={20} className="z-spin" style={{ color: 'var(--ink-mute)' }} />}>
        <PairingWizard
          open={open}
          onClose={() => setOpen(false)}
          onAddIrDevice={() => {}}
        />
      </Suspense>
      <Row>
        <SecondaryBtn onClick={onBack}>{t('onboarding.back') || 'Back'}</SecondaryBtn>
        <SecondaryBtn onClick={() => setOpen(true)} disabled={open}>
          {t('onboarding.devices.openAgain') || 'Add another'}
        </SecondaryBtn>
        <PrimaryBtn onClick={onNext}>
          {t('onboarding.devices.done') || "I'm done"}
        </PrimaryBtn>
      </Row>
    </StepLayout>
  )
}

function StepNotifications({ onNext, onBack, addToast, t }) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')

  const request = async () => {
    if (typeof Notification === 'undefined') {
      addToast(t('onboarding.notif.unsupported') || 'Browser does not support notifications', 'error')
      return
    }
    setBusy(true)
    try {
      const perm = await Notification.requestPermission()
      setStatus(perm)
      if (perm === 'granted') addToast(t('onboarding.notif.granted') || 'Notifications enabled', 'success')
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepLayout
      title={t('onboarding.notif.title') || 'Stay informed'}
      subtitle={t('onboarding.notif.subtitle') || 'Get push alerts for motion, doors, leaks, and offline devices.'}
      icon={Bell}
    >
      <div className="z-card" style={{ padding: 12, marginBottom: 16 }}>
        <p className="z-body">
          {status === 'granted'
            ? (t('onboarding.notif.allowed') || 'Notifications allowed ✓')
            : status === 'denied'
              ? (t('onboarding.notif.denied') || 'Notifications blocked — enable in your browser settings.')
              : (t('onboarding.notif.ask') || 'We\'ll ask your browser to allow notifications.')}
        </p>
      </div>
      <Row>
        <SecondaryBtn onClick={onBack}>{t('onboarding.back') || 'Back'}</SecondaryBtn>
        {status !== 'granted' && (
          <PrimaryBtn onClick={request} disabled={busy}>
            {busy ? '…' : (t('onboarding.notif.enable') || 'Enable notifications')}
          </PrimaryBtn>
        )}
        <PrimaryBtn onClick={onNext}>{t('onboarding.continue') || 'Continue'}</PrimaryBtn>
      </Row>
    </StepLayout>
  )
}

function StepSuggestedAutomations({ onNext, onBack, t }) {
  const [items, setItems] = useState(null)
  useEffect(() => {
    getSuggestedTemplates()
      .then(r => setItems((r.suggested || []).slice(0, 3)))
      .catch(() => setItems([]))
  }, [])

  return (
    <StepLayout
      title={t('onboarding.autom.title') || 'Suggested automations'}
      subtitle={t('onboarding.autom.subtitle') || 'Based on the devices you have. Tap any to set up — or skip.'}
      icon={Zap}
    >
      {items === null ? (
        <Loader2 size={20} className="z-spin" style={{ color: 'var(--ink-mute)' }} />
      ) : items.length === 0 ? (
        <p className="z-body" style={{ color: 'var(--ink-mute)' }}>
          {t('onboarding.autom.none') || 'Nothing to suggest yet — pair more devices to unlock automations.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map(it => (
            <div key={it.id || it.name} className="z-card-sm" style={{
              minHeight: 48, padding: '12px 16px',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <Zap size={24} strokeWidth={1.75} aria-hidden style={{ color: 'var(--ink-2)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 15, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)' }}>{it.name}</p>
                <p className="z-subhead" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.description}
                </p>
              </div>
            </div>
          ))}
          <p className="z-footnote">
            {t('onboarding.autom.openLater') || 'Open Automations later to enable these.'}
          </p>
        </div>
      )}
      <Row>
        <SecondaryBtn onClick={onBack}>{t('onboarding.back') || 'Back'}</SecondaryBtn>
        <PrimaryBtn onClick={onNext}>{t('onboarding.continue') || 'Continue'}</PrimaryBtn>
      </Row>
    </StepLayout>
  )
}

function StepVoice({ onNext, onBack, addToast, t }) {
  const [mode, setMode]   = useState('ptt')
  const [busy, setBusy]   = useState(false)

  const save = async (selected) => {
    setBusy(true)
    try {
      await patchVoiceSettings({ enabled: true, listen_mode: selected })
      addToast(t('onboarding.voice.saved') || 'Voice settings saved — restart Ziggy for the change to take effect.', 'success', 5000)
      onNext()
    } catch (e) {
      addToast(e?.message || 'Failed to save', 'error')
      setBusy(false)
    }
  }

  return (
    <StepLayout
      title={t('onboarding.voice.title') || 'Talk to Ziggy?'}
      subtitle={t('onboarding.voice.subtitle') || 'Voice is optional. Tap how you\'d like to start a conversation.'}
      icon={Mic}
    >
      <ChoiceCard
        title={t('onboarding.voice.pttTitle') || 'Push to talk'}
        body={t('onboarding.voice.pttBody') || 'Press a key or tap the chat icon. Most private.'}
        selected={mode === 'ptt'}
        onClick={() => setMode('ptt')}
      />
      <ChoiceCard
        title={t('onboarding.voice.wakeTitle') || 'Say "Hey Ziggy"'}
        body={t('onboarding.voice.wakeBody') || 'Always-listening wake word. Requires a working microphone on this machine.'}
        selected={mode === 'wake'}
        onClick={() => setMode('wake')}
      />
      <Row>
        <SecondaryBtn onClick={onBack}>{t('onboarding.back') || 'Back'}</SecondaryBtn>
        <PrimaryBtn onClick={() => save(mode)} disabled={busy}>
          {busy ? '…' : (t('onboarding.continue') || 'Continue')}
        </PrimaryBtn>
      </Row>
    </StepLayout>
  )
}

function ChoiceCard({ title, body, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      style={{
        width: '100%', textAlign: 'start', minHeight: 56,
        padding: '12px 16px', borderRadius: 'var(--r-card)',
        background: selected ? 'var(--surface-2)' : 'var(--surface)',
        border: `0.5px solid ${selected ? 'var(--line-2)' : 'var(--line)'}`,
        cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        transition: 'background var(--dur-state) var(--ease-standard), border-color var(--dur-state) var(--ease-standard)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 15, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)' }}>{title}</p>
        <p className="z-subhead" style={{ marginTop: 2 }}>{body}</p>
      </div>
      {selected && <Check size={20} strokeWidth={2} style={{ color: 'var(--ink)', flexShrink: 0 }} />}
    </button>
  )
}

function StepMobile({ onNext, onBack, t }) {
  return (
    <StepLayout
      title={t('onboarding.mobile.title') || 'Take Ziggy with you'}
      subtitle={t('onboarding.mobile.subtitle') || 'Install the Ziggy Home app and pair it with this code.'}
      icon={Smartphone}
    >
      <PairWithPhone />
      <Row>
        <SecondaryBtn onClick={onBack}>{t('onboarding.back') || 'Back'}</SecondaryBtn>
        <PrimaryBtn onClick={onNext}>{t('onboarding.continue') || 'Continue'}</PrimaryBtn>
      </Row>
    </StepLayout>
  )
}

function StepDone({ onFinish, t }) {
  // Bumped from 1.8s → 3.5s so the "what's next" hint below the checkmark
  // is actually readable before the auto-redirect kicks in.
  useEffect(() => {
    const id = setTimeout(onFinish, 3500)
    return () => clearTimeout(id)
  }, [onFinish])
  const whatsNext = t('onboarding.done.whatsNext')
  const showWhatsNext = whatsNext && whatsNext !== 'onboarding.done.whatsNext'
  return (
    <StepLayout
      title={t('onboarding.done.title') || "You're all set!"}
      subtitle={t('onboarding.done.subtitle') || 'Opening your home…'}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 16px 16px', gap: 16 }}>
        <div style={{
          width: 88, height: 88, borderRadius: '50%',
          background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Check size={44} style={{ color: 'var(--on-accent)' }} strokeWidth={2.5} />
        </div>
        {showWhatsNext && (
          <p className="z-body" style={{ color: 'var(--ink-mute)', textAlign: 'center', maxWidth: 360 }}>
            {whatsNext}
          </p>
        )}
      </div>
    </StepLayout>
  )
}

// ─── Layout primitives ───────────────────────────────────────────────────

function StepLayout({ title, subtitle, icon: Icon, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
        {Icon && (
          <div style={{ width: 40, height: 40, borderRadius: 'var(--r-ctl)', background: 'var(--surface-2)', border: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
            <Icon size={20} strokeWidth={1.75} style={{ color: 'var(--ink-2)' }} aria-hidden />
          </div>
        )}
        <h1 className="z-display" style={{ margin: 0 }}>{title}</h1>
        {subtitle && <p className="z-body" style={{ margin: 0, color: 'var(--ink-mute)' }}>{subtitle}</p>}
      </header>
      {children}
    </div>
  )
}

function FormField({ label, hint, children, style }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...(style || {}) }}>
      <label style={{ fontSize: 13, lineHeight: '20px', color: 'var(--ink)', fontWeight: 600 }}>{label}</label>
      {children}
      {hint && <p className="z-footnote" style={{ marginTop: 2 }}>{hint}</p>}
    </div>
  )
}

function Row({ children }) {
  return <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>{children}</div>
}

function ErrorText({ children }) {
  return <p role="alert" style={{ fontSize: 13, lineHeight: '20px', color: 'var(--err-text)', margin: '4px 0 0' }}>{children}</p>
}

// The one inverted (ink-on-bg) element per step; `.z-button` supplies the
// disabled dim and the 44px touch floor.
function PrimaryBtn({ children, style, className, ...rest }) {
  return (
    <button {...rest} className={`z-btn-primary z-button ${className || ''}`} style={{ flex: 1, ...(style || {}) }}>
      {children}
    </button>
  )
}

function SecondaryBtn({ children, style, className, ...rest }) {
  return (
    <button {...rest} className={`z-btn-secondary z-button ${className || ''}`} style={style}>
      {children}
    </button>
  )
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', minHeight: 40,
  padding: '12px 16px', borderRadius: 'var(--r-ctl)',
  border: '0.5px solid var(--line)', background: 'var(--surface)',
  color: 'var(--ink)', fontSize: 15, lineHeight: 1.3, fontFamily: 'inherit',
  outline: 'none',
}

const successBox = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '12px 16px', borderRadius: 'var(--r-ctl)',
  background: 'color-mix(in srgb, var(--ok) 12%, var(--surface))',
  color: 'var(--ok-text)', fontSize: 13, lineHeight: '20px', fontWeight: 500,
}

const shellStyles = {
  page: {
    minHeight: '100dvh', background: 'var(--bg)',
    display: 'flex', flexDirection: 'column',
    fontFamily: 'inherit',
  },
  header: {
    padding: 'max(24px, env(safe-area-inset-top, 0px)) 0 12px',
    flexShrink: 0,
  },
  main: {
    flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    padding: '12px 20px 24px',
    overflowY: 'auto',
  },
  footer: {
    flexShrink: 0,
    padding: '12px 20px max(24px, env(safe-area-inset-bottom, 12px))',
    display: 'flex', justifyContent: 'center',
  },
  skipBtn: {
    background: 'transparent', border: 'none',
    color: 'var(--ink-mute)', fontSize: 13, fontWeight: 500, minHeight: 40,
    cursor: 'pointer', fontFamily: 'inherit',
    padding: '8px 16px',
  },
}
