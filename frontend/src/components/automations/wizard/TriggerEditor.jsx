import React, { useState } from 'react'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { EntitySelect } from '../../ui/EntitySelect'
import { Modal } from '../../ui/Modal'
import { useT } from '../../../lib/i18n'
import { useDeviceStore } from '../../../stores/deviceStore'
import {
  getTriggerTypes, getTrackerTriggerStates,
  getBinarySensorTriggerStates, getDefaultBinaryTrigger,
  getTimePatternUnits,
} from '../../../lib/automations/types'
import ZoneTriggerEditor from './ZoneTriggerEditor'
import OccupancySensorForm from '../OccupancySensorForm'
import { FieldHint } from './Atoms'

// binary_sensor device_classes that represent room presence.
const PRESENCE_CLASSES = ['occupancy', 'presence']

// ── TriggerEditor ─────────────────────────────────────────────────────────────
function TriggerEditor({ trigger, onChange }) {
  const t = useT()
  const entities = useDeviceStore(s => s.entities)
  const rooms    = useDeviceStore(s => s.rooms)
  // Local modal for spawning a presence sensor from the occupancy trigger when
  // the chosen room has none yet.
  const [showSensorForm, setShowSensorForm] = useState(false)
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
    // Periodic — default to "every 15 minutes" (HA time_pattern "/15").
    else if (next === 'time_pattern') onChange({ type: 'time_pattern', minutes: '/15' })
    // Occupancy — friendly wrapper resolved to a state trigger on save.
    // Israeli default: turn off after 5 minutes of no motion (state 'off').
    else if (next === 'occupancy') onChange({ type: 'occupancy', room: '', entity_id: '', state: 'on', for_minutes: undefined })
    else                         onChange({ ...trigger, type: next })
  }

  // ── time_pattern helpers ──────────────────────────────────────────────────
  const tpUnit = ['minutes', 'hours', 'seconds'].find(u => trigger[u] != null && trigger[u] !== '') || 'minutes'
  const tpNum  = String(trigger[tpUnit] ?? '/15').replace(/^\//, '')
  const setTimePattern = (num, unit) => {
    // Always emit the cron-style "/N" form (= "every N units"); clear the
    // other two units so exactly one interval is active.
    onChange({ type: 'time_pattern', [unit]: `/${num || 1}` })
  }

  // ── occupancy helpers ─────────────────────────────────────────────────────
  const occRoomArea = (rooms || []).find(a => a.id === trigger.room)
  const occSensor = occRoomArea
    ? entities.find(e => (occRoomArea.entities || []).includes(e.entity_id)
        && e.domain === 'binary_sensor' && PRESENCE_CLASSES.includes(e.device_class))
    : null
  const occRoomOptions = (rooms || []).filter(a => (a.entities || []).some(eid => {
    const e = entities.find(x => x.entity_id === eid)
    return e && e.domain === 'binary_sensor' && ['motion', ...PRESENCE_CLASSES, 'door', 'opening'].includes(e.device_class)
  }))
  const selectOccRoom = (roomId) => {
    const area = (rooms || []).find(a => a.id === roomId)
    const sensor = area
      ? entities.find(e => (area.entities || []).includes(e.entity_id)
          && e.domain === 'binary_sensor' && PRESENCE_CLASSES.includes(e.device_class))
      : null
    onChange({ ...trigger, type: 'occupancy', room: roomId, entity_id: sensor?.entity_id || '' })
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
                // Ziggy voice: a motion sensor going quiet reads as "no motion",
                // so we reword the "hold for" field for that case.
                label={(triggerDomain === 'binary_sensor'
                        && ['motion', ...PRESENCE_CLASSES].includes(triggerEntity?.device_class)
                        && trigger.state === 'off')
                  ? t('automations.editor.occForLabel')
                  : t('automations.editor.stayForLabel')}
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

      {uiType === 'time_pattern' && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <Input
                label={t('automations.editor.everyLabel')}
                type="number"
                min={1}
                value={tpNum}
                onChange={e => setTimePattern(e.target.value.replace(/\D/g, ''), tpUnit)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Select
                label=" "
                options={getTimePatternUnits()}
                value={tpUnit}
                onChange={e => setTimePattern(tpNum, e.target.value)}
              />
            </div>
          </div>
          <FieldHint>{t('automations.editor.timePatternHint')}</FieldHint>
        </>
      )}

      {uiType === 'occupancy' && (
        <>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }} dir="auto">
              {t('automations.editor.occRoom')}
            </label>
            {occRoomOptions.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: 0 }} dir="auto">
                {t('automations.smartSensor.noneFound')}
              </p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {occRoomOptions.map(r => {
                  const sel = r.id === trigger.room
                  return (
                    <button key={r.id} type="button" onClick={() => selectOccRoom(r.id)} style={{
                      padding: '4px 11px', borderRadius: 999, fontSize: 12, fontWeight: 500,
                      background: sel ? 'var(--ink)' : 'var(--surface)',
                      color: sel ? 'var(--bg)' : 'var(--ink-mute)',
                      border: sel ? 'none' : '0.5px solid var(--line)',
                      cursor: 'pointer', fontFamily: 'inherit',
                    }} dir="auto">{r.name}</button>
                  )
                })}
              </div>
            )}
          </div>

          {trigger.room && !occSensor && (
            <div style={{
              padding: '10px 12px', borderRadius: 10,
              background: `color-mix(in srgb, var(--warn) 6%, var(--surface))`,
              border: `0.5px solid color-mix(in srgb, var(--warn) 30%, var(--line))`,
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              <p style={{ fontSize: 11.5, color: 'var(--ink-mute)', margin: 0, lineHeight: 1.45 }} dir="auto">
                {t('automations.editor.occNoSensor')}
              </p>
              <button type="button" onClick={() => setShowSensorForm(true)} className="z-btn-secondary" style={{ fontSize: 12, padding: '6px 12px', borderRadius: 9, alignSelf: 'flex-start' }}>
                {t('automations.editor.occCreate')}
              </button>
            </div>
          )}

          {trigger.room && occSensor && (
            <FieldHint>{t('automations.editor.occHasSensor')}</FieldHint>
          )}

          <Select
            label={t('automations.editor.occWhen')}
            options={[
              { value: 'on',  label: t('automations.editor.occOccupied') },
              { value: 'off', label: t('automations.editor.occEmpty') },
            ]}
            value={trigger.state === 'off' ? 'off' : 'on'}
            onChange={e => {
              const st = e.target.value
              // Israeli default: 5 minutes of no motion before "empty" fires.
              onChange({ ...trigger, state: st, for_minutes: st === 'off' ? (trigger.for_minutes || 5) : undefined })
            }}
          />

          {trigger.state === 'off' && (
            <Input
              label={t('automations.editor.occForLabel')}
              type="number"
              min={0}
              placeholder={t('automations.editor.occForPh')}
              value={trigger.for_minutes ?? ''}
              onChange={e => {
                const v = e.target.value
                onChange({ ...trigger, for_minutes: v ? parseInt(v) : undefined })
              }}
            />
          )}
        </>
      )}

      <Modal open={showSensorForm} onClose={() => setShowSensorForm(false)} title={t('automations.smartSensor.title')}>
        <OccupancySensorForm
          initialRoom={trigger.room}
          onCreated={(res) => {
            const newId = res?.data?.entity_id
            if (newId) onChange({ ...trigger, type: 'occupancy', entity_id: newId })
          }}
          onClose={() => setShowSensorForm(false)}
        />
      </Modal>
    </div>
  )
}

export default TriggerEditor
