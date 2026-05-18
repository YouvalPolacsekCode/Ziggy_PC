import { useState, useEffect, useRef, useCallback } from 'react'
import { useWebSocket } from '../hooks/useWebSocket'
import { useAuthStore } from '../stores/authStore'
import { useUIStore } from '../stores/uiStore'
import {
  getDebugConfig, setDebugConfig, getDebugEvents,
  clearDebugEvents, exportDebugReport, getDebugStatus,
  simulateIntent, getRequestTrace, debugSelfTest,
} from '../lib/api'

// ─── Constants ───────────────────────────────────────────────────────────────

const LEVEL_ORDER = { off: 0, basic: 1, verbose: 2, trace: 3 }
const LEVEL_COLOR = {
  off:     'var(--ink-faint)',
  basic:   'var(--accent)',
  verbose: '#e0a020',
  trace:   '#c050e0',
}
const SCOPE_COLORS = {
  intent:     '#3b82f6',
  ha:         '#10b981',
  ir:         '#f59e0b',
  automation: '#8b5cf6',
  sensor:     '#ef4444',
  presence:   '#06b6d4',
  ws:         '#6366f1',
  voice:      '#ec4899',
  scheduler:  '#84cc16',
  general:    'var(--ink-mute)',
}
const RESULT_COLOR = {
  ok:              '#10b981',
  error:           '#ef4444',
  exception:       '#ef4444',
  not_found:       '#f59e0b',
  unrecognized:    '#f59e0b',
  skipped:         'var(--ink-faint)',
  cancelled:       'var(--ink-faint)',
  partial_failure: '#f59e0b',
}

const ALL_SCOPES = ['intent','ha','ir','automation','sensor','presence','ws','voice','scheduler']
const ALL_LEVELS = ['off','basic','verbose','trace']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
    '.' + String(d.getMilliseconds()).padStart(3, '0')
}

function truncate(str, n = 80) {
  if (!str) return ''
  const s = String(str)
  return s.length > n ? s.slice(0, n) + '…' : s
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function LevelBadge({ level }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
      fontFamily: '"IBM Plex Mono", monospace',
      background: LEVEL_COLOR[level] + '22',
      color: LEVEL_COLOR[level],
      padding: '1px 6px', borderRadius: 4,
      border: `1px solid ${LEVEL_COLOR[level]}44`,
      textTransform: 'uppercase',
    }}>
      {level}
    </span>
  )
}

function ScopeBadge({ scope }) {
  const c = SCOPE_COLORS[scope] || 'var(--ink-faint)'
  return (
    <span style={{
      fontSize: 9, fontWeight: 600,
      fontFamily: '"IBM Plex Mono", monospace',
      color: c, background: c + '18',
      padding: '1px 6px', borderRadius: 4,
      border: `1px solid ${c}33`,
    }}>
      {scope}
    </span>
  )
}

function ResultDot({ result }) {
  const c = RESULT_COLOR[result] || 'var(--ink-faint)'
  return (
    <span style={{
      display: 'inline-block', width: 6, height: 6,
      borderRadius: '50%', background: c, flexShrink: 0,
      marginTop: 1,
    }} title={result} />
  )
}

