import React from 'react'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { EntitySelect } from '../../ui/EntitySelect'
import { useT } from '../../../lib/i18n'
import { useDeviceStore } from '../../../stores/deviceStore'
import {
  getTriggerTypes, getTrackerTriggerStates,
  getBinarySensorTriggerStates, getDefaultBinaryTrigger,
} from '../../../lib/automations/types'
import ZoneTriggerEditor from './ZoneTriggerEditor'
import { FieldHint } from './Atoms'

// ── TriggerEditor ─────────────────────────────────────────────────────────────
function TriggerEditor({ trigger, onChange }) {
  const t = useT()
  const { entities } = useDeviceStore()
  // `numeric_state` is presented to the user as a sensor-aware variant of "Device
  // State" — same picker, but the controls swap to above/below + threshold when
  // a numeric sensor is selected.
  const effectiveType = trigger.type || 'time'
  const uiType = (effectiveType === 'numeric_state') ? 'state' : effectiveType
  const triggerDomain = trigger.entity_id?.split('.')?.[0] || null
  const triggerEntity = trigger.entity_id ? entities.find(e => e.entity_id === trigger.entity_id) : null
  const isTracker     = triggerDomain === 'person' || triggerDomain === 'device_tracker'
  const isNumericSensor = triggerDomain === 'sensor'
  const BINARY_SENSOR_TRIGGER_STATES = getBinarySensorTriggerStates()
  const DEFAULT_BINARY_TRIGGER = getDefaultBinaryTrigger()
  const stateOptions  = isTracker
    ? getTrackerTriggerStates()
    : (triggerDomain === 'binary_sensor' && triggerEntity?.device_class)
      ? (BINARY_SENSOR_TRIGGER_STATES[triggerEntity.device_class] || DEFAULT_BINARY_TRIGGER)
      : DEFAULT_BINARY_TRIGGER
  const unitHint = triggerEntity?.unit_of_measurement || ''

  const handleTypeChange = e => {
    const next = e.target.value
    // Reset to clean defaults when switching type
    if (next === 'zone')    onChange({ type: 'zone',    entity_id: '', zone: 'zone.home', event: 'enter' })
    else if (next === 'state')   onChange({ type: 'state',   entity_id: '', state: 'on' })
    else if (next === 'time')    onChange({ type: 'time',    time: '' })
    else if (next === 'webhook') onChange({ type: 'webhook', webhook_id: '' })
    else if (next === 'manual')  onChange({ type: 'manual' })
    else                         onChange({ ...trigger, type: next })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Select label={t('automations.triggerType')} options={getTriggerTypes()} value={uiType} onChange={handleTypeChange} />

      {uiType === 'time' && (
        <Input
          label={t('automations.editor.timeLabel')}
          type="time"
          // HA stores time as "HH:MM:SS"; <input type="time"> needs "HH:MM".
          // Slice defensively so edit-existing always shows the value.
          value={(trigger.time || '').slice(0, 5)}
          onChange={e => onChange({ ...trigger, type: 'time', time: e.target.value })}
        />
      )}

      {uiType === 'state' && (
        <>
          <EntitySelect
            label={t('automations.editor.entity')}
            value={trigger.entity_id || ''}
            onChange={v => {
              const dom = v?.split('.')?.[0]
              const isT = dom === 'person' || dom === 'device_tracker'
              const isN = dom === 'sensor'
              if (isN) {
                // Numeric sensor → switch to numeric_state with above threshold
                onChange({ type: 'numeric_state', entity_id: v, above: '', below: undefined })
              } else {
                onChange({ type: 'state', entity_id: v, state: isT ? 'home' : 'on', for_minutes: undefined, above: undefined, below: undefined })
              }
            }}
          />
          {trigger.entity_id && isNumericSensor && (
            <>
              <Select
                label={t('automations.editor.triggerWhen')}
                options={[
                  { value: 'above', label: t('automations.editor.risesAboveOpt') },
                  { value: 'below', label: t('automations.editor.dropsBelowOpt') },
                ]}
                value={trigger.below !== undefined && trigger.below !== '' && (trigger.above === undefined || trigger.above === '') ? 'below' : 'above'}
                onChange={e => {
                  // Switch operator: keep the existing numeric value but move
                  // it to the chosen side of the threshold.
                  const op = e.target.value
                  const v = trigger.above ?? trigger.below ?? ''
                  if (op === 'above') onChange({ type: 'numeric_state', entity_id: trigger.entity_id, above: v, below: undefined })
                  else                onChange({ type: 'numeric_state', entity_id: trigger.entity_id, above: undefined, below: v })
                }}
              />
              <Input
                label={unitHint ? t('automations.editor.thresholdUnit', { unit: unitHint }) : t('automations.editor.threshold')}
                type="number"
                placeholder={t('automations.editor.placeholderThreshold')}
                value={trigger.above ?? trigger.below ?? ''}
                onChange={e => {
                  const v = e.target.value === '' ? '' : Number(e.target.value)
                  const usingBelow = trigger.below !== undefined && trigger.below !== '' && (trigger.above === undefined || trigger.above === '')
                  if (usingBelow) onChange({ type: 'numeric_state', entity_id: trigger.entity_id, above: undefined, below: v })
                  else            onChange({ type: 'numeric_state', entity_id: trigger.entity_id, above: v, below: undefined })
                }}
              />
              <FieldHint>{t('automations.editor.thresholdHint')}</FieldHint>
            </>
          )}
          {trigger.entity_id && !isNumericSensor && (
            <>
              <Select
                label={isTracker ? t('automations.editor.stateWhen') : t('automations.editor.newState')}
                options={stateOptions}
                value={trigger.state || (isTracker ? 'home' : 'on')}
                onChange={e => onChange({ ...trigger, type: 'state', state: e.target.value })}
              />
              <Input
                label={t('automations.editor.stayForLabel')}
                type="number"
                placeholder={t('automations.editor.stayForPh')}
                value={trigger.for_minutes || ''}
                onChange={e => {
                  const v = e.target.value
                  onChange({ ...trigger, for_minutes: v ? parseInt(v) : undefined })
                }}
              />
            </>
          )}
        </>
      )}

      {uiType === 'zone' && (
        <ZoneTriggerEditor trigger={trigger} onChange={onChange} />
      )}

      {(uiType === 'sunrise' || uiType === 'sunset') && (
        <>
          <Input label={t('automations.editor.offsetLabel')} placeholder={t('automations.editor.offsetPh')} value={trigger.offset || ''} onChange={e => onChange({ ...trigger, offset: e.target.value })} />
          <FieldHint>
            {uiType === 'sunrise' ? t('automations.editor.offsetHintSunrise') : t('automations.editor.offsetHintSunset')}
          </FieldHint>
        </>
      )}

      {uiType === 'webhook' && (
        <>
          <Input label={t('automations.editor.webhookId')} placeholder={t('automations.editor.webhookPh')} value={trigger.webhook_id || ''} onChange={e => onChange({ ...trigger, webhook_id: e.target.value })} dir="auto" />
          <FieldHint>
            {t('automations.editor.webhookHint')}
          </FieldHint>
        </>
      )}

      {uiType === 'manual' && (
        <div style={{
          padding: '10px 12px', borderRadius: 10,
          background: `color-mix(in srgb, var(--info) 6%, var(--surface))`,
          border: `0.5px solid color-mix(in srgb, var(--info) 25%, var(--line))`,
        }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--info)', marginBottom: 4 }}>
            {t('automations.editor.manualTitle')}
          </p>
          <p style={{ fontSize: 11, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
            {t('automations.editor.manualBody')}
          </p>
        </div>
      )}
    </div>
  )
}

export default TriggerEditor
