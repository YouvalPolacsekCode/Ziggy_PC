import React, { useState, useEffect, useCallback } from 'react'
import { Zap, Search, Play, RefreshCw, ChevronDown, Check, X, ArrowRight } from 'lucide-react'
import { useT, useTranslatedName } from '../../lib/i18n'
import { getTriggerTypes, getActionTypes } from '../../lib/automations/types'
import { triggerSummary, actionSummary, conditionSummary, formatRelativeTime } from '../../lib/automations/summaries'
import { AndConnector } from './wizard/Atoms'
import { isCompleteCondition } from './wizard/ActionRow'
import { getAutomationTraces, getAutomationTraceDetail } from '../../lib/api'

// ── AutomationViewModal ───────────────────────────────────────────────────────
// Two tabs:
//   • Details — what the automation does (trigger / conditions / steps / rooms)
//   • History — most recent runs, click to inspect step-by-step outcomes
// History is lazy-fetched on first tab activation. Each run's pill color reflects
// outcome; opening a run expands its timeline inline (no extra modal hop).
//
// HIG pass: Headline / Subhead / Footnote roles, 44px glyph box and controls,
// neutral chips (.z-chip) instead of info-tinted pills, line icons for the
// emoji glyphs, and the --err family for failures (the old `--danger` token
// did not exist, so failed steps rendered in the inherited colour).
function AutomationViewModal({ automation, roomNameMap, onEdit, onTrigger, onClose }) {
  const t = useT()
  const automationName = useTranslatedName(automation?.name)
  const automationDesc = useTranslatedName(automation?.description)
  const [tab, setTab] = useState('details')
  if (!automation) return null
  const lastRun = formatRelativeTime(automation.last_triggered)
  // numeric_state belongs to the "Device State" trigger family in the UI.
  const tType = automation.trigger?.type
  const triggerTypeLabel = getTriggerTypes().find(tt => tt.value === (tType === 'numeric_state' ? 'state' : tType))?.label || t('common.unknown')
  const completeConditions = (automation.conditions || []).filter(isCompleteCondition)
  const actions = automation.actions || []
  const actionTypes = getActionTypes()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header — name, description */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div aria-hidden="true" style={{ width: 44, height: 44, borderRadius: 'var(--r-ctl)', background: 'var(--surface-2)', color: automation.enabled ? 'var(--ink-2)' : 'var(--ink-faint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Zap size={22} strokeWidth={1.75} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="z-headline" style={{ margin: 0 }} dir="auto">{automationName}</p>
          {automation.description && <p className="z-subhead" style={{ margin: '2px 0 0' }} dir="auto">{automationDesc}</p>}
        </div>
      </div>

      {/* Tab switcher — matches the Actions-page segmented control. */}
      <div role="tablist" style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--surface-2)', borderRadius: 'var(--r-ctl)' }}>
        {[
          { id: 'details', label: t('automations.view.tabDetails') },
          { id: 'history', label: t('automations.view.tabHistory') },
        ].map(tabDef => {
          const active = tab === tabDef.id
          return (
            <button key={tabDef.id} role="tab" aria-selected={active} onClick={() => setTab(tabDef.id)} style={{
              flex: 1, minHeight: 44, padding: '0 16px', borderRadius: 'var(--r-ctl)', fontFamily: 'inherit', cursor: 'pointer',
              background: active ? 'var(--surface)' : 'transparent',
              border: `0.5px solid ${active ? 'var(--line)' : 'transparent'}`,
              fontSize: 15, fontWeight: 600,
              color: active ? 'var(--ink)' : 'var(--ink-mute)',
              transition: 'background var(--dur-state) var(--ease-standard), color var(--dur-state) var(--ease-standard)',
            }}>
              {tabDef.label}
            </button>
          )
        })}
      </div>

      {tab === 'details' && (
        <DetailsTab
          automation={automation}
          roomNameMap={roomNameMap}
          triggerTypeLabel={triggerTypeLabel}
          completeConditions={completeConditions}
          actions={actions}
          actionTypes={actionTypes}
          lastRun={lastRun}
          t={t}
        />
      )}
      {tab === 'history' && <HistoryTab automation={automation} t={t} />}

      {/* Footer actions — quick path to edit or run from the view itself */}
      {(onEdit || onTrigger) && (
        <div style={{ display: 'flex', gap: 8, paddingTop: 8, borderTop: '0.5px solid var(--line)' }}>
          {onTrigger && (
            <button onClick={() => { onTrigger(automation.id); onClose?.() }} className="z-btn-secondary" style={{ flex: 1 }}>
              <Play size={16} strokeWidth={1.75} aria-hidden="true" />
              {t('automations.view.runNow')}
            </button>
          )}
          {onEdit && (
            <button onClick={() => { onEdit(automation); onClose?.() }} className="z-btn-primary" style={{ flex: 1 }}>
              {t('common.edit')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Details tab ──────────────────────────────────────────────────────────────
function DetailsTab({ automation, roomNameMap, triggerTypeLabel, completeConditions, actions, actionTypes, lastRun, t }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Trigger */}
      <div style={{ padding: '12px 16px', borderRadius: 'var(--r-ctl)', background: 'var(--surface-2)', border: '0.5px solid var(--line)' }}>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.triggerLabel')}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="z-chip">{triggerTypeLabel}</span>
          <span className="z-subhead">{triggerSummary(automation.trigger)}</span>
        </div>
      </div>

      {/* Conditions — keep time-only conditions visible. AND chip between rows
          mirrors the wizard so this view answers "what will fire?" honestly. */}
      {completeConditions.length > 0 && (
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 8 }}>
            {t('automations.view.conditionsAll', { n: completeConditions.length })}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {completeConditions.map((c, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {i > 0 && <AndConnector />}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, padding: '8px 16px', borderRadius: 'var(--r-ctl)', border: '0.5px solid var(--line)', background: 'var(--surface)' }}>
                  <Search size={18} strokeWidth={1.75} aria-hidden="true" style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
                  <span className="z-subhead" style={{ color: 'var(--ink-2)' }}>{conditionSummary(c)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Steps */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.view.stepsCount', { n: actions.length })}</p>
        {actions.length === 0
          ? <p className="z-subhead">{t('automations.view.noSteps')}</p>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {actions.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minHeight: 56, padding: '12px 16px', borderRadius: 'var(--r-ctl)', border: '0.5px solid var(--line)', background: 'var(--surface)' }}>
                  <span className="z-caption z-mono" style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--surface-2)', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="z-headline" style={{ margin: 0 }}>
                      {actionTypes.find(at => at.value === a.type)?.label || a.type}
                    </p>
                    <p className="z-subhead" style={{ margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{actionSummary(a)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* Rooms */}
      {(automation.rooms || []).length > 0 && (
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.view.rooms')}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {automation.rooms.map(r => (
              <span key={r} className="z-chip">
                {roomNameMap?.[r] || r.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Status footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="z-chip" style={{ color: automation.enabled ? 'var(--ok-text)' : 'var(--ink-mute)' }}>
          {automation.enabled ? t('automations.view.enabled') : t('automations.view.disabled')}
        </span>
        <span className="z-chip">
          {automation.source === 'ziggy' ? t('automations.view.localScheduler') : t('automations.view.haTriggered')}
        </span>
        <span className="z-footnote z-mono" style={{ marginInlineStart: 'auto', color: 'var(--ink-faint)' }}>
          {lastRun ? t('automations.view.lastRan', { when: lastRun }) : t('automations.view.neverRun')}
        </span>
      </div>
    </div>
  )
}

// ── History tab ──────────────────────────────────────────────────────────────
// Runs are fetched once on mount of this tab (the parent unmounts/remounts it
// when switching tabs, so re-opening the History tab re-fetches — which is the
// behavior we want for "show me what's new"). One refresh button for explicit
// refetch. Click a run to expand its step timeline inline.

const STATUS_PALETTE = {
  success: { dot: 'var(--ok)',   text: 'var(--ok-text)',   label: 'automations.view.statusSuccess' },
  stopped: { dot: 'var(--warn)', text: 'var(--warn-text)', label: 'automations.view.statusStopped' },
  failed:  { dot: 'var(--err)',  text: 'var(--err-text)',  label: 'automations.view.statusFailed'  },
  running: { dot: 'var(--info)', text: 'var(--ink-2)',     label: 'automations.view.statusRunning' },
}

function HistoryTab({ automation, t }) {
  const [state, setState] = useState({ status: 'loading', runs: [], error: null })
  const [openRunId, setOpenRunId] = useState(null)

  const load = useCallback(async () => {
    setState({ status: 'loading', runs: [], error: null })
    try {
      const r = await getAutomationTraces(automation.id, 10)
      if (r && r.ok) {
        setState({ status: 'ready', runs: r.runs || [], error: null })
      } else {
        setState({ status: 'error', runs: [], error: (r && r.error) || t('automations.view.runsUnavailable') })
      }
    } catch {
      setState({ status: 'error', runs: [], error: t('automations.view.runsUnavailable') })
    }
  }, [automation.id, t])

  useEffect(() => { load() }, [load])

  if (state.status === 'loading') {
    return (
      <div className="z-subhead" style={{ padding: '24px 0', textAlign: 'center' }}>
        {t('automations.view.loadingRuns')}
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div style={{ padding: '20px 16px', borderRadius: 'var(--r-ctl)', background: 'color-mix(in srgb, var(--warn) 8%, var(--surface))', border: '0.5px solid var(--line)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <p className="z-subhead" style={{ color: 'var(--ink-2)', textAlign: 'center', margin: 0 }} dir="auto">{state.error}</p>
        <button onClick={load} className="z-btn-secondary">{t('common.retry')}</button>
      </div>
    )
  }

  if (state.runs.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', borderRadius: 'var(--r-card)', background: 'var(--surface-2)', border: '0.5px dashed var(--line)' }}>
        <p className="z-headline" style={{ margin: 0 }} dir="auto">{t('automations.view.noRunsYet')}</p>
        <p className="z-subhead" style={{ margin: '4px 0 0' }} dir="auto">{t('automations.view.noRunsHint')}</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="z-eyebrow" style={{ margin: 0 }}>{t('automations.view.recentRuns', { n: state.runs.length })}</p>
        <button onClick={load} style={{
          background: 'transparent', border: 'none', cursor: 'pointer', minHeight: 44, padding: '0 8px', margin: '0 -8px',
          fontSize: 15, fontWeight: 500, color: 'var(--ink-mute)', display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: 'inherit',
        }}>
          <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
          {t('common.refresh')}
        </button>
      </div>
      {state.runs.map((run, i) => (
        <RunRow
          key={run.run_id || i}
          run={run}
          index={state.runs.length - i}
          automationId={automation.id}
          isOpen={openRunId === run.run_id}
          onToggle={() => setOpenRunId(openRunId === run.run_id ? null : run.run_id)}
          t={t}
        />
      ))}
    </div>
  )
}

// ── Per-run row, expandable inline ──────────────────────────────────────────
function RunRow({ run, index, automationId, isOpen, onToggle, t }) {
  const palette = STATUS_PALETTE[run.status] || STATUS_PALETTE.stopped
  const when = formatRunTimestamp(run.started_at)
  const triggerLabel = friendlyTriggerLabel(run.trigger_label, t)
  return (
    <div style={{ borderRadius: 'var(--r-ctl)', border: '0.5px solid var(--line)', background: 'var(--surface)', overflow: 'hidden' }}>
      <button onClick={onToggle} aria-expanded={isOpen} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 12, minHeight: 56,
        padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer',
        fontFamily: 'inherit', textAlign: 'inherit', color: 'var(--ink)',
      }}>
        <span className="z-dot" style={{ background: palette.dot }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="z-headline" style={{ margin: 0 }} dir="auto">
            {t('automations.view.runNumber', { n: index })}
            {when && <span className="z-mono" style={{ color: 'var(--ink-mute)', fontWeight: 400 }}> · {when}</span>}
          </p>
          <p className="z-subhead" style={{ margin: '2px 0 0' }} dir="auto">
            <span style={{ color: palette.text, fontWeight: 600 }}>{t(palette.label)}</span>
            {triggerLabel && <span> · {t('automations.view.triggeredBy', { source: triggerLabel })}</span>}
          </p>
        </div>
        <ChevronDown size={18} strokeWidth={1.75} aria-hidden="true"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform var(--dur-state) var(--ease-standard)', color: 'var(--ink-faint)', flexShrink: 0 }} />
      </button>
      {isOpen && <RunDetail automationId={automationId} runId={run.run_id} t={t} />}
    </div>
  )
}

// ── Inline run detail — step timeline ────────────────────────────────────────
function RunDetail({ automationId, runId, t }) {
  const [state, setState] = useState({ status: 'loading', steps: [], error: null })

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const r = await getAutomationTraceDetail(automationId, runId)
        if (cancelled) return
        if (r && r.ok) {
          setState({ status: 'ready', steps: r.steps || [], error: null })
        } else {
          setState({ status: 'error', steps: [], error: (r && r.error) || t('automations.view.runDetailUnavailable') })
        }
      } catch (e) {
        if (cancelled) return
        // get() throws on non-2xx; surface a friendly message.
        const msg = (e && e.message) || ''
        const friendly = msg.includes('404')
          ? t('automations.view.runGone')
          : t('automations.view.runDetailUnavailable')
        setState({ status: 'error', steps: [], error: friendly })
      }
    }
    load()
    return () => { cancelled = true }
  }, [automationId, runId, t])

  const note = (text, extra) => (
    <div className="z-subhead" style={{ padding: '12px 16px', borderTop: '0.5px solid var(--line)', ...extra }} dir="auto">{text}</div>
  )
  if (state.status === 'loading') return note(t('automations.view.loadingRunDetail'), { textAlign: 'center' })
  if (state.status === 'error')   return note(state.error)
  if (state.steps.length === 0)   return note(t('automations.view.noStepDetails'))

  return (
    <div style={{ padding: '8px 16px 12px', borderTop: '0.5px solid var(--line)', background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {state.steps.map((step, i) => (
        <StepRow key={step.path || i} step={step} t={t} />
      ))}
    </div>
  )
}

function StepRow({ step, t }) {
  const isCondition = step.kind === 'condition'
  // Colour: ok = passed, err = failed, neutral = trigger / plain step.
  let dot, text, Icon
  if (step.passed === false || step.error) {
    dot = 'var(--err)'; text = 'var(--err-text)'; Icon = X
  } else if (step.passed === true && isCondition) {
    dot = 'var(--ok)'; text = 'var(--ok-text)'; Icon = Check
  } else {
    dot = 'var(--ink-faint)'; text = 'var(--ink-mute)'; Icon = step.kind === 'trigger' ? Zap : ArrowRight
  }

  const kindLabelKey = {
    trigger:   'automations.view.stepKindTrigger',
    condition: 'automations.view.stepKindCondition',
    action:    'automations.view.stepKindStep',
  }[step.kind] || 'automations.view.stepKindStep'

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 0' }}>
      <span aria-hidden="true" style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 1,
        background: `color-mix(in srgb, ${dot} 14%, transparent)`, color: text,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}><Icon size={12} strokeWidth={2.25} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="z-subhead" style={{ margin: 0, color: 'var(--ink-2)' }} dir="auto">
          <span style={{ fontWeight: 600 }}>{t(kindLabelKey)}:</span> {step.label}
          {step.passed === false && !step.error && (
            <span style={{ color: 'var(--warn-text)', marginInlineStart: 8 }} dir="auto">— {t('automations.view.stepConditionFailed')}</span>
          )}
        </p>
        {step.error && (
          <p className="z-footnote" style={{ color: 'var(--err-text)', margin: '2px 0 0', wordBreak: 'break-word' }} dir="auto">{step.error}</p>
        )}
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// "14:32" if today, "Mon 14:32" if this week, "Jun 23 14:32" otherwise.
// Returns null when missing so the caller can omit the dot separator.
function formatRunTimestamp(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (sameDay) return `${hh}:${mm}`
  const dayMs = 24 * 60 * 60 * 1000
  if (now.getTime() - d.getTime() < 7 * dayMs) {
    return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${hh}:${mm}`
  }
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${hh}:${mm}`
}

// Strip bridge-internal phrasing from the trigger label. The bridge returns
// strings like "state of binary_sensor.bedroom_motion" — the user must never
// see "binary_sensor.bedroom_motion", so we collapse such cases to a friendly
// fallback. When we can show a clean phrase we do.
function friendlyTriggerLabel(raw, t) {
  if (!raw) return ''
  const s = String(raw).trim()
  if (!s || s.toLowerCase() === 'manual') return t('automations.view.triggerManual')
  // Anything that looks like a domain.entity_id leak ⇒ generic label.
  if (/[a-z]+\.[a-z0-9_]+/.test(s)) return t('automations.view.triggerSensor')
  return s
}

export default AutomationViewModal
