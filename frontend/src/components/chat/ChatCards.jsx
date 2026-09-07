// Embedded UI in chat — one small card per tool-result `kind`.
//
// The agent's tool results carry `data.card` (see core/agent/runner) with a
// `kind` and just enough structure to render. The card lets the user act
// without another round-trip through the model: interactive bits call the
// actions registry directly (`runAction` → POST /api/actions/{name}), which
// is the same code path the agent itself uses.
//
// Language: the runner stamps `card.lang` ("he" | "en") = the language of the
// turn. Every label on a card follows that, not the UI locale, so a Hebrew
// answer never carries an English card (and vice versa). Missing → UI locale.
// The card root also takes its `dir` from that language, so a Hebrew card
// lays out right-to-left even inside an English UI.
//
// The device card shows the home as ROOMS, not rows: one soft tile per room,
// ordered by how much is on in it, and inside each tile the devices as pill
// chips. The chip IS the switch — tapping it flips the device (optimistic,
// rolled back on failure) — so there is no separate control per device and
// nothing reads as a settings panel. A device's own page is one hover-chevron
// (pointer) or long-press (touch) away. Automations use the same chip
// language. Rooms show every chip; a room with more than CHIP_LIMIT devices
// folds the rest behind a "+N" ghost chip.
//
// Layout: on a wide enough column the chat page puts the reply text and the
// card side by side (see AIChat's Message and chatCards.css); the card itself
// is the same either way.
//
// Motion: tiles enter with a fade and a 4px rise on a strong ease-out,
// 30ms apart (capped); the chips inside ride with their tile — no second
// cascade. State flips are a 120ms fill transition (chatCards.css). Under
// prefers-reduced-motion every element mounts instantly with no transition
// props at all.
//
// Kept deliberately plain: the app's CSS variables, logical properties only
// (RTL-safe), no new libraries. Device glyphs come from the central
// DeviceIcon, so they follow the user's Settings → Display icon style like
// everywhere else.

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Zap, Stethoscope, HeartPulse, Sparkles, Camera, ChevronRight } from 'lucide-react'
import { runAction } from '../../lib/api'
import { useLang, t as translateWithLang } from '../../lib/i18n'
import { getKind } from '../../lib/devices'
import { DeviceIcon } from '../../lib/deviceIcons'
import { useChatStore, isWideForChatDock } from '../../stores/chatStore'
import { useDeviceStore } from '../../stores/deviceStore'
import './chatCards.css'

// ── Motion ────────────────────────────────────────────────────────────────────

const EASE_OUT = [0.23, 1, 0.32, 1]
const CARD_EASE_CSS = 'cubic-bezier(0.23, 1, 0.32, 1)'
const STAGGER_S = 0.03
const STAGGER_CAP = 8            // ≥ this index every tile shares one delay

// Props for a motion element entering as the `order`-th of its siblings, or
// nothing at all when the user asked for reduced motion.
export function enterProps(reduce, order = 0) {
  if (reduce) return {}
  return {
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.18, ease: EASE_OUT, delay: Math.min(order, STAGGER_CAP) * STAGGER_S },
  }
}

// FLIP the card's height when its content grows/shrinks (Show all / Less):
// `before()` is called by the toggle right before the state change, the
// layout effect measures the new height and animates between the two. Only
// this one box animates, so nothing inside it is scale-distorted.
function useHeightFlip(ref, dep, enabled) {
  const before = useRef(null)
  useLayoutEffect(() => {
    const el = ref?.current
    const from = before.current
    before.current = null
    if (!enabled || !el || from == null || typeof el.animate !== 'function') return
    const to = el.offsetHeight
    if (to === from) return
    const anim = el.animate(
      [{ height: `${from}px`, overflow: 'hidden' }, { height: `${to}px`, overflow: 'hidden' }],
      { duration: 220, easing: CARD_EASE_CSS },
    )
    return () => { try { anim.cancel() } catch { /* already done */ } }
  }, [dep, enabled, ref])
  return useCallback(() => { before.current = ref?.current?.offsetHeight ?? null }, [ref])
}

// ── Turn language ─────────────────────────────────────────────────────────────

function cardLangOf(card, uiLang) {
  const l = card?.lang
  return l === 'he' || l === 'en' ? l : uiLang
}

// `t` bound to the card's language (identity stable per lang, like useT).
function useCardI18n(card) {
  const uiLang = useLang()
  const lang = cardLangOf(card, uiLang)
  const t = useCallback((key, params) => translateWithLang(key, params, lang), [lang])
  return { t, lang }
}

// ── In-context navigation ─────────────────────────────────────────────────────
// A card names a real object; opening it keeps the conversation at hand: on
// wide screens AppShell keeps the chat docked beside the page (chatDock), on
// phones it shows a "back to chat" pill for any location whose state carries
// `fromChat`. Cards render inside the router in both places (the /chat page
// and the dock), so useNavigate is safe here.

function useChatNav() {
  const navigate = useNavigate()
  const setChatDock = useChatStore((s) => s.setChatDock)
  return (path) => {
    if (!path) return
    if (isWideForChatDock()) setChatDock(true)
    navigate(path, { state: { fromChat: true } })
  }
}

