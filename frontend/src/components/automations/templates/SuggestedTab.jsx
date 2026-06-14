import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useT, t as tStatic } from '../../../lib/i18n'

// ── Suggested tab (embedded from Suggestions.jsx logic) ──────────────────────
function ConfidenceMeter({ value }) {
  const filled = Math.round(value * 5)
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span className="z-mono" style={{ fontSize: 9, color: 'var(--ink-faint)' }}>{Math.round(value * 100)}%</span>
      <span style={{ display: 'inline-flex', gap: 2 }}>
        {[0,1,2,3,4].map(i => (
          <span key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: i < filled ? 'var(--ink-2)' : 'var(--line)' }} />
        ))}
      </span>
    </div>
  )
}

function getPatternTypeMeta() {
  return {
    time_based: { label: tStatic('automations.pattern.timePattern'), tint: 'var(--info)' },
    sequence:   { label: tStatic('automations.pattern.routine'),     tint: 'var(--ok)' },
    group:      { label: tStatic('automations.pattern.group'),       tint: 'var(--warn)' },
  }
}
function getSuggestionStatusMeta() {
  return {
    accepted:    { label: tStatic('automations.suggestionStatus.accepted'),    tint: 'var(--ok)' },
    rejected:    { label: tStatic('automations.suggestionStatus.rejected'),    tint: 'var(--err)' },
    snoozed:     { label: tStatic('automations.suggestionStatus.snoozed'),     tint: 'var(--warn)' },
    implemented: { label: tStatic('automations.suggestionStatus.implemented'), tint: 'var(--ok)' },
  }
}

// Canonical suggestion card for the Suggested tab. Configure opens the
// AutomationWizard pre-populated with detected devices and suggestion defaults —
// never auto-deploys. A separate, legacy SuggestionCard lives in pages/Suggestions.jsx
// (the standalone /suggestions page) with an older accept/reject UX; do not edit
// that one for new work.
function SuggestionCard({ suggestion, onConfigure, onReject, onSnooze }) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const [acting,   setActing]   = useState(null)
  const isPending = suggestion.status === 'pending'
  const PATTERN_TYPE_META = getPatternTypeMeta()
  const SUGGESTION_STATUS_META = getSuggestionStatusMeta()
  const meta = PATTERN_TYPE_META[suggestion.pattern_type] || PATTERN_TYPE_META.time_based
  const act = async (fn, label) => { setActing(label); try { await fn() } finally { setActing(null) } }

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: isPending ? 1 : 0.65, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.18 }}
      style={{ padding: 14, borderRadius: 16, background: 'var(--surface)', border: '0.5px solid var(--line)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <p className="z-eyebrow" style={{ color: meta.tint }}>{meta.label}</p>
        <div style={{ flex: 1 }} />
        <ConfidenceMeter value={suggestion.confidence} />
        {!isPending && (
          <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 5, background: `color-mix(in srgb, ${SUGGESTION_STATUS_META[suggestion.status]?.tint || 'var(--info)'} 14%, transparent)`, color: SUGGESTION_STATUS_META[suggestion.status]?.tint || 'var(--info)', fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {SUGGESTION_STATUS_META[suggestion.status]?.label || suggestion.status}
          </span>
        )}
      </div>
      <p style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.4, color: 'var(--ink)', marginBottom: 8 }} dir="auto">{suggestion.user_message}</p>
      {(suggestion.trigger || suggestion.actions?.length > 0) && (
        <div style={{ padding: '8px 10px', borderRadius: 9, background: 'var(--bg-2)', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: isPending ? 10 : 0 }}>
          {suggestion.trigger?.type && <span className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{t('automations.suggested.tagWhen', { desc: `${suggestion.trigger.type}${suggestion.trigger.value ? ` · ${suggestion.trigger.value}` : ''}` })}</span>}
          {suggestion.actions?.slice(0, 2).map((a, i) => <span key={i} className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{t('automations.suggested.tagDo', { desc: `${a.intent?.replace(/_/g, ' ')}${a.params?.room ? ` · ${a.params.room.replace(/_/g, ' ')}` : ''}` })}</span>)}
        </div>
      )}
      {isPending && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => act(onConfigure, 'configure')} disabled={!!acting} style={{ flex: 1, padding: '10px', borderRadius: 10, background: 'var(--ink)', color: 'var(--bg)', border: 'none', fontSize: 13, fontWeight: 600, cursor: acting ? 'default' : 'pointer', opacity: acting ? 0.6 : 1, fontFamily: 'inherit' }}>
            {acting === 'configure' ? t('automations.suggested.openingDots') : t('automations.suggested.configure')}
          </button>
          <button onClick={() => act(() => onSnooze(3), 'snooze')} disabled={!!acting} style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--ink-2)', border: '0.5px solid var(--line)', fontSize: 13, fontWeight: 500, cursor: acting ? 'default' : 'pointer', opacity: acting ? 0.6 : 1, fontFamily: 'inherit' }}>
            {acting === 'snooze' ? '…' : t('automations.suggested.later')}
          </button>
          <button onClick={() => act(onReject, 'reject')} disabled={!!acting} aria-label={t('common.delete')} style={{ padding: '10px', borderRadius: 10, background: 'transparent', color: 'var(--ink-faint)', border: '0.5px solid var(--line)', fontSize: 13, cursor: acting ? 'default' : 'pointer', opacity: acting ? 0.6 : 1, fontFamily: 'inherit' }}>✕</button>
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

