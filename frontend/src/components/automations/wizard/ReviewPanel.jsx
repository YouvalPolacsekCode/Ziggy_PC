import React from 'react'
import { Search } from 'lucide-react'
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ padding: 12, borderRadius: 'var(--r-ctl)', background: 'var(--surface-2)', border: '0.5px solid var(--line)' }}>
        <p className="z-headline" style={{ margin: 0 }} dir="auto">{name || t('automations.wizard.noName')}</p>
        {description && <p className="z-subhead" style={{ margin: '2px 0 0' }} dir="auto">{description}</p>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <span className="z-chip">{triggerLabel}</span>
          <span className="z-subhead">{triggerSummary(trigger)}</span>
        </div>
      </div>
      {completeConditions.length > 0 && (
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.summary.conditionsCount', { n: completeConditions.length })}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {completeConditions.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 40, padding: '8px 16px', borderRadius: 'var(--r-ctl)', border: '0.5px solid var(--line)', background: 'var(--surface)' }}>
                <Search size={18} strokeWidth={1.75} aria-hidden="true" style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
                <span className="z-subhead" style={{ color: 'var(--ink-2)' }}>{conditionSummary(c)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {actions.length === 0 ? (
        <p className="z-subhead" style={{ textAlign: 'center', padding: '12px 0', margin: 0 }}>{t('automations.action.noActions')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p className="z-eyebrow" style={{ margin: 0 }}>{t(actions.length === 1 ? 'automations.action.actionsHeadingOne' : 'automations.action.actionsHeading', { n: actions.length })}</p>
          {actions.map((a, i) => (
            <div key={a._key || i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minHeight: 48, padding: '12px 16px', borderRadius: 'var(--r-ctl)', border: '0.5px solid var(--line)', background: 'var(--surface)' }}>
              <span className="z-caption z-mono" style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, background: 'var(--surface-2)', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>{i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <p className="z-headline" style={{ margin: 0 }}>{actionTypes.find(at => at.value === a.type)?.label || a.type}</p>
                <p className="z-subhead" style={{ margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{actionSummary(a)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ReviewPanel