// Name-as-link: a real button (keyboard + screen reader) that looks like the
// plain name it replaces — no underline; a chevron at the trailing edge says
// "this opens" (hover on a pointer device, always faintly on touch).
function LinkName({ to, children, style, title }) {
  const go = useChatNav()
  if (!to) return <span dir="auto" style={style}>{children}</span>
  return (
    <button
      type="button"
      dir="auto"
      title={title}
      className="zc-link"
      onClick={(e) => { e.stopPropagation(); go(to) }}
      style={style}
    >
      <span style={{ minWidth: 0 }}>{children}</span>
      <ChevronRight className="zc-link-go" size={13} strokeWidth={2} aria-hidden="true" />
    </button>
  )
}

export function devicePath(entityId) {
  return entityId ? `/devices/${encodeURIComponent(entityId)}` : null
}

export function automationPath(id) {
  return id ? `/actions?focus=${encodeURIComponent(id)}` : '/actions'
}

// The card's room is the agent directory's slug of the HA area NAME
// (core/agent/directory._slugify_area: lower-case, spaces → underscores). The
// Rooms page routes by HA area_id. Those coincide for a plainly named area
// that was never renamed, but not in general (a renamed area keeps its old
// id; a Hebrew name gets transliterated), so the slug is matched against the
// rooms the app already holds — by id, then by the same slugging of the name
// — and when nothing matches the title opens the Rooms list instead.
export function slugifyRoom(name) {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, '_')
}

export function roomPath(slug, rooms) {
  if (!slug) return null
  const hit = (rooms || []).find((r) => r && (r.id === slug || slugifyRoom(r.name) === slug))
  return hit?.id ? `/rooms/${encodeURIComponent(hit.id)}` : '/rooms'
}

// ── Shared chrome ─────────────────────────────────────────────────────────────

const cardStyle = {
  padding: '12px 14px',
  borderRadius: 16,
  background: 'var(--surface)',
  border: '0.5px solid var(--line)',
  fontSize: 13,
  lineHeight: 1.4,
  color: 'var(--ink)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minWidth: 0,
}

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '5px 0',
  borderBlockStart: '0.5px solid var(--line)',
  minWidth: 0,
}

// One cell of the capabilities grid: name over pitch, a live dot on the
// trailing edge. Live reads as a light accent tint; the rest sits flat.
const cellStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minHeight: 48,
  boxSizing: 'border-box',
  padding: '6px 10px',
  borderRadius: 12,
  border: '0.5px solid var(--line)',
  background: 'var(--surface)',
  minWidth: 0,
}

const cellOnStyle = {
  background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
  borderColor: 'color-mix(in srgb, var(--accent) 35%, var(--line))',
}

const muteStyle = { fontSize: 11, color: 'var(--ink-mute)' }

const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const nameStyle = { fontSize: 13, fontWeight: 600, lineHeight: 1.25, display: 'block', maxWidth: '100%', ...ellipsis }
const detailStyle = { ...muteStyle, lineHeight: 1.25, display: 'block', maxWidth: '100%', ...ellipsis }

function Card({ title, icon: Icon, children, tone, cardRef, lang }) {
  return (
    <div
      ref={cardRef}
      className="zc-card"
      dir={lang === 'he' ? 'rtl' : lang === 'en' ? 'ltr' : undefined}
      style={{
        ...cardStyle,
        ...(tone ? { borderColor: `color-mix(in srgb, var(--${tone}) 45%, var(--line))` } : {}),
      }}
    >
      {title && (
        <p className="z-eyebrow" style={{
          margin: 0, fontSize: 10, lineHeight: 1.5, color: 'var(--ink-mute)',
          display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
        }}>
          {Icon && <Icon size={12} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0, color: tone ? `var(--${tone})` : 'var(--ink-faint)' }} />}
          <span style={{ minWidth: 0, display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap' }}>{title}</span>
        </p>
      )}
      {children}
    </div>
  )
}

function Badge({ children, tone = 'ink-mute' }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap',
      color: `var(--${tone})`,
      background: `color-mix(in srgb, var(--${tone}) 12%, transparent)`,
      border: `0.5px solid color-mix(in srgb, var(--${tone}) 35%, transparent)`,
    }}>
      {children}
    </span>
  )
}

function Dot({ tone, title }) {
  return (
    <span aria-hidden={title ? undefined : true} title={title} role={title ? 'img' : undefined} aria-label={title} style={{
      display: 'inline-block', width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
      background: `var(--${tone})`,
      boxShadow: `0 0 0 3px color-mix(in srgb, var(--${tone}) 18%, transparent)`,
    }} />
  )
}

function SmallButton({ children, onClick, disabled, primary }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        alignSelf: 'flex-start',
        padding: '6px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
        background: primary ? 'var(--ink)' : 'var(--surface-2)',
        color: primary ? 'var(--bg)' : 'var(--ink)',
        border: primary ? 'none' : '0.5px solid var(--line)',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  )
}

