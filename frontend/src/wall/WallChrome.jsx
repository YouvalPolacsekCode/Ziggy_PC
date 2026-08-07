// Wall chrome — header, idle screen, PIN pad, module picker, toast, and the
// connection indicator. Small pieces, grouped because none of them is big
// enough to earn its own file and they are only ever used together.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useT, useLangStore } from '../lib/i18n'
import { useUIStore } from '../stores/uiStore'
import { useWallStore } from '../stores/wallStore'
import { availableManifests } from './modules/registry'
import { verifyWallPin } from '../lib/api'
import { useNow } from './modules/CoreModules'

const ZiggyMark = ({ size = 26 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} className="zw-mark" aria-hidden="true">
    <g stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" fill="none">
      <path d="M12 3v18" /><path d="M4.2 7.5l15.6 9" /><path d="M19.8 7.5l-15.6 9" />
    </g>
  </svg>
)

// ─── Header ─────────────────────────────────────────────────────────────────

export const WallHeader = memo(function WallHeader({
  view, setView, onOpenDevices, onOpenRail, weather, policy,
}) {
  const t = useT()
  const now = useNow(20_000)
  const lang = useLangStore((s) => s.lang)
  const setLang = useLangStore((s) => s.setLang)
  const theme = useUIStore((s) => s.theme)
  const toggleTheme = useUIStore((s) => s.toggleTheme)
  const editing = useWallStore((s) => s.editing)
  const startEdit = useWallStore((s) => s.startEdit)
  const commitEdit = useWallStore((s) => s.commitEdit)

  const greeting = useMemo(() => {
    const h = now.getHours()
    if (h < 5)  return t('wall.greet.night')
    if (h < 12) return t('wall.greet.morning')
    if (h < 17) return t('wall.greet.afternoon')
    if (h < 22) return t('wall.greet.evening')
    return t('wall.greet.night')
  }, [now, t])

  const locale = lang === 'he' ? 'he-IL' : undefined
  const canOpenDevices = policy?.capabilities?.devices !== false

  return (
    <header className="zw-header">
      <button
        className="zw-btn zw-btn-icon zw-rail-toggle"
        onClick={onOpenRail}
        aria-label={t('wall.rail.expand')}
      >☰</button>

      <ZiggyMark />

      <div className="zw-ident">
        <div className="zw-eyebrow zw-date">
          {now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
        <div className="zw-greet">{greeting}, {t('wall.greetSuffix')}</div>
      </div>

      <div className="zw-tabs" role="tablist">
        <button role="tab" aria-selected={view === 'home'} className="zw-tab" onClick={() => setView('home')}>
          {t('wall.tab.home')}
        </button>
        <button role="tab" aria-selected={view === 'autos'} className="zw-tab" onClick={() => setView('autos')}>
          {t('wall.tab.autos')}
        </button>
      </div>

      <div className="zw-clock-wrap">
        <div className="zw-clock">{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
        {weather && <div className="zw-weather">{weather}</div>}
      </div>

      <div className="zw-actions">
        {canOpenDevices && (
          <button className="zw-btn" onClick={onOpenDevices}>{t('wall.devices')}</button>
        )}
        <button
          className="zw-btn zw-btn-icon"
          onClick={toggleTheme}
          aria-label="theme"
          title="theme"
        >{theme === 'dark' ? '☀' : '☾'}</button>
        <button
          className="zw-btn zw-btn-icon zw-btn-mono"
          onClick={() => setLang(lang === 'he' ? 'en' : 'he')}
        >{lang === 'he' ? 'EN' : 'עב'}</button>
        <button
          className={`zw-btn${editing ? ' is-on' : ''}`}
          onClick={() => (editing ? commitEdit() : startEdit())}
        >{editing ? t('wall.editDone') : `✎ ${t('wall.edit')}`}</button>
      </div>
    </header>
  )
})

// ─── Connection indicator ───────────────────────────────────────────────────

export const ConnectionChip = memo(function ConnectionChip({ connected }) {
  const t = useT()
  // Don't flash on a momentary blip — only speak up once it's actually a
  // problem a person should notice.
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (connected) { setShow(false); return }
    const id = setTimeout(() => setShow(true), 2500)
    return () => clearTimeout(id)
  }, [connected])

  if (!show) return null
  return (
    <div className="zw-conn" role="status">
      <span className="zw-conn-dot" />
      {t('wall.reconnecting')}
    </div>
  )
})

// ─── Toast ──────────────────────────────────────────────────────────────────

export const WallToast = memo(function WallToast({ toast }) {
  if (!toast) return null
  return <div className={`zw-toast${toast.tone === 'err' ? ' is-err' : ''}`}>{toast.text}</div>
})

// ─── Idle / always-on-display ───────────────────────────────────────────────

