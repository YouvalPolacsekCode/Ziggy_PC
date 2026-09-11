// LEGACY — superseded by the Suggested tab inside Automations.jsx.
// The canonical SuggestionCard now lives at Automations.jsx (Configure → wizard flow,
// no auto-deploy). This page's SuggestionCard still uses the older accept/reject UX
// and is kept only because /suggestions is still routed from App.jsx and linked from
// Dashboard. New suggestion work should go through the Suggested tab; do not extend
// this page. Slated for removal once the Dashboard link and /suggestions route are
// retired.
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw, X, ChevronRight, AlertTriangle } from 'lucide-react'
import { useSuggestionStore } from '../stores/suggestionStore'
import { useUIStore } from '../stores/uiStore'
import { useT } from '../lib/i18n'
import { T_ENTER, T_STATE } from '../lib/motion'
import { chipStyle } from '../lib/automations/styles'

// ── Confidence meter ──────────────────────────────────────────────────────────
// ONE 13px footnote: "82%" + five dots, ink-mute.
function ConfidenceMeter({ value }) {
  const filled = Math.round(value * 5)
  return (
    <span className="z-footnote z-mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {Math.round(value * 100)}%
      <span style={{ display: 'inline-flex', gap: 3 }} aria-hidden="true">
        {[0,1,2,3,4].map(i => (
          <span key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: i < filled ? 'var(--ink-2)' : 'var(--line-2)' }} />
        ))}
      </span>
    </span>
  )
}