function List({ items, render, empty }) {
  if (!items?.length) return empty ? <p style={muteStyle}>{empty}</p> : null
  return (
    <ul style={{ margin: 0, paddingInlineStart: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {items.map((it, i) => <li key={i} style={{ minWidth: 0 }}>{render ? render(it, i) : String(it)}</li>)}
    </ul>
  )
}

function humanize(code) {
  return String(code ?? '').replace(/[_-]+/g, ' ').trim()
}

// "living_room" → "Living room". Only the first letter — device and room
// names are the user's own words, not headlines.
function titleish(code) {
  const s = humanize(code)
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function formatWhen(ts) {
  if (!ts) return ''
  try {
    const d = typeof ts === 'number' ? new Date(ts < 1e12 ? ts * 1000 : ts) : new Date(ts)
    if (Number.isNaN(d.getTime())) return String(ts)
    return d.toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  } catch { return String(ts) }
}

// ── Collapse: first page + "Show all (n)" (list cards) ────────────────────────

export const COLLAPSE_NARROW = 8
export const COLLAPSE_WIDE = 12

function collapseLimit() {
  try {
    return typeof window !== 'undefined' && window.innerWidth >= 1024 ? COLLAPSE_WIDE : COLLAPSE_NARROW
  } catch { return COLLAPSE_NARROW }
}

// Decided once at mount: the page size should not jump under the user's
// finger when a phone rotates mid-conversation.
//
// The card that owns the list hands us its root ref so expanding animates the
// card's height instead of jumping; the toggle snapshots the height first.
function useCollapse(items, cardRef) {
  const reduce = useReducedMotion()
  const [limit] = useState(collapseLimit)
  const [expanded, setExpanded] = useState(false)
  const total = items.length
  const collapsible = total > limit
  const shown = collapsible && !expanded ? items.slice(0, limit) : items
  const snapshot = useHeightFlip(cardRef, expanded, !reduce && !!cardRef)
  const toggle = useCallback(() => { snapshot(); setExpanded((v) => !v) }, [snapshot])
  // Stagger order for the i-th shown item: the first page counts from 0; the
  // items revealed by "Show all" count from 0 again so they cascade too.
  const order = useCallback((i) => (expanded && i >= limit ? i - limit : i), [expanded, limit])
  return { shown, total, collapsible, expanded, toggle, limit, order, reduce }
}

// Quiet text button on the trailing edge: no underline, a soft hover wash
// (chatCards.css), the count in the label.
function ShowAll({ t, collapse }) {
  if (!collapse.collapsible) return null
  return (
    <button
      type="button"
      className="zc-showall"
      onClick={collapse.toggle}
      aria-expanded={collapse.expanded}
      style={{
        alignSelf: 'flex-end', background: 'none', border: 'none', padding: '4px 8px',
        margin: 0, marginBlockStart: 2, marginInlineEnd: -8, borderRadius: 8,
        font: 'inherit', fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)',
        cursor: 'pointer',
      }}
    >
      {collapse.expanded ? t('chat.card.less') : t('chat.card.showAll', { n: collapse.total })}
    </button>
  )
}

// ── Chips ─────────────────────────────────────────────────────────────────────

// Chips per room (or per automations card) before the rest folds behind "+N".
export const CHIP_LIMIT = 8

const LONG_PRESS_MS = 500

// The chip: a pill whose whole body is the press target. `onPress` flips a
// switchable thing (the body then carries aria-pressed); a static chip
// (sensor) opens its page on tap instead, since there is nothing to flip.
// `to` adds the trailing chevron for a pointer and the long-press for touch.
//
// Failure feedback is quiet: the state suffix reads "didn't go through" in
// the error colour for a moment (and the chip's title says the same); the
// fill simply returns to where it was. No shake.
function Chip({ lit, on, busy, failed, icon, label, suffix, onPress, to, title, testid, ghost, t, ariaLabel }) {
  const go = useChatNav()
  const press = useRef({ timer: null, fired: false })

  const clear = () => {
    if (press.current.timer) { clearTimeout(press.current.timer); press.current.timer = null }
  }
  const onPointerDown = (e) => {
    if (!to || e.pointerType !== 'touch') return
    press.current.fired = false
    clear()
    press.current.timer = setTimeout(() => { press.current.fired = true; press.current.timer = null; go(to) }, LONG_PRESS_MS)
  }
  const onClick = () => {
    if (press.current.fired) { press.current.fired = false; return }
    if (onPress) onPress()
    else if (to) go(to)
  }

  const switchable = typeof onPress === 'function'
  const cls = ['zc-chip', lit ? 'zc-chip--on' : '', !switchable && on ? 'zc-chip--lit' : '', ghost ? 'zc-chip--ghost' : ''].filter(Boolean).join(' ')
  return (
    <div className={cls} data-testid={testid} data-on={lit ? 'true' : 'false'} title={failed ? t('chat.card.actionFailed') : title}>
      <button
        type="button"
        className="zc-chip-main"
        aria-pressed={switchable ? !!on : undefined}
        aria-busy={busy ? 'true' : undefined}
        aria-label={ariaLabel}
        disabled={!switchable && !to}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerUp={clear}
        onPointerCancel={clear}
        onPointerLeave={clear}
        onContextMenu={(e) => { if (press.current.timer || press.current.fired) e.preventDefault() }}
      >
        {icon && <span className="zc-chip-ico" aria-hidden="true">{icon}</span>}
        <span className="zc-chip-name" dir="auto">{label}</span>
        {(failed || suffix) && (
          <span className={`zc-chip-suffix${failed ? ' zc-chip-suffix--err' : ''}`} dir="auto">
            {failed ? t('chat.card.actionFailed') : suffix}
          </span>
        )}
      </button>
      {to && (
        <button
          type="button"
          className="zc-chip-go"
          aria-label={t('chat.card.open', { name: label })}
          onClick={(e) => { e.stopPropagation(); go(to) }}
        >
          <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

// "+N" ghost chip: expands its group in place. One-way — chips are small,
// nothing needs folding back.
function MoreChip({ n, onClick, t }) {
  return (
    <div className="zc-chip zc-chip--ghost" data-testid="more-chip">
      <button
        type="button"
        className="zc-chip-main"
        aria-label={t('chat.card.showMore', { n })}
        onClick={onClick}
      >
        <span className="zc-chip-name">{t('chat.card.more', { n })}</span>
      </button>
    </div>
  )
}

// Optimistic on/off with rollback. `send(next)` performs the action; the hook
// owns the busy/failed flags and the timed reset of the failure note.
function useFlip(initial, send, onDone) {
  const [on, setOn] = useState(!!initial)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const flip = async () => {
    if (busy) return
    const prev = on
    const next = !on
    setOn(next); setBusy(true); setFailed(false)
    try {
      const res = await send(next)
      if (res?.ok === false) throw new Error(res?.message || 'failed')
      onDone?.(next)
    } catch {
      setOn(prev); setFailed(true)
      setTimeout(() => setFailed(false), 1200)
    } finally { setBusy(false) }
  }
  return { on, busy, failed, flip }
}

// ── Device labels ─────────────────────────────────────────────────────────────

// The directory's fallback noun when it has nothing better to say about a
// device (core/agent/directory.py). Showing it would put sixteen identical
// "המכשיר" chips on screen; the real name is more useful even in Hebrew.
const GENERIC_HE_NOUN = 'המכשיר'

export function deviceLabel(device, lang) {
  if (!device) return ''
  if (lang === 'he') {
    const noun = (device.he_noun || '').trim()
    if (noun && noun !== GENERIC_HE_NOUN) return noun
    return device.name || noun || ''
  }
  return device.name || device.he_noun || ''
}

export function roomLabel(device, lang) {
  if (!device) return ''
  if (lang === 'he') return device.room_he || (device.room ? humanize(device.room) : '')
  return device.room ? titleish(device.room) : (device.room_he || '')
}

// Chips for the primary domains that have a meaningful on/off. Sensors and
// the like are listed but not switchable.
const SWITCHABLE = new Set(['light', 'switch', 'fan', 'climate', 'media_player', 'humidifier', 'input_boolean'])

export function isSwitchable(device) {
  return !!device?.entity_id && SWITCHABLE.has(device.domain) && typeof device.on === 'boolean'
}

// ON first, then by room, stable within a group — the things the user can
// act on right now come first, and neighbours sit together.
export function sortDevices(devices, lang) {
  return devices
    .map((d, i) => ({ d, i, on: d.on === true ? 0 : 1, room: roomLabel(d, lang) }))
    .sort((a, b) => (a.on - b.on) || a.room.localeCompare(b.room) || (a.i - b.i))
    .map((x) => x.d)
}

// Rooms, ordered by how much is on in them (then by name); devices with no
// room gather last under "Elsewhere". Inside a room, ON chips lead.
export function groupByRoom(devices, lang) {
  const groups = new Map()
  for (const d of devices || []) {
    const slug = d?.room ? String(d.room) : ''
    if (!groups.has(slug)) groups.set(slug, { slug: slug || null, name: slug ? roomLabel(d, lang) : '', devices: [], on: 0 })
    const g = groups.get(slug)
    g.devices.push(d)
    if (isSwitchable(d) && d.on === true) g.on += 1
  }
  const out = [...groups.values()]
  out.sort((a, b) => ((a.slug ? 0 : 1) - (b.slug ? 0 : 1)) || (b.on - a.on) || a.name.localeCompare(b.name))
  for (const g of out) g.devices = sortDevices(g.devices, lang)
  return out
}

// ── device_list ───────────────────────────────────────────────────────────────

// The card payload is the agent's directory row, not a full HA entity, so
// the kind resolver gets a synthesized shape: entity_id + domain drive the
// domain switch, the display name feeds the keyword pass that tells a kettle
// from a plug (device_class is not in the payload; binary sensors fall back
// to the name scan and then to the generic binary glyph).
export function deviceKind(device) {
  return getKind({
    entity_id: device?.entity_id || '',
    domain: device?.domain || (device?.entity_id || '').split('.')[0],
    friendly_name: device?.name || '',
    device_class: device?.device_class,
  })
}

// The small state suffix of a static chip: "24°", "open", "motion". Binary
// states are read through the device's kind so a door says open/closed and
// a motion sensor says motion/clear, in the turn's language.
export function stateSuffix(device, kind, t) {
  const raw = device?.state
  if (raw == null || raw === '' || raw === 'unknown' || raw === 'unavailable') return ''
  const s = String(raw)
  const num = Number(s)
  if (s.trim() !== '' && !Number.isNaN(num)) {
    if (kind === 'temperature') return `${Math.round(num)}°`
    if (kind === 'humidity') return `${Math.round(num)}%`
    return s
  }
  const isBinary = (device.domain || (device.entity_id || '').split('.')[0]) === 'binary_sensor'
  if (isBinary && (s === 'on' || s === 'off')) {
    const onState = s === 'on'
    if (kind === 'door' || kind === 'window') return t(onState ? 'chat.card.state.open' : 'chat.card.state.closed')
    if (kind === 'motion' || kind === 'occupancy') return t(onState ? 'chat.card.state.motion' : 'chat.card.state.clear')
    return t(onState ? 'chat.card.state.on' : 'chat.card.state.off')
  }
  return humanize(s)
}

function DeviceChip({ device, lang, t, onAction }) {
  const canToggle = isSwitchable(device)
  const name = deviceLabel(device, lang)
  const kind = useMemo(() => deviceKind(device), [device])
  const { on, busy, failed, flip } = useFlip(
    device.on,
    (next) => runAction('control_device', { entity_id: device.entity_id, action: next ? 'on' : 'off' }, lang),
    (next) => onAction?.({ name: 'control_device', args: { entity_id: device.entity_id, action: next ? 'on' : 'off' }, ok: true }),
  )
  const suffix = canToggle ? '' : stateSuffix(device, kind, t)
  return (
    <Chip
      testid="device-chip"
      lit={canToggle && on}
      on={canToggle ? on : device.on === true}
      busy={busy}
      failed={failed}
      icon={<DeviceIcon kind={kind} size={18} />}
      label={name}
      suffix={suffix}
      onPress={canToggle ? flip : undefined}
      to={devicePath(device.entity_id)}
      title={name}
      t={t}
    />
  )
}

function RoomTile({ group, lang, t, onAction, order, reduce, rooms }) {
  const go = useChatNav()
  const [expanded, setExpanded] = useState(false)
  const path = roomPath(group.slug, rooms)
  const title = group.slug ? group.name : t('chat.card.elsewhere')
  const shown = expanded || group.devices.length <= CHIP_LIMIT ? group.devices : group.devices.slice(0, CHIP_LIMIT)
  const hidden = group.devices.length - shown.length
  const onText = group.on === 0 ? '' : group.on === 1 ? t('chat.card.onOne') : t('chat.card.onCount', { n: group.on })
  return (
    <motion.section
      className="zc-room"
      data-testid="room-tile"
      data-room={group.slug || ''}
      {...enterProps(reduce, order)}
    >
      <header className="zc-room-head">
        {path
          ? (
            <button type="button" className="zc-room-title" onClick={() => go(path)} aria-label={t('chat.card.openRoom', { name: title })}>
              <span dir="auto">{title}</span>
              <ChevronRight className="zc-room-go" size={13} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
            </button>
          )
          : <span className="zc-room-title"><span dir="auto">{title}</span></span>}
        {onText && <span className="zc-room-on" dir="auto">{onText}</span>}
      </header>
      <div className="zc-chips">
        {shown.map((d, i) => (
          <DeviceChip key={d.entity_id || `${d.name}-${i}`} device={d} lang={lang} t={t} onAction={onAction} />
        ))}
        {hidden > 0 && <MoreChip n={hidden} t={t} onClick={() => setExpanded(true)} />}
      </div>
    </motion.section>
  )
}

function DeviceListCard({ card, onAction }) {
  const { t, lang } = useCardI18n(card)
  const reduce = useReducedMotion()
  const rooms = useDeviceStore((s) => s.ziggyRooms)
  const devices = card.devices || []
  const groups = useMemo(() => groupByRoom(devices, lang), [devices, lang])
  const title = `${t('chat.card.home')} · ${t('chat.card.devices', { n: devices.length })}`
  return (
    <Card lang={lang} title={title}>
      {devices.length === 0
        ? <p style={muteStyle}>{t('chat.card.noDevices')}</p>
        : (
          <div className="zc-rooms">
            {groups.map((g, i) => (
              <RoomTile
                key={g.slug || '__elsewhere'}
                group={g} lang={lang} t={t} onAction={onAction}
                order={i} reduce={reduce} rooms={rooms}
              />
            ))}
          </div>
        )}
    </Card>
  )
}

// ── automations ───────────────────────────────────────────────────────────────

function AutomationChip({ auto, lang, t, onAction }) {
  const { on, busy, failed, flip } = useFlip(
    auto.enabled,
    (next) => runAction('toggle_automation', { name: auto.name, enabled: next }, lang),
    (next) => onAction?.({ name: 'toggle_automation', args: { name: auto.name, enabled: next }, ok: true }),
  )
  const detail = auto.last_triggered ? t('chat.card.lastRun', { when: formatWhen(auto.last_triggered) }) : t('chat.card.neverRan')
  return (
    <Chip
      testid="automation-chip"
      lit={on}
      on={on}
      busy={busy}
      failed={failed}
      icon={<Zap size={14} strokeWidth={2} aria-hidden="true" fill={on ? 'currentColor' : 'none'} />}
      label={auto.name}
      onPress={auto.name ? flip : undefined}
      to={automationPath(auto.id)}
      title={`${auto.name} · ${detail}`}
      t={t}
    />
  )
}

function AutomationsCard({ card, onAction }) {
  const { t, lang } = useCardI18n(card)
  const reduce = useReducedMotion()
  const autos = card.automations || []
  const [expanded, setExpanded] = useState(false)
  const shown = expanded || autos.length <= CHIP_LIMIT ? autos : autos.slice(0, CHIP_LIMIT)
  const hidden = autos.length - shown.length
  return (
    <Card lang={lang} title={t('chat.card.automations', { n: autos.length })}>
      {autos.length === 0
        ? <p style={muteStyle}>{t('chat.card.noAutomations')}</p>
        : (
          <motion.div className="zc-chips" data-testid="automation-chips" {...enterProps(reduce, 0)}>
            {shown.map((a, i) => (
              <AutomationChip key={a.id || a.name || i} auto={a} lang={lang} t={t} onAction={onAction} />
            ))}
            {hidden > 0 && <MoreChip n={hidden} t={t} onClick={() => setExpanded(true)} />}
          </motion.div>
        )}
    </Card>
  )
}

// ── capabilities ──────────────────────────────────────────────────────────────

function CapabilitiesCard({ card }) {
  const { t, lang } = useCardI18n(card)
  const caps = card.capabilities || []
  const cardRef = useRef(null)
  const collapse = useCollapse(caps, cardRef)
  return (
    <Card lang={lang} cardRef={cardRef} icon={Sparkles} title={card.overview ? t('chat.card.whatZiggyCanDo') : t('chat.card.capabilities')}>
      {caps.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, minWidth: 0 }}>
          {collapse.shown.map((c, i) => {
            const pitch = c.pitch || c.what_it_does || ''
            return (
              <motion.div
                key={c.name || i}
                className={`zc-cell${c.live ? ' zc-cell--on' : ''}`}
                style={{ ...cellStyle, ...(c.live ? cellOnStyle : {}) }}
                {...enterProps(collapse.reduce, collapse.order(i))}
              >
                <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 1 }}>
                  <span dir="auto" title={c.name} style={nameStyle}>{c.name}</span>
                  <span dir="auto" title={pitch} style={detailStyle}>{pitch || ' '}</span>
                </div>
                <Dot tone={c.live ? 'ok' : 'ink-mute'} title={c.live ? t('chat.card.live') : t('chat.card.notLive')} />
              </motion.div>
            )
          })}
        </div>
      )}
      <ShowAll t={t} collapse={collapse} />
    </Card>
  )
}

// ── why_not ───────────────────────────────────────────────────────────────────

// services/why_not.py VERDICTS — mapped to short human titles via i18n.
const VERDICT_KEYS = {
  device_unreachable: 'chat.card.verdict.deviceUnreachable',
  sensor_latched: 'chat.card.verdict.sensorLatched',
  sensor_silent: 'chat.card.verdict.sensorSilent',
  automation_disabled: 'chat.card.verdict.automationDisabled',
  automation_did_not_trigger: 'chat.card.verdict.automationDidNotTrigger',
  automation_stopped_on_conditions: 'chat.card.verdict.automationStoppedOnConditions',
  automation_failed: 'chat.card.verdict.automationFailed',
  manual_override: 'chat.card.verdict.manualOverride',
  no_automation_for_device: 'chat.card.verdict.noAutomationForDevice',
  unknown: 'chat.card.verdict.unknown',
}

export function verdictTitle(t, code) {
  const key = VERDICT_KEYS[code]
  return key ? t(key) : humanize(code)
}

function WhyNotCard({ card, entityId, onAction }) {
  const { t, lang } = useCardI18n(card)
  const [fixState, setFixState] = useState('idle')   // idle | busy | done | error
  const verdicts = card.verdicts || []
  const primary = verdicts[0]
  const canFix = card.device_reachable === false && !!entityId

  const tryFix = async () => {
    if (fixState === 'busy') return
    setFixState('busy')
    try {
      const res = await runAction('refresh_device', { entity_id: entityId }, lang)
      if (res?.ok === false) throw new Error(res?.message || 'failed')
      setFixState('done')
      onAction?.({ name: 'refresh_device', args: { entity_id: entityId }, ok: true })
    } catch {
      setFixState('error')
      setTimeout(() => setFixState('idle'), 2500)
    }
  }

  const occupancy = card.occupancy && typeof card.occupancy === 'object'
    ? (card.occupancy.state || card.occupancy.status || null)
    : card.occupancy

  // The card is about one device (entity_id from the runner when it knows it);
  // its verdict line doubles as the way into that device's page.
  const deviceLink = devicePath(card.entity_id || entityId)

  return (
    <Card lang={lang} icon={Stethoscope} title={t('chat.card.whyNot')} tone={primary && primary !== 'unknown' ? 'warn' : undefined}>
      {primary && (
        <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>
          <LinkName to={deviceLink} style={{ fontWeight: 600, fontSize: 14 }}>{verdictTitle(t, primary)}</LinkName>
        </p>
      )}
      {verdicts.length > 1 && (
        <p style={muteStyle}>{t('chat.card.alsoPossible')}: {verdicts.slice(1).map((v) => verdictTitle(t, v)).join(' · ')}</p>
      )}
      {card.device_reachable === false && <p style={{ ...muteStyle, color: 'var(--err)' }}>{t('chat.card.deviceUnreachable')}</p>}
      {occupancy && <p style={muteStyle}>{t('chat.card.roomOccupancy')}: {humanize(occupancy)}</p>}

      {card.routines?.length > 0 && (
        <div>
          <p style={{ ...muteStyle, fontWeight: 600, marginBottom: 2 }}>{t('chat.card.routines')}</p>
          <List items={card.routines} render={(r) => (
            <span dir="auto">
              {r.name}
              <span style={muteStyle}> · {r.enabled ? t('common.enabled') : t('common.disabled')}{r.last_run ? ` · ${humanize(r.last_run)}` : ''}</span>
            </span>
          )} />
        </div>
      )}
      {card.room_sensors?.length > 0 && (
        <div>
          <p style={{ ...muteStyle, fontWeight: 600, marginBottom: 2 }}>{t('chat.card.sensors')}</p>
          <List items={card.room_sensors} render={(s) => (
            <span dir="auto">
              {s.room ? humanize(s.room) : t('chat.card.sensor')}
              <span style={muteStyle}>
                {' · '}{humanize(s.state)}
                {s.held_minutes > 0 ? ` · ${t('chat.card.heldMinutes', { n: s.held_minutes })}` : ''}
                {s.problem === 'stuck' ? ` · ${t('chat.card.sensorStuck')}` : s.problem === 'quiet' ? ` · ${t('chat.card.sensorQuiet')}` : ''}
              </span>
            </span>
          )} />
        </div>
      )}
      {card.tried?.length > 0 && (
        <div>
          <p style={{ ...muteStyle, fontWeight: 600, marginBottom: 2 }}>{t('chat.card.tried')}</p>
          <List items={card.tried} render={(a) => <span dir="auto">{humanize(a.step)}<span style={muteStyle}> · {humanize(a.outcome)}</span></span>} />
        </div>
      )}

      {canFix && (
        <SmallButton primary onClick={tryFix} disabled={fixState === 'busy' || fixState === 'done'}>
          {fixState === 'done' ? t('chat.card.fixSent')
            : fixState === 'busy' ? '…'
            : fixState === 'error' ? t('chat.card.actionFailed')
            : t('chat.card.tryFix')}
        </SmallButton>
      )}
    </Card>
  )
}

// ── home_health / down_devices / repair_history / recent_activity ─────────────

function HomeHealthCard({ card }) {
  const { t, lang } = useCardI18n(card)
  const tone = card.severity === 'problem' ? 'err' : card.severity === 'attention' ? 'warn' : 'ok'
  const label = card.severity === 'problem' ? t('chat.card.healthProblem')
    : card.severity === 'attention' ? t('chat.card.healthAttention')
    : t('chat.card.healthOk')
  return (
    <Card lang={lang} title={t('chat.card.homeHealth')}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span aria-hidden="true" style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          width: 28, height: 28, borderRadius: '50%',
          color: `var(--${tone})`,
          background: `color-mix(in srgb, var(--${tone}) 14%, transparent)`,
          boxShadow: `0 0 0 3px color-mix(in srgb, var(--${tone}) 10%, transparent)`,
        }}>
          <HeartPulse size={15} strokeWidth={2.25} />
        </span>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={muteStyle}>· {t('chat.card.offlineCount', { n: card.offline_count ?? 0 })}</span>
      </div>
    </Card>
  )
}

