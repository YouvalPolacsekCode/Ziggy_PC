import React from 'react'
import { Reorder, useDragControls } from 'framer-motion'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { EntitySelect, getActionsForDomain, getActionLabel } from '../../ui/EntitySelect'
import { useT } from '../../../lib/i18n'
import { useDeviceStore } from '../../../stores/deviceStore'
import { useFeature } from '../../../stores/featuresStore'
import { CONTROLLABLE_DOMAINS } from '../../../lib/domainRegistry'
import { getActionTypes } from '../../../lib/automations/types'
import { ACTION_TYPE_ICON, actionSummary } from '../../../lib/automations/summaries'
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

  // Neutral look matching the Trigger / Conditions steps — no info tint, plain
  // surface + hairline. The drag handle and the small numeric badge are kept
  // because reordering and "step N" labelling carry real meaning here.
  if (collapsed) {
    return (
      <div onClick={onToggleCollapse} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px', borderRadius: 10,
        background: 'var(--surface)', border: '0.5px solid var(--line)',
        cursor: 'pointer',
      }}>
        <span style={{ color: 'var(--ink-faint)', cursor: 'grab', display: 'flex', touchAction: 'none' }} onClick={e => e.stopPropagation()} {...dragHandleProps}>
          <svg width="12" height="16" viewBox="0 0 9 13" fill="currentColor"><circle cx="2" cy="2" r="1.1"/><circle cx="7" cy="2" r="1.1"/><circle cx="2" cy="6.5" r="1.1"/><circle cx="7" cy="6.5" r="1.1"/><circle cx="2" cy="11" r="1.1"/><circle cx="7" cy="11" r="1.1"/></svg>
        </span>
        <span style={{
          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
          background: 'var(--bg-2)', color: 'var(--ink-mute)',
          fontSize: 10, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: '"IBM Plex Mono", monospace',
        }}>
          {index + 1}
        </span>
        <span style={{ fontSize: 13, flexShrink: 0 }}>{ACTION_TYPE_ICON[action.type] || '•'}</span>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {actionSummary(action)}
        </span>
        <button onClick={e => { e.stopPropagation(); onRemove() }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
    )
  }

  return (
    <div style={{
      border: '0.5px solid var(--line)',
      borderRadius: 11, padding: 12, display: 'flex', flexDirection: 'column', gap: 10,
      background: 'var(--surface)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--ink-faint)', cursor: 'grab', touchAction: 'none' }} {...dragHandleProps}>
            <svg width="12" height="16" viewBox="0 0 9 13" fill="currentColor"><circle cx="2" cy="2" r="1.1"/><circle cx="7" cy="2" r="1.1"/><circle cx="2" cy="6.5" r="1.1"/><circle cx="7" cy="6.5" r="1.1"/><circle cx="2" cy="11" r="1.1"/><circle cx="7" cy="11" r="1.1"/></svg>
          </span>
          <p className="z-eyebrow">{t('automations.wizard.actionLabel', { n: index + 1 })}</p>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={onToggleCollapse} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--ink-mute)', fontFamily: 'inherit', padding: '4px 8px', borderRadius: 7 }}>{t('automations.wizard.collapse')}</button>
          <button onClick={onRemove} aria-label={t('automations.removeStep')} title={t('automations.removeStep')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 4 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
          </button>
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
        } else {
          onChange({ type: nextType, entity_id: '', service: '' })
        }
      }} />

      {action.type === 'ir_command' && <IRDeviceSelect value={action} onChange={patch => onChange({ ...action, ...patch })} />}

      {action.type === 'call_service' && (
        <>
          <EntitySelect value={action.entity_id || ''} onChange={v => onChange({ ...action, entity_id: v, service: 'homeassistant.turn_on', service_value: 'turn_on', service_data: undefined })} placeholder={t('automations.action.selectEntity')} allowedDomains={CONTROLLABLE_DOMAINS} />
          {linkedIr && action.entity_id ? (
            <MergedActionPicker
              haActions={availableActions}
              irDevice={linkedIr}
              haValue={action.service_value || action.service?.split('.')[1] || 'turn_on'}
              onChangeHa={val => { const def = availableActions.find(a => a.value === val) || {}; onChange({ ...action, service_value: val, service: `homeassistant.${def.haService || val}`, service_data: def.serviceData || undefined }) }}
              onPickIrCommand={cmd => onChange({ ...action, type: 'ir_command', ir_device_id: linkedIr.id, ir_device_name: linkedIr.name, ir_command: cmd, ir_sequence: undefined, service: undefined, service_value: undefined, service_data: undefined })}
            />
          ) : (
            <Select
              options={availableActions.map(a => ({ ...a, label: getActionLabel(a, t) }))}
              value={action.service_value || action.service?.split('.')[1] || 'turn_on'}
              onChange={e => { const sel = e.target.value; const def = availableActions.find(a => a.value === sel) || {}; onChange({ ...action, service_value: sel, service: `homeassistant.${def.haService || sel}`, service_data: def.serviceData || undefined }) }}
            />
          )}
          {(() => {
            const selVal = action.service_value || action.service?.split('.')[1] || 'turn_on'
            const def = availableActions.find(a => a.value === selVal)
            return def?.needsInput ? (
              <NeedsInputFields fields={def.needsInput} entityId={action.entity_id} serviceData={action.service_data} onChangeServiceData={data => onChange({ ...action, service_data: data })} />
            ) : null
          })()}
        </>
      )}

      {action.type === 'send_intent' && <SendIntentEditor value={action.text || ''} onChange={text => onChange({ ...action, text })} />}
      {action.type === 'delay'       && <Input type="number" placeholder={t('automations.action.secondsPh')} value={action.seconds || ''} onChange={e => onChange({ ...action, seconds: parseInt(e.target.value) })} />}
      {action.type === 'notify'      && <Input placeholder={t('automations.action.messagePh')} value={action.message || ''} onChange={e => onChange({ ...action, message: e.target.value })} dir="auto" />}
      {action.type === 'device_command' && <DeviceCommandEditor value={action} onChange={patch => onChange({ ...action, ...patch })} />}
      {action.type === 'fake_occupancy_start' && <FakeOccupancyEditor action={action} onChange={patch => onChange(patch)} />}
      {action.type === 'media_play' && mediaMusic && <MediaPlayActionEditor action={action} onChange={onChange} />}
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

// A condition is "complete enough" to surface in summaries if it has an entity
// (entity-state condition) or a time bound (time-window condition).
export function isCompleteCondition(c) {
  if (!c) return false
  if (c.type === 'time') return !!(c.after || c.before)
  return !!c.entity_id
}

export { DraggableActionRow }
export default ActionRow
