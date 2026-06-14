import React from 'react'
import { useT, useTranslatedName } from '../../lib/i18n'
import { getTriggerTypes, getActionTypes } from '../../lib/automations/types'
import { triggerSummary, actionSummary, conditionSummary, formatRelativeTime, ACTION_TYPE_ICON } from '../../lib/automations/summaries'
import { AndConnector } from './wizard/Atoms'
import { isCompleteCondition } from './wizard/ActionRow'

// ── AutomationViewModal ───────────────────────────────────────────────────────
function AutomationViewModal({ automation, roomNameMap, onEdit, onTrigger, onClose }) {
  const t = useT()
  const automationName = useTranslatedName(automation?.name)
  const automationDesc = useTranslatedName(automation?.description)
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

export default AutomationViewModal
