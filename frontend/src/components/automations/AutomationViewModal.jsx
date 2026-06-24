import React, { useState, useEffect, useCallback } from 'react'
import { useT, useTranslatedName } from '../../lib/i18n'
import { getTriggerTypes, getActionTypes } from '../../lib/automations/types'
import { triggerSummary, actionSummary, conditionSummary, formatRelativeTime, ACTION_TYPE_ICON } from '../../lib/automations/summaries'
import { AndConnector } from './wizard/Atoms'
import { isCompleteCondition } from './wizard/ActionRow'
import { getAutomationTraces, getAutomationTraceDetail } from '../../lib/api'

// ── AutomationViewModal ───────────────────────────────────────────────────────
// Two tabs:
//   • Details — what the automation does (trigger / conditions / steps / rooms)
//   • History — most recent runs, click to inspect step-by-step outcomes
// History is lazy-fetched on first tab activation. Each run's pill color reflects
// outcome; opening a run expands its timeline inline (no extra modal hop).
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header — name, description, state pill row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: automation.enabled ? `color-mix(in srgb, var(--info) 12%, var(--surface))` : 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={automation.enabled ? 'var(--info)' : 'var(--ink-faint)'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 15 }} dir="auto">{automationName}</p>
          {automation.description && <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }} dir="auto">{automationDesc}</p>}
        </div>
      </div>

      {/* Tab switcher — matches the Actions-page segmented pill style. */}
      <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--surface-2)', borderRadius: 11 }}>
        {[
          { id: 'details', label: t('automations.view.tabDetails') },
          { id: 'history', label: t('automations.view.tabHistory') },
        ].map(tabDef => (
          <button key={tabDef.id} onClick={() => setTab(tabDef.id)} style={{
            flex: 1, padding: '7px 0', borderRadius: 9, fontFamily: 'inherit', cursor: 'pointer',
            background: tab === tabDef.id ? 'var(--surface)' : 'transparent',
            border: 'none', fontSize: 12, fontWeight: 600,
            color: tab === tabDef.id ? 'var(--ink)' : 'var(--ink-mute)',
            boxShadow: tab === tabDef.id ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
            transition: 'background 0.15s',
          }}>
            {tabDef.label}
          </button>
        ))}
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
        <div style={{ display: 'flex', gap: 8, paddingTop: 4, borderTop: '0.5px solid var(--line)', marginTop: 2 }}>
          {onTrigger && (
            <button onClick={() => { onTrigger(automation.id); onClose?.() }} className="z-btn-secondary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Trigger */}
      <div style={{ padding: '12px 14px', borderRadius: 11, background: 'var(--bg-2)', border: '0.5px solid var(--line)' }}>
        <p className="z-eyebrow" style={{ marginBottom: 6 }}>{t('automations.triggerLabel')}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: `color-mix(in srgb, var(--info) 12%, transparent)`, color: 'var(--info)', fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace' }}>
            {triggerTypeLabel}
          </span>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{triggerSummary(automation.trigger)}</span>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: '0.5px solid var(--line)', background: 'var(--surface)' }}>
                  <span style={{ fontSize: 13, flexShrink: 0 }}>🔍</span>
                  <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{conditionSummary(c)}</span>
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
          ? <p style={{ fontSize: 13, color: 'var(--ink-faint)', fontStyle: 'italic' }}>{t('automations.view.noSteps')}</p>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {actions.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--line)', background: 'var(--surface)' }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: `color-mix(in srgb, var(--info) 12%, transparent)`, color: 'var(--info)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: '"IBM Plex Mono", monospace' }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                      {ACTION_TYPE_ICON[a.type] || '•'} {actionTypes.find(at => at.value === a.type)?.label || a.type}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2, fontFamily: '"IBM Plex Mono", monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{actionSummary(a)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* Rooms */}
      {(automation.rooms || []).length > 0 && (
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 6 }}>{t('automations.view.rooms')}</p>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {automation.rooms.map(r => (
              <span key={r} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: `color-mix(in srgb, var(--info) 10%, var(--surface))`, color: 'var(--info)', border: '0.5px solid var(--line)' }}>
                {roomNameMap?.[r] || r.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Status footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace', background: `color-mix(in srgb, ${automation.enabled ? 'var(--ok)' : 'var(--ink-mute)'} 12%, transparent)`, color: automation.enabled ? 'var(--ok)' : 'var(--ink-mute)' }}>
          {automation.enabled ? t('automations.view.enabled') : t('automations.view.disabled')}
        </span>
        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace', background: 'var(--bg-2)', color: 'var(--ink-faint)' }}>
          {automation.source === 'ziggy' ? t('automations.view.localScheduler') : t('automations.view.haTriggered')}
        </span>
        <span style={{ fontSize: 11, color: 'var(--ink-faint)', marginLeft: 'auto', fontFamily: '"IBM Plex Mono", monospace' }}>
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
  success: { fg: 'var(--ok)',         label: 'automations.view.statusSuccess' },
  stopped: { fg: 'var(--warn)',       label: 'automations.view.statusStopped' },
  failed:  { fg: 'var(--danger)',     label: 'automations.view.statusFailed'  },
  running: { fg: 'var(--info)',       label: 'automations.view.statusRunning' },
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
      <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--ink-faint)', fontSize: 13 }}>
        {t('automations.view.loadingRuns')}
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div style={{ padding: '20px 16px', borderRadius: 11, background: `color-mix(in srgb, var(--warn) 8%, var(--surface))`, border: '0.5px solid var(--line)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', textAlign: 'center' }} dir="auto">{state.error}</p>
        <button onClick={load} className="z-btn-secondary" style={{ fontSize: 12 }}>{t('common.retry')}</button>
      </div>
    )
  }

  if (state.runs.length === 0) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', borderRadius: 11, background: 'var(--bg-2)', border: '0.5px dashed var(--line)' }}>
        <p style={{ fontSize: 28, marginBottom: 8 }}>⌛</p>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 600 }} dir="auto">{t('automations.view.noRunsYet')}</p>
        <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 4 }} dir="auto">{t('automations.view.noRunsHint')}</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
        <p className="z-eyebrow">{t('automations.view.recentRuns', { n: state.runs.length })}</p>
        <button onClick={load} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontSize: 11, color: 'var(--ink-faint)', display: 'flex', alignItems: 'center', gap: 4,
          fontFamily: 'inherit',
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
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
    <div style={{ borderRadius: 10, border: '0.5px solid var(--line)', background: 'var(--surface)', overflow: 'hidden' }}>
      <button onClick={onToggle} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer',
        fontFamily: 'inherit', textAlign: 'inherit',
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', background: palette.fg, flexShrink: 0,
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }} dir="auto">
            {t('automations.view.runNumber', { n: index })}
            {when && <span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}> · {when}</span>}
          </p>
          <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }} dir="auto">
            <span style={{ color: palette.fg, fontWeight: 600 }}>{t(palette.label)}</span>
            {triggerLabel && <span style={{ color: 'var(--ink-faint)' }}> · {t('automations.view.triggeredBy', { source: triggerLabel })}</span>}
          </p>
        </div>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s', color: 'var(--ink-faint)', flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
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

  if (state.status === 'loading') {
    return (
      <div style={{ padding: '12px 14px', borderTop: '0.5px solid var(--line)', fontSize: 12, color: 'var(--ink-faint)', textAlign: 'center' }}>
        {t('automations.view.loadingRunDetail')}
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div style={{ padding: '12px 14px', borderTop: '0.5px solid var(--line)', fontSize: 12, color: 'var(--ink-mute)' }} dir="auto">
        {state.error}
      </div>
    )
  }
  if (state.steps.length === 0) {
    return (
      <div style={{ padding: '12px 14px', borderTop: '0.5px solid var(--line)', fontSize: 12, color: 'var(--ink-faint)', fontStyle: 'italic' }} dir="auto">
        {t('automations.view.noStepDetails')}
      </div>
    )
  }

  return (
    <div style={{ padding: '8px 12px 10px', borderTop: '0.5px solid var(--line)', background: 'var(--bg-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {state.steps.map((step, i) => (
        <StepRow key={step.path || i} step={step} t={t} />
      ))}
    </div>
  )
}

