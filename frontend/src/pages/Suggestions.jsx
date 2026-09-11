// LEGACY — superseded by the Suggested tab inside Automations.jsx.
// The canonical SuggestionCard now lives at Automations.jsx (Configure → wizard flow,
// no auto-deploy). This page's SuggestionCard still uses the older accept/reject UX
// and is kept only because /suggestions is still routed from App.jsx and linked from
// Dashboard. New suggestion work should go through the Suggested tab; do not extend
// this page. Slated for removal once the Dashboard link and /suggestions route are
// retired.
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSuggestionStore } from '../stores/suggestionStore'
import { useUIStore } from '../stores/uiStore'
import { useT } from '../lib/i18n'

// ── Confidence meter ──────────────────────────────────────────────────────────
function ConfidenceMeter({ value }) {
  const filled = Math.round(value * 5)
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 9, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
        {Math.round(value * 100)}%
      </span>
      <span style={{ display: 'inline-flex', gap: 2 }}>
        {[0,1,2,3,4].map(i => (
          <span key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: i < filled ? 'var(--ink-2)' : 'var(--line)' }} />
        ))}
      </span>
    </div>
  )
}

const PATTERN_TYPE_KEYS = {
  time_based: { key: 'suggestions.patternTime',    tint: 'var(--info)' },
  sequence:   { key: 'suggestions.patternRoutine', tint: 'var(--ok)' },
  group:      { key: 'suggestions.patternGroup',   tint: 'var(--warn)' },
}
const STATUS_KEYS = {
  accepted:    { key: 'suggestions.statusAccepted',  tint: 'var(--ok)' },
  rejected:    { key: 'suggestions.statusDismissed', tint: 'var(--accent)' },
  snoozed:     { key: 'suggestions.statusSnoozed',   tint: 'var(--warn)' },
  implemented: { key: 'suggestions.statusActive',    tint: 'var(--ok)' },
}

