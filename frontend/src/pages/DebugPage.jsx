import { useState, useEffect, useRef, useCallback } from 'react'
import { X } from 'lucide-react'
import { useWsMessages } from '../hooks/useWebSocket'
import { useAuthStore } from '../stores/authStore'
import { useUIStore } from '../stores/uiStore'
import { Button } from '../components/ui/Button'
import {
  getDebugConfig, setDebugConfig, getDebugEvents,
  clearDebugEvents, exportDebugReport, getDebugStatus,
  simulateIntent, getRequestTrace, debugSelfTest,
} from '../lib/api'
import feLogger from '../lib/logger'
import { useT } from '../lib/i18n'

// ─── Constants ───────────────────────────────────────────────────────────────
//
// Colour is carried by an 8px dot next to the word, never by the word itself:
// the scope/level/result vocabularies are far bigger than the four status
// tones that have AA-safe text variants, so a coloured badge label at 13px
// would either fail contrast or collapse every scope into one hue. The dot
// keeps the at-a-glance scan; the text stays ink.

const LEVEL_ORDER = { off: 0, basic: 1, verbose: 2, trace: 3 }
const LEVEL_DOT = {
  off:     'var(--ink-faint)',
  basic:   'var(--ok)',
  verbose: 'var(--warn)',
  trace:   'var(--info)',
}
const SCOPE_DOT = {
  intent:     'var(--info)',
  ha:         'var(--ok)',
  ir:         'var(--warn)',
  automation: 'var(--info)',
  sensor:     'var(--err)',
  presence:   'var(--gold)',
  ws:         'var(--info)',
  voice:      'var(--gold)',
  scheduler:  'var(--ok)',
  api:        'var(--info)',
  device:     'var(--gold)',
  frontend:   'var(--err)',
  settings:   'var(--warn)',
  general:    'var(--ink-mute)',
}
// Result tones: `dot` is the fill, `text` the AA-safe word colour.
const RESULT_TONE = {
  ok:              { dot: 'var(--ok)',        text: 'var(--ok-text)',   soft: 'bg-ok-soft' },
  error:           { dot: 'var(--err)',       text: 'var(--err-text)',  soft: 'bg-err-soft' },
  exception:       { dot: 'var(--err)',       text: 'var(--err-text)',  soft: 'bg-err-soft' },
  not_found:       { dot: 'var(--warn)',      text: 'var(--warn-text)', soft: 'bg-warn-soft' },
  unrecognized:    { dot: 'var(--warn)',      text: 'var(--warn-text)', soft: 'bg-warn-soft' },
  skipped:         { dot: 'var(--ink-faint)', text: 'var(--ink-mute)',  soft: 'z-card-soft' },
  cancelled:       { dot: 'var(--ink-faint)', text: 'var(--ink-mute)',  soft: 'z-card-soft' },
  partial_failure: { dot: 'var(--warn)',      text: 'var(--warn-text)', soft: 'bg-warn-soft' },
}
const NEUTRAL_TONE = { dot: 'var(--ink-faint)', text: 'var(--ink-mute)', soft: 'z-card-soft' }

const ALL_SCOPES = [
  'intent','ha','ir','automation','sensor','presence','ws','voice','scheduler',
  'api','device','frontend','settings',
]
const ALL_LEVELS = ['off','basic','verbose','trace']

// Time · scope · level · step · result. Sized for 13px tabular time
// ("09:40:52.123") and 13px chips with a dot.
const GRID = '110px 112px 96px 1fr 16px'

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

function Dot({ color }) {
  return <span className="z-dot" style={{ background: color, boxShadow: 'none' }} />
}

function LevelBadge({ level }) {
  return (
    <span className="z-chip" style={{ gap: 6 }}>
      <Dot color={LEVEL_DOT[level] || 'var(--ink-faint)'} />
      {level}
    </span>
  )
}

function ScopeBadge({ scope }) {
  return (
    <span className="z-chip" style={{ gap: 6 }}>
      <Dot color={SCOPE_DOT[scope] || 'var(--ink-faint)'} />
      {scope}
    </span>
  )
}

function ResultDot({ result }) {
  const tone = RESULT_TONE[result] || NEUTRAL_TONE
  return <span className="z-dot" style={{ background: tone.dot }} title={result} />
}

