import React from 'react'
import { Reorder, useDragControls } from 'framer-motion'
import { GripVertical, Trash2 } from 'lucide-react'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { EntitySelect, getActionsForDomain, getActionLabel } from '../../ui/EntitySelect'
import { useT } from '../../../lib/i18n'
import { useDeviceStore } from '../../../stores/deviceStore'
import { useFeature } from '../../../stores/featuresStore'
import { CONTROLLABLE_DOMAINS } from '../../../lib/domainRegistry'
import { getActionTypes, getModeOptions } from '../../../lib/automations/types'
import { actionSummary } from '../../../lib/automations/summaries'
import { incompleteConditions } from '../../../lib/automations/completeness'
import { FieldHint } from './Atoms'
import { cardIconBtn } from '../../../lib/automations/styles'
import { canHaveDuration, withDurationRule, splitSeconds, MAX_DURATION_MINUTES } from '../../../lib/automations/duration'
import IRDeviceSelect from '../../IRDeviceSelect'
import MediaPlayActionEditor from '../../media/MediaPlayActionEditor'
import SendIntentEditor from './SendIntentEditor'
import NeedsInputFields from './NeedsInputFields'
import MergedActionPicker from './MergedActionPicker'
import DeviceCommandEditor from './DeviceCommandEditor'
import FakeOccupancyEditor from './FakeOccupancyEditor'