// ── Suggestion card (Inbox-A variant) ─────────────────────────────────────────
function SuggestionCard({ suggestion, onAccept, onReject, onSnooze }) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const [acting,   setActing]   = useState(null)
  const isPending = suggestion.status === 'pending'
  const meta = PATTERN_TYPE_KEYS[suggestion.pattern_type] || PATTERN_TYPE_KEYS.time_based
  const statusMeta = STATUS_KEYS[suggestion.status]

  const act = async (fn, label) => {
    setActing(label)
    try { await fn() } finally { setActing(null) }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.18 }}
      style={{
        padding: 14, borderRadius: 14,
        background: isPending ? 'var(--surface)' : 'var(--surface)',
        border: '0.5px solid var(--line)',
        opacity: isPending ? 1 : 0.65,
      }}
    >
      {/* Type + confidence row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <p className="z-eyebrow" style={{ color: meta.tint }}>{t(meta.key)}</p>
        <div style={{ flex: 1 }} />
        <ConfidenceMeter value={suggestion.confidence} />
        {!isPending && (
          <span style={{
            fontSize: 9, padding: '2px 7px', borderRadius: 5,
            background: `color-mix(in srgb, ${statusMeta?.tint || 'var(--info)'} 14%, transparent)`,
            color: statusMeta?.tint || 'var(--info)',
            fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            {statusMeta ? t(statusMeta.key) : suggestion.status}
          </span>
        )}
      </div>

      {/* Description */}
      <p style={{ fontSize: 14.5, fontWeight: 500, lineHeight: 1.4, color: 'var(--ink)', textWrap: 'pretty', marginBottom: 8 }}>
        {suggestion.user_message}
      </p>

      {/* Trigger/action summary */}
      {(suggestion.trigger || suggestion.actions?.length > 0) && (
        <div style={{
          padding: '8px 10px', borderRadius: 9, background: 'var(--bg-2)',
          display: 'flex', flexDirection: 'column', gap: 4, marginBottom: isPending ? 10 : 0,
        }}>
          {suggestion.trigger?.type && (() => {
            const FRIENDLY_TRIGGERS = new Set(['time', 'state', 'numeric_state', 'zone', 'sunrise', 'sunset'])
            const triggerText = FRIENDLY_TRIGGERS.has(suggestion.trigger.type)
              ? t(`suggestions.trigger.${suggestion.trigger.type}`)
              : null
            if (!triggerText) return null
            return (
              <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                {t('suggestions.actionWhen')}  {triggerText}{suggestion.trigger.value ? ` · ${suggestion.trigger.value}` : ''}
              </span>
            )
          })()}
          {suggestion.actions?.slice(0, 2).map((a, i) => (
            <span key={i} style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
              {t('suggestions.actionDo')}    {a.intent?.replace(/_/g, ' ')}{a.params?.room ? ` · ${a.params.room.replace(/_/g, ' ')}` : ''}
            </span>
          ))}
        </div>
      )}

      {/* Expandable evidence + reasoning */}
      {(suggestion.reasoning || suggestion.evidence_summary) && (
        <div style={{ marginBottom: isPending ? 10 : 0, marginTop: (suggestion.trigger || suggestion.actions?.length > 0) ? 8 : 0 }}>
          <button
            onClick={() => setExpanded(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--ink-mute)', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', padding: 0 }}
          >
            <span style={{ transform: expanded ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>›</span>
            {t('suggestions.whyExpand')}
          </button>
          <AnimatePresence>
            {expanded && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.15 }} style={{ overflow: 'hidden' }}>
                <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: '2px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 6 }}>

                  {/* Evidence block — only shown when evidence_summary is present */}
                  {suggestion.evidence_summary && (() => {
                    const es = suggestion.evidence_summary
                    const chip = { fontSize: 10, color: 'var(--ink-mute)', fontFamily: '"IBM Plex Mono", monospace' }
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {/* Counts row */}
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <span style={chip}>{t('suggestions.observed', { n: es.occurrences })}</span>
                          <span style={chip}>{t(es.unique_weeks === 1 ? 'suggestions.week' : 'suggestions.weeks', { n: es.unique_weeks })}</span>
                          {es.last_seen && <span style={chip}>{t('suggestions.lastSeen', { when: es.last_seen })}</span>}
                          {es.reversal_rate > 0 && (
                            <span style={{ ...chip, color: 'var(--warn)' }}>
                              {t('suggestions.reversed', { pct: Math.round(es.reversal_rate * 100) })}
                            </span>
                          )}
                        </div>
                        {/* Time window (time_based patterns) */}
                        {es.time_window && (
                          <span style={chip}>{t('suggestions.timeWindowLine', { window: es.time_window, avg: es.avg_time })}</span>
                        )}
                        {/* Active days */}
                        {es.active_day_names?.length > 0 && (
                          <span style={chip}>{es.active_day_names.join(' · ')}</span>
                        )}
                      </div>
                    )
                  })()}

                  {/* Reasoning text */}
                  {suggestion.reasoning && (
                    <p style={{ fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.5 }}>{suggestion.reasoning}</p>
                  )}

                  {suggestion.safety_note && (
                    <p style={{ fontSize: 11, color: 'var(--warn)' }}>⚠ {suggestion.safety_note}</p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Actions — only pending */}
      {isPending && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => act(onAccept, 'accept')}
            disabled={!!acting}
            style={{
              flex: 1, padding: '10px', borderRadius: 9,
              background: 'var(--ink)', color: 'var(--bg)',
              border: 'none', fontSize: 13, fontWeight: 600, cursor: acting ? 'default' : 'pointer',
              opacity: acting ? 0.6 : 1, fontFamily: 'inherit',
            }}
          >
            {acting === 'accept' ? t('suggestions.creating') : t('suggestions.yesCreate')}
          </button>
          <button
            onClick={() => act(() => onSnooze(3), 'snooze')}
            disabled={!!acting}
            style={{
              padding: '10px 14px', borderRadius: 9,
              background: 'var(--surface-2)', color: 'var(--ink-2)',
              border: '0.5px solid var(--line)', fontSize: 13, fontWeight: 500, cursor: acting ? 'default' : 'pointer',
              opacity: acting ? 0.6 : 1, fontFamily: 'inherit',
            }}
          >
            {acting === 'snooze' ? '…' : t('suggestions.later')}
          </button>
          <button
            onClick={() => act(onReject, 'reject')}
            disabled={!!acting}
            style={{
              padding: '10px', borderRadius: 9,
              background: 'transparent', color: 'var(--ink-faint)',
              border: '0.5px solid var(--line)', fontSize: 13, cursor: acting ? 'default' : 'pointer',
              opacity: acting ? 0.6 : 1, fontFamily: 'inherit',
            }}
          >
            ✕
          </button>
        </div>
      )}
    </motion.div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Suggestions() {
  const t = useT()
  const { suggestions, loading, analyzing, fetch, accept, reject, snooze, runAnalysis } = useSuggestionStore()
  const { addToast } = useUIStore()
  const [tab, setTab] = useState('pending')

  useEffect(() => { fetch() }, [])

  const pending = suggestions.filter(s => s.status === 'pending')
  const history = suggestions.filter(s => s.status !== 'pending')

  const handleAccept  = async (id) => { try { await accept(id);     addToast(t('suggestions.toastAccepted'), 'success') } catch { addToast(t('suggestions.toastFailed'), 'error') } }
  const handleReject  = async (id) => { try { await reject(id);     addToast(t('suggestions.toastDismissed'), 'success')          } catch { addToast(t('suggestions.toastFailed'), 'error') } }
  const handleSnooze  = async (id, days) => { try { await snooze(id, days); addToast(t('suggestions.toastSnoozed', { n: days }), 'success') } catch { addToast(t('suggestions.toastFailed'), 'error') } }
  const handleAnalyze = async () => {
    try {
      const r = await runAnalysis()
      const msg = r?.new_count > 0
        ? (r.new_count === 1 ? t('suggestions.toastNewOne', { n: r.new_count }) : t('suggestions.toastNew', { n: r.new_count }))
        : t('suggestions.toastNoNew')
      addToast(msg, 'success')
    } catch { addToast(t('suggestions.toastAnalysisFailed'), 'error') }
  }

  const displayed = tab === 'pending' ? pending : history

  return (
    <div style={{ maxWidth: 'var(--page-max-w)', margin: '0 auto', padding: '24px 20px 16px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>{t('suggestions.eyebrow')}</p>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0, lineHeight: 1 }}>
            {t('suggestions.title')}
          </h1>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 6, lineHeight: 1.5, maxWidth: 440 }}>
            {t('suggestions.subtitle')}
          </p>
        </div>
        <button
          onClick={handleAnalyze}
          disabled={analyzing}
          className="z-btn-secondary"
          style={{ padding: '8px 12px', borderRadius: 9, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: analyzing ? 'spin 1s linear infinite' : 'none' }}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
          {analyzing ? 'Analyzing…' : 'Analyze'}
        </button>
      </div>

      {/* Stats strip */}
      {suggestions.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20 }}>
          {[
            { label: 'Pending',   value: pending.length,                                             tint: 'var(--info)' },
            { label: 'Accepted',  value: suggestions.filter(s => s.status === 'accepted').length,    tint: 'var(--ok)' },
            { label: 'Snoozed',   value: suggestions.filter(s => s.status === 'snoozed').length,     tint: 'var(--warn)' },
            { label: 'Dismissed', value: suggestions.filter(s => s.status === 'rejected').length,    tint: 'var(--ink-faint)' },
          ].map(({ label, value, tint }) => (
            <div key={label} style={{ padding: '10px 12px', borderRadius: 11, background: 'var(--surface)', border: '0.5px solid var(--line)', textAlign: 'center' }}>
              <p style={{ fontSize: 22, fontWeight: 700, color: value > 0 ? tint : 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', letterSpacing: '-0.01em', margin: 0 }}>{value}</p>
              <p className="z-eyebrow" style={{ marginTop: 4 }}>{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
        {[{ id: 'pending', label: 'Pending', count: pending.length }, { id: 'history', label: 'History' }].map(t => (
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
              <span style={{ background: tab === t.id ? 'rgba(255,255,255,0.25)' : 'var(--accent)', color: '#fff', fontSize: 9, padding: '1px 5px', borderRadius: 999, fontFamily: '"IBM Plex Mono", monospace', fontWeight: 700 }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Loading — stale-while-revalidate: skeleton only on true cold start.
          During a background refresh, keep cached cards visible below. */}
      {loading && suggestions.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 120, borderRadius: 14, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
        </div>
      )}

      {/* Empty */}
      {!loading && displayed.length === 0 && tab === 'pending' && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>{t('suggestions.noPending')}</p>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.5, maxWidth: 280, margin: '0 auto 16px' }}>
            {t('suggestions.noPendingHint')}
          </p>
          <button onClick={handleAnalyze} disabled={analyzing} className="z-btn-secondary" style={{ padding: '8px 14px', borderRadius: 9, fontFamily: 'inherit' }}>
            {analyzing ? t('suggestions.analyzing') : t('suggestions.runAnalysisNow')}
          </button>
        </div>
      )}
      {!loading && displayed.length === 0 && tab === 'history' && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <p className="z-eyebrow">{t('suggestions.noHistory')}</p>
        </div>
      )}

      {/* Cards */}
      {displayed.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AnimatePresence mode="popLayout">
            {displayed.map(s => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                onAccept={() => handleAccept(s.id)}
                onReject={() => handleReject(s.id)}
                onSnooze={(days) => handleSnooze(s.id, days)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* How it works */}
      {!loading && suggestions.length === 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} style={{ marginTop: 24 }}>
          <div style={{ padding: '18px 20px', borderRadius: 14, background: 'var(--surface)', border: '0.5px solid var(--line)' }}>
            <p className="z-eyebrow" style={{ marginBottom: 12 }}>{t('suggestions.howItWorks')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                t('suggestions.howItWorks1'),
                t('suggestions.howItWorks2'),
                t('suggestions.howItWorks3'),
                t('suggestions.howItWorks4'),
              ].map((text, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: 10, color: 'var(--ink-mute)', fontFamily: '"IBM Plex Mono", monospace' }}>{i + 1}</span>
                  </span>
                  <p style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.4 }}>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  )
}
