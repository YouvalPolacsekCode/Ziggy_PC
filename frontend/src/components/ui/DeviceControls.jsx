import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  SkipBack, SkipForward, Play, Pause, Volume2, VolumeX,
  ArrowUp, ArrowDown, Lock, LockOpen, Home, Square, Minus, Plus,
  Shuffle, Repeat, ChevronDown, X, Tv2, Check, Star,
  Snowflake, Flame, Wind, Droplets, Power, ArrowUpDown, Zap, Mic,
} from 'lucide-react'
import { Slider } from './Slider'
import { T_STATE, SPRING_SHEET } from '../../lib/motion'

// ── Chip recipe for every in-card option row (modes, speeds, sources…) ──
// 13/500 in `.z-chip` tone, 36px tall so a thumb can hit it. Active =
// surface-3 fill + ink + line-2 hairline, never inverted, never accent.
const CHIP_CLS = 'z-chip transition-colors capitalize'
const chipStyle = (active) => ({
  minHeight: 36, cursor: 'pointer', fontFamily: 'inherit',
  ...(active
    ? { background: 'var(--surface-3)', color: 'var(--ink)', borderColor: 'var(--line-2)', fontWeight: 600 }
    : { color: 'var(--ink-mute)' }),
})
// 44×44 quiet icon target (transport buttons, mute, close).
const ICON_BTN_STYLE = {
  width: 40, height: 40, borderRadius: 'var(--r-ctl)', flexShrink: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--ink-mute)',
}
import { cn, lightRgb } from '../../lib/utils'
import { DOMAIN_REGISTRY, TOGGLEABLE_DOMAINS as _REGISTRY_TOGGLEABLE } from '../../lib/domainRegistry'
import { useT } from '../../lib/i18n'
import { useUIStore } from '../../stores/uiStore'
import {
  getDevicePresets, addDevicePreset, renameDevicePreset, deleteDevicePreset,
  setDefaultDevicePreset, clearDefaultDevicePreset,
} from '../../lib/api'

// Capitalise + de-snake a raw HA mode/option for display.
const _humanize = (s) => String(s).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

// Translate an HA mode token (e.g. 'cool', 'heat_cool', 'fan_only') when a
// matching deviceControls.hvac* key exists; otherwise fall back to humanise.
const _hvacLabel = (t, mode) => {
  const KEY = {
    cool: 'deviceControls.hvacCool',
    heat: 'deviceControls.hvacHeat',
    auto: 'deviceControls.hvacAuto',
    heat_cool: 'deviceControls.hvacHeatCool',
    fan_only: 'deviceControls.hvacFanOnly',
    dry: 'deviceControls.hvacDry',
    off: 'deviceControls.hvacOff',
  }[mode]
  return KEY ? t(KEY) : _humanize(mode)
}

// Re-export TOGGLEABLE_DOMAINS derived from registry (keeps external imports working).
export const TOGGLEABLE_DOMAINS = _REGISTRY_TOGGLEABLE

// Media players report activity via multiple states, not just 'on'
const MEDIA_ACTIVE = new Set(['on', 'playing', 'paused', 'idle'])

export function isEntityOn(entity) {
  if (!entity) return false
  const domain = entity.domain || entity.entity_id?.split('.')[0]
  if (domain === 'media_player') return MEDIA_ACTIVE.has(entity.state)
  return entity.state === 'on'
}

// ── BrightnessLamp — vertical relative-drag for brightness, tap for on/off ──
// Anchors to the current value at pointerDown; vertical movement = delta.
// Tap with no movement fires onTap (parent uses this to toggle the light).
function BrightnessLamp({ value, onChange, onCommit, onTap, isOn, accentColor = 'var(--gold)', width = 128, height = 184 }) {
  const t = useT()
  const trackRef = useRef(null)
  const gesture  = useRef({ ptr: null, startY: 0, startValue: 0, moved: false })
  const [dragging, setDragging] = useState(false)
  const pct = Math.max(1, Math.min(100, value))

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    gesture.current = { ptr: e.pointerId, startY: e.clientY, startValue: pct, moved: false }
    setDragging(true)
  }
  const onPointerMove = (e) => {
    const g = gesture.current
    if (g.ptr !== e.pointerId || !trackRef.current) return
    const dy = g.startY - e.clientY
    if (!g.moved && Math.abs(dy) < 3) return
    g.moved = true
    const h = trackRef.current.getBoundingClientRect().height
    const delta = (dy / Math.max(1, h)) * 100
    onChange(Math.max(1, Math.min(100, Math.round(g.startValue + delta))))
  }
  const onPointerUp = (e) => {
    const g = gesture.current
    if (g.ptr !== e.pointerId) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    const moved = g.moved
    gesture.current.ptr = null
    setDragging(false)
    if (moved) { onCommit?.(pct) }
    else       { onTap?.() }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.035em', color: 'var(--ink)', lineHeight: 1 }}>
        {isOn ? `${pct}%` : t('deviceControls.off')}
      </div>
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: 'relative', width, height, borderRadius: 16,
          background: 'var(--surface-3)', overflow: 'hidden',
          border: '0.5px solid var(--line)',
          cursor: 'pointer', userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
        }}
      >
        {isOn && (
          <>
            <div style={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              height: `${pct}%`,
              background: accentColor,
              transition: dragging ? 'none' : 'height 0.18s',
            }} />
            <div style={{
              position: 'absolute', left: '22%', right: '22%',
              bottom: `${pct}%`,
              height: 4, marginBottom: -2,
              background: 'var(--ink)',
              borderRadius: 2,
              transition: dragging ? 'none' : 'bottom 0.18s',
            }} />
          </>
        )}
      </div>
    </div>
  )
}

// ── Dial — large circular progress arc ────────────────────────────────────────
function Dial({ size = 220, value = 70, max = 100, label, sublabel, color = 'var(--accent)', trackColor = 'var(--line)' }) {
  const r = size / 2 - 18
  const c = 2 * Math.PI * r
  const off = c * (1 - Math.max(0, Math.min(value, max)) / max)
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={trackColor} strokeWidth="14" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="14"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ fontSize: Math.round(size * 0.22), fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--ink)', lineHeight: 1 }}>{label}</div>
        {sublabel && <div className="z-mono" style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 8, letterSpacing: '0.04em' }}>{sublabel}</div>}
      </div>
    </div>
  )
}

// ── Gradient drag slider ───────────────────────────────────────────────────────
function GradientSlider({ value, onChange, onCommit, min = 0, max = 100, gradient, height = 34 }) {
  const trackRef = useRef(null)
  const pct = ((value - min) / (max - min)) * 100

  const getValueFromEvent = (e) => {
    const rect = trackRef.current.getBoundingClientRect()
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left
    const pct = Math.max(0, Math.min(1, x / rect.width))
    return Math.round(min + pct * (max - min))
  }

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const v = getValueFromEvent(e)
    onChange(v)
  }
  const onPointerMove = (e) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    onChange(getValueFromEvent(e))
  }
  const onPointerUp = (e) => {
    const v = getValueFromEvent(e)
    onChange(v)
    onCommit?.(v)
  }

  return (
    <div
      ref={trackRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        height, borderRadius: 16, position: 'relative',
        background: gradient, border: '0.5px solid var(--line)',
        cursor: 'ew-resize', touchAction: 'none', userSelect: 'none',
        overflow: 'visible',
      }}
    >
      {/* 28px round thumb — the one slider thumb size across the app. */}
      <div style={{
        position: 'absolute', top: '50%',
        left: `calc(${pct}% - 14px)`, width: 28, height: 28,
        transform: 'translateY(-50%)',
        background: 'var(--surface)', borderRadius: '50%',
        border: '2px solid var(--ink)',
        boxShadow: 'var(--shadow-md)',
        pointerEvents: 'none',
      }} />
    </div>
  )
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

const COLOR_SWATCHES = [
  { label: 'Red',    rgb: [255, 30,  0]   },
  { label: 'Orange', rgb: [255, 120, 0]   },
  { label: 'Yellow', rgb: [255, 210, 0]   },
  { label: 'Green',  rgb: [0,   200, 0]   },
  { label: 'Cyan',   rgb: [0,   200, 220] },
  { label: 'Blue',   rgb: [0,   60,  255] },
  { label: 'Purple', rgb: [160, 0,   255] },
  { label: 'Pink',   rgb: [255, 0,   140] },
  { label: 'White',  rgb: [255, 255, 255] },
]

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

function rgbToHex(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return '#ffffff'
  return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}

function MoreToggle({ expanded, onToggle, label }) {
  const t = useT()
  const resolvedLabel = label ?? t('deviceControls.moreOptions')
  return (
    <button
      onClick={onToggle}
      aria-expanded={expanded}
      className="flex items-center gap-1 min-h-[44px] text-footnote font-medium text-ink-mute hover:text-ink transition-colors self-start"
    >
      <ChevronDown
        size={14}
        strokeWidth={1.75}
        className={cn(expanded && 'rotate-180')}
        style={{ transition: 'transform var(--dur-state) var(--ease-standard)' }}
      />
      {expanded ? t('deviceControls.less') : resolvedLabel}
    </button>
  )
}