const PATTERN_TYPE_KEYS = {
  time_based: { key: 'suggestions.patternTime' },
  sequence:   { key: 'suggestions.patternRoutine' },
  group:      { key: 'suggestions.patternGroup' },
}
const STATUS_KEYS = {
  accepted:    { key: 'suggestions.statusAccepted',  color: 'var(--ok-text)' },
  rejected:    { key: 'suggestions.statusDismissed', color: 'var(--err-text)' },
  snoozed:     { key: 'suggestions.statusSnoozed',   color: 'var(--warn-text)' },
  implemented: { key: 'suggestions.statusActive',    color: 'var(--ok-text)' },
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
      transition={T_ENTER}
      style={{
        padding: 16, borderRadius: 'var(--r-card)',
        background: 'var(--surface)',
        border: '0.5px solid var(--line)',
        // Resolved cards read in the muted ink, not through an opacity veil.
        color: isPending ? 'var(--ink)' : 'var(--ink-mute)',
      }}
    >
      {/* Type + confidence row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <p className="z-eyebrow" style={{ margin: 0 }}>{t(meta.key)}</p>
        <div style={{ flex: 1 }} />
        <ConfidenceMeter value={suggestion.confidence} />
        {!isPending && (
          <span className="z-chip" style={{ color: statusMeta?.color || 'var(--ink-2)' }}>
            {statusMeta ? t(statusMeta.key) : suggestion.status}
          </span>
        )}
      </div>

      {/* Description */}
      <p className="z-body" style={{ fontWeight: 500, textWrap: 'pretty', marginBottom: 8, color: 'inherit' }}>
        {suggestion.user_message}
      </p>

      {/* Trigger/action summary */}
      {(suggestion.trigger || suggestion.actions?.length > 0) && (
        <div style={{
          padding: '8px 12px', borderRadius: 'var(--r-ctl)', background: 'var(--surface-2)',
          display: 'flex', flexDirection: 'column', gap: 4, marginBottom: isPending ? 12 : 0,
        }}>
          {suggestion.trigger?.type && (() => {
            const FRIENDLY_TRIGGERS = new Set(['time', 'state', 'numeric_state', 'zone', 'sunrise', 'sunset'])
            const triggerText = FRIENDLY_TRIGGERS.has(suggestion.trigger.type)
              ? t(`suggestions.trigger.${suggestion.trigger.type}`)
              : null
            if (!triggerText) return null
            return (
              <span className="z-subhead">
                {t('suggestions.actionWhen')}  {triggerText}{suggestion.trigger.value ? ` · ${suggestion.trigger.value}` : ''}
              </span>
            )
          })()}
          {suggestion.actions?.slice(0, 2).map((a, i) => (
            <span key={i} className="z-subhead">
              {t('suggestions.actionDo')}    {a.intent?.replace(/_/g, ' ')}{a.params?.room ? ` · ${a.params.room.replace(/_/g, ' ')}` : ''}
            </span>
          ))}
        </div>
      )}

      {/* Expandable evidence + reasoning */}
      {(suggestion.reasoning || suggestion.evidence_summary) && (
        <div style={{ marginBottom: isPending ? 8 : 0, marginTop: (suggestion.trigger || suggestion.actions?.length > 0) ? 4 : 0 }}>
          <button
            onClick={() => setExpanded(v => !v)}
            aria-expanded={expanded}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 500, color: 'var(--ink-mute)', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', minHeight: 44, padding: '0 8px', margin: '0 -8px' }}
          >
            <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform var(--dur-state) var(--ease-standard)' }} />
            {t('suggestions.whyExpand')}
          </button>
          <AnimatePresence>
            {expanded && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={T_STATE} style={{ overflow: 'hidden' }}>
                <div style={{ marginTop: 4, paddingInlineStart: 12, borderInlineStart: '2px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>

                  {/* Evidence block — only shown when evidence_summary is present */}
                  {suggestion.evidence_summary && (() => {
                    const es = suggestion.evidence_summary
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {/* Counts row */}
                        <div className="z-footnote z-mono" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          <span>{t('suggestions.observed', { n: es.occurrences })}</span>
                          <span>{t(es.unique_weeks === 1 ? 'suggestions.week' : 'suggestions.weeks', { n: es.unique_weeks })}</span>
                          {es.last_seen && <span>{t('suggestions.lastSeen', { when: es.last_seen })}</span>}
                          {es.reversal_rate > 0 && (
                            <span style={{ color: 'var(--warn-text)' }}>
                              {t('suggestions.reversed', { pct: Math.round(es.reversal_rate * 100) })}
                            </span>
                          )}
                        </div>
                        {/* Time window (time_based patterns) */}
                        {es.time_window && (
                          <span className="z-footnote z-mono">{t('suggestions.timeWindowLine', { window: es.time_window, avg: es.avg_time })}</span>
                        )}
                        {/* Active days */}
                        {es.active_day_names?.length > 0 && (
                          <span className="z-footnote">{es.active_day_names.join(' · ')}</span>
                        )}
                      </div>
                    )
                  })()}

                  {/* Reasoning text */}
                  {suggestion.reasoning && (
                    <p className="z-subhead" style={{ margin: 0 }}>{suggestion.reasoning}</p>
                  )}

                  {suggestion.safety_note && (
                    <p className="z-subhead" style={{ margin: 0, color: 'var(--warn-text)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <AlertTriangle size={16} strokeWidth={1.75} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                      <span>{suggestion.safety_note}</span>
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Actions — only pending */}
      {isPending && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => act(onAccept, 'accept')}
            disabled={!!acting}
            className="z-btn-primary"
            style={{ flex: 1, opacity: acting ? 0.6 : 1 }}
          >
            {acting === 'accept' ? t('suggestions.creating') : t('suggestions.yesCreate')}
          </button>
          <button
            onClick={() => act(() => onSnooze(3), 'snooze')}
            disabled={!!acting}
            className="z-btn-secondary"
            style={{ opacity: acting ? 0.6 : 1 }}
          >
            {acting === 'snooze' ? '…' : t('suggestions.later')}
          </button>
          <button
            onClick={() => act(onReject, 'reject')}
            disabled={!!acting}
            className="z-icon-btn"
            aria-label={t('suggestions.toastDismissed')}
            title={t('suggestions.toastDismissed')}
            style={{ opacity: acting ? 0.6 : 1 }}
          >
            <X size={18} strokeWidth={1.75} />
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
    <div style={{ maxWidth: 'var(--page-max-w)', margin: '0 auto', padding: '24px 20px 24px' }}>

      {/* Header — ONE trailing 44px action (Analyze). The subtitle is the
          page's Subhead; the numbers live in the stat strip below. */}
      <div className="z-page-head">
        <div>
          <p className="z-eyebrow">{t('suggestions.eyebrow')}</p>
          <h1 className="z-display" style={{ margin: 0 }}>{t('suggestions.title')}</h1>
          <p className="z-subhead" style={{ marginTop: 8, maxWidth: 440 }}>{t('suggestions.subtitle')}</p>
        </div>
        <button
          onClick={handleAnalyze}
          disabled={analyzing}
          className="z-btn-secondary"
          style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          <RefreshCw size={18} strokeWidth={1.75} aria-hidden="true" className={analyzing ? 'z-spin' : undefined} />
          {analyzing ? t('suggestions.analyzing') : t('suggestions.analyze')}
        </button>
      </div>

      {/* Stats strip — Title-size tabular numbers in ink; zero reads faint. */}
      {suggestions.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 20 }}>
          {[
            { label: t('suggestions.statPending'),     value: pending.length },
            { label: t('suggestions.statusAccepted'),  value: suggestions.filter(s => s.status === 'accepted').length },
            { label: t('suggestions.statusSnoozed'),   value: suggestions.filter(s => s.status === 'snoozed').length },
            { label: t('suggestions.statusDismissed'), value: suggestions.filter(s => s.status === 'rejected').length },
          ].map(({ label, value }) => (
            <div key={label} style={{ padding: 12, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)', textAlign: 'center' }}>
              <p className="z-title z-mono" style={{ color: value > 0 ? 'var(--ink)' : 'var(--ink-faint)', margin: 0 }}>{value}</p>
              <p className="z-eyebrow" style={{ marginTop: 4 }}>{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs — filter chips: active = surface-2 + ink + hairline. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[{ id: 'pending', label: t('suggestions.tabPending'), count: pending.length }, { id: 'history', label: t('suggestions.tabHistory') }].map(tabDef => (
          <button
            key={tabDef.id}
            onClick={() => setTab(tabDef.id)}
            aria-pressed={tab === tabDef.id}
            style={chipStyle(tab === tabDef.id)}
          >
            {tabDef.label}
            {tabDef.count > 0 && (
              <span className="z-chip z-mono" style={{ padding: '0 8px', lineHeight: '22px' }}>
                {tabDef.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Loading — stale-while-revalidate: skeleton only on true cold start.
          During a background refresh, keep cached cards visible below. */}
      {loading && suggestions.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 120, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
        </div>
      )}

      {/* Empty */}
      {!loading && displayed.length === 0 && tab === 'pending' && (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <p className="z-headline" style={{ margin: '0 0 4px' }}>{t('suggestions.noPending')}</p>
          <p className="z-subhead" style={{ maxWidth: 320, margin: '0 auto 16px' }}>
            {t('suggestions.noPendingHint')}
          </p>
          <button onClick={handleAnalyze} disabled={analyzing} className="z-btn-secondary">
            {analyzing ? t('suggestions.analyzing') : t('suggestions.runAnalysisNow')}
          </button>
        </div>
      )}
      {!loading && displayed.length === 0 && tab === 'history' && (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <p className="z-subhead" style={{ margin: 0 }}>{t('suggestions.noHistory')}</p>
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
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...T_ENTER, delay: 0.1 }} style={{ marginTop: 24 }}>
          <div style={{ padding: '16px 20px', borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)' }}>
            <p className="z-eyebrow" style={{ marginBottom: 12 }}>{t('suggestions.howItWorks')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                t('suggestions.howItWorks1'),
                t('suggestions.howItWorks2'),
                t('suggestions.howItWorks3'),
                t('suggestions.howItWorks4'),
              ].map((text, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="z-caption z-mono" aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 'var(--r-chip)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {i + 1}
                  </span>
                  <p className="z-subhead" style={{ color: 'var(--ink-2)', margin: 0 }}>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  )
}
