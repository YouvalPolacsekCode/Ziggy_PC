// Shared onboarding steps — platform-agnostic wizard steps used by BOTH the
// native MobileOnboarding flow and the web/PWA WebOnboarding flow.
//
// Each step is a dumb component: it takes an `onDone` (+ `onError` where it can
// fail) and drives one wizard screen. The only platform seam is the optional
// `authToken` prop: native passes nothing (the API client falls back to the
// paired device token), web passes the owner's super_admin session token minted
// by /api/auth/setup. The backend get_onboarding_principal dependency accepts
// either. See docs/superpowers/specs/2026-07-29-web-onboarding-path-design.md.

import { useEffect, useRef, useState } from 'react'
import { requestNotificationPermission } from '../../lib/native'
import {
  registerDevice,
  getOnboardingSensors,
  confirmSensors,
  getStarterPack,
  installAutomation,
  completeOnboarding,
} from '../../lib/mobileApi'
import { useT } from '../../lib/i18n'
import { primaryBtn, secondaryBtn, textInput, fieldLabel } from './styles'

// ── SENSORS naming wizard ────────────────────────────────────────────────────

export function SensorsStep({ onDone, onError, authToken = null }) {
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
        const res = await getOnboardingSensors(authToken)
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
  }, [onError, authToken])

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
      const res = await confirmSensors(payload, authToken)
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

// ── STARTER_PACK ─────────────────────────────────────────────────────────────

export function StarterStep({ userToken, onDone, onError, authToken = null }) {
  // Renders the resolved starter-pack list from /api/onboarding/starter-pack.
  // User toggles accept/skip per card; "Install selected" POSTs each
  // accepted automation's ha_payload to /api/automations (user-authed —
  // uses userToken from the claim/setup step).
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
        const res = await getStarterPack(authToken)
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
  }, [onError, authToken])

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

// ── Notifications permission ──────────────────────────────────────────────────

export function NotifyStep({ onDone }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const allow = async () => {
    setBusy(true)
    const status = await requestNotificationPermission()
    // registerDevice persists the grant against the paired device (native).
    // On web there is no device token, so this throws and is swallowed — the
    // permission is still requested and the wizard advances.
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

// ── DONE ───────────────────────────────────────────────────────────────────

export function DoneStep({
  onDone, isFirstPair, startedAt,
  sensorsConfirmedCount, automationsAcceptedCount, errors, onError,
  authToken = null,
}) {
  const t = useT()
  // Fire the completion telemetry once when we land here (only on the
  // first-pair / fresh-setup branch — subsequent pairs don't run the kit
  // setup loop).
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
    }, authToken).catch(e => onError(`complete:${e?.message || 'unknown'}`))
  }, [isFirstPair, startedAt, sensorsConfirmedCount, automationsAcceptedCount, errors, onError, authToken])

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

// ── Permission screen (shared shell) ─────────────────────────────────────────

export function PermissionScreen({ title, body, onAllow, onSkip, busy }) {
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