function StepRow({ step, t }) {
  const isCondition = step.kind === 'condition'
  // Color: green = passed, red = failed, gray = neutral/trigger.
  let color, icon
  if (step.passed === false || step.error) {
    color = 'var(--danger)'
    icon = '✕'
  } else if (step.passed === true && isCondition) {
    color = 'var(--ok)'
    icon = '✓'
  } else {
    color = 'var(--ink-faint)'
    icon = step.kind === 'trigger' ? '⚡' : '→'
  }

  const kindLabelKey = {
    trigger:   'automations.view.stepKindTrigger',
    condition: 'automations.view.stepKindCondition',
    action:    'automations.view.stepKindStep',
  }[step.kind] || 'automations.view.stepKindStep'

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 4px' }}>
      <span style={{
        width: 18, height: 18, borderRadius: '50%',
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color, fontSize: 10, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 11, color: 'var(--ink-2)' }} dir="auto">
          <span style={{ fontWeight: 600 }}>{t(kindLabelKey)}:</span> {step.label}
          {step.passed === false && !step.error && (
            <span style={{ color: 'var(--warn)', marginLeft: 6 }} dir="auto">— {t('automations.view.stepConditionFailed')}</span>
          )}
        </p>
        {step.error && (
          <p style={{ fontSize: 10, color: 'var(--danger)', marginTop: 2, wordBreak: 'break-word' }} dir="auto">{step.error}</p>
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