function DownDevicesCard({ card }) {
  const { t, lang } = useCardI18n(card)
  const names = card.names || []
  const count = card.count ?? names.length
  return (
    <Card lang={lang} title={t('chat.card.downDevices', { n: count })} tone={count > 0 ? 'warn' : undefined}>
      {/* No ids in this card — names open the Devices list, where the offline
          filter/banner takes over. */}
      <List items={names} render={(n) => <LinkName to="/devices">{n}</LinkName>} empty={t('chat.card.allReachable')} />
    </Card>
  )
}

function RepairHistoryCard({ card }) {
  const { t, lang } = useCardI18n(card)
  return (
    <Card lang={lang} title={t('chat.card.repairHistory')}>
      <List
        items={card.attempts || []}
        empty={t('chat.card.noRepairs')}
        render={(a) => (
          <span dir="auto">
            {humanize(a.step)}
            <span style={muteStyle}> · {humanize(a.outcome)}{a.ts ? ` · ${formatWhen(a.ts)}` : ''}</span>
          </span>
        )}
      />
    </Card>
  )
}

function RecentActivityCard({ card }) {
  const { t, lang } = useCardI18n(card)
  const changes = card.changes || []
  const cardRef = useRef(null)
  const collapse = useCollapse(changes, cardRef)
  return (
    <Card lang={lang} cardRef={cardRef} title={t('chat.card.recentActivity')}>
      <List items={collapse.shown} empty={t('chat.card.noActivity')} render={(c) => <span dir="auto">{String(c)}</span>} />
      <ShowAll t={t} collapse={collapse} />
    </Card>
  )
}