function SidePanel({ width = 420, children }) {
  return (
    <div style={{
      position: 'fixed', top: 0, insetInlineEnd: 0, width: `min(${width}px, 100vw)`, height: '100dvh',
      background: 'var(--surface)', borderInlineStart: '0.5px solid var(--line)',
      zIndex: 50, display: 'flex', flexDirection: 'column',
      boxShadow: 'var(--shadow-lg)',
    }}>
      {children}
    </div>
  )
}

function PanelHead({ children, onClose, closeLabel }) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, minHeight: 68 }}>
      {children}
      <button onClick={onClose} className="z-icon-btn" aria-label={closeLabel}>
        <X size={20} strokeWidth={1.75} />
      </button>
    </div>
  )
}

function EventRow({ event, onSelect, selected, onFilterReqId }) {
  const t = useT()
  const data = event.data || {}
  const result = data.result
  const isSelected = selected?.id === event.id

  return (
    <div
      onClick={() => onSelect(isSelected ? null : event)}
      style={{
        display: 'grid',
        gridTemplateColumns: GRID,
        gap: 8,
        alignItems: 'center',
        minHeight: 36,
        padding: '4px 12px',
        borderBottom: '0.5px solid var(--line)',
        cursor: 'pointer',
        background: isSelected ? 'var(--surface-2)' : 'transparent',
        transition: 'background var(--dur-press) var(--ease-standard)',
      }}
    >
      <span className="z-mono" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>
        {fmtTime(event.ts)}
      </span>
      <span><ScopeBadge scope={event.scope} /></span>
      <span><LevelBadge level={event.level} /></span>
      <span style={{ fontSize: 15, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {event.step}
        {data.intent && <span style={{ fontSize: 13, color: 'var(--ink-mute)', marginInlineStart: 8 }}>{data.intent}</span>}
        {data.message && <span style={{ fontSize: 13, color: 'var(--ink-faint)', marginInlineStart: 8 }}>{truncate(data.message, 60)}</span>}
        {event.request_id && (
          <span
            onClick={e => { e.stopPropagation(); onFilterReqId(event.request_id) }}
            title={t('debug.filterTo', { id: event.request_id })}
            className="z-code"
            style={{
              marginInlineStart: 8, fontSize: 13, color: 'var(--ink-mute)',
              cursor: 'pointer', textDecoration: 'underline dotted',
            }}
          >
            {event.request_id.slice(0, 12)}
          </span>
        )}
      </span>
      {result ? <ResultDot result={result} /> : <span />}
    </div>
  )
}

function EventDetail({ event, onClose }) {
  const t = useT()
  if (!event) return null
  const data = event.data || {}
  const tone = RESULT_TONE[data.result] || NEUTRAL_TONE

  return (
    <SidePanel>
      <PanelHead onClose={onClose} closeLabel={t('common.close')}>
        <ScopeBadge scope={event.scope} />
        <LevelBadge level={event.level} />
        <span className="z-headline" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {event.step}
        </span>
      </PanelHead>

      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <Row label={t('debug.detailTime')}       value={fmtTime(event.ts)} />
        <Row label={t('debug.detailRequestId')} value={event.request_id} mono />
        <Row label={t('debug.detailEventId')}   value={event.id} mono />

        {data.result && (
          <div className={tone.soft} style={{ margin: '12px 0', padding: '12px 16px', borderRadius: 'var(--r-ctl)', border: '0.5px solid var(--line)' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: tone.text }}>
              {t('debug.detailResult', { result: data.result })}
            </p>
            {data.message && <p style={{ fontSize: 15, color: 'var(--ink)', marginTop: 4 }}>{data.message}</p>}
          </div>
        )}

        {data.suggestion && (
          <div className="bg-info-soft" style={{ margin: '8px 0', padding: '12px 16px', borderRadius: 'var(--r-ctl)', border: '0.5px solid var(--line)' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{t('debug.detailSuggestion')}</p>
            <p style={{ fontSize: 15, color: 'var(--ink)' }}>{data.suggestion}</p>
          </div>
        )}

        {data.error && (
          <div className="bg-err-soft" style={{ margin: '8px 0', padding: '12px 16px', borderRadius: 'var(--r-ctl)', border: '0.5px solid var(--line)' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--err-text)', marginBottom: 4 }}>{t('debug.detailErrorLabel', { type: data.error_type })}</p>
            <p className="z-code" style={{ fontSize: 13, color: 'var(--err-text)', wordBreak: 'break-all' }}>{data.error}</p>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('debug.detailData')}</p>
          <pre className="z-code" style={{
            fontSize: 13, color: 'var(--ink)', background: 'var(--surface-2)',
            padding: 12, borderRadius: 'var(--r-ctl)', overflow: 'auto',
            lineHeight: '18px', margin: 0,
            maxHeight: 400, border: '0.5px solid var(--line)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      </div>
    </SidePanel>
  )
}

function Row({ label, value, mono }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'baseline' }}>
      <span className="z-footnote" style={{ minWidth: 88, flexShrink: 0 }}>{label}</span>
      <span className={mono ? 'z-code' : undefined} style={{ fontSize: mono ? 13 : 15, color: 'var(--ink)', wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

function SimulatePanel({ onClose }) {
  const t = useT()
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
      addToast(e.message || t('debug.failedSimulate'), 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SidePanel width={480}>
      <PanelHead onClose={onClose} closeLabel={t('common.close')}>
        <span className="z-headline" style={{ flex: 1 }}>{t('debug.simTitle')}</span>
      </PanelHead>
      <div style={{ padding: 16, flex: 1, overflow: 'auto' }}>
        <p className="z-subhead" style={{ marginBottom: 12 }}>
          {t('debug.simHelp')}
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && run()}
            placeholder={t('debug.simPlaceholder')}
            dir="auto"
            className="z-input"
            style={{ flex: 1 }}
          />
          <button
            onClick={run}
            disabled={loading || !input.trim()}
            className="z-btn-primary"
          >
            {loading ? '…' : t('debug.simRun')}
          </button>
        </div>

        {result && (
          <div>
            <div className="z-card-soft" style={{ padding: '12px 16px', marginBottom: 16 }}>
              <p className="z-footnote" style={{ marginBottom: 4 }}>{t('debug.simParsed')}</p>
              <p className="z-headline">{result.parsed_intent}</p>
              <p className="z-subhead" style={{ marginTop: 4 }}>{result.reply}</p>
              {result.params && Object.keys(result.params).length > 0 && (
                <pre className="z-code" style={{ fontSize: 13, lineHeight: '18px', marginTop: 8, marginBottom: 0, color: 'var(--ink-mute)', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(result.params, null, 2)}
                </pre>
              )}
            </div>

            {result.events?.length > 0 && (
              <div>
                <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('debug.simTrace', { n: result.events.length })}</p>
                {result.events.map(ev => (
                  <div key={ev.id} style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 36, padding: '4px 0', borderBottom: '0.5px solid var(--line)' }}>
                    <ScopeBadge scope={ev.scope} />
                    <span style={{ fontSize: 15, color: 'var(--ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.step}</span>
                    {ev.data?.result && <ResultDot result={ev.data.result} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </SidePanel>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function DebugPage() {
  const t = useT()
  const { role } = useAuthStore()
  const { addToast } = useUIStore()
  const messages = useWsMessages()

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
        <p className="z-body" style={{ color: 'var(--ink-mute)' }}>{t('debug.notAvailable')}</p>
      </div>
    )
  }

  const loadConfig = useCallback(async () => {
    try {
      const c = await getDebugConfig()
      setConfig(c)
      setPendingLevel(c.level)
      setPendingScopes(c.scopes)
      // First-visit sync: bring the FE logger up to whatever the backend bus
      // is set to. Without this, opening Debug for the first time shows the
      // backend at "verbose" but the FE logger is still "off" from default.
      if (feLogger.getLevel() !== c.level) feLogger.setLevel(c.level)
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
      // Mirror the chosen level on the frontend logger too — otherwise clicks
      // never leave the browser even when the user picked verbose/trace.
      feLogger.setLevel(pendingLevel)
      await loadConfig()
      addToast(t('debug.savedToast'), 'success')
    } catch (e) {
      addToast(e.message || t('debug.failedSave'), 'error')
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
      addToast(t('debug.eventsCleared'), 'success')
    } catch (e) {
      addToast(e.message || t('debug.failedClear'), 'error')
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
      addToast(e.message || t('debug.failedExport'), 'error')
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
  const selfTestOk = selfTestResult && !selfTestResult.error && selfTestResult.ws_callback_wired

  // Active selector rows: surface-2 fill + ink + hairline, never inverted.
  const optionRow = (active, dense) => ({
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
    textAlign: 'start', padding: '0 12px', minHeight: dense ? 36 : 44,
    borderRadius: 'var(--r-ctl)', cursor: 'pointer', fontFamily: 'inherit',
    background: active ? 'var(--surface-2)' : 'transparent',
    border: `0.5px solid ${active ? 'var(--line)' : 'transparent'}`,
    color: active ? 'var(--ink)' : 'var(--ink-mute)',
    fontSize: 15, fontWeight: active ? 600 : 400,
    transition: 'background var(--dur-press) var(--ease-standard)',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div className="z-page-head" style={{
        padding: '24px 20px 16px', margin: 0, borderBottom: '0.5px solid var(--line)',
        alignItems: 'center', flexShrink: 0, background: 'var(--bg)', flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 className="z-display" style={{ margin: 0 }}>{t('debug.title')}</h1>
            {config && (
              <span className="z-chip" style={{ gap: 6 }}>
                <Dot color={isActive ? 'var(--ok)' : 'var(--ink-faint)'} />
                {isActive ? config.level.toUpperCase() : t('debug.statusOff')}
              </span>
            )}
          </div>
          <p className="z-footnote">
            {t('debug.subtitle', { n: filtered.length, live: liveMode ? t('debug.liveTag') : '' })}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={async () => {
              try {
                const r = await debugSelfTest()
                setSelfTestResult(r)
              } catch (e) {
                // This is the admin Debug page — show the normalized error code
                // + sanitized message + request_id so the operator can correlate
                // with backend logs. Raw e.message used to be raw HTTP/HA text.
                const code  = e?.code || 'unknown'
                const msg   = e?.userMessage || e?.message || 'request failed'
                const refId = e?.requestId ? ` (ref ${e.requestId})` : ''
                setSelfTestResult({ error: `${msg} [${code}]${refId}` })
              }
            }}
            className="z-btn-secondary"
          >
            {t('debug.selfTest')}
          </button>
          <button onClick={() => setShowSimulate(true)} className="z-btn-secondary">
            {t('debug.simulate')}
          </button>
          <button onClick={exportReport} className="z-btn-secondary">
            {t('debug.export')}
          </button>
          <Button variant="danger" onClick={clearEvents}>
            {t('debug.clear')}
          </Button>
        </div>
      </div>

      {selfTestResult && (
        <div className={selfTestOk ? 'bg-ok-soft' : 'z-alert-err'} style={{
          padding: '12px 20px', flexShrink: 0,
          borderBottom: '0.5px solid var(--line)',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{ flex: 1, paddingTop: 12 }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: selfTestOk ? 'var(--ok-text)' : 'var(--err-text)' }}>
              {selfTestResult.error
                ? t('debug.errorPrefix', { msg: selfTestResult.error })
                : selfTestResult.diagnosis}
            </p>
            {selfTestResult.ws_callback_wired === false && (
              <p style={{ fontSize: 13, color: 'var(--err-text)', marginTop: 4 }}>
                {t('debug.wsNotWired')}
              </p>
            )}
            {selfTestResult.ws_callback_wired && !selfTestResult.was_active_before && (
              <p style={{ fontSize: 13, color: 'var(--warn-text)', marginTop: 4 }}>
                {t('debug.busNotActive')}
              </p>
            )}
            {selfTestResult.ws_callback_wired && (
              <p className="z-code" style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>
                buffer={selfTestResult.buffer_size} · ws={selfTestResult.ws_callback_wired ? 'wired' : 'NOT wired'} · loop={selfTestResult.event_loop_stored ? 'stored' : 'missing'} · level={selfTestResult.config?.level}
              </p>
            )}
          </div>
          <button onClick={() => setSelfTestResult(null)} className="z-icon-btn" aria-label={t('common.close')}>
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left sidebar — config + filters */}
        <div style={{
          width: 240, flexShrink: 0, borderInlineEnd: '0.5px solid var(--line)',
          overflow: 'auto', background: 'var(--bg-2)', padding: 16,
        }}>
          {/* Level selector */}
          <p className="z-eyebrow" style={{ marginBottom: 8 }}>
            {t('debug.debugLevel')}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
            {ALL_LEVELS.map(lvl => (
              <button key={lvl} onClick={() => setPendingLevel(lvl)} style={optionRow(pendingLevel === lvl)}>
                <Dot color={LEVEL_DOT[lvl]} />
                {lvl}
              </button>
            ))}
          </div>

          {/* Scopes — thirteen rows on a desktop-only page, so the dense 36px row. */}
          <p className="z-eyebrow" style={{ marginBottom: 8 }}>
            {t('debug.scopes')} {(pendingScopes?.length ?? 0) === 0 ? t('debug.scopesAll') : `(${pendingScopes.length})`}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
            {ALL_SCOPES.map(scope => {
              const active = !pendingScopes || pendingScopes.length === 0 || pendingScopes.includes(scope)
              return (
                <button key={scope} onClick={() => toggleScope(scope)} style={optionRow(active, true)}>
                  <Dot color={active ? SCOPE_DOT[scope] : 'var(--ink-faint)'} />
                  {scope}
                </button>
              )
            })}
            <button onClick={() => setPendingScopes([])} style={optionRow(false, true)}>
              {t('debug.allScopes')}
            </button>
          </div>

          <button
            onClick={saveConfig}
            disabled={configSaving}
            className="z-btn-primary"
            style={{ width: '100%', marginBottom: 24 }}
          >
            {configSaving ? '…' : t('debug.apply')}
          </button>

          {/* Filters */}
          <p className="z-eyebrow" style={{ marginBottom: 8 }}>
            {t('debug.filterEvents')}
          </p>
          <select
            value={filterScope}
            onChange={e => setFilterScope(e.target.value)}
            className="z-input"
            style={{ marginBottom: 8 }}
          >
            <option value="">{t('debug.allScopesOpt')}</option>
            {ALL_SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={filterResult}
            onChange={e => setFilterResult(e.target.value)}
            className="z-input"
            style={{ marginBottom: 8 }}
          >
            <option value="">{t('debug.allResults')}</option>
            {['ok','error','exception','not_found','unrecognized','skipped'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <input
            value={filterReqId}
            onChange={e => setFilterReqId(e.target.value)}
            placeholder={t('debug.filterReqIdPh')}
            dir="auto"
            className="z-input"
            style={{ marginBottom: 12, boxSizing: 'border-box' }}
          />

          {/* Live vs stored — a segmented filter: the active side gets the
              surface-2 fill + hairline, not an inverted or accent fill. */}
          <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 'var(--r-ctl)', border: '0.5px solid var(--line)', background: 'var(--surface)' }}>
            {[[true, t('debug.live')], [false, t('debug.buffered')]].map(([mode, label]) => {
              const on = liveMode === mode
              return (
                <button
                  key={String(mode)}
                  onClick={() => { setLiveMode(mode); if (!mode) loadEvents() }}
                  style={{
                    flex: 1, minHeight: 36, borderRadius: 'var(--r-chip)', fontSize: 15, cursor: 'pointer',
                    fontFamily: 'inherit', fontWeight: on ? 600 : 400,
                    background: on ? 'var(--surface-2)' : 'transparent',
                    color: on ? 'var(--ink)' : 'var(--ink-mute)',
                    border: `0.5px solid ${on ? 'var(--line)' : 'transparent'}`,
                    transition: 'background var(--dur-press) var(--ease-standard)',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Main event list */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Column headers */}
          <div className="z-eyebrow" style={{
            display: 'grid', gridTemplateColumns: GRID,
            gap: 8, padding: '8px 12px', borderBottom: '0.5px solid var(--line)', flexShrink: 0,
          }}>
            <span>{t('debug.colTime')}</span>
            <span>{t('debug.colScope')}</span>
            <span>{t('debug.colLevel')}</span>
            <span>{t('debug.colStep')}</span>
            <span></span>
          </div>

          <div ref={listRef} style={{ flex: 1, overflow: 'auto' }}>
            {filterReqId && (
              <div className="bg-info-soft" style={{
                padding: '8px 12px',
                borderBottom: '0.5px solid var(--line)',
                display: 'flex', alignItems: 'center', gap: 8, minHeight: 44,
              }}>
                <span className="z-code" style={{ fontSize: 13, color: 'var(--ink)', flex: 1 }}>
                  {t('debug.tracing', { id: filterReqId })}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setFilterReqId('')}>
                  {t('debug.clearFilter')}
                </Button>
              </div>
            )}
            {filtered.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center' }}>
                <p className="z-body" style={{ color: 'var(--ink-mute)' }}>
                  {isActive ? (liveMode ? t('debug.waitingEvents') : t('debug.noEvents')) : t('debug.debugOff')}
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
