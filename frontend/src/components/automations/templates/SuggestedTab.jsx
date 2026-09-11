import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Lightbulb, X, RefreshCw } from 'lucide-react'
import { useT, t as tStatic } from '../../../lib/i18n'
import { T_ENTER } from '../../../lib/motion'
import { chipStyle } from '../../../lib/automations/styles'

// ── Suggested tab (embedded from Suggestions.jsx logic) ──────────────────────
// Confidence: ONE 13px footnote line — "82%" plus five dots — in ink-mute. The
// old 9/11px pairing and the per-type tint made every card compete.
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

function getPatternTypeMeta() {
  return {
    time_based: { label: tStatic('automations.pattern.timePattern') },
    sequence:   { label: tStatic('automations.pattern.routine') },
    group:      { label: tStatic('automations.pattern.group') },
  }
}
function getSuggestionStatusMeta() {
  return {
    accepted:    { label: tStatic('automations.suggestionStatus.accepted'),    color: 'var(--ok-text)' },
    rejected:    { label: tStatic('automations.suggestionStatus.rejected'),    color: 'var(--err-text)' },
    snoozed:     { label: tStatic('automations.suggestionStatus.snoozed'),     color: 'var(--warn-text)' },
    implemented: { label: tStatic('automations.suggestionStatus.implemented'), color: 'var(--ok-text)' },
  }
}

// Canonical suggestion card for the Suggested tab. Configure opens the
// AutomationWizard pre-populated with detected devices and suggestion defaults —
// never auto-deploys. A separate, legacy SuggestionCard lives in pages/Suggestions.jsx
// (the standalone /suggestions page) with an older accept/reject UX; do not edit
// that one for new work.
function SuggestionCard({ suggestion, onConfigure, onReject, onSnooze }) {
  const t = useT()
  const [acting,   setActing]   = useState(null)
  const isPending = suggestion.status === 'pending'
  const PATTERN_TYPE_META = getPatternTypeMeta()
  const SUGGESTION_STATUS_META = getSuggestionStatusMeta()
  const meta = PATTERN_TYPE_META[suggestion.pattern_type] || PATTERN_TYPE_META.time_based
  const statusMeta = SUGGESTION_STATUS_META[suggestion.status]
  const act = async (fn, label) => { setActing(label); try { await fn() } finally { setActing(null) } }

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={T_ENTER}
      style={{ padding: 12, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)', color: isPending ? 'var(--ink)' : 'var(--ink-mute)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <p className="z-eyebrow" style={{ margin: 0 }}>{meta.label}</p>
        <div style={{ flex: 1 }} />
        <ConfidenceMeter value={suggestion.confidence} />
        {!isPending && (
          <span className="z-chip" style={{ color: statusMeta?.color || 'var(--ink-2)' }}>
            {statusMeta?.label || suggestion.status}
          </span>
        )}
      </div>
      <p className="z-body" style={{ fontWeight: 500, marginBottom: 8, color: 'inherit' }} dir="auto">{suggestion.user_message}</p>
      {(suggestion.trigger || suggestion.actions?.length > 0) && (
        <div style={{ padding: '8px 12px', borderRadius: 'var(--r-ctl)', background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: isPending ? 12 : 0 }}>
          {suggestion.trigger?.type && <span className="z-subhead">{t('automations.suggested.tagWhen', { desc: `${suggestion.trigger.type}${suggestion.trigger.value ? ` · ${suggestion.trigger.value}` : ''}` })}</span>}
          {suggestion.actions?.slice(0, 2).map((a, i) => <span key={i} className="z-subhead">{t('automations.suggested.tagDo', { desc: `${a.intent?.replace(/_/g, ' ')}${a.params?.room ? ` · ${a.params.room.replace(/_/g, ' ')}` : ''}` })}</span>)}
        </div>
      )}
      {isPending && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => act(onConfigure, 'configure')} disabled={!!acting} className="z-btn-primary" style={{ flex: 1, opacity: acting ? 0.6 : 1 }}>
            {acting === 'configure' ? t('automations.suggested.openingDots') : t('automations.suggested.configure')}
          </button>
          <button onClick={() => act(() => onSnooze(3), 'snooze')} disabled={!!acting} className="z-btn-secondary" style={{ opacity: acting ? 0.6 : 1 }}>
            {acting === 'snooze' ? '…' : t('automations.suggested.later')}
          </button>
          <button onClick={() => act(onReject, 'reject')} disabled={!!acting} aria-label={t('common.delete')} title={t('common.delete')} className="z-icon-btn" style={{ opacity: acting ? 0.6 : 1 }}>
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
      )}
    </motion.div>
  )
}

