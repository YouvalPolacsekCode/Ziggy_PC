import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUIStore } from '../stores/uiStore'
import { getActiveAnomalies, getAnomalyHistory, snoozeMapAnomaly, getAnomalyRules, patchAnomalyRules } from '../lib/api'

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

function humanRoom(roomId) {
  if (!roomId) return 'Home'
  // entity_id form e.g. "switch.iron" → "Iron"
  if (roomId.includes('.')) return roomId.split('.')[1].replace(/_/g, ' ')
  return roomId.replace(/_/g, ' ')
}

const SEV_COLOR = { critical: 'var(--err)', warning: 'var(--warn)', info: 'var(--info)' }
const SEV_BG    = { critical: 'color-mix(in srgb, var(--err) 10%, var(--surface))', warning: 'color-mix(in srgb, var(--warn) 10%, var(--surface))', info: 'var(--surface)' }
const RULE_LABELS = {
  'ANOM-01': 'Away + lights on',
  'ANOM-02': 'Climate + empty room',
  'ANOM-03': 'Door/window open',
  'ANOM-04': 'Motion at night',
  'ANOM-05': 'No motion 24h',
  'ANOM-06': 'Device left on',
}

// ── Snooze picker ─────────────────────────────────────────────────────────────
const SNOOZE_OPTIONS = [
  { label: '30 min',    minutes: 30 },
  { label: '1 hour',    minutes: 60 },
  { label: '4 hours',   minutes: 240 },
  { label: 'All day',   minutes: 1440 },
]

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
        style={{
          padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 500,
          background: 'var(--surface-2)', color: 'var(--ink-2)',
          border: '0.5px solid var(--line)', cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', gap: 4,
          opacity: busy ? 0.5 : 1,
        }}
      >
        Snooze
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              style={{
                position: 'absolute', top: '110%', left: 0, zIndex: 20,
                background: 'var(--surface)', border: '0.5px solid var(--line)',
                borderRadius: 10, boxShadow: '0 6px 24px rgba(0,0,0,0.14)',
                overflow: 'hidden', minWidth: 120,
              }}
            >
              {SNOOZE_OPTIONS.map(opt => (
                <button
                  key={opt.minutes}
                  onClick={() => doSnooze(opt.minutes)}
                  style={{
                    display: 'block', width: '100%', padding: '9px 14px', textAlign: 'left',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 12, fontWeight: 500, color: 'var(--ink)', fontFamily: 'inherit',
                    borderBottom: '0.5px solid var(--line)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
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

// ── Active anomaly card ───────────────────────────────────────────────────────
function ActiveCard({ anomaly, roomId, onSnoozed }) {
  const sev    = anomaly.severity || 'warning'
  const color  = SEV_COLOR[sev] || SEV_COLOR.warning
  const bg     = SEV_BG[sev]    || SEV_BG.warning
  const conf   = anomaly.confidence ?? 1.0
  const label  = RULE_LABELS[anomaly.rule_id] || anomaly.rule_id

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.16 }}
      style={{ padding: '14px 16px', borderRadius: 14, background: bg, border: `0.5px solid ${color}33` }}
    >
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        {/* Severity dot */}
        <span style={{
          width: 8, height: 8, borderRadius: '50%', background: color,
          flexShrink: 0, marginTop: 5,
          boxShadow: sev === 'critical' ? `0 0 6px ${color}` : 'none',
        }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Rule + room */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              color, fontFamily: '"IBM Plex Mono", monospace',
            }}>
              {anomaly.rule_id}
            </span>
            <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{label}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', flexShrink: 0 }}>
              {humanRoom(roomId)}
            </span>
          </div>

          {/* Message */}
          <p style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.45, margin: 0 }}>
            {anomaly.message}
          </p>
          {anomaly.context === 'quiet_hours' && (
            <span style={{
              display: 'inline-block', marginTop: 4,
              fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
              textTransform: 'uppercase', fontFamily: '"IBM Plex Mono", monospace',
              color: 'var(--ink-faint)', background: 'var(--bg-2)',
              borderRadius: 4, padding: '2px 6px',
            }}>
              during quiet hours
            </span>
          )}
        </div>
      </div>

      {/* Bottom row: meta + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 18 }}>
        {/* Confidence */}
        <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
          {Math.round(conf * 100)}% conf
        </span>
        <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>·</span>
        <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{timeAgo(anomaly.since)}</span>

        {/* Severity chip */}
        <span style={{
          marginLeft: 'auto',
          fontSize: 9, padding: '2px 7px', borderRadius: 5,
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          color, fontFamily: '"IBM Plex Mono", monospace', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          {sev}
        </span>

        <SnoozeMenu roomId={roomId} ruleId={anomaly.rule_id} onSnoozed={onSnoozed} />
      </div>

      {/* Suggested action hint */}
      {anomaly.action_available && anomaly.suggested_action && (
        <div style={{ marginTop: 8, paddingLeft: 18 }}>
          <span style={{
            fontSize: 10, color: 'var(--ink-mute)', fontFamily: '"IBM Plex Mono", monospace',
            background: 'var(--bg-2)', padding: '3px 8px', borderRadius: 5,
          }}>
            Suggested: {anomaly.suggested_action.replace('turn_off:', 'turn off ').replace(/_/g, ' ')}
          </span>
        </div>
      )}
    </motion.div>
  )
}

// ── History row ───────────────────────────────────────────────────────────────
function HistoryRow({ entry, isLast }) {
  const sev     = entry.severity || 'warning'
  const color   = SEV_COLOR[sev] || SEV_COLOR.warning
  const dur     = duration(entry.fired_at, entry.cleared_at)
  const cleared = !!entry.cleared_at
  const label   = RULE_LABELS[entry.rule_id] || entry.rule_id

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0',
      borderBottom: isLast ? 'none' : '0.5px solid var(--line)',
      opacity: cleared ? 0.7 : 1,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: cleared ? 'var(--ink-faint)' : color,
        flexShrink: 0, marginTop: 5,
      }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, color: cleared ? 'var(--ink-faint)' : color,
            fontFamily: '"IBM Plex Mono", monospace', letterSpacing: '0.05em', textTransform: 'uppercase',
          }}>
            {entry.rule_id}
          </span>
          <span style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{label}</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', flexShrink: 0 }}>
            {humanRoom(entry.room_id)}
          </span>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.4, margin: '0 0 4px' }}>
          {entry.message}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
            {timeAgo(entry.fired_at)}
          </span>
          {dur && (
            <>
              <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>·</span>
              <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{dur} duration</span>
            </>
          )}
          {cleared && (
            <span style={{
              fontSize: 9, padding: '1px 6px', borderRadius: 4,
              background: 'var(--bg-2)', color: 'var(--ink-mute)',
              fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600,
            }}>
              CLEARED
            </span>
          )}
          {!cleared && (
            <span style={{
              fontSize: 9, padding: '1px 6px', borderRadius: 4,
              background: `color-mix(in srgb, ${color} 14%, transparent)`,
              color, fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600,
            }}>
              ACTIVE
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Anomalies() {
  const { addToast } = useUIStore()
  const [tab,     setTab]     = useState('active')
  const [active,  setActive]  = useState({})   // { room_id: [anomaly, …] }
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [histLoading, setHistLoading] = useState(false)

  const [rules, setRules] = useState(null)
  const [engineEnabled, setEngineEnabled] = useState(true)

  const loadActive = useCallback(async () => {
    try {
      const r = await getActiveAnomalies()
      setActive(r.anomalies ?? {})
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
    } catch {}
  }, [])

  useEffect(() => {
    loadActive()
  }, [])

  useEffect(() => {
    if (tab === 'history') loadHistory()
  }, [tab])

  useEffect(() => {
    if (tab === 'rules') loadRules()
  }, [tab])

  const patchRule = async (id, patch) => {
    const next = rules.map(r => r.id === id ? { ...r, ...patch } : r)
    setRules(next)
    try {
      await patchAnomalyRules({ rules: [{ id, ...patch }] })
    } catch { addToast('Failed to save', 'error') }
  }

  // Flatten active anomalies to a list with roomId attached, sorted by severity
  const activeList = Object.entries(active)
    .flatMap(([roomId, items]) => items.map(a => ({ ...a, _roomId: roomId })))
    .sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 }
      return (order[a.severity] ?? 3) - (order[b.severity] ?? 3)
    })

  const criticalCount = activeList.filter(a => a.severity === 'critical').length
  const warningCount  = activeList.filter(a => a.severity === 'warning').length
  const todayCount    = history.filter(e => {
    return e.fired_at > (Date.now() / 1000 - 86400)
  }).length

  const tabs = [
    { id: 'active',  label: 'Active',  count: activeList.length },
    { id: 'history', label: 'History', count: null },
    { id: 'rules',   label: 'Rules',   count: null },
  ]

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 20px 40px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>Smart home monitoring</p>
          <h1 className="z-display" style={{ fontSize: 26, margin: 0 }}>Alerts</h1>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 6, lineHeight: 1.5, maxWidth: 400 }}>
            Active anomalies detected by Ziggy, with history and snooze controls.
          </p>
        </div>
        <button
          onClick={loadActive}
          className="z-btn-secondary"
          style={{ padding: '8px 12px', borderRadius: 9, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
            <path d="M21 3v5h-5"/>
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
            <path d="M8 16H3v5"/>
          </svg>
          Refresh
        </button>
      </div>

      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20 }}>
        {[
          { label: 'Critical',    value: criticalCount, tint: 'var(--err)' },
          { label: 'Warnings',    value: warningCount,  tint: 'var(--warn)' },
          { label: 'Today',       value: todayCount,    tint: 'var(--ink-mute)' },
        ].map(({ label, value, tint }) => (
          <div key={label} style={{ padding: '10px 12px', borderRadius: 11, background: 'var(--surface)', border: '0.5px solid var(--line)', textAlign: 'center' }}>
            <p style={{
              fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.01em',
              fontFamily: '"IBM Plex Mono", monospace',
              color: value > 0 ? tint : 'var(--ink-faint)',
            }}>
              {value}
            </p>
            <p className="z-eyebrow" style={{ marginTop: 4 }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '5px 12px', borderRadius: 999,
              background: tab === t.id ? 'var(--ink)' : 'var(--surface)',
              color: tab === t.id ? 'var(--bg)' : 'var(--ink-mute)',
              border: tab === t.id ? 'none' : '0.5px solid var(--line)',
              fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            {t.label}
            {t.count > 0 && (
              <span style={{
                background: tab === t.id ? 'rgba(255,255,255,0.25)' : 'var(--accent)',
                color: '#fff', fontSize: 9, padding: '1px 5px', borderRadius: 999,
                fontFamily: '"IBM Plex Mono", monospace', fontWeight: 700,
              }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Active tab ── */}
      {tab === 'active' && (
        <>
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1, 2].map(i => (
                <div key={i} style={{ height: 100, borderRadius: 14, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.5 }} />
              ))}
            </div>
          )}

          {!loading && activeList.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: 'center', padding: '52px 16px' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>All clear</p>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.5, maxWidth: 280, margin: '0 auto' }}>
                No active anomalies right now. Ziggy is watching.
              </p>
            </motion.div>
          )}

          {!loading && activeList.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <AnimatePresence mode="popLayout">
                {activeList.map((a, i) => (
                  <ActiveCard
                    key={`${a._roomId}:${a.rule_id}`}
                    anomaly={a}
                    roomId={a._roomId}
                    onSnoozed={loadActive}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </>
      )}

      {/* ── History tab ── */}
      {tab === 'history' && (
        <>
          {histLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {[1,2,3,4,5].map(i => (
                <div key={i} style={{ height: 68, borderBottom: '0.5px solid var(--line)', opacity: 0.4, background: 'var(--surface)' }} />
              ))}
            </div>
          )}

          {!histLoading && history.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: 'center', padding: '52px 16px' }}>
              <p className="z-eyebrow">No history yet</p>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 8 }}>
                Anomaly events will appear here as they are detected.
              </p>
            </motion.div>
          )}

          {!histLoading && history.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '0.5px solid var(--line)', borderRadius: 14, padding: '0 16px' }}>
              {history.map((entry, i) => (
                <HistoryRow
                  key={entry.id ?? i}
                  entry={entry}
                  isLast={i === history.length - 1}
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
              <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
            </div>
          )}

          {rules !== null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Overall engine toggle */}
              <div style={{ background: 'var(--surface)', border: '0.5px solid var(--line)', borderRadius: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Anomaly detection</p>
                  <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>Master switch for all anomaly rules</p>
                </div>
                <button
                  className="z-toggle"
                  aria-checked={engineEnabled}
                  onClick={async () => {
                    const next = !engineEnabled
                    setEngineEnabled(next)
                    try { await patchAnomalyRules({ engine_enabled: next }) }
                    catch { addToast('Failed to save', 'error') }
                  }}
                />
              </div>

              {/* Rule cards */}
              <div style={{ background: 'var(--surface)', border: '0.5px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
                {rules.map((rule, i) => {
                  const sevColor = SEV_COLOR[rule.severity] || SEV_COLOR.warning
                  return (
                    <div key={rule.id} style={{ padding: '12px 16px', borderBottom: i < rules.length - 1 ? '0.5px solid var(--line)' : 'none', opacity: engineEnabled ? 1 : 0.5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: rule.config ? 10 : 0 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: sevColor, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            {rule.label}
                            <span style={{
                              fontSize: 9, fontFamily: '"IBM Plex Mono", monospace',
                              color: sevColor,
                              background: `color-mix(in srgb, ${sevColor} 12%, var(--surface))`,
                              padding: '1px 5px', borderRadius: 4,
                            }}>{rule.severity}</span>
                          </p>
                          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }}>{rule.description}</p>
                        </div>
                        <button
                          className="z-toggle"
                          aria-checked={!!rule.enabled}
                          disabled={!engineEnabled}
                          onClick={() => patchRule(rule.id, { enabled: !rule.enabled })}
                        />
                      </div>
                      {rule.config && rule.enabled && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 17 }}>
                          <p style={{ fontSize: 11, color: 'var(--ink-mute)', flex: 1 }}>{rule.config.label}</p>
                          <input
                            type="number"
                            min={1}
                            value={rule.config.value ?? rule.config.default}
                            onChange={e => {
                              const val = parseInt(e.target.value)
                              if (!isNaN(val)) patchRule(rule.id, { config_value: val })
                            }}
                            className="z-input"
                            style={{ width: 70, height: 28, padding: '0 8px', fontSize: 12, textAlign: 'center' }}
                          />
                          <p style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{rule.config.unit}</p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
