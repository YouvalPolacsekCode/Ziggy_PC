// Embedded UI in chat — one small card per tool-result `kind`.
//
// The agent's tool results carry `data.card` (see core/agent/runner) with a
// `kind` and just enough structure to render. Cards sit BELOW the assistant's
// text bubble: the chat auto-scrolls to the bottom, so the interactive card is
// what stays in view while the (deliberately short) prose sits above it. The
// card lets the user act without another round-trip through the model.
// Interactive bits call the actions registry directly (`runAction` → POST
// /api/actions/{name}), which is the same code path the agent itself uses.
//
// Language: the runner stamps `card.lang` ("he" | "en") = the language of the
// turn. Every label on a card follows that, not the UI locale, so a Hebrew
// answer never carries an English card (and vice versa). Missing → UI locale.
//
// Density: list-shaped cards collapse to a first page (8 items, 12 on a wide
// window) behind a "Show all (n)" text button so reply + card fit one screen
// on a phone and on the desktop chat page alike.
//
// Layout: on a wide enough column the chat page puts the reply text and the
// card side by side (see AIChat's Message and chatCards.css); the card itself
// is the same either way.
//
// Motion: one grammar for everything here — fade + a 6px rise on a strong
// ease-out, cells staggered 25ms apart (capped so a full first page lands
// under ~400ms). Expanding "Show all" animates the card's height (a FLIP on
// the real height via WAAPI, so nothing inside is scale-distorted). Under
// prefers-reduced-motion every element mounts instantly with no transition
// props at all.
//
// Kept deliberately plain: inline styles on the app's CSS variables, logical
// properties only (RTL-safe), no new libraries. The Radix-backed Toggle from
// ui/ is the one shared control (gotcha: Radix wants onCheckedChange). Device
// glyphs come from the central DeviceIcon, so they follow the user's
// Settings → Display icon style like everywhere else.

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Zap, Stethoscope, HeartPulse, Sparkles, Camera } from 'lucide-react'
import { runAction } from '../../lib/api'
import { useLang, t as translateWithLang } from '../../lib/i18n'
import { getKind } from '../../lib/devices'
import { DeviceIcon } from '../../lib/deviceIcons'
import { Toggle } from '../ui/Toggle'
import { useChatStore, isWideForChatDock } from '../../stores/chatStore'
import './chatCards.css'

// ── Motion ────────────────────────────────────────────────────────────────────

const EASE_OUT = [0.23, 1, 0.32, 1]
const CARD_EASE_CSS = 'cubic-bezier(0.23, 1, 0.32, 1)'
const STAGGER_S = 0.025
const STAGGER_CAP = 8            // ≥ this index every cell shares one delay