// Translate a suggestion (from the pattern engine) into the shape the
// Automation wizard expects. The pattern engine emits actions as
// {intent, params} pairs — we map them to `send_intent` steps so the wizard
// can show them as human-readable strings the user can refine before saving.
function suggestionToWizardData(suggestion) {
  const tr = suggestion.trigger || {}
  let trigger = { type: 'time', time: '08:00' }
  if (tr.type === 'time' && tr.value) trigger = { type: 'time', time: tr.value.slice(0, 5) }
  else if (tr.type === 'sequence')    trigger = { type: 'time', time: '08:00' }   // sequence has no time; let the user choose
  else if (tr.type)                   trigger = { type: tr.type, ...tr }

  const actionToText = (a) => {
    const intent = (a.intent || '').replace(/_/g, ' ')
    const room   = a.params?.room ? tStatic('automations.suggestion.inRoomFmt', { room: a.params.room.replace(/_/g, ' ') }) : ''
    const onOff  = a.params?.turn_on === true ? ' on' : a.params?.turn_on === false ? ' off' : ''
    return `${intent}${onOff}${room}`.trim()
  }
  const actions = (suggestion.actions || []).map(a => ({
    type: 'send_intent',
    text: actionToText(a) || (a.intent || tStatic('automations.suggestion.doSomething')),
  }))

  return {
    name: suggestion.user_message?.slice(0, 60) || tStatic('automations.suggestion.defaultName'),
    description: suggestion.reasoning || suggestion.user_message || '',
    trigger,
    conditions: [],
    actions,
    rooms: [],
  }
}

// Inline nudge strip for the Automations tab. Shows the freshest `max` pending
// suggestions as full cards + a "see all" opener into the Suggestions inbox.
// Renders nothing when there's nothing pending, so it's zero-footprint on a
// home with no learned patterns yet. Reuses the same SuggestionCard as the
// inbox so Add / Later(snooze) / ✕(reject) behave identically in both places.
function SuggestionNudgeStrip({ suggestions, onConfigure, onReject, onSnooze, onOpenInbox, max = 2 }) {
  const t = useT()
  const pending = (suggestions || []).filter(s => s.status === 'pending')
  if (pending.length === 0) return null
  const shown = pending.slice(0, max)

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <p className="z-eyebrow" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Lightbulb size={16} strokeWidth={1.75} aria-hidden="true" />{t('automations.tabSuggested')}
        </p>
        <button onClick={onOpenInbox} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--ink-mute)', minHeight: 40, padding: '0 8px', margin: '0 -8px' }}>
          {t('automations.suggested.seeAll', { n: pending.length })}
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <AnimatePresence mode="popLayout">
          {shown.map(s => (
            <SuggestionCard key={s.id} suggestion={s} onConfigure={() => onConfigure(s)} onReject={() => onReject(s.id)} onSnooze={(days) => onSnooze(s.id, days)} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

function SuggestedTab({ suggestions, loading, analyzing, onConfigure, onReject, onSnooze, onAnalyze }) {
  const t = useT()
  const [subtab, setSubtab] = useState('pending')
  const pending = suggestions.filter(s => s.status === 'pending')
  const history = suggestions.filter(s => s.status !== 'pending')
  const displayed = subtab === 'pending' ? pending : history

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {[{ id: 'pending', label: t('automations.suggested.pending'), count: pending.length }, { id: 'history', label: t('automations.suggested.history') }].map(tab => (
            <button key={tab.id} onClick={() => setSubtab(tab.id)} aria-pressed={subtab === tab.id} style={chipStyle(subtab === tab.id)}>
              {tab.label}
              {tab.count > 0 && <span className="z-chip z-mono" style={{ padding: '0 8px', lineHeight: '22px' }}>{tab.count}</span>}
            </button>
          ))}
        </div>
        <button onClick={onAnalyze} disabled={analyzing} className="z-btn-secondary" style={{ flexShrink: 0 }}>
          <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" className={analyzing ? 'z-spin' : undefined} />
          {analyzing ? t('automations.suggested.analyzing') : t('automations.suggested.analyze')}
        </button>
      </div>

      {loading && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[1,2,3].map(i => <div key={i} style={{ height: 100, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}</div>}

      {!loading && displayed.length === 0 && (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <p className="z-headline" style={{ margin: '0 0 4px' }}>{subtab === 'pending' ? t('automations.suggested.noPending') : t('automations.suggested.noHistory')}</p>
          {subtab === 'pending' && <p className="z-subhead" style={{ maxWidth: 320, margin: '0 auto 16px' }}>{t('automations.suggested.learnsHint')}</p>}
          {subtab === 'pending' && <button onClick={onAnalyze} disabled={analyzing} className="z-btn-secondary">{analyzing ? t('automations.suggested.analyzing') : t('automations.suggested.runAnalysis')}</button>}
        </div>
      )}

      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AnimatePresence mode="popLayout">
            {displayed.map(s => (
              <SuggestionCard key={s.id} suggestion={s} onConfigure={() => onConfigure(s)} onReject={() => onReject(s.id)} onSnooze={(days) => onSnooze(s.id, days)} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

export { suggestionToWizardData, SuggestionNudgeStrip }
export default SuggestedTab