function SuggestedTab({ suggestions, loading, analyzing, onConfigure, onReject, onSnooze, onAnalyze }) {
  const t = useT()
  const [subtab, setSubtab] = useState('pending')
  const pending = suggestions.filter(s => s.status === 'pending')
  const history = suggestions.filter(s => s.status !== 'pending')
  const displayed = subtab === 'pending' ? pending : history

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[{ id: 'pending', label: t('automations.suggested.pending'), count: pending.length }, { id: 'history', label: t('automations.suggested.history') }].map(tab => (
            <button key={tab.id} onClick={() => setSubtab(tab.id)} style={{ padding: '4px 11px', borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', background: subtab === tab.id ? 'var(--ink)' : 'var(--surface-2)', color: subtab === tab.id ? 'var(--bg)' : 'var(--ink-mute)', border: subtab === tab.id ? 'none' : '0.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 5 }}>
              {tab.label}
              {tab.count > 0 && <span style={{ background: subtab === tab.id ? 'rgba(255,255,255,0.25)' : 'var(--accent)', color: '#fff', fontSize: 9, padding: '1px 5px', borderRadius: 999, fontFamily: '"IBM Plex Mono", monospace', fontWeight: 700 }}>{tab.count}</span>}
            </button>
          ))}
        </div>
        <button onClick={onAnalyze} disabled={analyzing} className="z-btn-secondary" style={{ padding: '6px 12px', borderRadius: 9, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: analyzing ? 'spin 1s linear infinite' : 'none' }}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
          {analyzing ? t('automations.suggested.analyzing') : t('automations.suggested.analyze')}
        </button>
      </div>

      {loading && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[1,2,3].map(i => <div key={i} style={{ height: 100, borderRadius: 14, background: 'var(--surface)', opacity: 0.6 }} />)}</div>}

      {!loading && displayed.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>{subtab === 'pending' ? t('automations.suggested.noPending') : t('automations.suggested.noHistory')}</p>
          {subtab === 'pending' && <p style={{ fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.5, maxWidth: 280, margin: '0 auto 16px' }}>{t('automations.suggested.learnsHint')}</p>}
          {subtab === 'pending' && <button onClick={onAnalyze} disabled={analyzing} className="z-btn-secondary" style={{ padding: '8px 14px', borderRadius: 9, fontFamily: 'inherit' }}>{analyzing ? t('automations.suggested.analyzing') : t('automations.suggested.runAnalysis')}</button>}
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

export { suggestionToWizardData }
export default SuggestedTab