// Props for a motion element entering as the `order`-th of its siblings, or
// nothing at all when the user asked for reduced motion.
export function enterProps(reduce, order = 0) {
  if (reduce) return {}
  return {
    initial: { opacity: 0, y: 6 },
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
// A card names a real object; tapping the name opens that object's page. The
// conversation stays at hand: on wide screens AppShell keeps the chat docked
// beside the page (chatDock), on phones it shows a "back to chat" pill for any
// location whose state carries `fromChat`. Cards render inside the router in
// both places (the /chat page and the dock), so useNavigate is safe here.

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
// plain name it replaces. Stops propagation so a row that also holds a Toggle
// never sees the click.
function LinkName({ to, children, style, title }) {
  const go = useChatNav()
  if (!to) return <span dir="auto" style={style}>{children}</span>
  return (
    <button
      type="button"
      dir="auto"
      title={title}
      onClick={(e) => { e.stopPropagation(); go(to) }}
      style={{
        background: 'none', border: 'none', padding: 0, margin: 0,
        font: 'inherit', color: 'inherit', textAlign: 'start', cursor: 'pointer',
        textDecoration: 'underline', textDecorationColor: 'color-mix(in srgb, var(--ink) 25%, transparent)',
        textUnderlineOffset: 3, maxWidth: '100%', minWidth: 0,
        ...style,
      }}
    >
      {children}
    </button>
  )
}

export function devicePath(entityId) {
  return entityId ? `/devices/${encodeURIComponent(entityId)}` : null
}

export function automationPath(id) {
  return id ? `/actions?focus=${encodeURIComponent(id)}` : '/actions'
}

// ── Shared chrome ─────────────────────────────────────────────────────────────

const cardStyle = {
  padding: '10px 12px',
  borderRadius: 14,
  background: 'var(--surface)',
  border: '0.5px solid var(--line)',
  fontSize: 13,
  lineHeight: 1.4,
  color: 'var(--ink)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
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

// One cell of a grid card: icon | name over detail | control on the trailing
// edge. ON reads as a light accent tint; OFF sits flat on the surface.
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

// The leading icon box of a cell. Tinted with the accent when the thing is
// on, muted when it is off, so state reads before the toggle does.
function cellIconStyle(on) {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    width: 30, height: 30, borderRadius: 9,
    color: on ? 'var(--accent)' : 'var(--ink-faint)',
    background: on
      ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
      : 'color-mix(in srgb, var(--ink) 5%, transparent)',
    transition: 'color 160ms ease, background-color 160ms ease',
  }
}

const muteStyle = { fontSize: 11, color: 'var(--ink-mute)' }

const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const nameStyle = { fontSize: 13, fontWeight: 600, lineHeight: 1.25, display: 'block', maxWidth: '100%', ...ellipsis }
const detailStyle = { ...muteStyle, lineHeight: 1.25, display: 'block', maxWidth: '100%', ...ellipsis }

// Header eyebrow: an optional kind glyph, the title, and — when the title is
// a "{n} things" string — the count lifted into a small mono pill. The count
// is found inside the translated string, so no locale needs a second key.
export function CountTitle({ text, n }) {
  if (typeof text !== 'string' || typeof n !== 'number') return text
  const needle = String(n)
  const at = text.indexOf(needle)
  if (at < 0) return text
  const head = text.slice(0, at), tail = text.slice(at + needle.length)
  return (
    <>
      {head}
      <span className="z-mono" style={{
        display: 'inline-block', fontSize: 10, fontWeight: 600, lineHeight: 1,
        padding: '3px 6px', borderRadius: 999, marginInline: head ? 4 : 0,
        color: 'var(--ink-2, var(--ink))',
        background: 'color-mix(in srgb, var(--ink) 7%, transparent)',
        border: '0.5px solid color-mix(in srgb, var(--ink) 12%, transparent)',
        letterSpacing: 0,
      }}>{needle}</span>
      {tail}
    </>
  )
}

function Card({ title, count, icon: Icon, children, tone, cardRef }) {
  return (
    <div ref={cardRef} style={{
      ...cardStyle,
      ...(tone ? { borderColor: `color-mix(in srgb, var(--${tone}) 45%, var(--line))` } : {}),
    }}>
      {title && (
        <p className="z-eyebrow" style={{
          margin: 0, fontSize: 10, color: 'var(--ink-mute)',
          display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
        }}>
          {Icon && <Icon size={12} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0, color: tone ? `var(--${tone})` : 'var(--ink-faint)' }} />}
          <span style={{ minWidth: 0, display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap' }}>
            <CountTitle text={title} n={count} />
          </span>
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

// ── Collapse: first page + "Show all (n)" ─────────────────────────────────────

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

// ── Device labels ─────────────────────────────────────────────────────────────

// The directory's fallback noun when it has nothing better to say about a
// device (core/agent/directory.py). Showing it would put sixteen identical
// "המכשיר" cells on screen; the real name is more useful even in Hebrew.
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

// Cards for the primary domains that have a meaningful on/off. Sensors and
// the like are listed but not switchable.
const SWITCHABLE = new Set(['light', 'switch', 'fan', 'climate', 'media_player', 'humidifier', 'input_boolean'])

// ON first, then by room, stable within a group — the things the user can
// act on right now come first, and neighbours sit together.
export function sortDevices(devices, lang) {
  return devices
    .map((d, i) => ({ d, i, on: d.on === true ? 0 : 1, room: roomLabel(d, lang) }))
    .sort((a, b) => (a.on - b.on) || a.room.localeCompare(b.room) || (a.i - b.i))
    .map((x) => x.d)
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

function DeviceCell({ device, lang, t, onAction, order = 0, reduce = false }) {
  const [on, setOn] = useState(!!device.on)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const canToggle = !!device.entity_id && SWITCHABLE.has(device.domain) && typeof device.on === 'boolean'
  const name = deviceLabel(device, lang)
  const room = roomLabel(device, lang)
  const kind = useMemo(() => deviceKind(device), [device])
  // State colour: a switchable thing that is on; a sensor reporting "on"
  // (motion / open door) counts too, so the cell's tint tells the state at a
  // glance even where there is no toggle.
  const lit = canToggle ? on : device.on === true

  const toggle = async (next) => {
    if (busy) return
    const prev = on
    setOn(next); setBusy(true); setFailed(false)
    try {
      const res = await runAction('control_device', { entity_id: device.entity_id, action: next ? 'on' : 'off' }, lang)
      if (res?.ok === false) throw new Error(res?.message || 'failed')
      onAction?.({ name: 'control_device', args: { entity_id: device.entity_id, action: next ? 'on' : 'off' }, ok: true })
    } catch {
      setOn(prev); setFailed(true)
      setTimeout(() => setFailed(false), 2500)
    } finally { setBusy(false) }
  }

  const detail = failed
    ? t('chat.card.actionFailed')
    : [room, !canToggle && device.state ? humanize(device.state) : ''].filter(Boolean).join(' · ')

  return (
    <motion.div
      className={`zc-cell${lit ? ' zc-cell--on' : ''}`}
      data-testid="device-cell"
      data-on={lit ? 'true' : 'false'}
      style={{ ...cellStyle, ...(lit ? cellOnStyle : {}) }}
      {...enterProps(reduce, order)}
    >
      <span style={cellIconStyle(lit)}>
        <DeviceIcon kind={kind} size={18} />
      </span>
      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 1 }}>
        <LinkName to={devicePath(device.entity_id)} title={name} style={nameStyle}>{name}</LinkName>
        <span dir="auto" title={detail} style={{ ...detailStyle, ...(failed ? { color: 'var(--err)' } : {}) }}>{detail || ' '}</span>
      </div>
      {canToggle
        ? <Toggle checked={on} onCheckedChange={toggle} disabled={busy} />
        : null}
    </motion.div>
  )
}

function DeviceListCard({ card, onAction }) {
  const { t, lang } = useCardI18n(card)
  const devices = sortDevices(card.devices || [], lang)
  const cardRef = useRef(null)
  const collapse = useCollapse(devices, cardRef)
  return (
    <Card cardRef={cardRef} title={t('chat.card.devices', { n: devices.length })} count={devices.length}>
      {devices.length === 0
        ? <p style={muteStyle}>{t('chat.card.noDevices')}</p>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6, minWidth: 0 }}>
            {collapse.shown.map((d, i) => (
              <DeviceCell
                key={d.entity_id || `${d.name}-${i}`}
                device={d} lang={lang} t={t} onAction={onAction}
                order={collapse.order(i)} reduce={collapse.reduce}
              />
            ))}
          </div>
        )}
      <ShowAll t={t} collapse={collapse} />
    </Card>
  )
}

// ── automations ───────────────────────────────────────────────────────────────

function AutomationRow({ auto, lang, t, onAction, order = 0, reduce = false }) {
  const [enabled, setEnabled] = useState(!!auto.enabled)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const toggle = async (next) => {
    if (busy) return
    const prev = enabled
    setEnabled(next); setBusy(true); setFailed(false)
    try {
      const res = await runAction('toggle_automation', { name: auto.name, enabled: next }, lang)
      if (res?.ok === false) throw new Error(res?.message || 'failed')
      onAction?.({ name: 'toggle_automation', args: { name: auto.name, enabled: next }, ok: true })
    } catch {
      setEnabled(prev); setFailed(true)
      setTimeout(() => setFailed(false), 2500)
    } finally { setBusy(false) }
  }

  const detail = failed
    ? t('chat.card.actionFailed')
    : auto.last_triggered ? t('chat.card.lastRun', { when: formatWhen(auto.last_triggered) }) : t('chat.card.neverRan')

  return (
    <motion.div
      className={`zc-cell${enabled ? ' zc-cell--on' : ''}`}
      data-testid="automation-cell"
      data-on={enabled ? 'true' : 'false'}
      style={{ ...cellStyle, ...(enabled ? cellOnStyle : {}) }}
      {...enterProps(reduce, order)}
    >
      <span style={cellIconStyle(enabled)}>
        <Zap size={16} strokeWidth={2} aria-hidden="true" fill={enabled ? 'currentColor' : 'none'} />
      </span>
      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 1 }}>
        <LinkName to={automationPath(auto.id)} title={auto.name} style={nameStyle}>{auto.name}</LinkName>
        <span style={{ ...detailStyle, ...(failed ? { color: 'var(--err)' } : {}) }}>{detail}</span>
      </div>
      <Toggle checked={enabled} onCheckedChange={toggle} disabled={busy || !auto.name} />
    </motion.div>
  )
}

