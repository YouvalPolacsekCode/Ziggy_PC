import React from 'react'
import { useT } from '../../../lib/i18n'
import { getTriggerTypes, getActionTypes } from '../../../lib/automations/types'
import { triggerSummary, actionSummary, conditionSummary } from '../../../lib/automations/summaries'
import { isCompleteCondition } from './ActionRow'

// ── ReviewPanel ───────────────────────────────────────────────────────────────
function ReviewPanel({ name, description, trigger, conditions = [], actions }) {
  const t = useT()
  const completeConditions = conditions.filter(isCompleteCondition)
  const triggerType = trigger?.type || 'time'
  // numeric_state is presented as the "Device State" trigger family.
  const triggerLabel = getTriggerTypes().find(tt => tt.value === (triggerType === 'numeric_state' ? 'state' : triggerType))?.label
  const actionTypes = getActionTypes()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--bg-2)', border: '0.5px solid var(--line)' }}>
        <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 15, marginBottom: 4 }} dir="auto">{name || t('automations.wizard.noName')}</p>
        {description && <p style={{ fontSize: 13, color: 'var(--ink-mute)' }} dir="auto">{description}</p>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 999,
            background: `color-mix(in srgb, var(--info) 12%, transparent)`, color: 'var(--info)',
            fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace',
          }}>
            {triggerLabel}
          </span>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{triggerSummary(trigger)}</span>
        </div>
      </div>
      {completeConditions.length > 0 && (
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.summary.conditionsCount', { n: completeConditions.length })}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {completeConditions.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: `0.5px solid var(--line)`, background: 'var(--surface)' }}>
                <span style={{ fontSize: 13, flexShrink: 0 }}>🔍</span>
                <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{conditionSummary(c)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {actions.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--ink-faint)', textAlign: 'center', padding: '12px 0', fontStyle: 'italic' }}>{t('automations.action.noActions')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p className="z-eyebrow">{t(actions.length === 1 ? 'automations.action.actionsHeadingOne' : 'automations.action.actionsHeading', { n: actions.length })}</p>
          {actions.map((a, i) => (
            <div key={a._key || i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--line)', background: 'var(--surface)' }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1, background: `color-mix(in srgb, var(--info) 12%, transparent)`, color: 'var(--info)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"IBM Plex Mono", monospace' }}>{i + 1}</span>
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{actionTypes.find(at => at.value === a.type)?.label || a.type}</p>
                <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: '"IBM Plex Mono", monospace' }}>{actionSummary(a)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ReviewPanel