function ActionRow({ action, index, onChange, onRemove, collapsed, onToggleCollapse, dragHandleProps }) {
  const t = useT()
  const mediaMusic = useFeature('media_music')
  const { entities } = useDeviceStore()
  const domain = action.entity_id?.split('.')?.[0] || null
  const availableActions = domain ? getActionsForDomain(domain) : [{ value: 'turn_on', label: t('automations.fallback.turnOn') }, { value: 'turn_off', label: t('automations.fallback.turnOff') }, { value: 'toggle', label: t('automations.fallback.toggle') }]
  const linkedIr = entities.find(e => e.entity_id === action.entity_id)?._linkedIr || null
  // Every device/service change goes through here, so a "for how long" never
  // survives onto a step that has no off (turn on → turn off).
  const setServiceAction = next => onChange(withDurationRule(next))

  // Neutral look matching the Trigger / Conditions steps — no info tint, plain
  // surface + hairline. The drag handle and the small numeric badge are kept
  // because reordering and "step N" labelling carry real meaning here. The
  // emoji type glyph is gone: the summary already names the step type.
  const dragHandle = (
    <span
      role="button" aria-label={t('automations.wizard.actionLabel', { n: index + 1 })}
      style={{ color: 'var(--ink-faint)', cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none', width: 40, height: 40, margin: '0 -12px', flexShrink: 0 }}
      onClick={e => e.stopPropagation()} {...dragHandleProps}
    >
      <GripVertical size={18} strokeWidth={1.75} aria-hidden="true" />
    </span>
  )
  const removeBtn = (
    <button type="button" onClick={e => { e.stopPropagation(); onRemove() }} aria-label={t('automations.removeStep')} title={t('automations.removeStep')} style={cardIconBtn('var(--err-text)')}>
      <Trash2 size={18} strokeWidth={1.75} />
    </button>
  )

  if (collapsed) {
    return (
      <div onClick={onToggleCollapse} style={{
        display: 'flex', alignItems: 'center', gap: 12, minHeight: 48,
        padding: '6px 16px', borderRadius: 'var(--r-ctl)',
        background: 'var(--surface)', border: '0.5px solid var(--line)',
        cursor: 'pointer',
      }}>
        {dragHandle}
        <span className="z-caption z-mono" style={{
          width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
          background: 'var(--surface-2)', color: 'var(--ink-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {index + 1}
        </span>
        <span className="z-subhead" style={{ flex: 1, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {actionSummary(action)}
        </span>
        {removeBtn}
      </div>
    )
  }

  return (
    <div style={{
      border: '0.5px solid var(--line)',
      borderRadius: 'var(--r-ctl)', padding: '8px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12,
      background: 'var(--surface)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          {dragHandle}
          <p className="z-eyebrow" style={{ margin: 0 }}>{t('automations.wizard.actionLabel', { n: index + 1 })}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, margin: '0 -12px 0 0' }}>
          <button type="button" onClick={onToggleCollapse} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--ink-mute)', fontFamily: 'inherit', minHeight: 40, padding: '0 12px', borderRadius: 'var(--r-ctl)' }}>{t('automations.wizard.collapse')}</button>
          {removeBtn}
        </div>
      </div>

      <Select options={getActionTypes({ mediaMusic })} value={action.type || 'call_service'} onChange={e => {
        const nextType = e.target.value
        // Seed sensible defaults for the few step types that have a dedicated
        // editor — otherwise the editor opens with empty fields and the user
        // has to remember every required param themselves.
        if (nextType === 'fake_occupancy_start') {
          onChange({ type: nextType, window_start: '19:00', window_end: '23:00', duration_days: 7, brightness_pct: 70, rooms: [], tv_ir_device_id: null })
        } else if (nextType === 'media_play') {
          onChange({ type: nextType, speaker_entity: '', service: 'spotify', profile: '', mode: 'playlist' })
        } else if (nextType === 'set_mode') {
          onChange({ type: nextType, mode: 'movie', on: true, hours: null })
        } else {
          onChange({ type: nextType, entity_id: '', service: '' })
        }
      }} />

      {action.type === 'ir_command' && <IRDeviceSelect value={action} onChange={patch => onChange({ ...action, ...patch })} />}

      {action.type === 'call_service' && (
        <>
          <EntitySelect value={action.entity_id || ''} onChange={v => setServiceAction({ ...action, entity_id: v, service: 'homeassistant.turn_on', service_value: 'turn_on', service_data: undefined })} placeholder={t('automations.action.selectEntity')} allowedDomains={CONTROLLABLE_DOMAINS} />
          {linkedIr && action.entity_id ? (
            <MergedActionPicker
              haActions={availableActions}
              irDevice={linkedIr}
              haValue={action.service_value || action.service?.split('.')[1] || 'turn_on'}
              onChangeHa={val => { const def = availableActions.find(a => a.value === val) || {}; setServiceAction({ ...action, service_value: val, service: `homeassistant.${def.haService || val}`, service_data: def.serviceData || undefined }) }}
              onPickIrCommand={cmd => onChange({ ...action, type: 'ir_command', ir_device_id: linkedIr.id, ir_device_name: linkedIr.name, ir_command: cmd, ir_sequence: undefined, service: undefined, service_value: undefined, service_data: undefined })}
            />
          ) : (
            <Select
              options={availableActions.map(a => ({ ...a, label: getActionLabel(a, t) }))}
              value={action.service_value || action.service?.split('.')[1] || 'turn_on'}
              onChange={e => { const sel = e.target.value; const def = availableActions.find(a => a.value === sel) || {}; setServiceAction({ ...action, service_value: sel, service: `homeassistant.${def.haService || sel}`, service_data: def.serviceData || undefined }) }}
            />
          )}
          {(() => {
            const selVal = action.service_value || action.service?.split('.')[1] || 'turn_on'
            const def = availableActions.find(a => a.value === selVal)
            return def?.needsInput ? (
              <NeedsInputFields fields={def.needsInput} entityId={action.entity_id} serviceData={action.service_data} onChangeServiceData={data => onChange({ ...action, service_data: data })} />
            ) : null
          })()}
          {/* "On for 20 minutes" — Ziggy turns it back off by itself. Only on a
              step that has an off; see lib/automations/duration.js. */}
          {canHaveDuration(action) && (
            <>
              <Input
                label={t('automations.action.forLabel')}
                type="number" min="1" max={MAX_DURATION_MINUTES} inputMode="numeric"
                placeholder={t('automations.action.forPh')}
                value={action.for_minutes ?? ''}
                onChange={e => {
                  const v = e.target.value
                  if (v === '') { const { for_minutes: _x, ...rest } = action; onChange(rest) }
                  else onChange({ ...action, for_minutes: Number(v) })
                }}
              />
              {Number(action.for_minutes) > 0 && <FieldHint>{t('automations.action.forHint')}</FieldHint>}
            </>
          )}
        </>
      )}

      {action.type === 'send_intent' && <SendIntentEditor value={action.text || ''} onChange={text => onChange({ ...action, text })} />}
      {action.type === 'delay' && (() => {
        // Minutes + seconds; stored as total seconds, as the hub always has.
        const { h, m, s } = splitSeconds(action.seconds)
        const mins = h * 60 + m
        const set = (nm, ns) => onChange({ ...action, seconds: Math.max(0, (nm || 0) * 60 + (ns || 0)) })
        return (
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Input label={t('automations.action.waitMinutesLabel')} type="number" min="0" inputMode="numeric"
                placeholder={t('automations.action.minutesPh')} value={action.seconds ? mins : ''}
                onChange={e => set(parseInt(e.target.value) || 0, s)} />
            </div>
            <div style={{ flex: 1 }}>
              <Input label={t('automations.action.waitSecondsLabel')} type="number" min="0" max="59" inputMode="numeric"
                placeholder={t('automations.action.secondsPh')} value={action.seconds ? s : ''}
                onChange={e => set(mins, Math.min(59, parseInt(e.target.value) || 0))} />
            </div>
          </div>
        )
      })()}
      {action.type === 'notify'      && <Input placeholder={t('automations.action.messagePh')} value={action.message || ''} onChange={e => onChange({ ...action, message: e.target.value })} dir="auto" />}
      {action.type === 'set_mode' && (
        <>
          <Select options={getModeOptions()} value={action.mode || 'movie'} onChange={e => onChange({ ...action, mode: e.target.value })} />
          <Select
            options={[{ value: 'on', label: t('automations.action.modeOn') }, { value: 'off', label: t('automations.action.modeOff') }]}
            value={action.on === false ? 'off' : 'on'}
            onChange={e => onChange({ ...action, on: e.target.value === 'on' })}
          />
          {action.on !== false && (
            <Input type="number" min="0.5" step="0.5" placeholder={t('automations.action.modeHoursPh')}
              value={action.hours ?? ''} onChange={e => onChange({ ...action, hours: e.target.value === '' ? null : parseFloat(e.target.value) })} />
          )}
        </>
      )}
      {action.type === 'device_command' && <DeviceCommandEditor value={action} onChange={patch => onChange({ ...action, ...patch })} />}
      {action.type === 'fake_occupancy_start' && <FakeOccupancyEditor action={action} onChange={patch => onChange(patch)} />}
      {action.type === 'media_play' && mediaMusic && <MediaPlayActionEditor action={action} onChange={onChange} />}

      {/* Say something out loud. The executor has had this since the routine
          engine landed; nothing in the wizard offered it. */}
      {action.type === 'speak' && (
        <Input
          placeholder={t('automations.action.speakPh')}
          value={action.text || ''}
          onChange={e => onChange({ ...action, text: e.target.value })}
          dir="auto"
        />
      )}

      {/* Everything off. No target to choose — that IS the action. */}
      {action.type === 'turn_off_everything' && (
        <FieldHint>{t('automations.action.turnOffEverythingHint')}</FieldHint>
      )}

      {/* Pause the rest of the steps until a device reaches a state, or the
          timeout runs out. Makes "open the blind, wait until it's open, then
          turn on the lamp" expressible. */}
      {action.type === 'wait_for_state' && (
        <>
          <EntitySelect
            label={t('automations.action.waitEntityLabel')}
            value={action.entity_id || ''}
            onChange={v => onChange({ ...action, entity_id: v })}
            placeholder={t('automations.action.waitEntityPh')}
          />
          <Input
            label={t('automations.action.waitStateLabel')}
            placeholder="on"
            value={action.state ?? 'on'}
            onChange={e => onChange({ ...action, state: e.target.value })}
            dir="ltr"
          />
          <Input
            label={t('automations.action.waitTimeoutLabel')}
            type="number"
            placeholder="600"
            value={action.timeout_seconds ?? ''}
            onChange={e => onChange({ ...action, timeout_seconds: parseInt(e.target.value) || undefined })}
          />
          <FieldHint>{t('automations.action.waitHint')}</FieldHint>
        </>
      )}
    </div>
  )
}

function DraggableActionRow({ action, index, onChange, onRemove, collapsed, onToggleCollapse }) {
  const controls = useDragControls()
  return (
    <Reorder.Item value={action} dragControls={controls} dragListener={false} style={{ listStyle: 'none' }}>
      <ActionRow action={action} index={index} onChange={onChange} onRemove={onRemove} collapsed={collapsed} onToggleCollapse={onToggleCollapse} dragHandleProps={{ onPointerDown: e => controls.start(e) }} />
    </Reorder.Item>
  )
}

// A condition is "complete enough" to surface in summaries when it carries a
// usable test — the SAME rule the wizard saves by (completeness.js). This used
// to accept only entity and time-window conditions, so mode / daylight /
// presence (and now weather) conditions were saved and enforced but silently
// missing from the review step and the automation viewer.
export function isCompleteCondition(c) {
  if (!c) return false
  return incompleteConditions([c]).length === 0
}

export { DraggableActionRow }
export default ActionRow