function AutomationsCard({ card, onAction }) {
  const { t, lang } = useCardI18n(card)
  const autos = card.automations || []
  const cardRef = useRef(null)
  const collapse = useCollapse(autos, cardRef)
  return (
    <Card cardRef={cardRef} title={t('chat.card.automations', { n: autos.length })} count={autos.length}>
      {autos.length === 0
        ? <p style={muteStyle}>{t('chat.card.noAutomations')}</p>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            {collapse.shown.map((a, i) => (
              <AutomationRow
                key={a.id || a.name || i}
                auto={a} lang={lang} t={t} onAction={onAction}
                order={collapse.order(i)} reduce={collapse.reduce}
              />
            ))}
          </div>
        )}
      <ShowAll t={t} collapse={collapse} />
    </Card>
  )
}

// ── capabilities ──────────────────────────────────────────────────────────────

function CapabilitiesCard({ card }) {
  const { t } = useCardI18n(card)
  const caps = card.capabilities || []
  const cardRef = useRef(null)
  const collapse = useCollapse(caps, cardRef)
  return (
    <Card cardRef={cardRef} icon={Sparkles} title={card.overview ? t('chat.card.whatZiggyCanDo') : t('chat.card.capabilities')}>
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
                  <span dir="auto" title={pitch} style={detailStyle}>{pitch || ' '}</span>
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
    <Card icon={Stethoscope} title={t('chat.card.whyNot')} tone={primary && primary !== 'unknown' ? 'warn' : undefined}>
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
  const { t } = useCardI18n(card)
  const tone = card.severity === 'problem' ? 'err' : card.severity === 'attention' ? 'warn' : 'ok'
  const label = card.severity === 'problem' ? t('chat.card.healthProblem')
    : card.severity === 'attention' ? t('chat.card.healthAttention')
    : t('chat.card.healthOk')
  return (
    <Card title={t('chat.card.homeHealth')}>
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
  const { t } = useCardI18n(card)
  const names = card.names || []
  const count = card.count ?? names.length
  return (
    <Card title={t('chat.card.downDevices', { n: count })} tone={count > 0 ? 'warn' : undefined}>
      {/* No ids in this card — names open the Devices list, where the offline
          filter/banner takes over. */}
      <List items={names} render={(n) => <LinkName to="/devices">{n}</LinkName>} empty={t('chat.card.allReachable')} />
    </Card>
  )
}

function RepairHistoryCard({ card }) {
  const { t } = useCardI18n(card)
  return (
    <Card title={t('chat.card.repairHistory')}>
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
  const { t } = useCardI18n(card)
  const changes = card.changes || []
  const cardRef = useRef(null)
  const collapse = useCollapse(changes, cardRef)
  return (
    <Card cardRef={cardRef} title={t('chat.card.recentActivity')}>
      <List items={collapse.shown} empty={t('chat.card.noActivity')} render={(c) => <span dir="auto">{String(c)}</span>} />
      <ShowAll t={t} collapse={collapse} />
    </Card>
  )
}

// ── camera_look / needs_approval ──────────────────────────────────────────────

function CameraLookCard({ card }) {
  const { t } = useCardI18n(card)
  const title = [card.camera, card.room && humanize(card.room)].filter(Boolean).join(' · ') || t('chat.card.camera')
  return (
    <Card icon={Camera} title={<LinkName to="/cameras" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{title}</LinkName>}>
      {card.description && <p dir="auto" style={{ margin: 0 }}>{card.description}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {typeof card.people_count === 'number' && <Badge tone="accent">{t('chat.card.people', { n: card.people_count })}</Badge>}
        {(card.tags || []).map((tag, i) => <Badge key={i}>{String(tag)}</Badge>)}
      </div>
    </Card>
  )
}

function NeedsApprovalCard({ card }) {
  const { t } = useCardI18n(card)
  return (
    <Card title={t('chat.card.needsApproval')} tone="warn">
      {card.fix && <p dir="auto" style={{ margin: 0, fontWeight: 500 }}>{typeof card.fix === 'string' ? card.fix : humanize(card.fix.name || card.fix.step || JSON.stringify(card.fix))}</p>}
      <p style={muteStyle}>{t('chat.card.needsApprovalNote')}</p>
    </Card>
  )
}

// ── Fallback: compact key/value ───────────────────────────────────────────────

const ID_KEY_RE = /(^|_)(id|ids|uuid|entity_id|entity_ids|device_id|unique_id|token)$/i

function KeyValueCard({ card }) {
  const { t } = useCardI18n(card)
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
    <Card title={title}>
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

// Grid cards are allowed to grow with the chat column (150px cells → 2 on a
// phone/dock, 4–6 on the wide chat page); row/list cards stay narrow.
const CARD_MAX_WIDTH = { device_list: 940, capabilities: 640 }

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
