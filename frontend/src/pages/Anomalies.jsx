import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw, ChevronDown, CheckCircle2, X } from 'lucide-react'
import { useUIStore } from '../stores/uiStore'
import { useDeviceStore } from '../stores/deviceStore'
import { useWsMessages } from '../hooks/useWebSocket'
import { useT } from '../lib/i18n'
import { Toggle } from '../components/ui/Toggle'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { T_STATE, T_ENTER } from '../lib/motion'
import {
  getActiveAnomalies, getAnomalyHistory,
  snoozeMapAnomaly, executeAnomalyAction,
  getAnomalyRules, patchAnomalyRules,
} from '../lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(ts) {
  if (!ts) return '—'
  const diff = Math.floor((Date.now() / 1000 - ts))
  if (diff < 60)    return `${diff}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function duration(firedAt, clearedAt) {
  if (!clearedAt) return null
  const secs = Math.round(clearedAt - firedAt)
  if (secs < 60)    return `${secs}s`
  if (secs < 3600)  return `${Math.floor(secs / 60)}m`
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
}

function humanRoom(roomId, roomName) {
  // Server resolves room_id → the real HA area name (single source of truth,
  // e.g. "Roni's Room"). Trust it when present.
  if (roomName) return roomName
  if (!roomId || roomId === 'home') return 'Home'
  // An entity_id-form key (contains '.') or a raw Zigbee id means the device
  // isn't assigned to a room — NEVER leak the entity_id/hex as a "room".
  if (roomId.includes('.') || /^0x[0-9a-f]{6,}/i.test(roomId)) return 'No Room'
  // Last-resort: title-case the area slug so it reads like the rest of the app.
  return roomId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// Fill tokens (edge bar, icon tint, 8px dot) and their text-safe twins for
// anything a person reads under 18px.
const SEV_COLOR = { critical: 'var(--err)', warning: 'var(--warn)', info: 'var(--info)' }
const SEV_TEXT  = { critical: 'var(--err-text)', warning: 'var(--warn-text)', info: 'var(--ink-2)' }
const RULE_LABELS = {
  'ANOM-01': 'Away + lights on',
  'ANOM-02': 'Climate + empty room',
  'ANOM-03': 'Door/window open',
  'ANOM-04': 'Motion at night',
  'ANOM-05': 'No motion 24h',
  'ANOM-06': 'Device left on',
  'ANOM-07': 'Automation device offline',
  'ANOM-08': 'Battery low',
  'ANOM-09': 'Devices offline (coordinator)',
  'ANOM-10': 'Safety sensor silent',
}

// Map anomaly message keywords → icon SVG paths
function anomalyIcon(message = '', ruleId = '') {
  const m = message.toLowerCase()
  const r = ruleId.toLowerCase()
  if (m.includes('faucet') || m.includes('water') || r.includes('water')) return <path d="M12 2s7 8 7 13a7 7 0 1 1-14 0c0-5 7-13 7-13z"/>
  if (m.includes('door') || r.includes('door')) return <><rect x="6" y="3" width="12" height="18" rx="1"/><circle cx="15" cy="12" r="0.7" fill="currentColor"/></>
  if (m.includes('window') || r.includes('window')) return <><rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 4v16M4 12h16"/></>
  if (m.includes('motion') || r.includes('motion') || r.includes('anom-04') || r.includes('anom-05')) return <><circle cx="12" cy="5" r="2"/><path d="M8 22l2-6 2 2 2-2 2 6M9 12l3 3 3-3"/></>
  if (m.includes('light') || r.includes('anom-01')) return <><path d="M9 18h6M10 22h4"/><path d="M12 2a6 6 0 0 0-4 10.5c.7.7 1 1.6 1 2.5v1h6v-1c0-.9.3-1.8 1-2.5A6 6 0 0 0 12 2z"/></>
  if (m.includes('ac') || m.includes('climate') || r.includes('anom-02')) return <path d="M14 14.76V4a2 2 0 1 0-4 0v10.76a4 4 0 1 0 4 0z"/>
  if (m.includes('battery') || r.includes('anom-08')) return <><rect x="2" y="7" width="18" height="10" rx="2"/><path d="M22 11v2"/><path d="M6 10v4"/></>
  if (m.includes('offline') || m.includes('connection') || m.includes('wifi') || r.includes('anom-07') || r.includes('anom-09')) return <><path d="M2 9a16 16 0 0 1 20 0M5 13a11 11 0 0 1 14 0M8.5 16.5a6 6 0 0 1 7 0M12 20h.01"/></>
  if (m.includes('camera')) return <><rect x="3" y="6" width="14" height="12" rx="2"/><path d="M17 10l4-2v8l-4-2z"/></>
  // default: bolt
  return <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>
}

// Action label heuristic — turns "turn_off:light.kitchen_main" / "turn_off_all_lights" /
// "check_coordinator" into something a human reads in 0.3 seconds.
function actionLabel(action) {
  if (!action) return null
  if (action === 'turn_off_all_lights') return 'Turn off all'
  if (action.startsWith('turn_off:'))   return 'Turn off'
  if (action === 'check_coordinator')   return 'Reconnect'
  return action.replace(/_/g, ' ').replace(/:/g, ' ')
}

// ── Snooze picker ─────────────────────────────────────────────────────────────
const SNOOZE_OPTIONS = [
  { label: '30 min',    minutes: 30 },
  { label: '1 hour',    minutes: 60 },
  { label: '4 hours',   minutes: 240 },
  { label: 'All day',   minutes: 1440 },
]

// Ghost text button: 44 tall, 15px, ink. The quiet sibling of the card's one
// bordered action.
const ghostBtn = {
  minHeight: 40, padding: '0 12px', borderRadius: 'var(--r-ctl)', fontSize: 13, fontWeight: 500,
  background: 'transparent', color: 'var(--ink-mute)', border: 'none', cursor: 'pointer',
  fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4,
}

function SnoozeMenu({ roomId, ruleId, onSnoozed }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const { addToast } = useUIStore()

  const doSnooze = async (minutes) => {
    setBusy(true)
    setOpen(false)
    try {
      await snoozeMapAnomaly(roomId, ruleId, minutes)
      addToast(`Snoozed for ${SNOOZE_OPTIONS.find(o => o.minutes === minutes)?.label}`, 'success')
      onSnoozed()
    } catch {
      addToast('Snooze failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        disabled={busy}
        aria-expanded={open}
        style={{ ...ghostBtn, opacity: busy ? 0.5 : 1 }}
      >
        Snooze
        <ChevronDown size={18} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-state) var(--ease-standard)' }} />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              transition={T_ENTER}
              style={{
                position: 'absolute', top: '100%', insetInlineEnd: 0, zIndex: 20, marginTop: 4,
                background: 'var(--surface)', border: '0.5px solid var(--line)',
                borderRadius: 'var(--r-ctl)', boxShadow: 'var(--shadow-md)',
                overflow: 'hidden', minWidth: 160,
              }}
            >
              {SNOOZE_OPTIONS.map((opt, i) => (
                <button
                  key={opt.minutes}
                  onClick={() => doSnooze(opt.minutes)}
                  style={{
                    display: 'block', width: '100%', minHeight: 40, padding: '0 16px', textAlign: 'start',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 15, fontWeight: 400, color: 'var(--ink)', fontFamily: 'inherit',
                    borderBottom: i < SNOOZE_OPTIONS.length - 1 ? '0.5px solid var(--line)' : 'none',
                    transition: 'background var(--dur-press) var(--ease-standard)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  {opt.label}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Action button — executes the anomaly's suggested_action via the backend ──
// The card's one bordered control. Not inverted: inverted is reserved for the
// screen's single primary action, and a list of alerts has many cards.
function ActionButton({ roomId, ruleId, action, onDone }) {
  const [busy, setBusy] = useState(false)
  const { addToast } = useUIStore()
  const label = actionLabel(action)
  if (!label) return null

  const run = async () => {
    setBusy(true)
    try {
      const r = await executeAnomalyAction(roomId, ruleId)
      if (r?.ok) {
        addToast(r.message || 'Done', 'success')
        onDone()
      } else {
        addToast(r?.message || 'Action failed', 'error')
      }
    } catch (e) {
      addToast(e?.message || 'Action failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button onClick={run} disabled={busy} className="z-btn-secondary" style={{ whiteSpace: 'nowrap', opacity: busy ? 0.55 : 1 }}>
      {busy ? '…' : label}
    </button>
  )
}

// ── Unified anomaly card — used for both Active and History tabs ─────────────
// variant='active'  → "since" timestamp, action button + snooze
// variant='history' → "fired_at" timestamp, CLEARED/ACTIVE pill, dim if cleared
function AnomalyCard({ anomaly, roomId, roomName, variant = 'active', onChange }) {
  const sev       = anomaly.severity || 'warning'
  const color     = SEV_COLOR[sev] || SEV_COLOR.warning
  const textColor = SEV_TEXT[sev] || SEV_TEXT.warning
  const room      = humanRoom(roomId, roomName)
  const ruleId    = anomaly.rule_id
  const ruleLabel = RULE_LABELS[ruleId] || ''

  const isHistory   = variant === 'history'
  const cleared     = isHistory && !!anomaly.cleared_at
  const headerTs    = isHistory ? anomaly.fired_at : anomaly.since
  const dur         = isHistory ? duration(anomaly.fired_at, anomaly.cleared_at) : null
  const showActions = !isHistory && !!anomaly.action_available

  // Compose the small meta line: "ANOM-06 · 2h ago · Living Room · Cleared after 12m"
  // Pieces are joined with " · " separators only when non-empty so we don't end
  // up with dangling dots on narrow rooms or unknown labels.
  const metaParts = []
  if (ruleId)              metaParts.push(ruleId)
  if (headerTs)            metaParts.push(timeAgo(headerTs))
  if (room && room !== 'Home') metaParts.push(room)
  if (cleared && dur)      metaParts.push(`Cleared after ${dur}`)
  else if (cleared)        metaParts.push('Cleared')

  const subtitle = (
    anomaly.details
    || (anomaly.context === 'quiet_hours' ? 'During quiet hours' : '')
    || (!cleared ? ruleLabel : '')
  )

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
      transition={T_ENTER}
      style={{
        display: 'flex', gap: 12, padding: 12, borderRadius: 'var(--r-card)', minHeight: 48,
        background: 'var(--surface)', border: '0.5px solid var(--line)',
        borderInlineStart: `3px solid ${cleared ? 'var(--line-2)' : color}`,
      }}
    >
      {/* Tinted icon box */}
      <div style={{
        width: 36, height: 36, borderRadius: 'var(--r-ctl)', flexShrink: 0,
        background: cleared
          ? 'var(--surface-2)'
          : `color-mix(in srgb, ${color} 10%, var(--surface-2))`,
        color: cleared ? 'var(--ink-faint)' : color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          {anomalyIcon(anomaly.message, ruleId)}
        </svg>
      </div>

      {/* Content — three vertical zones so phone widths don't squish them onto
          one line: (1) message, (2) meta strip (ANOM · time · room · cleared),
          (3) actions or status pill on their own row. */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* 1. Message — full width, wraps freely. A cleared entry reads in
            ink-mute instead of being dimmed through opacity. */}
        <div style={{
          fontSize: 15, fontWeight: 600, color: cleared ? 'var(--ink-mute)' : 'var(--ink)', lineHeight: 1.3,
          overflowWrap: 'anywhere',
        }}>
          {anomaly.message}
        </div>

        {/* Optional subtitle — non-meta context like "During quiet hours" */}
        {subtitle && (
          <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4, lineHeight: 1.4 }}>
            {subtitle}
          </div>
        )}

        {/* 2. Meta strip — one tabular row, wraps cleanly on narrow widths */}
        {metaParts.length > 0 && (
          <div className="z-mono" style={{
            fontSize: 12, color: 'var(--ink-mute)', marginTop: 8,
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
          }}>
            {metaParts.map((part, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {i > 0 && <span style={{ color: 'var(--ink-faint)' }}>·</span>}
                {i === 0 && ruleId === part ? (
                  <span className="z-chip" style={{ color: cleared ? 'var(--ink-mute)' : textColor }}>{part}</span>
                ) : part}
              </span>
            ))}
          </div>
        )}

        {/* 3. Actions / status — own row, end-aligned, with full horizontal
              width to themselves. Active card gets ActionButton + SnoozeMenu;
              history card gets the CLEARED/ACTIVE pill. */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
          marginTop: 8, justifyContent: 'flex-end',
        }}>
            {!isHistory && (
              <SnoozeMenu roomId={roomId} ruleId={ruleId} onSnoozed={onChange} />
            )}
            {showActions && (
              <ActionButton
                roomId={roomId}
                ruleId={ruleId}
                action={anomaly.suggested_action}
                onDone={onChange}
              />
            )}
            {isHistory && (
              <span className="z-chip" style={{ color: cleared ? 'var(--ink-mute)' : textColor, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {cleared ? 'Cleared' : 'Active'}
              </span>
            )}
          </div>
      </div>
    </motion.div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Anomalies() {
  const t = useT()
  const { addToast } = useUIStore()
  const [tab,     setTab]     = useState('active')
  const [active,  setActive]  = useState({})   // { room_id: [anomaly, …] }
  const [roomNames, setRoomNames] = useState({})   // { room_id: "Living Room" | null }
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [histLoading, setHistLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const [rules, setRules] = useState(null)
  const [engineEnabled, setEngineEnabled] = useState(true)
  const [exemptions, setExemptions] = useState([])
  const entities = useDeviceStore(s => s.entities)
  const { fetch: fetchEntities } = useDeviceStore()

  const loadActive = useCallback(async () => {
    try {
      const r = await getActiveAnomalies()
      setActive(r.anomalies ?? {})
      setRoomNames(r.room_names ?? {})
    } catch {
      addToast('Could not load alerts', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadHistory = useCallback(async () => {
    setHistLoading(true)
    try {
      const r = await getAnomalyHistory(100)
      setHistory(r.history ?? [])
    } catch {
      addToast('Could not load history', 'error')
    } finally {
      setHistLoading(false)
    }
  }, [])

  const loadRules = useCallback(async () => {
    try {
      const r = await getAnomalyRules()
      setRules(r.rules ?? [])
      setEngineEnabled(r.engine_enabled ?? true)
      setExemptions(r.exemptions ?? [])
    } catch {}
  }, [])

  useEffect(() => {
    loadActive()
  }, [])

  useEffect(() => {
    if (tab === 'history') loadHistory()
  }, [tab])

  useEffect(() => {
    if (tab === 'rules') {
      loadRules()
      // Need the entity list to render the exemption picker.
      if (!entities || entities.length === 0) fetchEntities?.()
    }
  }, [tab])

  // Live updates: the engine broadcasts {type:'anomaly_active'|'anomaly_cleared'}
  // on every fire/clear. Refresh whichever tab is open when one arrives.
  // We track the last message ts we've reacted to so re-renders don't re-trigger.
  const messages = useWsMessages()
  const lastSeenWsTs = useRef(0)
  useEffect(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (!m || m.ts <= lastSeenWsTs.current) break
      if (m.type === 'anomaly_active' || m.type === 'anomaly_cleared') {
        lastSeenWsTs.current = messages[messages.length - 1].ts
        loadActive()
        if (tab === 'history') loadHistory()
        break
      }
    }
    if (messages.length) lastSeenWsTs.current = messages[messages.length - 1].ts
  }, [messages, tab, loadActive, loadHistory])

  // After an action runs on the Active tab, refresh BOTH active and history so
  // the entry appears in history (with cleared_at) the next time the user
  // flips tabs.
  const refreshAfterChange = useCallback(() => {
    loadActive()
    if (tab === 'history') loadHistory()
  }, [tab, loadActive, loadHistory])

  // Manual refresh: spin until the fetches actually settle.
  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await Promise.allSettled([loadActive(), tab === 'history' ? loadHistory() : Promise.resolve()])
    } finally { setRefreshing(false) }
  }

  const patchRule = async (id, patch) => {
    const next = rules.map(r => r.id === id ? { ...r, ...patch } : r)
    setRules(next)
    try {
      await patchAnomalyRules({ rules: [{ id, ...patch }] })
    } catch { addToast(t('anomalies.saveFailed'), 'error') }
  }

  const saveExemptions = async (next) => {
    setExemptions(next)
    try {
      await patchAnomalyRules({ exemptions: next })
    } catch { addToast(t('anomalies.saveFailed'), 'error') }
  }

  // Pool the user can pick from for "Device left on" exemptions — must match
  // ANOM-06's scope (switch/light/plug). Already-exempt entities are filtered out.
  const exemptionPool = useMemo(() => {
    const exempt = new Set(exemptions)
    return (entities || [])
      .filter(e => ['switch', 'light'].includes(e.domain) || e.entity_id?.startsWith('plug.'))
      .filter(e => !exempt.has(e.entity_id))
      .sort((a, b) => (a.display_name || a.entity_id).localeCompare(b.display_name || b.entity_id))
  }, [entities, exemptions])

  // Friendly label for a chip — prefer display name, fall back to slug.
  const entityLabel = useCallback((eid) => {
    const e = entities?.find(x => x.entity_id === eid)
    return e?.display_name || e?.friendly_name || eid
  }, [entities])

  // Flatten active anomalies to a list with roomId attached, sorted by severity
  const activeList = Object.entries(active)
    .flatMap(([roomId, items]) => items.map(a => ({ ...a, _roomId: roomId, _roomName: roomNames[roomId] })))
    .sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 }
      return (order[a.severity] ?? 3) - (order[b.severity] ?? 3)
    })

  const criticalCount = activeList.filter(a => a.severity === 'critical').length
  const warningCount  = activeList.filter(a => a.severity === 'warning').length

  const tabs = [
    { id: 'active',  label: t('anomaliesPage.tabAll', { n: activeList.length || 0 }) },
    { id: 'history', label: t('anomaliesPage.tabHistory') },
    { id: 'rules',   label: t('anomaliesPage.tabRules') },
  ]

  return (
    <div style={{ maxWidth: 'var(--page-max-w)', margin: '0 auto', padding: '24px 20px 24px' }}>

      {/* Header */}
      <div className="z-page-head">
        <div>
          <p className="z-eyebrow">
            {t('anomaliesPage.today')}{criticalCount + warningCount > 0 ? t('anomaliesPage.needAttentionCount', { n: criticalCount + warningCount }) : ''}
          </p>
          <h1 className="z-display" style={{ margin: 0 }}>{t('alerts.title')}</h1>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="z-icon-btn"
          aria-label={t('common.refresh')}
          title={t('common.refresh')}
        >
          <RefreshCw size={18} className={refreshing ? 'z-spin' : undefined} />
        </button>
      </div>

      {/* Tabs — segmented pill */}
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--surface-2)', borderRadius: 'var(--r-ctl)', marginBottom: 16 }}>
        {tabs.map(tb => (
          <button key={tb.id} onClick={() => setTab(tb.id)} aria-pressed={tab === tb.id} style={{
            flex: 1, minHeight: 40, padding: '0 8px', borderRadius: 'var(--r-chip)', fontFamily: 'inherit', cursor: 'pointer',
            background: tab === tb.id ? 'var(--surface)' : 'transparent',
            border: 'none', fontSize: 13, fontWeight: 600,
            color: tab === tb.id ? 'var(--ink)' : 'var(--ink-mute)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            boxShadow: tab === tb.id ? 'var(--shadow-sm)' : 'none',
            transition: 'background var(--dur-press) var(--ease-standard), color var(--dur-press) var(--ease-standard)',
          }}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* ── Active tab ── */}
      {tab === 'active' && (
        <>
          {/* Skeleton only on a cold start. Cached anomalies stay visible
              while a background refresh is in flight. */}
          {loading && activeList.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1, 2].map(i => (
                <div key={i} style={{ height: 100, borderRadius: 'var(--r-card)', background: 'var(--surface-2)', border: '0.5px solid var(--line)' }} />
              ))}
            </div>
          )}

          {!loading && activeList.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={T_STATE} style={{ textAlign: 'center', padding: 32 }}>
              <CheckCircle2 size={32} strokeWidth={1.75} style={{ color: 'var(--ok)', marginBottom: 12 }} />
              <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{t('anomaliesPage.allClear')}</p>
              <p style={{ fontSize: 13, color: 'var(--ink-mute)', lineHeight: 1.5, maxWidth: 320, margin: '0 auto' }}>
                {t('anomaliesPage.allClearHelp')}
              </p>
            </motion.div>
          )}

          {activeList.length > 0 && (() => {
            const needsAttention = activeList.filter(a => a.severity === 'critical' || a.severity === 'warning')
            const info           = activeList.filter(a => a.severity === 'info')
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {needsAttention.length > 0 && (
                  <>
                    <p className="z-eyebrow" style={{ marginBottom: 4 }}>{t('anomaliesPage.needsAttention')}</p>
                    <AnimatePresence mode="popLayout">
                      {needsAttention.map(a => (
                        <AnomalyCard
                          key={`${a._roomId}:${a.rule_id}`}
                          anomaly={a}
                          roomId={a._roomId}
                          roomName={a._roomName}
                          variant="active"
                          onChange={refreshAfterChange}
                        />
                      ))}
                    </AnimatePresence>
                  </>
                )}
                {info.length > 0 && (
                  <>
                    <p className="z-eyebrow" style={{ marginBottom: 4, marginTop: needsAttention.length > 0 ? 8 : 0 }}>{t('anomaliesPage.earlierToday')}</p>
                    <AnimatePresence mode="popLayout">
                      {info.map(a => (
                        <AnomalyCard
                          key={`${a._roomId}:${a.rule_id}`}
                          anomaly={a}
                          roomId={a._roomId}
                          roomName={a._roomName}
                          variant="active"
                          onChange={refreshAfterChange}
                        />
                      ))}
                    </AnimatePresence>
                  </>
                )}
              </div>
            )
          })()}
        </>
      )}

      {/* ── History tab ── */}
      {tab === 'history' && (
        <>
          {histLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ height: 100, borderRadius: 'var(--r-card)', background: 'var(--surface-2)', border: '0.5px solid var(--line)' }} />
              ))}
            </div>
          )}

          {!histLoading && history.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={T_STATE} style={{ textAlign: 'center', padding: 32 }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{t('anomaliesPage.noHistory')}</p>
              <p style={{ fontSize: 13, color: 'var(--ink-mute)' }}>
                {t('anomaliesPage.noHistoryHelp')}
              </p>
            </motion.div>
          )}

          {!histLoading && history.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {history.map((entry, i) => (
                <AnomalyCard
                  key={entry.id ?? `${entry.room_id}:${entry.rule_id}:${entry.fired_at}:${i}`}
                  anomaly={entry}
                  roomId={entry.room_id}
                  roomName={entry.room_name}
                  variant="history"
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Rules tab ── */}
      {tab === 'rules' && (
        <>
          {rules === null && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 100 }}>
              <div className="z-spin" style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--line-2)', borderTopColor: 'var(--ink)' }} />
            </div>
          )}

          {rules !== null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Overall engine toggle */}
              <div style={{ background: 'var(--surface)', border: '0.5px solid var(--line)', borderRadius: 'var(--r-card)', padding: '12px 16px', minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{t('anomalies.engineTitle')}</p>
                  <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 2 }}>{t('anomalies.engineDesc')}</p>
                </div>
                <Toggle
                  checked={engineEnabled}
                  aria-label={t('anomalies.engineTitle')}
                  onCheckedChange={async (next) => {
                    setEngineEnabled(next)
                    try { await patchAnomalyRules({ engine_enabled: next }) }
                    catch { addToast(t('anomalies.saveFailed'), 'error') }
                  }}
                />
              </div>

              {/* Rule cards */}
              <div style={{ background: 'var(--surface)', border: '0.5px solid var(--line)', borderRadius: 'var(--r-card)', overflow: 'hidden' }}>
                {rules.map((rule, i) => {
                  const sevColor = SEV_COLOR[rule.severity] || SEV_COLOR.warning
                  const sevText  = SEV_TEXT[rule.severity] || SEV_TEXT.warning
                  return (
                    <div key={rule.id} style={{ padding: '12px 16px', borderBottom: i < rules.length - 1 ? '0.5px solid var(--line)' : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, marginBottom: rule.config && rule.enabled ? 8 : 0 }}>
                        <span className="z-dot" style={{ background: sevColor, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 15, fontWeight: 500, color: engineEnabled ? 'var(--ink)' : 'var(--ink-mute)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            {rule.label}
                            <span className="z-chip" style={{ color: sevText }}>{rule.severity}</span>
                          </p>
                          <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 2 }}>{rule.description}</p>
                        </div>
                        <Toggle
                          checked={!!rule.enabled}
                          disabled={!engineEnabled}
                          aria-label={rule.label}
                          onCheckedChange={(v) => patchRule(rule.id, { enabled: v })}
                        />
                      </div>
                      {rule.config && rule.enabled && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingInlineStart: 20 }}>
                          <p style={{ fontSize: 13, color: 'var(--ink-mute)', flex: 1 }}>{rule.config.label}</p>
                          <Input
                            type="number"
                            min={1}
                            value={rule.config.value ?? rule.config.default}
                            onChange={e => {
                              const val = parseInt(e.target.value)
                              if (!isNaN(val)) patchRule(rule.id, { config_value: val })
                            }}
                            aria-label={rule.config.label}
                            style={{ width: 96, textAlign: 'center', padding: '0 8px' }}
                          />
                          <p style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{rule.config.unit}</p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* ── Exemptions for "Device left on" (ANOM-06) ──
                  Without this, fridges, routers, NAS plugs etc. trigger
                  warnings as soon as their on-time exceeds the threshold.
                  Editing happens here, persisted under
                  anomaly_engine.exemptions in settings.yaml. */}
              <div style={{ background: 'var(--surface)', border: '0.5px solid var(--line)', borderRadius: 'var(--r-card)', padding: 12 }}>
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{t('anomalies.alwaysOn')}</p>
                  <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 2 }}>
                    {t('anomalies.alwaysOnHint')}
                  </p>
                </div>

                {exemptions.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                    {exemptions.map(eid => (
                      // The whole chip is the remove target so it clears 44px
                      // without growing an X button inside a 13px capsule.
                      <button
                        key={eid}
                        aria-label={`Remove ${entityLabel(eid)}`}
                        title={t('common.remove')}
                        onClick={() => saveExemptions(exemptions.filter(x => x !== eid))}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 8,
                          fontSize: 13, color: 'var(--ink-2)', fontFamily: 'inherit', cursor: 'pointer',
                          minHeight: 40, padding: '0 12px 0 16px', borderRadius: 999,
                          background: 'var(--surface-2)', border: '0.5px solid var(--line)',
                        }}
                      >
                        {entityLabel(eid)}
                        <X size={18} style={{ color: 'var(--ink-mute)' }} />
                      </button>
                    ))}
                  </div>
                )}

                <Select
                  value=""
                  onChange={e => {
                    const eid = e.target.value
                    if (eid && !exemptions.includes(eid)) {
                      saveExemptions([...exemptions, eid].sort())
                    }
                  }}
                  aria-label={t('anomalies.alwaysOn')}
                  style={{ width: '100%' }}
                  options={[
                    { value: '', label: '+ Add exemption…' },
                    ...exemptionPool.map(e => ({ value: e.entity_id, label: e.display_name || e.friendly_name || e.entity_id })),
                  ]}
                />
                {exemptionPool.length === 0 && exemptions.length === 0 && (
                  <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 8 }}>
                    No eligible switches or lights found.
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