// `colorActive` / `colorIdle` are accepted for call-site compatibility but
// every chip now draws from the one chip recipe above.
// eslint-disable-next-line no-unused-vars
function ModeChips({ label, modes, current, colorActive, colorIdle, onSelect }) {
  if (!modes || modes.length === 0) return null
  return (
    <div className="flex gap-2 flex-wrap items-center">
      {label && <span className="text-footnote text-ink-mute me-1 shrink-0">{label}</span>}
      {modes.map((mode) => (
        <button
          key={mode}
          onClick={() => onSelect(mode)}
          aria-pressed={current === mode}
          className={CHIP_CLS}
          style={chipStyle(current === mode)}
        >
          {mode.replace(/_/g, ' ')}
        </button>
      ))}
    </div>
  )
}

// ─── Light ────────────────────────────────────────────────────────────────────
const COLOR_PRESETS = [
  { name: 'Warm',   labelKey: 'deviceControls.presetWarm',   hex: '#F4D08E' },
  { name: 'Cool',   labelKey: 'deviceControls.presetCool',   hex: '#FFFFFF' },
  { name: 'Sunset', labelKey: 'deviceControls.presetSunset', hex: '#E27A55' },
  { name: 'Ocean',  labelKey: 'deviceControls.presetOcean',  hex: '#7AAEE0' },
  { name: 'Forest', labelKey: 'deviceControls.presetForest', hex: '#6CBF8C' },
  { name: 'Candle', labelKey: 'deviceControls.presetCandle', hex: '#C99845' },
]

// ─── Device presets (named saved positions) ────────────────────────────────
// A preset is a still position — brightness + the light's active colour — that
// the user captures on the card and recalls in one tap. Home-scoped store lives
// behind /api/device/{id}/presets; applying is just a turn_on with the settings.
const MAX_DEVICE_PRESETS = 6

function presetSwatchColor(settings) {
  const rgb = lightRgb({
    rgb_color: settings.rgb_color,
    color_temp_kelvin: settings.color_temp_kelvin,
    color_mode: settings.rgb_color ? 'rgb' : 'color_temp',
  })
  return rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : 'var(--gold)'
}

// Is the light currently sitting on this preset? Brightness must be close AND
// the colour must match on the SAME dimension (temp-vs-temp or rgb-vs-rgb).
function settingsMatch(preset, live) {
  if (!preset || !live) return false
  if (Math.abs((preset.brightness_pct ?? -1) - (live.brightness_pct ?? -99)) > 3) return false
  const presetHasTemp = preset.color_temp_kelvin != null
  const presetHasRgb = !!preset.rgb_color
  if (!presetHasTemp && !presetHasRgb) return true  // brightness-only preset (plain dimmer)
  if (presetHasTemp && live.color_temp_kelvin != null)
    return Math.abs(preset.color_temp_kelvin - live.color_temp_kelvin) <= 150
  if (presetHasRgb && live.rgb_color)
    return preset.rgb_color.every((c, i) => Math.abs(c - live.rgb_color[i]) <= 25)
  return false
}

