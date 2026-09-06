// Embedded UI in chat — one small card per tool-result `kind`.
//
// The agent's tool results carry `data.card` (see core/agent/runner) with a
// `kind` and just enough structure to render. Cards sit ABOVE the assistant's
// text bubble; the prose still explains, the card lets the user act without
// another round-trip through the model. Interactive bits call the actions
// registry directly (`runAction` → POST /api/actions/{name}), which is the
// same code path the agent itself uses.
//
// Kept deliberately plain: inline styles on the app's CSS variables, logical
// properties only (RTL-safe), no new libraries. The Radix-backed Toggle from
// ui/ is the one shared control (gotcha: Radix wants onCheckedChange).

import { useState } from 'react'
import { runAction } from '../../lib/api'
import { useT, useLang } from '../../lib/i18n'
import { Toggle } from '../ui/Toggle'

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

const muteStyle = { fontSize: 11, color: 'var(--ink-mute)' }

function Card({ title, children, tone }) {
  return (
    <div style={{
      ...cardStyle,
      ...(tone ? { borderColor: `color-mix(in srgb, var(--${tone}) 45%, var(--line))` } : {}),
    }}>
      {title && (
        <p className="z-eyebrow" style={{ margin: 0, fontSize: 10, color: 'var(--ink-mute)' }}>{title}</p>
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

function Dot({ tone }) {
  return (
    <span aria-hidden style={{
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

function formatWhen(ts) {
  if (!ts) return ''
  try {
    const d = typeof ts === 'number' ? new Date(ts < 1e12 ? ts * 1000 : ts) : new Date(ts)
    if (Number.isNaN(d.getTime())) return String(ts)
    return d.toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  } catch { return String(ts) }
}

// Cards for the primary domains that have a meaningful on/off. Sensors and
// the like are listed but not switchable.
const SWITCHABLE = new Set(['light', 'switch', 'fan', 'climate', 'media_player', 'humidifier', 'input_boolean'])

// ── device_list ───────────────────────────────────────────────────────────────

function DeviceRow({ device, lang, onAction }) {
  const t = useT()
  const [on, setOn] = useState(!!device.on)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const canToggle = !!device.entity_id && SWITCHABLE.has(device.domain) && typeof device.on === 'boolean'
  const name = lang === 'he' ? (device.he_noun || device.name) : (device.name || device.he_noun)
  const room = lang === 'he' ? (device.room_he || device.room) : (device.room || device.room_he)

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

  return (
    <div style={rowStyle}>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span dir="auto" style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <span dir="auto" style={muteStyle}>
          {[room && humanize(room), !canToggle && device.state].filter(Boolean).join(' · ')}
          {failed && <span style={{ color: 'var(--err)' }}> · {t('chat.card.actionFailed')}</span>}
        </span>
      </div>
      {canToggle
        ? <Toggle checked={on} onCheckedChange={toggle} disabled={busy} />
        : null}
    </div>
  )
}

function DeviceListCard({ card, onAction }) {
  const t = useT()
  const lang = useLang()
  const devices = card.devices || []
  return (
    <Card title={t('chat.card.devices', { n: devices.length })}>
      {devices.length === 0
        ? <p style={muteStyle}>{t('chat.card.noDevices')}</p>
        : devices.map((d, i) => <DeviceRow key={d.entity_id || i} device={d} lang={lang} onAction={onAction} />)}
    </Card>
  )
}

// ── automations ───────────────────────────────────────────────────────────────

function AutomationRow({ auto, lang, onAction }) {
  const t = useT()
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

  return (
    <div style={rowStyle}>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span dir="auto" style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{auto.name}</span>
        <span style={muteStyle}>
          {auto.last_triggered ? t('chat.card.lastRun', { when: formatWhen(auto.last_triggered) }) : t('chat.card.neverRan')}
          {failed && <span style={{ color: 'var(--err)' }}> · {t('chat.card.actionFailed')}</span>}
        </span>
      </div>
      <Toggle checked={enabled} onCheckedChange={toggle} disabled={busy || !auto.name} />
    </div>
  )
}

function AutomationsCard({ card, onAction }) {
  const t = useT()
  const lang = useLang()
  const autos = card.automations || []
  return (
    <Card title={t('chat.card.automations', { n: autos.length })}>
      {autos.length === 0
        ? <p style={muteStyle}>{t('chat.card.noAutomations')}</p>
        : autos.map((a, i) => <AutomationRow key={a.id || a.name || i} auto={a} lang={lang} onAction={onAction} />)}
    </Card>
  )
}

// ── capabilities ──────────────────────────────────────────────────────────────

function CapabilitiesCard({ card }) {
  const t = useT()
  const caps = card.capabilities || []
  return (
    <Card title={card.overview ? t('chat.card.whatZiggyCanDo') : t('chat.card.capabilities')}>
      {caps.map((c, i) => (
        <div key={c.name || i} style={{ ...rowStyle, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span dir="auto" style={{ fontWeight: 500 }}>{c.name}</span>
            {(c.pitch || c.what_it_does) && <span dir="auto" style={muteStyle}>{c.pitch || c.what_it_does}</span>}
          </div>
          <Badge tone={c.live ? 'ok' : 'ink-mute'}>{c.live ? t('chat.card.live') : t('chat.card.notLive')}</Badge>
        </div>
      ))}
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
  const t = useT()
  const lang = useLang()
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

  return (
    <Card title={t('chat.card.whyNot')} tone={primary && primary !== 'unknown' ? 'warn' : undefined}>
      {primary && (
        <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{verdictTitle(t, primary)}</p>
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
  const t = useT()
  const tone = card.severity === 'problem' ? 'err' : card.severity === 'attention' ? 'warn' : 'ok'
  const label = card.severity === 'problem' ? t('chat.card.healthProblem')
    : card.severity === 'attention' ? t('chat.card.healthAttention')
    : t('chat.card.healthOk')
  return (
    <Card title={t('chat.card.homeHealth')}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Dot tone={tone} />
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={muteStyle}>· {t('chat.card.offlineCount', { n: card.offline_count ?? 0 })}</span>
      </div>
    </Card>
  )
}

function DownDevicesCard({ card }) {
  const t = useT()
  const names = card.names || []
  const count = card.count ?? names.length
  return (
    <Card title={t('chat.card.downDevices', { n: count })} tone={count > 0 ? 'warn' : undefined}>
      <List items={names} render={(n) => <span dir="auto">{n}</span>} empty={t('chat.card.allReachable')} />
    </Card>
  )
}

function RepairHistoryCard({ card }) {
  const t = useT()
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
  const t = useT()
  return (
    <Card title={t('chat.card.recentActivity')}>
      <List items={card.changes || []} empty={t('chat.card.noActivity')} render={(c) => <span dir="auto">{String(c)}</span>} />
    </Card>
  )
}

// ── camera_look / needs_approval ──────────────────────────────────────────────

function CameraLookCard({ card }) {
  const t = useT()
  const title = [card.camera, card.room && humanize(card.room)].filter(Boolean).join(' · ') || t('chat.card.camera')
  return (
    <Card title={title}>
      {card.description && <p dir="auto" style={{ margin: 0 }}>{card.description}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {typeof card.people_count === 'number' && <Badge tone="accent">{t('chat.card.people', { n: card.people_count })}</Badge>}
        {(card.tags || []).map((tag, i) => <Badge key={i}>{String(tag)}</Badge>)}
      </div>
    </Card>
  )
}

function NeedsApprovalCard({ card }) {
  const t = useT()
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
  const t = useT()
  const entries = Object.entries(card || {}).filter(([k, v]) =>
    k !== 'kind' && !ID_KEY_RE.test(k) && v != null && v !== '' && typeof v !== 'function')
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

/**
 * @param {object} props.card       tool result object with a `kind`
 * @param {string} [props.entityId] the device a why_not card is about (not in
 *                                  the payload; the runner adds card.entity_id
 *                                  when it knows it)
 * @param {function} [props.onAction] called after an in-card action succeeds
 */
export default function ChatCard({ card, entityId, onAction }) {
  if (!card || typeof card !== 'object' || !card.kind) return null
  const Comp = CARDS[card.kind] || KeyValueCard
  return (
    <div style={{ width: '100%', maxWidth: 420, alignSelf: 'flex-start' }}>
      <Comp card={card} entityId={entityId ?? card.entity_id} onAction={onAction} />
    </div>
  )
}
