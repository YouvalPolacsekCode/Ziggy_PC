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
const RULE_LABELS = {
  'ANOM-01': 'Away + lights on',
  'ANOM-02': 'Climate + empty room',
  'ANOM-03': 'Door/window open',
  'ANOM-04': 'Motion at night',
  'ANOM-05': 'No motion 24h',
  'ANOM-06': 'Device left on',
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
  if (m.includes('offline') || m.includes('connection') || m.includes('wifi')) return <><path d="M2 9a16 16 0 0 1 20 0M5 13a11 11 0 0 1 14 0M8.5 16.5a6 6 0 0 1 7 0M12 20h.01"/></>
  if (m.includes('camera')) return <><rect x="3" y="6" width="14" height="12" rx="2"/><path d="M17 10l4-2v8l-4-2z"/></>
  // default: bolt
  return <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>
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

// ── Active anomaly card — matches design exactly ──────────────────────────────
function ActiveCard({ anomaly, roomId, onSnoozed }) {
  const sev   = anomaly.severity || 'warning'
  const color = SEV_COLOR[sev] || SEV_COLOR.warning
  const room  = humanRoom(roomId)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.16 }}
      style={{
        display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 14,
        background: 'var(--surface)', border: '0.5px solid var(--line)',
        borderLeft: `3px solid ${color}`,
      }}
    >
      {/* Tinted icon box */}
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: `color-mix(in srgb, ${color} 10%, var(--surface-2))`,
        color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          {anomalyIcon(anomaly.message, anomaly.rule_id)}
        </svg>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Title + time */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3 }}>{anomaly.message}</span>
          <span className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', flexShrink: 0 }}>{timeAgo(anomaly.since)}</span>
        </div>

        {/* Subtitle */}
        {anomaly.details && (
          <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2, lineHeight: 1.4 }}>{anomaly.details}</div>
        )}
        {!anomaly.details && anomaly.context === 'quiet_hours' && (
          <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>During quiet hours</div>
        )}

        {/* Room chip + actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
          {room && room !== 'Home' && (
            <span className="z-mono" style={{
              fontSize: 10, color: 'var(--ink-faint)', padding: '2px 8px', borderRadius: 999,
              background: 'var(--surface-2)', border: '0.5px solid var(--line)',
              letterSpacing: '0.02em',
            }}>{room}</span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <SnoozeMenu roomId={roomId} ruleId={anomaly.rule_id} onSnoozed={onSnoozed} />
          </div>
        </div>
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
    { id: 'active',  label: `All · ${activeList.length || 0}` },
    { id: 'history', label: 'History' },
    { id: 'rules',   label: 'Rules' },
  ]

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 20px 40px' }}>

      {/* Header — matches design: eyebrow + title + Mark all read */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>
            Today{criticalCount + warningCount > 0 ? ` · ${criticalCount + warningCount} need attention` : ''}
          </p>
          <h1 className="z-display" style={{ fontSize: 26, margin: 0 }}>Alerts</h1>
        </div>
        <button
          onClick={loadActive}
          className="z-btn-secondary"
          style={{ padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 500, flexShrink: 0 }}
        >
          Mark all read
        </button>
      </div>

      {/* Tabs — segmented pill */}
      <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--surface-2)', borderRadius: 12, marginBottom: 18 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: '7px 0', borderRadius: 9, fontFamily: 'inherit', cursor: 'pointer',
            background: tab === t.id ? 'var(--surface)' : 'transparent',
            border: 'none', fontSize: 12, fontWeight: 600,
            color: tab === t.id ? 'var(--ink)' : 'var(--ink-mute)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            boxShadow: tab === t.id ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
          }}>
            {t.label}
            {t.count > 0 && <span className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{t.count}</span>}
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

          {!loading && activeList.length > 0 && (() => {
            const critical = activeList.filter(a => a.severity === 'critical' || a.severity === 'warning')
            const info     = activeList.filter(a => a.severity === 'info')
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {critical.length > 0 && (
                  <>
                    <p className="z-eyebrow" style={{ marginBottom: 4 }}>Needs attention</p>
                    <AnimatePresence mode="popLayout">
                      {critical.map(a => (
                        <ActiveCard key={`${a._roomId}:${a.rule_id}`} anomaly={a} roomId={a._roomId} onSnoozed={loadActive} />
                      ))}
                    </AnimatePresence>
                  </>
                )}
                {info.length > 0 && (
                  <>
                    <p className="z-eyebrow" style={{ marginBottom: 4, marginTop: critical.length > 0 ? 8 : 0 }}>Earlier today</p>
                    <AnimatePresence mode="popLayout">
                      {info.map(a => (
                        <ActiveCard key={`${a._roomId}:${a.rule_id}`} anomaly={a} roomId={a._roomId} onSnoozed={loadActive} />
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