function EventRow({ event, onSelect, selected, onFilterReqId }) {
  const data = event.data || {}
  const result = data.result
  const isSelected = selected?.id === event.id

  return (
    <div
      onClick={() => onSelect(isSelected ? null : event)}
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 60px 90px 1fr auto',
        gap: 8,
        alignItems: 'center',
        padding: '5px 12px',
        borderBottom: '0.5px solid var(--line)',
        cursor: 'pointer',
        background: isSelected ? 'var(--bg-2)' : 'transparent',
        fontSize: 11,
        fontFamily: '"IBM Plex Mono", monospace',
      }}
    >
      <span style={{ color: 'var(--ink-faint)', fontSize: 10 }}>
        {fmtTime(event.ts)}
      </span>
      <ScopeBadge scope={event.scope} />
      <LevelBadge level={event.level} />
      <span style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {event.step}
        {data.intent && <span style={{ color: 'var(--ink-mute)', marginLeft: 6 }}>{data.intent}</span>}
        {data.message && <span style={{ color: 'var(--ink-faint)', marginLeft: 6 }}>{truncate(data.message, 60)}</span>}
        {event.request_id && (
          <span
            onClick={e => { e.stopPropagation(); onFilterReqId(event.request_id) }}
            title={`Filter to ${event.request_id}`}
            style={{
              marginLeft: 8, fontSize: 9, color: 'var(--ink-faint)',
              fontFamily: '"IBM Plex Mono", monospace',
              cursor: 'pointer', textDecoration: 'underline dotted',
            }}
          >
            {event.request_id.slice(0, 12)}
          </span>
        )}
      </span>
      {result && <ResultDot result={result} />}
    </div>
  )
}