const _presetIconBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 999, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }
const _presetMenuItem = { display: 'block', width: '100%', textAlign: 'start', padding: '12px 16px', minHeight: 40, fontSize: 15, fontFamily: 'inherit', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink)' }
const _presetSavePill = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '8px 12px', minHeight: 36, borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', border: '1px dashed var(--line-2)', background: 'transparent', color: 'var(--ink-mute)' }
// A preset that is currently applied is an "on" tile — the one place an
// inverted chip is allowed.
const _presetPill = (active) => ({ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px 8px 8px', minHeight: 36, borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '0.5px solid var(--line)', background: active ? 'var(--ink)' : 'var(--surface-2)', color: active ? 'var(--bg)' : 'var(--ink-mute)' })

function PresetGauge({ settings, active }) {
  const fill = Math.max(6, Math.min(100, settings.brightness_pct || 0))
  return (
    <span style={{ width: 15, height: 15, borderRadius: 6, position: 'relative', overflow: 'hidden', flex: '0 0 auto',
      background: active ? 'rgba(255,255,255,0.18)' : 'var(--surface)',
      boxShadow: active ? 'inset 0 0 0 1px rgba(255,255,255,0.2)' : 'inset 0 0 0 1px rgba(0,0,0,0.08)' }}>
      <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${fill}%`, background: presetSwatchColor(settings) }} />
    </span>
  )
}

function PresetInput({ value, onChange, onConfirm, onCancel, t, placeholder }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 4px 4px 12px', borderRadius: 999, border: '0.5px solid var(--line)', background: 'var(--surface-2)' }}>
      <input autoFocus value={value} placeholder={placeholder || ''}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onConfirm(); else if (e.key === 'Escape') onCancel() }}
        style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 15, fontFamily: 'inherit', color: 'var(--ink)', width: 120 }} />
      <button onClick={onConfirm} title={t('deviceControls.presetSaveConfirm')} aria-label={t('deviceControls.presetSaveConfirm')} style={{ ..._presetIconBtn, color: 'var(--ok-text)' }}><Check size={16} strokeWidth={2} /></button>
      <button onClick={onCancel} title={t('deviceControls.presetCancel')} aria-label={t('deviceControls.presetCancel')} style={{ ..._presetIconBtn, color: 'var(--ink-mute)' }}><X size={16} strokeWidth={1.75} /></button>
    </span>
  )
}

function PresetMenu({ isDefault, onToggleDefault, onRename, onDelete, onClose, t }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div style={{ position: 'absolute', top: 'calc(100% + 4px)', insetInlineStart: 0, zIndex: 41, background: 'var(--surface)', border: '0.5px solid var(--line)', borderRadius: 'var(--r-card)', boxShadow: '0 6px 20px rgba(0,0,0,0.18)', overflow: 'hidden', minWidth: 200 }}>
        <button onClick={onToggleDefault} style={{ ..._presetMenuItem, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Star size={16} strokeWidth={1.75} fill={isDefault ? 'currentColor' : 'none'} />
          {isDefault ? t('deviceControls.presetClearDefault') : t('deviceControls.presetSetDefault')}
        </button>
        <button onClick={onRename} style={_presetMenuItem}>{t('deviceControls.presetRename')}</button>
        <button onClick={onDelete} style={{ ..._presetMenuItem, color: 'var(--err-text)' }}>{t('deviceControls.presetDelete')}</button>
      </div>
    </>
  )
}

function DevicePresetsRow({ entityId, live, isOn, suggestedName, onApply }) {
  const t = useT()
  const addToast = useUIStore((s) => s.addToast)
  const [presets, setPresets] = useState([])
  // Light is on the Smart Light Schedule → the schedule wins on turn-on, so a
  // default preset won't apply. Drives the note below.
  const [onSchedule, setOnSchedule] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [name, setName] = useState('')
  const [menuFor, setMenuFor] = useState(null)
  const pressTimer = useRef(null)
  const pressState = useRef({ id: null, long: false })

  useEffect(() => {
    let alive = true
    getDevicePresets(entityId)
      .then((r) => { if (alive) { setPresets(r.presets || []); setOnSchedule(!!r.on_schedule) } })
      .catch(() => { /* row just stays empty; never blocks the card */ })
    return () => { alive = false }
  }, [entityId])

  const atCap = presets.length >= MAX_DEVICE_PRESETS
  const reset = () => { setAdding(false); setEditingId(null); setName('') }
  const beginAdd = () => { setMenuFor(null); setEditingId(null); setName(suggestedName || ''); setAdding(true) }

  const confirmAdd = async () => {
    const nm = name.trim()
    if (!nm) return reset()
    try {
      const r = await addDevicePreset(entityId, nm, live)
      setPresets((p) => [...p, r.preset])
      reset()
    } catch (e) {
      const code = e?.detail?.code || e?.code
      addToast(code === 'preset_limit' ? t('deviceControls.presetLimitReached')
        : (e?.userMessage || e?.message || t('deviceControls.presetSaveFailed')), 'error')
      reset()
    }
  }

  const confirmRename = async (id) => {
    const nm = name.trim()
    if (!nm) return reset()
    try {
      const r = await renameDevicePreset(entityId, id, nm)
      setPresets((p) => p.map((x) => (x.id === id ? r.preset : x)))
    } catch (e) {
      addToast(e?.message || t('deviceControls.presetSaveFailed'), 'error')
    }
    reset()
  }

  const remove = async (id) => {
    setMenuFor(null)
    const prev = presets
    setPresets((p) => p.filter((x) => x.id !== id))
    try {
      await deleteDevicePreset(entityId, id)
    } catch (e) {
      setPresets(prev)
      addToast(e?.message || t('deviceControls.presetSaveFailed'), 'error')
    }
  }

  const toggleDefault = async (p) => {
    setMenuFor(null)
    const makeDefault = !p.is_default
    // Optimistic: exactly one default at a time.
    setPresets((list) => list.map((x) => ({ ...x, is_default: makeDefault && x.id === p.id })))
    try {
      if (makeDefault) await setDefaultDevicePreset(entityId, p.id)
      else await clearDefaultDevicePreset(entityId)
    } catch (e) {
      getDevicePresets(entityId).then((r) => setPresets(r.presets || [])).catch(() => {})
      addToast(e?.message || t('deviceControls.presetSaveFailed'), 'error')
    }
  }

  // Tap vs long-press detected purely with pointer events (mirrors BrightnessLamp).
  // Mixing onClick with a timer was unreliable on touch — a tap often ends as
  // pointercancel, so the synthetic click never fired and apply was dropped.
  const startPress = (id) => {
    pressState.current = { id, long: false }
    clearTimeout(pressTimer.current)
    pressTimer.current = setTimeout(() => { pressState.current.long = true; setMenuFor(id) }, 500)
  }
  const finishPress = (p) => {
    clearTimeout(pressTimer.current)
    const tapped = pressState.current.id === p.id && !pressState.current.long && menuFor !== p.id
    pressState.current = { id: null, long: false }
    if (tapped) onApply(p.settings)
  }
  const cancelPress = () => { clearTimeout(pressTimer.current); pressState.current = { id: null, long: false } }

  return (
    <div>
      <span className="z-eyebrow" style={{ display: 'block', marginBottom: 8 }}>{t('deviceControls.presets')}</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {presets.map((p) => {
          if (editingId === p.id) {
            return <PresetInput key={p.id} value={name} onChange={setName}
              onConfirm={() => confirmRename(p.id)} onCancel={reset} t={t} />
          }
          const active = isOn && settingsMatch(p.settings, live)
          return (
            <div key={p.id} style={{ position: 'relative' }}>
              <button
                onPointerDown={() => startPress(p.id)}
                onPointerUp={() => finishPress(p)}
                onPointerCancel={cancelPress}
                onPointerLeave={cancelPress}
                onContextMenu={(e) => { e.preventDefault(); setMenuFor(p.id) }}
                style={{ ..._presetPill(active), touchAction: 'manipulation' }}
              >
                <PresetGauge settings={p.settings} active={active} />
                {p.is_default && <Star size={14} strokeWidth={1.75} fill="currentColor" />}
                <span>{p.name}</span>
                <span className="z-mono" style={{ fontSize: 12, fontWeight: 500 }}>{p.settings.brightness_pct}%</span>
              </button>
              {menuFor === p.id && (
                <PresetMenu
                  isDefault={!!p.is_default}
                  onToggleDefault={() => toggleDefault(p)}
                  onRename={() => { setEditingId(p.id); setName(p.name); setMenuFor(null) }}
                  onDelete={() => remove(p.id)}
                  onClose={() => setMenuFor(null)}
                  t={t}
                />
              )}
            </div>
          )
        })}

        {adding
          ? <PresetInput value={name} onChange={setName} onConfirm={confirmAdd} onCancel={reset}
              t={t} placeholder={t('deviceControls.presetNamePlaceholder')} />
          : !atCap && (
            <button onClick={beginAdd} title={t('deviceControls.savePresetTitle')} style={_presetSavePill}>
              <Plus size={16} strokeWidth={1.75} /> {t('deviceControls.savePreset')}
            </button>
          )}
      </div>
      {onSchedule && presets.some((p) => p.is_default) && (
        <p className="z-footnote" style={{ margin: '8px 0 0' }} dir="auto">
          {t('deviceControls.presetDefaultShadowed')}
        </p>
      )}
    </div>
  )
}

export function LightControls({ entity, onService }) {
  const t = useT()
  const isOn = isEntityOn(entity)
  const rawBrightness = entity.brightness != null ? Math.round(entity.brightness / 255 * 100) : 80
  const [brightness, setBrightness] = useState(rawBrightness)

  const colorModes = entity.supported_color_modes || []
  const supportsColorTemp = colorModes.includes('color_temp') || entity.color_temp != null || entity.color_temp_kelvin != null
  const supportsColor = colorModes.some((m) => ['hs', 'rgb', 'xy', 'rgbw', 'rgbww'].includes(m))
  const effectList = entity.effect_list || []
  const currentRgb = entity.rgb_color

  // Bulbs report colour temperature as KELVIN (modern z2m/HA) or MIREDS (older).
  // Prefer kelvin; fall back to mireds; else sane 2700–6500 defaults. Reading
  // mireds-only broke kelvin-only bulbs: the live value stayed null so the
  // warmth slider never tracked real state (only optimistic drags moved it).
  const minK = entity.min_color_temp_kelvin ?? (entity.max_mireds ? Math.round(1000000 / entity.max_mireds) : 2700)
  const maxK = entity.max_color_temp_kelvin ?? (entity.min_mireds ? Math.round(1000000 / entity.min_mireds) : 6500)
  const liveK = entity.color_temp_kelvin ?? (entity.color_temp ? Math.round(1000000 / entity.color_temp) : null)
  const [colorTemp, setColorTemp] = useState(liveK ?? 2700)

  // Persistent commit lock: after the user commits a value we hold it locally until HA's
  // reported value actually matches (within tolerance). If HA's WS reply briefly overwrites
  // the optimistic store value with a stale reading, the local state stays put — no jump.
  // Lock releases on:
  //   - HA's reported value matching our commit (within tolerance) → HA confirmed
  //   - The user committing a new value → previous intent superseded
  const lastCommittedBri  = useRef(null)
  const lastCommittedTemp = useRef(null)

  useEffect(() => {
    if (entity.brightness == null) return
    const next = Math.round(entity.brightness / 255 * 100)
    if (lastCommittedBri.current != null) {
      if (Math.abs(next - lastCommittedBri.current) <= 2) {
        // HA confirmed our commit — release the lock and accept HA's value.
        lastCommittedBri.current = null
        setBrightness(next)
      }
      // else: HA hasn't applied our value yet (or sent a stale event); hold the committed value.
      return
    }
    setBrightness(next)
  }, [entity.brightness])

  useEffect(() => {
    if (liveK == null) return
    if (lastCommittedTemp.current != null) {
      if (Math.abs(liveK - lastCommittedTemp.current) <= 100) {
        lastCommittedTemp.current = null
        setColorTemp(liveK)
      }
      return
    }
    setColorTemp(liveK)
  }, [liveK])

  // Commit handlers: arm the lock and fire HA service. We DON'T optimistically write to
  // the store here — doing so would echo through entity.brightness and trick the useEffect
  // into releasing the lock before HA's real WS confirmation arrives, after which a stale
  // WS event could snap the display back to the pre-commit value.
  const commitBri = (v) => {
    lastCommittedBri.current = v
    setBrightness(v)
    onService('turn_on', { brightness_pct: v })
  }
  const commitTemp = (v) => {
    lastCommittedTemp.current = v
    setColorTemp(v)
    onService('turn_on', { color_temp_kelvin: v })
  }

  const ctPct = ((colorTemp - minK) / (maxK - minK)) * 100

  // Live perceived color — respects color_mode so the lamp follows the active control:
  // in color_temp mode, the live colorTemp slider drives the tint; in color mode, rgb_color wins.
  const livePreviewRgb = lightRgb({
    rgb_color: currentRgb,
    color_temp_kelvin: colorTemp,
    color_mode: entity.color_mode,
  })
  const livePreviewColor = livePreviewRgb
    ? `rgb(${livePreviewRgb[0]}, ${livePreviewRgb[1]}, ${livePreviewRgb[2]})`
    : 'var(--gold)'

  // Live position for the presets row: brightness + the ACTIVE colour dimension
  // (rgb when the bulb is in a colour mode, otherwise colour-temp).
  const _inColorMode = supportsColor && ['hs', 'rgb', 'xy', 'rgbw', 'rgbww'].includes(entity.color_mode) && !!currentRgb
  const livePresetSettings = {
    brightness_pct: brightness,
    ...(_inColorMode ? { rgb_color: currentRgb }
        : supportsColorTemp ? { color_temp_kelvin: colorTemp } : {}),
  }
  const _tempWord = colorTemp < 3500 ? t('deviceControls.tempWarm') : colorTemp < 5000 ? t('deviceControls.tempNeutral') : t('deviceControls.tempCool')
  const suggestedPresetName = _inColorMode ? `${brightness}%` : `${_humanize(_tempWord)} ${brightness}%`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 4, maxWidth: 320, width: '100%', margin: '0 auto' }}>
      {/* Brightness lamp — tap to toggle, hold + vertical drag for brightness */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <BrightnessLamp
          value={brightness}
          onChange={setBrightness}
          onCommit={commitBri}
          onTap={() => onService(isOn ? 'turn_off' : 'turn_on', {})}
          isOn={isOn}
          accentColor={livePreviewColor}
        />
      </div>

      {/* Brightness gradient slider */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span className="z-eyebrow">{t('deviceControls.brightness')}</span>
          <span className="z-mono" style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{brightness}%</span>
        </div>
        <GradientSlider
          value={brightness}
          onChange={setBrightness}
          onCommit={commitBri}
          min={1} max={100}
          gradient="linear-gradient(90deg, var(--ink-ghost) 0%, var(--gold) 100%)"
        />
      </div>

      {/* Color temp slider */}
      {supportsColorTemp && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="z-eyebrow">{t('deviceControls.temperature')}</span>
            <span className="z-mono" style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{colorTemp}K · {colorTemp < 3500 ? t('deviceControls.tempWarm') : colorTemp < 5000 ? t('deviceControls.tempNeutral') : t('deviceControls.tempCool')}</span>
          </div>
          <GradientSlider
            value={colorTemp}
            onChange={setColorTemp}
            onCommit={commitTemp}
            min={minK} max={maxK}
            gradient="linear-gradient(90deg, #FFB060 0%, #FFE6C0 30%, #FFFFFF 60%, #C0DDFF 100%)"
          />
        </div>
      )}

      {/* Saved-position presets — brightness + colour, captured and recalled in a tap */}
      <DevicePresetsRow
        entityId={entity.entity_id}
        live={livePresetSettings}
        isOn={isOn}
        suggestedName={suggestedPresetName}
        onApply={(s) => onService('turn_on', s)}
      />

      {/* Colours — quick tint (keeps current brightness) */}
      {supportsColor && (
        <div>
          <span className="z-eyebrow" style={{ display: 'block', marginBottom: 8 }}>{t('deviceControls.colors')}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {COLOR_PRESETS.map(p => {
              const rgb = hexToRgb(p.hex)
              const isActive = currentRgb && Math.abs(currentRgb[0] - rgb[0]) < 25 && Math.abs(currentRgb[1] - rgb[1]) < 25 && Math.abs(currentRgb[2] - rgb[2]) < 25
              return (
                <button
                  key={p.name}
                  title={t(p.labelKey)}
                  onClick={() => onService('turn_on', { rgb_color: rgb })}
                  style={{
                    flex: 1, aspectRatio: '1', borderRadius: 10,
                    background: p.hex,
                    border: isActive ? '2.5px solid var(--ink)' : '0.5px solid var(--line)',
                    cursor: 'pointer',
                    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)',
                    transition: 'transform 0.1s',
                    transform: isActive ? 'scale(1.06)' : 'none',
                  }}
                />
              )
            })}
            <label title={t('deviceControls.customColor')} aria-label={t('deviceControls.customColor')} style={{ flex: 1, aspectRatio: '1', borderRadius: 10, border: '1px dashed var(--line-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', color: 'var(--ink-mute)' }}>
              <input type="color" style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
                value={rgbToHex(currentRgb)} onChange={(e) => onService('turn_on', { rgb_color: hexToRgb(e.target.value) })} />
              <Plus size={20} strokeWidth={1.75} />
            </label>
          </div>
        </div>
      )}

      {/* Effects */}
      {effectList.length > 0 && (
        <div>
          <span className="z-eyebrow" style={{ display: 'block', marginBottom: 8 }}>{t('deviceControls.effects')}</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['none', ...effectList].map(fx => {
              const active = entity.effect === fx || (!entity.effect && fx === 'none')
              return (
                <button key={fx} onClick={() => onService('turn_on', { effect: fx === 'none' ? null : fx })}
                  aria-pressed={active} className={CHIP_CLS} style={chipStyle(active)}>
                  {fx === 'none' ? t('deviceControls.effectNone') : fx.replace(/_/g, ' ')}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Big on/off */}
      <button
        onClick={() => onService(isOn ? 'turn_off' : 'turn_on', {})}
        className="z-btn-primary"
        style={{ width: '100%', marginTop: 4 }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6M10 22h4"/><path d="M12 2a6 6 0 0 0-4 10.5c.7.7 1 1.6 1 2.5v1h6v-1c0-.9.3-1.8 1-2.5A6 6 0 0 0 12 2z"/></svg>
        {isOn ? t('deviceControls.on') : t('deviceControls.off')}
      </button>
    </div>
  )
}

// ─── Climate ──────────────────────────────────────────────────────────────────
// Line icons per HVAC mode (16px inside the chip). Colour is not used on
// the chip — the label carries the meaning, the icon is a glyph.
const HVAC_MODE_META = {
  off:       { Icon: Power },
  auto:      { Icon: Zap },
  cool:      { Icon: Snowflake },
  heat:      { Icon: Flame },
  heat_cool: { Icon: ArrowUpDown },
  fan_only:  { Icon: Wind },
  dry:       { Icon: Droplets },
}

export function ClimateControls({ entity, onService }) {
  const t = useT()
  const hvacMode    = entity.hvac_mode || entity.state
  const hvacModes   = entity.hvac_modes || []
  const targetTemp  = entity.temperature
  const currentTemp = entity.current_temperature
  const step        = entity.target_temp_step || 1
  const minTemp     = entity.min_temp || 16
  const maxTemp     = entity.max_temp || 30
  const fanMode     = entity.fan_mode
  const fanModes    = entity.fan_modes   || []
  const presetMode  = entity.preset_mode
  const presetModes = entity.preset_modes || []
  const swingMode   = entity.swing_mode
  const swingModes  = entity.swing_modes  || []

  const displayTemp = targetTemp ?? currentTemp ?? 22
  const dialPct = ((displayTemp - minTemp) / (maxTemp - minTemp)) * 100

  const adjustTemp = (delta) => {
    const base = targetTemp ?? currentTemp ?? 22
    const next = Math.round(Math.min(maxTemp, Math.max(minTemp, base + delta)) * 10) / 10
    onService('set_temperature', { temperature: next })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 8 }}>
      {/* Dial */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Dial
          size={220}
          value={Math.max(0, dialPct)}
          max={100}
          label={`${displayTemp}°`}
          sublabel={currentTemp ? `${_hvacLabel(t, hvacMode).toUpperCase()} · ${currentTemp}° ${t('deviceControls.tempNow')}` : _hvacLabel(t, hvacMode).toUpperCase()}
          color="var(--info)"
          trackColor="var(--line)"
        />
      </div>

      {/* Temp stepper below dial */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 20 }}>
        <button onClick={() => adjustTemp(-step)} className="z-icon-btn" aria-label={t('deviceControls.hvacCool')}><Minus size={20} strokeWidth={1.75} /></button>
        <span className="z-mono" style={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.04em', minWidth: 56, textAlign: 'center' }}>{displayTemp}°</span>
        <button onClick={() => adjustTemp(step)} className="z-icon-btn" aria-label={t('deviceControls.hvacHeat')}><Plus size={20} strokeWidth={1.75} /></button>
      </div>

      {/* HVAC mode chips */}
      {hvacModes.length > 0 && (
        <div>
          <span className="z-eyebrow" style={{ display: 'block', marginBottom: 8 }}>{t('deviceControls.mode')}</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {hvacModes.map(mode => {
              const Icon = (HVAC_MODE_META[mode] || {}).Icon
              const active = hvacMode === mode
              return (
                <button key={mode} onClick={() => onService('set_hvac_mode', { hvac_mode: mode })}
                  aria-pressed={active} className={CHIP_CLS} style={{ ...chipStyle(active), gap: 6, textTransform: 'none' }}>
                  {Icon && <Icon size={16} strokeWidth={1.75} />}
                  {_hvacLabel(t, mode)}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Fan speed chips */}
      {fanModes.length > 1 && (
        <div>
          <span className="z-eyebrow" style={{ display: 'block', marginBottom: 8 }}>{t('deviceControls.fanSpeed')}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {fanModes.map(mode => (
              <button key={mode} onClick={() => onService('set_fan_mode', { fan_mode: mode })}
                aria-pressed={fanMode === mode} className={CHIP_CLS} style={{ ...chipStyle(fanMode === mode), flex: 1, justifyContent: 'center' }}>
                {mode.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Swing */}
      {swingModes.length > 1 && (
        <div>
          <span className="z-eyebrow" style={{ display: 'block', marginBottom: 8 }}>{t('deviceControls.swing')}</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {swingModes.map(mode => (
              <button key={mode} onClick={() => onService('set_swing_mode', { swing_mode: mode })}
                aria-pressed={swingMode === mode} className={CHIP_CLS} style={chipStyle(swingMode === mode)}>
                {mode.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* On/Off */}
      <button
        onClick={() => onService(hvacMode === 'off' ? 'set_hvac_mode' : 'set_hvac_mode', { hvac_mode: hvacMode === 'off' ? (hvacModes.find(m => m !== 'off') || 'cool') : 'off' })}
        className="z-btn-primary"
        style={{ width: '100%' }}
      >
        {hvacMode === 'off' ? t('deviceControls.turnOn') : t('deviceControls.turnOff')}
      </button>
    </div>
  )
}

// ─── Media Player ─────────────────────────────────────────────────────────────
const MP_SHUFFLE = 32768
const MP_REPEAT  = 262144

export function MediaPlayerControls({ entity, onService }) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const isPlaying = entity.state === 'playing'
  const isMuted   = entity.is_volume_muted
  // volume_level=0.0 while playing usually means the TV routes audio through ARC/eARC
  // and the integration can't read the real volume — treat it as unknown in that case.
  const volReliable  = entity.volume_level != null && !(entity.volume_level === 0 && entity.state === 'playing')
  const rawVol       = volReliable ? Math.round(entity.volume_level * 100) : null
  const [volume, setVolume] = useState(rawVol ?? 50)

  useEffect(() => {
    if (volReliable) setVolume(Math.round(entity.volume_level * 100))
  }, [entity.volume_level, entity.state])

  const source     = entity.source
  const sourceList = entity.source_list || []
  const appList    = entity.app_list    || []
  const mediaTitle  = entity.media_title
  const mediaArtist = entity.media_artist
  const shuffle    = entity.shuffle
  const repeat     = entity.repeat
  const soundMode  = entity.sound_mode
  const soundModes = entity.sound_mode_list || []
  const features   = entity.supported_features || 0

  const supportsShuffle = !!(features & MP_SHUFFLE)
  const supportsRepeat  = !!(features & MP_REPEAT)

  // sourceList goes in secondary so the card stays compact even with many inputs
  const hasSecondary = sourceList.length > 0 || supportsShuffle || supportsRepeat || appList.length > 0 || soundModes.length > 1
  const moreLabel = sourceList.length > 0 ? t('deviceControls.sourcesAndMore') : t('deviceControls.shuffleAndMore')

  if (entity.state === 'off' || entity.state === 'unavailable') return null

  const nextRepeat = repeat === 'off' || !repeat ? 'all' : repeat === 'all' ? 'one' : 'off'

  return (
    <div className="flex flex-col gap-3 mt-2 pt-2 border-t border-line">
      {/* Now playing */}
      {(mediaTitle || mediaArtist) && (
        <p className="text-footnote text-ink-mute truncate">
          {[mediaTitle, mediaArtist].filter(Boolean).join(' · ')}
        </p>
      )}

      {/* Primary: playback — 44px targets; play/pause is the one inverted tile */}
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => onService('media_previous_track', {})}
          style={ICON_BTN_STYLE}
          className="hover:bg-surface-2 transition-colors"
          aria-label={t('deviceControls.remote.back')}
        >
          <SkipBack size={20} strokeWidth={1.75} />
        </button>
        <button
          onClick={() => onService(isPlaying ? 'media_pause' : 'media_play', {})}
          className="w-11 h-11 rounded-full bg-ink flex items-center justify-center shrink-0 hover:bg-ink-2 transition-colors"
          aria-label={isPlaying ? t('deviceControls.pause') : t('deviceControls.on')}
        >
          {isPlaying
            ? <Pause size={18} strokeWidth={1.75} className="text-bg" />
            : <Play  size={18} strokeWidth={1.75} className="text-bg translate-x-px" />}
        </button>
        <button
          onClick={() => onService('media_next_track', {})}
          style={ICON_BTN_STYLE}
          className="hover:bg-surface-2 transition-colors"
        >
          <SkipForward size={20} strokeWidth={1.75} />
        </button>
      </div>

      {/* Primary: volume */}
      {entity.volume_level != null && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onService('volume_mute', { is_volume_muted: !isMuted })}
            style={ICON_BTN_STYLE}
            className="hover:bg-surface-2 transition-colors"
            aria-label={isMuted ? t('deviceControls.muted') : t('deviceControls.remote.mute')}
            aria-pressed={!!isMuted}
          >
            {isMuted ? <VolumeX size={18} strokeWidth={1.75} /> : <Volume2 size={18} strokeWidth={1.75} />}
          </button>
          <Slider
            value={isMuted ? 0 : (volReliable ? volume : 0)}
            onValueChange={volReliable ? setVolume : undefined}
            onValueCommit={volReliable ? (v) => onService('volume_set', { volume_level: v / 100 }) : undefined}
            min={0} max={100}
            disabled={!volReliable}
          />
          <span className="z-mono text-footnote text-ink-mute w-12 text-end shrink-0">
            {isMuted ? t('deviceControls.muted') : volReliable ? `${volume}%` : t('deviceControls.unknown')}
          </span>
        </div>
      )}

      {/* "Sources & more" toggle — sources + shuffle/apps/sound all live here */}
      {hasSecondary && (
        <MoreToggle
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          label={moreLabel}
        />
      )}

      {expanded && (
        <div className="flex flex-col gap-2">
          {/* Source list */}
          {sourceList.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {sourceList.map((s) => (
                <button
                  key={s}
                  onClick={() => onService('select_source', { source: s })}
                  aria-pressed={source === s}
                  className={CHIP_CLS}
                  style={{ ...chipStyle(source === s), textTransform: 'none' }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* App list (distinct from source list) */}
          {appList.length > 0 && (
            <div className="flex gap-2 flex-wrap items-center">
              <span className="text-footnote text-ink-mute me-1 shrink-0">{t('deviceControls.apps')}</span>
              {appList.map((app) => (
                <button
                  key={app}
                  onClick={() => onService('select_source', { source: app })}
                  aria-pressed={source === app}
                  className={CHIP_CLS}
                  style={{ ...chipStyle(source === app), textTransform: 'none' }}
                >
                  {app}
                </button>
              ))}
            </div>
          )}

          {/* Shuffle + Repeat */}
          {(supportsShuffle || supportsRepeat) && (
            <div className="flex gap-2">
              {supportsShuffle && (
                <button
                  onClick={() => onService('shuffle_set', { shuffle: !shuffle })}
                  title={shuffle ? t('deviceControls.shuffleOn') : t('deviceControls.shuffleOff')}
                  aria-pressed={!!shuffle}
                  className={CHIP_CLS}
                  style={{ ...chipStyle(!!shuffle), gap: 6, textTransform: 'none' }}
                >
                  <Shuffle size={14} strokeWidth={1.75} /> {t('deviceControls.shuffle')}
                </button>
              )}
              {supportsRepeat && (
                <button
                  onClick={() => onService('repeat_set', { repeat: nextRepeat })}
                  title={`${t('deviceControls.repeatLabel')}: ${repeat || 'off'}`}
                  aria-pressed={!!(repeat && repeat !== 'off')}
                  className={CHIP_CLS}
                  style={{ ...chipStyle(!!(repeat && repeat !== 'off')), gap: 6, textTransform: 'none' }}
                >
                  <Repeat size={14} strokeWidth={1.75} />
                  {' '}{repeat === 'one' ? t('deviceControls.repeatOne') : repeat === 'all' ? t('deviceControls.repeatAll') : t('deviceControls.repeatOff')}
                </button>
              )}
            </div>
          )}

          {/* Sound mode */}
          {soundModes.length > 1 && (
            <ModeChips
              label={t('deviceControls.sound')}
              modes={soundModes}
              current={soundMode}
              colorActive="bg-ink text-bg"
              colorIdle="bg-surface-2 text-ink-mute hover:bg-line"
              onSelect={(mode) => onService('select_sound_mode', { sound_mode: mode })}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Cover ────────────────────────────────────────────────────────────────────
// Secondary action button inside a control surface: 44px tall, 15px.
const ctrlBtn = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '8px 12px', minHeight: 40, borderRadius: 'var(--r-ctl)', fontSize: 13, fontWeight: 500,
  background: 'var(--surface-2)', border: '0.5px solid var(--line)',
  color: 'var(--ink)', cursor: 'pointer', fontFamily: 'inherit',
}

export function CoverControls({ entity, onService }) {
  const t = useT()
  const position = entity.current_position
  const [localPos, setLocalPos] = useState(position ?? 0)

  useEffect(() => { if (position != null) setLocalPos(position) }, [position])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, paddingTop: 8, borderTop: '0.5px solid var(--line)' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onService('open_cover', {})} style={{ ...ctrlBtn, flex: 1 }}>
          <ArrowUp size={16} strokeWidth={1.75} /> {t('deviceControls.openCover')}
        </button>
        <button onClick={() => onService('stop_cover', {})} style={{ ...ctrlBtn, width: 44, padding: 0 }} aria-label={t('deviceControls.stopCover')}>
          <Square size={16} strokeWidth={1.75} />
        </button>
        <button onClick={() => onService('close_cover', {})} style={{ ...ctrlBtn, flex: 1 }}>
          <ArrowDown size={16} strokeWidth={1.75} /> {t('deviceControls.closeCover')}
        </button>
      </div>
      {position != null && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-mute)', marginBottom: 8 }}>
            <span>{t('deviceControls.position')}</span>
            <span className="z-mono">{localPos}%</span>
          </div>
          <Slider value={localPos} onValueChange={setLocalPos} onValueCommit={(v) => onService('set_cover_position', { position: v })} min={0} max={100} />
        </div>
      )}
    </div>
  )
}

// ─── Fan ──────────────────────────────────────────────────────────────────────
export function FanControls({ entity, onService }) {
  const t = useT()
  const isOn = isEntityOn(entity)
  const rawPct = entity.percentage ?? 0
  const [pct, setPct] = useState(rawPct)
  const presetMode  = entity.preset_mode
  const presetModes = entity.preset_modes || []

  useEffect(() => { setPct(entity.percentage ?? 0) }, [entity.percentage])

  if (!isOn) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, paddingTop: 8, borderTop: '0.5px solid var(--line)' }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-mute)', marginBottom: 8 }}>
          <span>{t('deviceControls.speed')}</span>
          <span className="z-mono">{pct}%</span>
        </div>
        <Slider value={pct} onValueChange={setPct} onValueCommit={(v) => onService('set_percentage', { percentage: v })} min={0} max={100} />
      </div>
      {presetModes.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {presetModes.map((mode) => (
            <button
              key={mode}
              onClick={() => onService('set_preset_mode', { preset_mode: mode })}
              aria-pressed={presetMode === mode}
              className={CHIP_CLS}
              style={chipStyle(presetMode === mode)}
            >
              {mode}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Lock ─────────────────────────────────────────────────────────────────────
export function LockControls({ entity, onService }) {
  const t = useT()
  const [confirming, setConfirming] = useState(false)
  const isLocked  = entity.state === 'locked'
  const isPending = entity.state === 'locking' || entity.state === 'unlocking'
  const pendingLabel = entity.state === 'locking'
    ? t('deviceControls.lockState.locking')
    : entity.state === 'unlocking'
      ? t('deviceControls.lockState.unlocking')
      : entity.state

  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '0.5px solid var(--line)' }}>
      {isPending ? (
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-mute)', padding: '12px 0' }}>{pendingLabel}</div>
      ) : !isLocked ? (
        <button
          onClick={() => onService('lock', {})}
          style={{ ...ctrlBtn, width: '100%', background: `color-mix(in srgb, var(--ok) 12%, var(--surface))`, color: 'var(--ok-text)', border: '0.5px solid color-mix(in srgb, var(--ok) 30%, var(--line))' }}
        >
          <Lock size={16} strokeWidth={1.75} /> {t('deviceControls.lock')}
        </button>
      ) : confirming ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => { onService('unlock', {}); setConfirming(false) }}
            style={{ ...ctrlBtn, flex: 1, background: 'var(--err)', color: 'var(--on-accent)', border: 'none', fontWeight: 600 }}
          >
            {t('deviceControls.confirmUnlock')}
          </button>
          <button
            onClick={() => setConfirming(false)}
            style={{ ...ctrlBtn, width: 44, padding: 0, color: 'var(--ink-mute)' }}
            aria-label={t('deviceControls.presetCancel')}
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          style={{ ...ctrlBtn, width: '100%', background: `color-mix(in srgb, var(--err) 10%, var(--surface))`, color: 'var(--err-text)', border: '0.5px solid color-mix(in srgb, var(--err) 30%, var(--line))' }}
        >
          <LockOpen size={16} strokeWidth={1.75} /> {t('deviceControls.unlock')}
        </button>
      )}
    </div>
  )
}

// ─── Vacuum ───────────────────────────────────────────────────────────────────
export function VacuumControls({ entity, onService }) {
  const t = useT()
  const state      = entity.state
  const isCleaning = state === 'cleaning'
  const isPaused   = state === 'paused'
  const isDocked   = state === 'docked'
  const isIdle     = state === 'idle'

  const vacBtn = (bg, color, border) => ({
    ...ctrlBtn,
    background: bg, color, border: border || '0.5px solid var(--line)',
  })

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, paddingTop: 8, borderTop: '0.5px solid var(--line)' }}>
      {!isCleaning ? (
        <button onClick={() => onService('start', {})} style={vacBtn('var(--ink)', 'var(--bg)', 'none')}>
          <Play size={16} strokeWidth={1.75} /> {t('deviceControls.startVacuum')}
        </button>
      ) : (
        <button onClick={() => onService('pause', {})} style={vacBtn(`color-mix(in srgb, var(--warn) 10%, var(--surface))`, 'var(--warn-text)', `0.5px solid color-mix(in srgb, var(--warn) 30%, var(--line))`)}>
          <Pause size={16} strokeWidth={1.75} /> {t('deviceControls.pause')}
        </button>
      )}
      {(isCleaning || isPaused || isIdle) && (
        <button onClick={() => onService('return_to_base', {})} style={ctrlBtn}>
          <Home size={16} strokeWidth={1.75} /> {t('deviceControls.dock')}
        </button>
      )}
      {(isCleaning || isPaused) && (
        <button onClick={() => onService('stop', {})} style={vacBtn(`color-mix(in srgb, var(--err) 8%, var(--surface))`, 'var(--err-text)', `0.5px solid color-mix(in srgb, var(--err) 30%, var(--line))`)}>
          <Square size={16} strokeWidth={1.75} /> {t('deviceControls.stopCover')}
        </button>
      )}
      {isDocked && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', minHeight: 40, fontSize: 13, color: 'var(--ok-text)', fontWeight: 500 }}>
          <Home size={16} strokeWidth={1.75} /> {t('deviceControls.docked')}
        </span>
      )}
    </div>
  )
}

// ─── Generic Controls — auto-rendered for any domain in the registry ─────────
//
// Shows only the commands the specific device instance actually supports:
//   - Buttons are gated by supported_features bitmask (featureBit in registry)
//   - Position slider shown only when positionFeatureBit is set in features
//   - Chip rows rendered from attribute lists (chips[] in registry)
//
// Specialized components (LightControls, ClimateControls…) still handle
// complex domains. GenericControls handles everything else with zero per-device code.
export function GenericControls({ entity, onService }) {
  const t = useT()
  const meta = DOMAIN_REGISTRY[entity.domain]
  const [confirming, setConfirming] = useState(null)

  if (!meta || !meta.actions || Object.keys(meta.actions).length === 0) return null

  const features = entity.supported_features ?? entity.ha_attributes?.supported_features ?? 0

  // States that make a button redundant (don't show "Open" when already open, etc.)
  const _SKIP_WHEN = {
    turn_on:         ['on'],
    turn_off:        ['off'],
    open_valve:      ['open', 'opening'],
    close_valve:     ['closed', 'closing'],
    stop_valve:      [],   // always useful while opening/closing
    lock:            ['locked', 'locking'],
    unlock:          ['unlocked', 'unlocking'],
    open:            ['unlocked'],           // latch open — only when locked
    open_cover:      ['open', 'opening'],
    close_cover:     ['closed', 'closing'],
    start:           ['cleaning'],
    start_mowing:    ['mowing'],
    dock:            ['docked'],
    return_to_base:  ['docked'],
    alarm_disarm:    ['disarmed'],
  }

  const visibleActions = Object.entries(meta.actions).filter(([key, action]) => {
    // Gate by feature bit
    if (action.featureBit && !(features & action.featureBit)) return false
    // Skip redundant buttons given the current state
    const skip = _SKIP_WHEN[key]
    return !skip || !skip.includes(entity.state)
  })

  // Position slider — only when device reports the SET_POSITION feature
  const positionBit = meta.positionFeatureBit ?? 0
  const hasPosition = positionBit > 0 && (features & positionBit) && entity.current_position != null
  const positionService = entity.domain === 'valve' ? 'set_valve_position' : 'set_cover_position'

  // Chip rows — only render a row when the attribute list is non-empty
  const chipRows = (meta.chips ?? []).filter((cd) => {
    const opts = entity[cd.attr] ?? entity.ha_attributes?.[cd.attr]
    return Array.isArray(opts) && opts.length > 0
  })

  if (visibleActions.length === 0 && !hasPosition && chipRows.length === 0) return null

  return (
    <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-line">

      {/* Action buttons */}
      {visibleActions.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {visibleActions.map(([key, action]) => {
            const needsConfirm = action.confirm || meta.safetyLevel === 'double_confirm'

            if (needsConfirm && confirming === key) {
              return (
                <div key={key} className="flex gap-2 w-full">
                  <button
                    onClick={() => { onService(action.service, {}); setConfirming(null) }}
                    className="flex-1 min-h-[44px] px-3 rounded-[10px] bg-err text-on-accent text-subhead font-semibold transition-colors"
                  >
                    {t('deviceControls.confirmAction', { label: action.label })}
                  </button>
                  <button
                    onClick={() => setConfirming(null)}
                    className="w-11 min-h-[44px] rounded-[10px] bg-surface-2 text-ink-mute hover:bg-surface-3 transition-colors inline-flex items-center justify-center"
                    aria-label={t('deviceControls.presetCancel')}
                  >
                    <X size={16} strokeWidth={1.75} />
                  </button>
                </div>
              )
            }

            const isCurrentAction = (
              (key === 'open_valve'  && entity.state === 'open')    ||
              (key === 'close_valve' && entity.state === 'closed')  ||
              (key === 'lock'        && entity.state === 'locked')  ||
              (key === 'unlock'      && entity.state === 'unlocked')
            )

            return (
              <button
                key={key}
                onClick={() => needsConfirm ? setConfirming(key) : onService(action.service, {})}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1 min-h-[44px] px-3 rounded-[10px] text-subhead font-medium transition-colors',
                  isCurrentAction
                    ? 'bg-line text-ink-mute cursor-default'
                    : 'bg-surface-2 text-ink-2 hover:bg-surface-3',
                )}
              >
                {action.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Position slider — gated by SET_POSITION feature bit */}
      {hasPosition && (
        <div>
          <div className="flex justify-between text-footnote text-ink-mute mb-2">
            <span>{t('deviceControls.position')}</span>
            <span className="z-mono">{entity.current_position}%</span>
          </div>
          <Slider
            value={entity.current_position}
            onValueCommit={(v) => onService(positionService, { position: v })}
            min={0} max={100}
          />
        </div>
      )}

      {/* Attribute-driven chip rows (modes, speeds, presets…) */}
      {chipRows.map((cd) => {
        const opts = entity[cd.attr] ?? entity.ha_attributes?.[cd.attr] ?? []
        const current = entity[cd.currentAttr] ?? entity.ha_attributes?.[cd.currentAttr]
        return (
          <div key={cd.attr}>
            {cd.label && (
              <span className="text-footnote text-ink-mute me-1">{cd.label}</span>
            )}
            <div className="flex gap-2 flex-wrap mt-1">
              {opts.map((opt) => (
                <button
                  key={opt}
                  onClick={() => onService(cd.service, { [cd.param]: opt })}
                  aria-pressed={current === opt}
                  className={CHIP_CLS}
                  style={chipStyle(current === opt)}
                >
                  {String(opt).replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── IR Remote Drawer ─────────────────────────────────────────────────────────
// Full remote layout in a bottom-sheet drawer.
// onCommand(irDeviceId, commandName)
// onChannel(irDeviceId, channelNumber)

const REMOTE_DISPLAY = {
  power:        { labelKey: 'deviceControls.remote.power',   titleKey: 'deviceControls.remote.power' },
  volume_up:    { label: 'VOL+',   titleKey: 'deviceControls.remote.volUp' },
  volume_down:  { label: 'VOL−',   titleKey: 'deviceControls.remote.volDown' },
  mute:         { labelKey: 'deviceControls.remote.mute',    titleKey: 'deviceControls.remote.mute' },
  nav_up:       { labelKey: 'deviceControls.remote.up',    titleKey: 'deviceControls.remote.up' },
  nav_down:     { labelKey: 'deviceControls.remote.down',  titleKey: 'deviceControls.remote.down' },
  nav_left:     { labelKey: 'deviceControls.remote.left',  titleKey: 'deviceControls.remote.left' },
  nav_right:    { labelKey: 'deviceControls.remote.right', titleKey: 'deviceControls.remote.right' },
  nav_ok:       { labelKey: 'deviceControls.remote.ok',    titleKey: 'deviceControls.remote.ok' },
  back:         { labelKey: 'deviceControls.remote.back',  titleKey: 'deviceControls.remote.back' },
  home:         { labelKey: 'deviceControls.remote.home',  titleKey: 'deviceControls.remote.home' },
  menu:         { labelKey: 'deviceControls.remote.menu',  titleKey: 'deviceControls.remote.menu' },
  hdmi_1:       { label: 'HDMI 1', title: 'HDMI 1' },
  hdmi_2:       { label: 'HDMI 2', title: 'HDMI 2' },
  hdmi_3:       { label: 'HDMI 3', title: 'HDMI 3' },
  hdmi_4:       { label: 'HDMI 4', title: 'HDMI 4' },
  channel_up:   { label: 'CH+',    titleKey: 'deviceControls.remote.chanUp' },
  channel_down: { label: 'CH−',    titleKey: 'deviceControls.remote.chanDown' },
  mode_cool:    { labelKey: 'deviceControls.hvacCool', titleKey: 'deviceControls.hvacCool' },
  mode_heat:    { labelKey: 'deviceControls.hvacHeat', titleKey: 'deviceControls.hvacHeat' },
  mode_fan:     { labelKey: 'deviceControls.hvacFanOnly', titleKey: 'deviceControls.hvacFanOnly' },
  mode_auto:    { labelKey: 'deviceControls.hvacAuto', titleKey: 'deviceControls.hvacAuto' },
  mode_dry:     { labelKey: 'deviceControls.hvacDry', titleKey: 'deviceControls.hvacDry' },
  fan_low:      { labelKey: 'deviceControls.remote.fanLow',   titleKey: 'deviceControls.remote.fanLow' },
  fan_medium:   { labelKey: 'deviceControls.remote.fanMed',   titleKey: 'deviceControls.remote.fanMed' },
  fan_high:     { labelKey: 'deviceControls.remote.fanHigh',  titleKey: 'deviceControls.remote.fanHigh' },
  fan_auto:     { labelKey: 'deviceControls.remote.fanAuto',  titleKey: 'deviceControls.remote.fanAuto' },
  swing_on:     { labelKey: 'deviceControls.remote.swingOn',  titleKey: 'deviceControls.remote.swingOn' },
  swing_off:    { labelKey: 'deviceControls.remote.swingOff', titleKey: 'deviceControls.remote.swingOff' },
  digit_0:      { label: '0',       title: '0' },
  digit_1:      { label: '1',       title: '1' },
  digit_2:      { label: '2',       title: '2' },
  digit_3:      { label: '3',       title: '3' },
  digit_4:      { label: '4',       title: '4' },
  digit_5:      { label: '5',       title: '5' },
  digit_6:      { label: '6',       title: '6' },
  digit_7:      { label: '7',       title: '7' },
  digit_8:      { label: '8',       title: '8' },
  digit_9:      { label: '9',       title: '9' },
  digit_ok:     { label: 'OK',      titleKey: 'deviceControls.remote.enter' },
}

// Resolve a REMOTE_DISPLAY entry into its display strings using the active locale.
function _remoteEntry(t, cmd) {
  const d = REMOTE_DISPLAY[cmd] || {}
  let label = d.label
  if (d.labelKey) label = `${d.labelPrefix || ''}${t(d.labelKey)}`
  const title = d.titleKey ? t(d.titleKey) : d.title
  return { label, title }
}

// Remote layout zones — each zone only renders if ≥1 command in it is known
const REMOTE_GROUPS = {
  top_bar:  ['power', 'mute', 'volume_up', 'volume_down', 'channel_up', 'channel_down'],
  nav:      ['nav_up', 'nav_left', 'nav_ok', 'nav_right', 'nav_down', 'back', 'home', 'menu'],
  numpad:   ['digit_1','digit_2','digit_3','digit_4','digit_5','digit_6',
             'digit_7','digit_8','digit_9','digit_0','digit_ok'],
  sources:  ['hdmi_1','hdmi_2','hdmi_3','hdmi_4'],
  ac_modes: ['mode_cool','mode_heat','mode_fan','mode_auto','mode_dry',
             'fan_low','fan_medium','fan_high','fan_auto','swing_on','swing_off'],
}

const BTN_BASE = 'flex items-center justify-center rounded-[10px] text-subhead font-medium transition-colors select-none'
const BTN_ACTIVE = 'bg-surface-2 text-ink-2 hover:bg-surface-3'
const BTN_DISABLED = 'bg-bg text-ink-faint cursor-not-allowed'

function RemoteBtn({ cmd, learned, cmds, onPress, size = 'md' }) {
  const t = useT()
  const disp = _remoteEntry(t, cmd)
  const exists = cmd in cmds
  const isLearned = learned.has(cmd)
  const active = exists && isLearned
  // Every size clears 44px in both axes.
  const sz = size === 'lg'
    ? 'w-16 h-12 text-body'
    : size === 'sm'
    ? 'w-11 h-11 text-footnote'
    : 'w-14 h-11 text-subhead'
  const baseTitle = disp.title || cmd

  return (
    <button
      title={active ? baseTitle : t('deviceControls.remote.notLearned', { name: baseTitle })}
      disabled={!active}
      onClick={active ? () => onPress(cmd) : undefined}
      className={cn(BTN_BASE, sz, active ? BTN_ACTIVE : BTN_DISABLED)}
    >
      {disp.label || cmd.replace(/_/g, ' ')}
    </button>
  )
}

export function IRRemoteDrawer({ irDevice, onCommand, onChannel, onClose }) {
  const t = useT()
  const learned = new Set(irDevice.learned_commands || [])
  const cmds    = irDevice.commands || {}
  const canDo   = (cmd) => cmd in cmds && learned.has(cmd)
  const has     = (group) => REMOTE_GROUPS[group]?.some(canDo) ?? false

  const [ch, setCh] = useState('')
  const [volDisplay, setVolDisplay] = useState(24)
  const [chDisplay, setChDisplay] = useState(1)

  const fire = (cmd) => { if (canDo(cmd)) onCommand(irDevice.id, cmd) }
  const sourceCommands = (REMOTE_GROUPS.sources || []).filter(c => c in cmds)
  const extras = [...learned].filter(c => !new Set(Object.values(REMOTE_GROUPS).flat()).has(c) && canDo(c)).sort()

  const topBtns = [
    { cmd: 'power',    label: t('deviceControls.remote.power'), accent: 'var(--err)' },
    { cmd: 'mute',     label: t('deviceControls.remote.mute') },
    { cmd: 'input',    label: t('deviceControls.remote.input') },
  ]

  const ArrowIcon = ({ dir }) => {
    const paths = { up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', left: 'M15 18l-6-6 6-6', right: 'M9 6l6 6-6 6' }
    return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={paths[dir]}/></svg>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px 12px', borderBottom: '0.5px solid var(--line)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button onClick={onClose} className="z-icon-btn" aria-label={t('deviceControls.presetCancel')}><X size={18} strokeWidth={1.75} /></button>
          <div style={{ minWidth: 0 }}>
            <div className="z-headline truncate">{irDevice.name}</div>
            <div className="z-footnote z-mono truncate">{irDevice.room ? `${irDevice.room} · ` : ''}{t('deviceControls.remote.commandCount', { n: learned.size })}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '20px 20px 32px', overflowY: 'auto' }}>

        {/* Now-playing card */}
        <div className="z-card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 'var(--r-ctl)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-2)', flexShrink: 0 }}>
            <Tv2 size={22} strokeWidth={1.75} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="z-headline truncate">{irDevice.name}</div>
            <div className="z-footnote z-mono truncate">{t('deviceControls.remote.lastCommand', { n: learned.size })}</div>
          </div>
          <span className="z-dot z-dot-on" />
        </div>

        {/* Power / Mute / Input — power is the only status-coloured glyph (20px, so the fill token is fine) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {topBtns.map(b => (
            <button
              key={b.cmd}
              onClick={() => fire(b.cmd)}
              disabled={!canDo(b.cmd)}
              className="z-card"
              style={{
                padding: '16px 0', minHeight: 40,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                cursor: canDo(b.cmd) ? 'pointer' : 'not-allowed',
                opacity: canDo(b.cmd) ? 1 : 0.35,
                color: b.accent || 'var(--ink-2)', fontFamily: 'inherit',
              }}
            >
              {b.cmd === 'power' && <Power size={20} strokeWidth={1.75} />}
              {b.cmd === 'mute' && <VolumeX size={20} strokeWidth={1.75} />}
              {b.cmd === 'input' && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><circle cx="4" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="10" r="2" fill="currentColor"/><circle cx="20" cy="14" r="2" fill="currentColor"/></svg>}
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--ink-2)' }}>{b.label}</span>
            </button>
          ))}
        </div>

        {/* D-pad circle */}
        {has('nav') && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{
              width: 184, height: 184, borderRadius: '50%',
              background: 'var(--surface)', border: '0.5px solid var(--line)',
              position: 'relative', boxShadow: 'var(--shadow-md)',
            }}>
              {/* Center OK */}
              <button
                onClick={() => fire('nav_ok')}
                disabled={!canDo('nav_ok')}
                style={{
                  position: 'absolute', top: '50%', left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 82, height: 82, borderRadius: '50%',
                  background: 'var(--ink)', color: 'var(--bg)',
                  border: 'none', fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', letterSpacing: '0.02em',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >{t('deviceControls.remote.ok')}</button>
              {/* Arrows */}
              {[
                { dir: 'up',    cmd: 'nav_up',    style: { top: 6, left: '50%', transform: 'translateX(-50%)' } },
                { dir: 'down',  cmd: 'nav_down',  style: { bottom: 6, left: '50%', transform: 'translateX(-50%)' } },
                { dir: 'left',  cmd: 'nav_left',  style: { left: 6, top: '50%', transform: 'translateY(-50%)' } },
                { dir: 'right', cmd: 'nav_right', style: { right: 6, top: '50%', transform: 'translateY(-50%)' } },
              ].map(a => (
                <button key={a.dir} onClick={() => fire(a.cmd)} disabled={!canDo(a.cmd)}
                  aria-label={_remoteEntry(t, a.cmd).title || a.cmd}
                  style={{ ...ICON_BTN_STYLE, position: 'absolute', cursor: canDo(a.cmd) ? 'pointer' : 'default', color: canDo(a.cmd) ? 'var(--ink-2)' : 'var(--ink-faint)', ...a.style }}>
                  <ArrowIcon dir={a.dir} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Back / Home / Menu row */}
        {['back','home','menu'].some(c => c in cmds) && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {['back','home','menu'].filter(c => c in cmds).map(cmd => (
              <button key={cmd} onClick={() => fire(cmd)} disabled={!canDo(cmd)} style={{
                ...ctrlBtn, background: 'var(--surface)', padding: '8px 16px', fontWeight: 600,
                cursor: canDo(cmd) ? 'pointer' : 'default', color: canDo(cmd) ? 'var(--ink-2)' : 'var(--ink-faint)',
              }}>{_remoteEntry(t, cmd).title || cmd}</button>
            ))}
          </div>
        )}

        {/* Vol / Mic / Ch */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {/* Volume */}
          <div className="z-card" style={{ padding: '4px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
            <button onClick={() => { fire('volume_up');   setVolDisplay(v => Math.min(100, v+1)) }} style={{ ...ICON_BTN_STYLE, color: 'var(--ink-2)' }} aria-label={t('deviceControls.remote.volUp')}><ArrowIcon dir="up" /></button>
            <span className="z-mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{t('deviceControls.remote.vol')} {volDisplay}</span>
            <button onClick={() => { fire('volume_down'); setVolDisplay(v => Math.max(0, v-1)) }} style={{ ...ICON_BTN_STYLE, color: 'var(--ink-2)' }} aria-label={t('deviceControls.remote.volDown')}><ArrowIcon dir="down" /></button>
          </div>

          {/* Mic / voice — the sheet's single accent element; on-accent for
              the glyph and label, never a raw white. */}
          <button style={{
            padding: '16px 0', minHeight: 40, borderRadius: 'var(--r-sheet)',
            background: 'var(--accent)', color: 'var(--on-accent)', border: 'none',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
            cursor: 'pointer', boxShadow: 'var(--shadow-md)', fontFamily: 'inherit',
          }}>
            <Mic size={20} strokeWidth={1.75} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>{t('deviceControls.remote.speak')}</span>
          </button>

          {/* Channel */}
          <div className="z-card" style={{ padding: '4px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
            <button onClick={() => { fire('channel_up');   setChDisplay(v => v+1) }} style={{ ...ICON_BTN_STYLE, color: 'var(--ink-2)' }} aria-label={t('deviceControls.remote.chanUp')}><ArrowIcon dir="up" /></button>
            <span className="z-mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{t('deviceControls.remote.ch')} {chDisplay}</span>
            <button onClick={() => { fire('channel_down'); setChDisplay(v => Math.max(1, v-1)) }} style={{ ...ICON_BTN_STYLE, color: 'var(--ink-2)' }} aria-label={t('deviceControls.remote.chanDown')}><ArrowIcon dir="down" /></button>
          </div>
        </div>

        {/* Source chips */}
        {sourceCommands.length > 0 && (
          <div>
            <span className="z-eyebrow" style={{ display: 'block', marginBottom: 8 }}>{t('deviceControls.remote.source')}</span>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }} className="scrollbar-thin">
              {sourceCommands.map(cmd => (
                <button key={cmd} onClick={() => fire(cmd)} className={CHIP_CLS} style={{ ...chipStyle(false), flexShrink: 0, color: 'var(--ink-2)' }}>
                  {cmd.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Extra commands */}
        {extras.length > 0 && (
          <div>
            <span className="z-eyebrow" style={{ display: 'block', marginBottom: 8 }}>{t('deviceControls.remote.more')}</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {extras.map(cmd => (
                <button key={cmd} onClick={() => fire(cmd)} className={CHIP_CLS} style={{ ...chipStyle(false), color: 'var(--ink-2)' }}>
                  {cmd.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Channel entry */}
        {['digit_0','digit_1','digit_2','digit_3','digit_4','digit_5','digit_6','digit_7','digit_8','digit_9'].every(canDo) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12, borderTop: '0.5px solid var(--line)' }}>
            <span className="z-eyebrow" style={{ flexShrink: 0 }}>{t('deviceControls.remote.channel')}</span>
            <input type="number" min={0} max={9999} value={ch}
              onChange={e => setCh(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
              onKeyDown={e => e.key === 'Enter' && onChannel && onChannel(irDevice.id, parseInt(ch, 10))}
              placeholder="12" className="z-input z-mono" style={{ flex: 1, width: 'auto' }} />
            <button onClick={() => { if (ch) onChannel?.(irDevice.id, parseInt(ch, 10)); setCh('') }}
              className="z-btn-primary" style={{ flexShrink: 0 }}>{t('deviceControls.remote.go')}</button>
          </div>
        )}
      </div>
    </div>
  )
}

// IRRemoteButton — trigger row that opens the full remote drawer.
// Replaces the old IRRemotePanel. onCommand(id, cmd), onChannel(id, channel).
// Optional controlled mode: pass `open` + `onOpenChange` to control the drawer from a
// parent (lets a row's own button open the drawer directly without the intermediate
// "Open →" row). Pass `hideTrigger` to suppress that intermediate row entirely.
export function IRRemoteButton({ irDevice, onCommand, onChannel, open: openProp, onOpenChange, hideTrigger = false }) {
  const t = useT()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = openProp !== undefined ? openProp : internalOpen
  const setOpen = (v) => {
    if (onOpenChange) onOpenChange(v)
    else setInternalOpen(v)
  }
  if (!irDevice) return null

  const learned = new Set(irDevice.learned_commands || [])
  if (learned.size === 0) return null

  return (
    <>
      {!hideTrigger && (
      <div className="mt-2 pt-2 border-t border-line flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-footnote font-medium text-ink-mute min-w-0">
          <Tv2 size={16} strokeWidth={1.75} className="text-ink-mute shrink-0" />
          <span className="truncate">{t('deviceControls.remote.cmdCount', { n: learned.size, s: learned.size !== 1 ? 's' : '' })}</span>
        </span>
        <button
          onClick={() => setOpen(true)}
          className="min-h-[44px] px-2 text-subhead font-medium text-ink hover:text-ink-2 transition-colors shrink-0"
        >
          {t('deviceControls.remote.openLabel')}
        </button>
      </div>
      )}

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={T_STATE}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm"
            />
            {/* Drawer — the one gesture spring, tuned not to overshoot */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={SPRING_SHEET}
              className="fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-[24px] shadow-2xl overflow-hidden"
              style={{
                // dvh + safe-area-bottom: keeps the sheet inside the visible
                // viewport on Android Chrome (URL bar shown) and lifts the
                // bottom action area above iOS home-indicator / Galaxy gesture bar.
                maxHeight: '85dvh',
                paddingBottom: 'var(--safe-bottom)',
              }}
            >
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-line" />
              </div>
              <IRRemoteDrawer
                irDevice={irDevice}
                onCommand={onCommand}
                onChannel={onChannel}
                onClose={() => setOpen(false)}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
//
// Specialized components are used for complex domains that need rich UI
// (sliders, color pickers, media controls, etc.).
// All other domains registered in domainRegistry.js fall through to
// GenericControls which auto-renders buttons from the action definitions.
//
// To support a brand-new domain: add it to domainRegistry.js (and the Python
// registry).  No changes here required unless you want a specialized UI.
export function DeviceControls({ entity, onService }) {
  switch (entity.domain) {
    case 'light':        return <LightControls        entity={entity} onService={onService} />
    case 'climate':      return <ClimateControls      entity={entity} onService={onService} />
    case 'media_player': return <MediaPlayerControls  entity={entity} onService={onService} />
    case 'cover':        return <CoverControls        entity={entity} onService={onService} />
    case 'fan':          return <FanControls          entity={entity} onService={onService} />
    case 'lock':         return <LockControls         entity={entity} onService={onService} />
    case 'vacuum':       return <VacuumControls       entity={entity} onService={onService} />
    default:             return <GenericControls      entity={entity} onService={onService} />
  }
}