export const IdleScreen = memo(function IdleScreen({ onWake, status }) {
  const t = useT()
  const now = useNow(10_000)
  const lang = useLangStore((s) => s.lang)
  const locale = lang === 'he' ? 'he-IL' : undefined

  return (
    <div className="zw-idle" onClick={onWake} onPointerDown={onWake} role="button" tabIndex={0}>
      <div className="zw-idle-inner">
        <div className="zw-idle-date">
          {now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}
        </div>
        <div className="zw-idle-clock">
          {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </div>
        <div className="zw-idle-status">{status}</div>
        <div className="zw-idle-orb" />
        <div className="zw-idle-tag">{t('wall.idle.tapToWake')}</div>
      </div>
    </div>
  )
})

// ─── PIN gate ───────────────────────────────────────────────────────────────

export const PinGate = memo(function PinGate({ tabletId }) {
  const t = useT()
  const pinFor = useWallStore((s) => s.pinFor)
  const resolvePin = useWallStore((s) => s.resolvePin)
  const grantElevation = useWallStore((s) => s.grantElevation)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { setPin(''); setError('') }, [pinFor])

  const submit = useCallback(async (value) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await verifyWallPin(tabletId, pinFor, value)
      if (res?.ok) {
        grantElevation(pinFor, (res.ttl_s || 300) * 1000)
        resolvePin(true)
      } else {
        setError(res?.reason === 'no_pin' ? t('wall.pin.notSet') : t('wall.pin.wrong'))
        setPin('')
      }
    } catch (e) {
      setError(e?.userMessage || t('wall.pin.wrong'))
      setPin('')
    } finally { setBusy(false) }
  }, [busy, tabletId, pinFor, grantElevation, resolvePin, t])

  const press = useCallback((d) => {
    const next = (pin + d).slice(0, 8)
    setPin(next)
    setError('')
    if (next.length === 4) submit(next)
  }, [pin, submit])

  if (!pinFor) return null

  return (
    <div className="zw-scrim" onClick={() => resolvePin(false)}>
      <div className="zw-modal" style={{ width: 'min(360px, 92vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="zw-pin">
          <div className="zw-modal-title">{t('wall.pin.title')}</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', textAlign: 'center' }}>
            {t('wall.pin.subtitle')}
          </div>
          <div className="zw-pin-dots">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`zw-pin-dot${pin.length > i ? ' is-filled' : ''}`} />
            ))}
          </div>
          {error && <div style={{ color: 'var(--err)', fontSize: 12.5 }}>{error}</div>}
          <div className="zw-pin-grid">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} className="zw-pin-key" onClick={() => press(d)}>{d}</button>
            ))}
            <button className="zw-pin-key is-blank" tabIndex={-1} />
            <button className="zw-pin-key" onClick={() => press('0')}>0</button>
            <button className="zw-pin-key" onClick={() => setPin((p) => p.slice(0, -1))}>⌫</button>
          </div>
          <button className="zw-btn" style={{ marginTop: 6 }} onClick={() => resolvePin(false)}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
})

// ─── Module picker ──────────────────────────────────────────────────────────

export const ModulePicker = memo(function ModulePicker({ open, onClose, policy }) {
  const t = useT()
  const addModule = useWallStore((s) => s.addModule)
  const draft = useWallStore((s) => s.draft)

  const items = useMemo(() => {
    const avail = availableManifests(policy?.capabilities)
    const counts = new Map()
    for (const m of (draft?.modules || [])) counts.set(m.type, (counts.get(m.type) || 0) + 1)
    // A single-instance module already on the board is offered greyed out
    // rather than hidden, so its absence from the list is never a mystery.
    return avail.map((m) => ({ ...m, used: !m.multiple && counts.has(m.type) }))
  }, [policy, draft])

  if (!open) return null

  return (
    <div className="zw-scrim" onClick={onClose}>
      <div className="zw-modal" onClick={(e) => e.stopPropagation()}>
        <div className="zw-modal-head">
          <div className="zw-modal-title">{t('wall.addModule')}</div>
          <button className="zw-btn zw-btn-icon" style={{ marginInlineStart: 'auto' }} onClick={onClose}>✕</button>
        </div>
        <div className="zw-modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px,100%),1fr))', gap: 10, paddingTop: 12 }}>
            {items.map((m) => (
              <button
                key={m.type}
                disabled={m.used}
                onClick={() => { addModule(m.type); onClose() }}
                style={{
                  textAlign: 'start', padding: '14px 16px', borderRadius: 14,
                  border: '0.5px solid var(--line)', background: 'var(--surface)',
                  color: 'var(--ink)', cursor: m.used ? 'default' : 'pointer',
                  opacity: m.used ? 0.4 : 1, font: 'inherit',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14 }}>{t(m.titleKey)}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 3 }}>{t(m.descKey)}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
})