// ── camera_look / needs_approval ──────────────────────────────────────────────

function CameraLookCard({ card }) {
  const { t, lang } = useCardI18n(card)
  const title = [card.camera, card.room && humanize(card.room)].filter(Boolean).join(' · ') || t('chat.card.camera')
  return (
    <Card lang={lang} icon={Camera} title={<LinkName to="/cameras" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{title}</LinkName>}>
      {card.description && <p dir="auto" style={{ margin: 0 }}>{card.description}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {typeof card.people_count === 'number' && <Badge tone="accent">{t('chat.card.people', { n: card.people_count })}</Badge>}
        {(card.tags || []).map((tag, i) => <Badge key={i}>{String(tag)}</Badge>)}
      </div>
    </Card>
  )
}

function NeedsApprovalCard({ card }) {
  const { t, lang } = useCardI18n(card)
  return (
    <Card lang={lang} title={t('chat.card.needsApproval')} tone="warn">
      {card.fix && <p dir="auto" style={{ margin: 0, fontWeight: 500 }}>{typeof card.fix === 'string' ? card.fix : humanize(card.fix.name || card.fix.step || JSON.stringify(card.fix))}</p>}
      <p style={muteStyle}>{t('chat.card.needsApprovalNote')}</p>
    </Card>
  )
}

// ── Fallback: compact key/value ───────────────────────────────────────────────

const ID_KEY_RE = /(^|_)(id|ids|uuid|entity_id|entity_ids|device_id|unique_id|token)$/i

function KeyValueCard({ card }) {
  const { t, lang } = useCardI18n(card)
  const entries = Object.entries(card || {}).filter(([k, v]) =>
    k !== 'kind' && k !== 'lang' && !ID_KEY_RE.test(k) && v != null && v !== '' && typeof v !== 'function')
  const titleKey = `chat.card.kind.${card.kind}`
  const titled = t(titleKey)
  const title = titled === titleKey ? humanize(card.kind) : titled
  const show = (v) => {
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' && x ? JSON.stringify(x) : String(x))).join(', ')
    if (typeof v === 'boolean') return v ? t('common.yes') : t('common.no')
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v)
  }
  return (
    <Card lang={lang} title={title}>
      {entries.length === 0 && <p style={muteStyle}>—</p>}
      {entries.map(([k, v]) => (
        <div key={k} style={{ ...rowStyle, alignItems: 'flex-start' }}>
          <span style={{ ...muteStyle, flexShrink: 0 }}>{humanize(k)}</span>
          <span dir="auto" style={{ textAlign: 'end', overflowWrap: 'anywhere', minWidth: 0 }}>{show(v)}</span>
        </div>
      ))}
    </Card>
  )
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

const CARDS = {
  device_list: DeviceListCard,
  automations: AutomationsCard,
  capabilities: CapabilitiesCard,
  why_not: WhyNotCard,
  home_health: HomeHealthCard,
  down_devices: DownDevicesCard,
  repair_history: RepairHistoryCard,
  recent_activity: RecentActivityCard,
  camera_look: CameraLookCard,
  needs_approval: NeedsApprovalCard,
}

export const CARD_KINDS = Object.keys(CARDS)

// Tile/chip cards are allowed to grow with the chat column (240px tiles → 1
// on a phone/dock, 3–4 on the wide chat page); row/list cards stay narrow.
const CARD_MAX_WIDTH = { device_list: 940, automations: 640, capabilities: 640 }

/**
 * @param {object} props.card       tool result object with a `kind` (and,
 *                                  from the runner, a `lang` for the turn)
 * @param {string} [props.entityId] the device a why_not card is about (not in
 *                                  the payload; the runner adds card.entity_id
 *                                  when it knows it)
 * @param {function} [props.onAction] called after an in-card action succeeds
 */
export default function ChatCard({ card, entityId, onAction }) {
  if (!card || typeof card !== 'object' || !card.kind) return null
  const Comp = CARDS[card.kind] || KeyValueCard
  return (
    <div className="zc-card-wrap" style={{ width: '100%', maxWidth: CARD_MAX_WIDTH[card.kind] ?? 420, alignSelf: 'flex-start' }}>
      <Comp card={card} entityId={entityId ?? card.entity_id} onAction={onAction} />
    </div>
  )
}
