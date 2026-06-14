import React from 'react'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { EntitySelect } from '../../ui/EntitySelect'
import { useT } from '../../../lib/i18n'
import { useDeviceStore } from '../../../stores/deviceStore'
import {
  getBinarySensorConditionStates, getDefaultBinaryCondition,
  getConditionTypes, getControllableConditionStates,
} from '../../../lib/automations/types'
import { FieldHint } from './Atoms'

// ── ConditionRow ──────────────────────────────────────────────────────────────
// Visually aligned with TriggerEditor (plain controls, no warn tint) so steps 2
// and 3 of the wizard feel like the same form. A small AND chip is drawn above
// each condition (except the first) to make "all of these must be true" explicit.
function ConditionRow({ condition, onChange, onRemove }) {
  const t = useT()
  const { entities } = useDeviceStore()
  const condType    = condition.type || 'entity'
  const domain      = condition.entity_id?.split('.')?.[0] || null
  const entity      = condition.entity_id ? entities.find(e => e.entity_id === condition.entity_id) : null
  const deviceClass = entity?.device_class || null
  const isNumericSensor = domain === 'sensor'
  const isBinary    = domain === 'binary_sensor'
  const isTracker   = domain === 'person' || domain === 'device_tracker'
  // Controllable domains use a state dropdown (no operator), since "is not on"
  // is rarely what users want and adds noise.
  const controllableStates = getControllableConditionStates()[domain] || null
  const isSimpleControllable = !!controllableStates
  const unitHint = entity?.unit_of_measurement || ''
  const BINARY_SENSOR_CONDITION_STATES = getBinarySensorConditionStates()
  const DEFAULT_BINARY_CONDITION = getDefaultBinaryCondition()

  // For binary sensors / trackers we collapse operator+value into a single Select.
  // "Motion detected" / "No motion" already implies the operator, so showing
  // both is_not and on/off is redundant.
  const binaryStateOptions = isBinary
    ? (BINARY_SENSOR_CONDITION_STATES[deviceClass] || DEFAULT_BINARY_CONDITION)
    : []
  const trackerStateOptions = [
    { value: 'home',     label: t('automations.cond.isHome') },
    { value: 'not_home', label: t('automations.cond.isAway') },
  ]

  const sharedWrapper = (children) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p className="z-eyebrow">{t('automations.cond.title')}</p>
        <button onClick={onRemove} title={t('automations.cond.remove')} aria-label={t('automations.cond.remove')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 4 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
      <Select
        label={t('automations.cond.type')}
        options={getConditionTypes()}
        value={condType}
        onChange={e => {
          const next = e.target.value
          if (next === 'time') onChange({ type: 'time', after: '21:00', before: '07:00' })
          else onChange({ type: 'entity', entity_id: '', operator: 'is', value: 'on' })
        }}
      />
      {children}
    </div>
  )

  // ── Time window ───────────────────────────────────────────────────────────
  if (condType === 'time') {
    return sharedWrapper(
      <>
        <Input
          label={t('automations.cond.afterLabel')}
          type="time"
          value={(condition.after || '').slice(0, 5)}
          onChange={e => onChange({ ...condition, after: e.target.value })}
        />
        <Input
          label={t('automations.cond.beforeLabel')}
          type="time"
          value={(condition.before || '').slice(0, 5)}
          onChange={e => onChange({ ...condition, before: e.target.value })}
        />
        <FieldHint>{t('automations.cond.overnightHint')}</FieldHint>
      </>
    )
  }

  // ── Entity state ──────────────────────────────────────────────────────────
  return sharedWrapper(
    <>
      <EntitySelect
        label={t('automations.editor.entity')}
        value={condition.entity_id || ''}
        onChange={v => {
          const dom = v?.split('.')?.[0]
          const isT = dom === 'person' || dom === 'device_tracker'
          const isN = dom === 'sensor'
          onChange({
            ...condition,
            type: 'entity',
            entity_id: v,
            operator: isN ? 'above' : 'is',
            value: isT ? 'home' : (isN ? '' : 'on'),
          })
        }}
        placeholder={t('automations.cond.selectEntity')}
      />
      {condition.entity_id && (
        isNumericSensor ? (
          <>
            <Select
              options={[{ value: 'above', label: t('automations.cond.isAbove') }, { value: 'below', label: t('automations.cond.isBelow') }]}
              value={condition.operator || 'above'}
              onChange={e => onChange({ ...condition, operator: e.target.value })}
            />
            <Input
              label={unitHint ? t('automations.editor.thresholdUnit', { unit: unitHint }) : t('automations.editor.threshold')}
              type="number"
              placeholder={t('automations.editor.placeholderThreshold25')}
              value={condition.value ?? ''}
              onChange={e => onChange({ ...condition, value: e.target.value })}
            />
          </>
        ) : isBinary ? (
          // Binary sensors: a single Select that already implies is/is_not.
          // We always store operator: 'is' and let value carry the meaning.
          <Select
            label={t('automations.cond.stateLabel')}
            options={binaryStateOptions}
            value={condition.value || 'on'}
            onChange={e => onChange({ ...condition, operator: 'is', value: e.target.value })}
          />
        ) : isTracker ? (
          <Select
            label={t('automations.cond.stateLabel')}
            options={trackerStateOptions}
            value={condition.value || 'home'}
            onChange={e => onChange({ ...condition, operator: 'is', value: e.target.value })}
          />
        ) : isSimpleControllable ? (
          <>
            <Select
              options={[{ value: 'is', label: t('automations.cond.is') }, { value: 'is_not', label: t('automations.cond.isNot') }]}
              value={condition.operator || 'is'}
              onChange={e => onChange({ ...condition, operator: e.target.value })}
            />
            <Select
              label={t('automations.cond.stateLabel')}
              options={controllableStates}
              value={condition.value || controllableStates[0].value}
              onChange={e => onChange({ ...condition, value: e.target.value })}
            />
          </>
        ) : (
          // Fallback for unknown domains: free-form text value with operator.
          <>
            <Select
              options={[{ value: 'is', label: t('automations.cond.is') }, { value: 'is_not', label: t('automations.cond.isNot') }]}
              value={condition.operator || 'is'}
              onChange={e => onChange({ ...condition, operator: e.target.value })}
            />
            <Input
              label={t('automations.cond.stateValueLabel')}
              placeholder={t('automations.cond.stateValuePh')}
              value={condition.value ?? ''}
              onChange={e => onChange({ ...condition, value: e.target.value })}
              dir="auto"
            />
          </>
        )
      )}
    </>
  )
}

export default ConditionRow