function EventDetail({ event, onClose }) {
  if (!event) return null
  const data = event.data || {}

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, width: 420, height: '100dvh',
      background: 'var(--surface)', borderLeft: '0.5px solid var(--line)',
      zIndex: 50, display: 'flex', flexDirection: 'column',
      boxShadow: '-8px 0 32px rgba(0,0,0,0.15)',
    }}>
      <div style={{ padding: '14px 16px', borderBottom: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <ScopeBadge scope={event.scope} />
        <LevelBadge level={event.level} />
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--ink)', fontFamily: '"IBM Plex Mono", monospace' }}>
          {event.step}
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', fontSize: 18 }}>×</button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <Row label="Time"       value={fmtTime(event.ts)} />
        <Row label="Request ID" value={event.request_id} mono />
        <Row label="Event ID"   value={event.id} mono />

        {data.result && (
          <div style={{ margin: '12px 0', padding: '8px 12px', borderRadius: 8, background: (RESULT_COLOR[data.result] || 'var(--ink-faint)') + '18', border: `1px solid ${(RESULT_COLOR[data.result] || 'var(--ink-faint)')}33` }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: RESULT_COLOR[data.result] || 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', textTransform: 'uppercase' }}>
              Result: {data.result}
            </p>
            {data.message && <p style={{ fontSize: 12, color: 'var(--ink)', marginTop: 4 }}>{data.message}</p>}
          </div>
        )}

        {data.suggestion && (
          <div style={{ margin: '8px 0', padding: '8px 12px', borderRadius: 8, background: '#3b82f618', border: '1px solid #3b82f633' }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#3b82f6', marginBottom: 4 }}>SUGGESTION</p>
            <p style={{ fontSize: 12, color: 'var(--ink)' }}>{data.suggestion}</p>
          </div>
        )}

        {data.error && (
          <div style={{ margin: '8px 0', padding: '8px 12px', borderRadius: 8, background: '#ef444418', border: '1px solid #ef444433' }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', marginBottom: 4 }}>ERROR — {data.error_type}</p>
            <p style={{ fontSize: 11, color: '#ef4444', fontFamily: '"IBM Plex Mono", monospace', wordBreak: 'break-all' }}>{data.error}</p>
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 10, color: 'var(--ink-faint)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Data</p>
          <pre style={{
            fontSize: 10, color: 'var(--ink)', background: 'var(--bg-2)',
            padding: 10, borderRadius: 8, overflow: 'auto',
            fontFamily: '"IBM Plex Mono", monospace', lineHeight: 1.6,
            maxHeight: 400, border: '0.5px solid var(--line)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, mono }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 10, color: 'var(--ink-faint)', minWidth: 80, paddingTop: 1, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--ink)', fontFamily: mono ? '"IBM Plex Mono", monospace' : 'inherit', wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

function SimulatePanel({ onClose }) {
  const { addToast } = useUIStore()
  const [input, setInput] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  const run = async () => {
    if (!input.trim()) return
    setLoading(true)
    setResult(null)
    try {
      const r = await simulateIntent({ text: input.trim() })
      setResult(r)
    } catch (e) {
      addToast(e.message || 'Simulate failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, width: 480, height: '100dvh',
      background: 'var(--surface)', borderLeft: '0.5px solid var(--line)',
      zIndex: 50, display: 'flex', flexDirection: 'column',
      boxShadow: '-8px 0 32px rgba(0,0,0,0.15)',
    }}>
      <div style={{ padding: '14px 16px', borderBottom: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Simulate Intent (Dry Run)</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', fontSize: 18 }}>×</button>
      </div>
      <div style={{ padding: 16, flex: 1, overflow: 'auto' }}>
        <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 12 }}>
          Enter a natural language command. Ziggy will parse and trace it without executing any action.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && run()}
            placeholder="e.g. turn on the living room light"
            className="z-input"
            style={{ flex: 1, height: 36, padding: '0 12px', fontSize: 13 }}
          />
          <button
            onClick={run}
            disabled={loading || !input.trim()}
            className="z-btn-primary"
            style={{ padding: '0 16px', height: 36, fontSize: 13, borderRadius: 9 }}
          >
            {loading ? '…' : 'Run'}
          </button>
        </div>

        {result && (
          <div>
            <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg-2)', border: '0.5px solid var(--line)', marginBottom: 12 }}>
              <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>PARSED INTENT</p>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', fontFamily: '"IBM Plex Mono", monospace' }}>{result.parsed_intent}</p>
              <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 4 }}>{result.reply}</p>
              {result.params && Object.keys(result.params).length > 0 && (
                <pre style={{ fontSize: 10, marginTop: 8, fontFamily: '"IBM Plex Mono", monospace', color: 'var(--ink-mute)' }}>
                  {JSON.stringify(result.params, null, 2)}
                </pre>
              )}
            </div>

            {result.events?.length > 0 && (
              <div>
                <p style={{ fontSize: 10, color: 'var(--ink-faint)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' }}>Trace ({result.events.length} events)</p>
                {result.events.map(ev => (
                  <div key={ev.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', borderBottom: '0.5px solid var(--line)' }}>
                    <ScopeBadge scope={ev.scope} />
                    <span style={{ fontSize: 11, color: 'var(--ink)', fontFamily: '"IBM Plex Mono", monospace', flex: 1 }}>{ev.step}</span>
                    {ev.data?.result && <ResultDot result={ev.data.result} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function DebugPage() {
  const { role } = useAuthStore()
  const { addToast } = useUIStore()
  const { messages } = useWebSocket()

  const [config, setConfig] = useState(null)
  const [events, setEvents] = useState([])
  const [liveEvents, setLiveEvents] = useState([])
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [showSimulate, setShowSimulate] = useState(false)
  const [selfTestResult, setSelfTestResult] = useState(null)
  const [filterScope, setFilterScope] = useState('')
  const [filterLevel, setFilterLevel] = useState('')
  const [filterResult, setFilterResult] = useState('')
  const [filterReqId, setFilterReqId] = useState('')
  const [liveMode, setLiveMode] = useState(true)
  const [configSaving, setConfigSaving] = useState(false)
  const [pendingLevel, setPendingLevel] = useState(null)
  const [pendingScopes, setPendingScopes] = useState(null)
  const listRef = useRef(null)

  if (role !== 'super_admin') {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ color: 'var(--ink-faint)' }}>Debug mode is only available to super admins.</p>
      </div>
    )
  }

  const loadConfig = useCallback(async () => {
    try {
      const c = await getDebugConfig()
      setConfig(c)
      setPendingLevel(c.level)
      setPendingScopes(c.scopes)
    } catch {}
  }, [])

  const loadEvents = useCallback(async () => {
    try {
      const r = await getDebugEvents({
        limit: 200,
        scope: filterScope || undefined,
        level: filterLevel || undefined,
        result: filterResult || undefined,
        request_id: filterReqId || undefined,
      })
      setEvents(r.events || [])
    } catch {}
  }, [filterScope, filterLevel, filterResult, filterReqId])

  useEffect(() => { loadConfig() }, [])
  useEffect(() => { if (!liveMode) loadEvents() }, [liveMode, filterScope, filterLevel, filterResult, filterReqId])

  // Ingest live debug events from WebSocket
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last || last.type !== 'debug_event') return
    setLiveEvents(prev => {
      const updated = [...prev, last].slice(-500)
      return updated
    })
  }, [messages])

  // Auto-scroll live feed
  useEffect(() => {
    if (liveMode && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [liveEvents, liveMode])

  const visibleEvents = liveMode ? liveEvents : events
  const filtered = visibleEvents.filter(ev => {
    if (filterScope && ev.scope !== filterScope) return false
    if (filterLevel) {
      const evLvl = LEVEL_ORDER[ev.level] ?? 0
      const maxLvl = LEVEL_ORDER[filterLevel] ?? 3
      if (evLvl > maxLvl) return false
    }
    if (filterResult && ev.data?.result !== filterResult) return false
    if (filterReqId && !ev.request_id?.includes(filterReqId)) return false
    return true
  })

  const saveConfig = async () => {
    setConfigSaving(true)
    try {
      await setDebugConfig({ level: pendingLevel, scopes: pendingScopes })
      await loadConfig()
      addToast('Debug config saved', 'success')
    } catch (e) {
      addToast(e.message || 'Failed to save', 'error')
    } finally {
      setConfigSaving(false)
    }
  }

  const clearEvents = async () => {
    try {
      await clearDebugEvents()
      setLiveEvents([])
      setEvents([])
      setSelectedEvent(null)
      addToast('Events cleared', 'success')
    } catch (e) {
      addToast(e.message || 'Clear failed', 'error')
    }
  }

  const exportReport = async () => {
    try {
      const report = await exportDebugReport()
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ziggy_debug_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      addToast(e.message || 'Export failed', 'error')
    }
  }

  const toggleScope = (scope) => {
    setPendingScopes(prev => {
      const current = prev ?? []
      if (current.length === 0) return [scope]
      if (current.includes(scope)) {
        const next = current.filter(s => s !== scope)
        return next.length === 0 ? [] : next
      }
      return [...current, scope]
    })
  }

  const isActive = config && config.level !== 'off'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '0.5px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        background: 'var(--bg)',
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Debug Mode</span>
            {config && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                background: isActive ? '#10b98122' : 'var(--bg-2)',
                color: isActive ? '#10b981' : 'var(--ink-faint)',
                border: `1px solid ${isActive ? '#10b98144' : 'var(--line)'}`,
                fontFamily: '"IBM Plex Mono", monospace',
              }}>
                {isActive ? `● ${config.level.toUpperCase()}` : '○ OFF'}
              </span>
            )}
          </div>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>
            {filtered.length} events{liveMode ? ' (live)' : ''} · req_id tracks full flow end-to-end
          </p>
        </div>

        <button
          onClick={async () => {
            try {
              const r = await debugSelfTest()
              setSelfTestResult(r)
            } catch (e) {
              setSelfTestResult({ error: e.message })
            }
          }}
          style={{ padding: '6px 12px', fontSize: 12, borderRadius: 8, background: 'var(--bg-2)', border: '0.5px solid var(--line)', cursor: 'pointer', color: 'var(--ink)' }}
        >
          Self-Test
        </button>
        <button
          onClick={() => setShowSimulate(true)}
          style={{ padding: '6px 12px', fontSize: 12, borderRadius: 8, background: 'var(--bg-2)', border: '0.5px solid var(--line)', cursor: 'pointer', color: 'var(--ink)' }}
        >
          Simulate
        </button>
        <button
          onClick={exportReport}
          style={{ padding: '6px 12px', fontSize: 12, borderRadius: 8, background: 'var(--bg-2)', border: '0.5px solid var(--line)', cursor: 'pointer', color: 'var(--ink)' }}
        >
          Export
        </button>
        <button
          onClick={clearEvents}
          style={{ padding: '6px 12px', fontSize: 12, borderRadius: 8, background: 'var(--bg-2)', border: '0.5px solid var(--line)', cursor: 'pointer', color: '#ef4444' }}
        >
          Clear
        </button>
      </div>

      {selfTestResult && (
        <div style={{
          padding: '10px 16px', flexShrink: 0,
          background: selfTestResult.error || !selfTestResult.ws_callback_wired
            ? '#ef444418' : '#10b98118',
          borderBottom: '0.5px solid var(--line)',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: selfTestResult.error ? '#ef4444' : (selfTestResult.ws_callback_wired ? '#10b981' : '#ef4444') }}>
              {selfTestResult.error
                ? `Error: ${selfTestResult.error}`
                : selfTestResult.diagnosis}
            </p>
            {selfTestResult.ws_callback_wired === false && (
              <p style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>
                WS callback not wired — server was not restarted after code changes. Restart ziggy_main.py.
              </p>
            )}
            {selfTestResult.ws_callback_wired && !selfTestResult.was_active_before && (
              <p style={{ fontSize: 11, color: '#e0a020', marginTop: 4 }}>
                Bus is wired but debug level was off when you hit Self-Test. Set level and click Apply first.
              </p>
            )}
            {selfTestResult.ws_callback_wired && (
              <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 4, fontFamily: '"IBM Plex Mono", monospace' }}>
                buffer={selfTestResult.buffer_size} · ws={selfTestResult.ws_callback_wired ? 'wired' : 'NOT wired'} · loop={selfTestResult.event_loop_stored ? 'stored' : 'missing'} · level={selfTestResult.config?.level}
              </p>
            )}
          </div>
          <button onClick={() => setSelfTestResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', fontSize: 16, flexShrink: 0 }}>×</button>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left sidebar — config + filters */}
        <div style={{
          width: 220, flexShrink: 0, borderRight: '0.5px solid var(--line)',
          overflow: 'auto', background: 'var(--bg-2)', padding: 12,
        }}>
          {/* Level selector */}
          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Debug Level
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 14 }}>
            {ALL_LEVELS.map(lvl => (
              <button
                key={lvl}
                onClick={() => setPendingLevel(lvl)}
                style={{
                  textAlign: 'left', padding: '5px 8px', borderRadius: 7, cursor: 'pointer',
                  background: pendingLevel === lvl ? (LEVEL_COLOR[lvl] + '22') : 'transparent',
                  border: pendingLevel === lvl ? `1px solid ${LEVEL_COLOR[lvl]}44` : '1px solid transparent',
                  color: pendingLevel === lvl ? LEVEL_COLOR[lvl] : 'var(--ink-mute)',
                  fontSize: 12, fontWeight: 500, fontFamily: '"IBM Plex Mono", monospace',
                }}
              >
                {lvl}
              </button>
            ))}
          </div>

          {/* Scopes */}
          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Scopes {(pendingScopes?.length ?? 0) === 0 ? '(all)' : `(${pendingScopes.length})`}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 14 }}>
            {ALL_SCOPES.map(scope => {
              const c = SCOPE_COLORS[scope]
              const active = !pendingScopes || pendingScopes.length === 0 || pendingScopes.includes(scope)
              return (
                <button
                  key={scope}
                  onClick={() => toggleScope(scope)}
                  style={{
                    textAlign: 'left', padding: '4px 8px', borderRadius: 7, cursor: 'pointer',
                    background: active ? (c + '18') : 'transparent',
                    border: active ? `1px solid ${c}33` : '1px solid transparent',
                    color: active ? c : 'var(--ink-faint)',
                    fontSize: 11, fontFamily: '"IBM Plex Mono", monospace',
                  }}
                >
                  {scope}
                </button>
              )
            })}
            <button
              onClick={() => setPendingScopes([])}
              style={{ textAlign: 'left', padding: '4px 8px', borderRadius: 7, cursor: 'pointer', border: '1px solid transparent', background: 'transparent', color: 'var(--ink-faint)', fontSize: 10 }}
            >
              ↺ all scopes
            </button>
          </div>

          <button
            onClick={saveConfig}
            disabled={configSaving}
            className="z-btn-primary"
            style={{ width: '100%', height: 34, fontSize: 12, borderRadius: 8, marginBottom: 16 }}
          >
            {configSaving ? '…' : 'Apply'}
          </button>

          {/* Filters */}
          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Filter Events
          </p>
          <select
            value={filterScope}
            onChange={e => setFilterScope(e.target.value)}
            className="z-input"
            style={{ width: '100%', height: 32, fontSize: 11, marginBottom: 6 }}
          >
            <option value="">All scopes</option>
            {ALL_SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={filterResult}
            onChange={e => setFilterResult(e.target.value)}
            className="z-input"
            style={{ width: '100%', height: 32, fontSize: 11, marginBottom: 6 }}
          >
            <option value="">All results</option>
            {['ok','error','exception','not_found','unrecognized','skipped'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <input
            value={filterReqId}
            onChange={e => setFilterReqId(e.target.value)}
            placeholder="Filter by request_id…"
            className="z-input"
            style={{ width: '100%', height: 32, fontSize: 11, marginBottom: 12 }}
          />

          {/* Live vs stored toggle */}
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => setLiveMode(true)}
              style={{
                flex: 1, height: 28, borderRadius: 7, fontSize: 11, cursor: 'pointer',
                background: liveMode ? 'var(--accent)' : 'var(--bg)',
                color: liveMode ? '#fff' : 'var(--ink-mute)',
                border: '0.5px solid var(--line)',
              }}
            >
              Live
            </button>
            <button
              onClick={() => { setLiveMode(false); loadEvents() }}
              style={{
                flex: 1, height: 28, borderRadius: 7, fontSize: 11, cursor: 'pointer',
                background: !liveMode ? 'var(--accent)' : 'var(--bg)',
                color: !liveMode ? '#fff' : 'var(--ink-mute)',
                border: '0.5px solid var(--line)',
              }}
            >
              Buffered
            </button>
          </div>
        </div>

        {/* Main event list */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Column headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: '90px 60px 90px 1fr auto',
            gap: 8, padding: '6px 12px', borderBottom: '0.5px solid var(--line)',
            fontSize: 9, fontWeight: 700, color: 'var(--ink-faint)',
            textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0,
          }}>
            <span>Time</span>
            <span>Scope</span>
            <span>Level</span>
            <span>Step / Details</span>
            <span></span>
          </div>

          <div ref={listRef} style={{ flex: 1, overflow: 'auto' }}>
            {filterReqId && (
              <div style={{
                padding: '6px 12px', background: '#3b82f611',
                borderBottom: '0.5px solid var(--line)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 11, color: '#3b82f6', fontFamily: '"IBM Plex Mono", monospace', flex: 1 }}>
                  Tracing: {filterReqId}
                </span>
                <button
                  onClick={() => setFilterReqId('')}
                  style={{ fontSize: 10, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  × clear
                </button>
              </div>
            )}
            {filtered.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center' }}>
                <p style={{ color: 'var(--ink-faint)', fontSize: 13 }}>
                  {isActive ? (liveMode ? 'Waiting for events…' : 'No events in buffer.') : 'Debug is off. Set a level and press Apply.'}
                </p>
              </div>
            ) : (
              filtered.map(ev => (
                <EventRow
                  key={ev.id}
                  event={ev}
                  selected={selectedEvent}
                  onSelect={setSelectedEvent}
                  onFilterReqId={setFilterReqId}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Side panels */}
      {selectedEvent && !showSimulate && (
        <EventDetail event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
      {showSimulate && (
        <SimulatePanel onClose={() => setShowSimulate(false)} />
      )}
    </div>
  )
}
