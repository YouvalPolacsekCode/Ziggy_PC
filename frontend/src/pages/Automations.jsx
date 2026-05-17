import { useEffect, useState } from 'react'
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion'
import { Modal } from '../components/ui/Modal'
import { Toggle } from '../components/ui/Toggle'
import { Input, Textarea } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { EntitySelect, getActionsForDomain } from '../components/ui/EntitySelect'
import { useAutomationStore } from '../stores/automationStore'
import { useUIStore } from '../stores/uiStore'
import { useDeviceStore } from '../stores/deviceStore'
import { CONTROLLABLE_DOMAINS } from '../lib/domainRegistry'
import { getVirtualDevices, getCapabilities, getAllRooms, getEntityState, getEntities, getAutomationTemplates, getSuggestedTemplates } from '../lib/api'
import IRDeviceSelect from '../components/IRDeviceSelect'

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatRelativeTime(iso) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const TRIGGER_TYPES = [
  { value: 'time',    label: 'Time' },
  { value: 'state',   label: 'Device State' },
  { value: 'zone',    label: 'Zone Entry / Exit' },
  { value: 'sunrise', label: 'Sunrise' },
  { value: 'sunset',  label: 'Sunset' },
  { value: 'webhook', label: 'Webhook' },
]

const TRACKER_TRIGGER_STATES = [
  { value: 'home',     label: 'Arrives home' },
  { value: 'not_home', label: 'Leaves / goes away' },
]

const ACTION_TYPES = [
  { value: 'call_service', label: 'Control Device' },
  { value: 'ir_command',   label: 'IR Command' },
  { value: 'ziggy_intent', label: 'Ziggy Capability' },
  { value: 'send_intent',  label: 'Send Command' },
  { value: 'delay',        label: 'Wait' },
  { value: 'notify',       label: 'Notify' },
]

const SEND_INTENT_TEMPLATES = [
  { group: 'Lights', items: ['Turn off all lights', 'Turn on the lights in [room]', 'Set brightness in [room] to 50%', 'Set lights in [room] to warm white'] },
  { group: 'Climate', items: ['Set AC in [room] to 22 degrees', 'Turn on AC in [room]', 'Turn off AC in [room]', 'Set AC mode to cool in [room]'] },
  { group: 'TV & Media', items: ['Turn on the TV in [room]', 'Turn off the TV in [room]', 'Set volume to 30 on TV in [room]'] },
  { group: 'Covers', items: ['Open the blinds in [room]', 'Close the blinds in [room]'] },
  { group: 'General', items: ['Turn off everything', 'Good night', 'Good morning'] },
]

const SENSOR_DOMAINS  = new Set(['sensor', 'binary_sensor'])
const TRACKER_DOMAINS = new Set(['person', 'device_tracker'])

const BINARY_SENSOR_TRIGGER_STATES = {
  door:        [{ value: 'on', label: 'Opens' },            { value: 'off', label: 'Closes' }],
  window:      [{ value: 'on', label: 'Opens' },            { value: 'off', label: 'Closes' }],
  opening:     [{ value: 'on', label: 'Opens' },            { value: 'off', label: 'Closes' }],
  motion:      [{ value: 'on', label: 'Detects motion' },   { value: 'off', label: 'Clears' }],
  occupancy:   [{ value: 'on', label: 'Becomes occupied' }, { value: 'off', label: 'Becomes vacant' }],
  presence:    [{ value: 'on', label: 'Detects presence' }, { value: 'off', label: 'Clears' }],
  moisture:    [{ value: 'on', label: 'Detects leak' },     { value: 'off', label: 'Clears (dry)' }],
  smoke:       [{ value: 'on', label: 'Detects smoke' },    { value: 'off', label: 'Clears' }],
  gas:         [{ value: 'on', label: 'Detects gas' },      { value: 'off', label: 'Clears' }],
  vibration:   [{ value: 'on', label: 'Detects vibration' },{ value: 'off', label: 'Stops' }],
  connectivity:[{ value: 'on', label: 'Connects' },         { value: 'off', label: 'Disconnects' }],
  lock:        [{ value: 'on', label: 'Locks' },            { value: 'off', label: 'Unlocks' }],
}

const BINARY_SENSOR_CONDITION_STATES = {
  door:        [{ value: 'on', label: 'Open' },            { value: 'off', label: 'Closed' }],
  window:      [{ value: 'on', label: 'Open' },            { value: 'off', label: 'Closed' }],
  opening:     [{ value: 'on', label: 'Open' },            { value: 'off', label: 'Closed' }],
  motion:      [{ value: 'on', label: 'Motion detected' }, { value: 'off', label: 'No motion' }],
  occupancy:   [{ value: 'on', label: 'Occupied' },        { value: 'off', label: 'Vacant' }],
  presence:    [{ value: 'on', label: 'Present' },         { value: 'off', label: 'Not present' }],
  moisture:    [{ value: 'on', label: 'Leak detected' },   { value: 'off', label: 'Clear' }],
  smoke:       [{ value: 'on', label: 'Smoke detected' },  { value: 'off', label: 'Clear' }],
  gas:         [{ value: 'on', label: 'Gas detected' },    { value: 'off', label: 'Clear' }],
  vibration:   [{ value: 'on', label: 'Vibrating' },       { value: 'off', label: 'Still' }],
  connectivity:[{ value: 'on', label: 'Connected' },       { value: 'off', label: 'Disconnected' }],
  lock:        [{ value: 'on', label: 'Locked' },          { value: 'off', label: 'Unlocked' }],
}

const DEFAULT_BINARY_TRIGGER   = [{ value: 'on', label: 'Turns on' }, { value: 'off', label: 'Turns off' }]
const DEFAULT_BINARY_CONDITION = [{ value: 'on', label: 'On' },       { value: 'off', label: 'Off' }]

function triggerSummary(trigger) {
  if (!trigger?.type) return 'No trigger set'
  switch (trigger.type) {
    case 'time':    return trigger.time ? `Every day at ${trigger.time}` : 'Time trigger (no time set)'
    case 'state': {
      let s = `When ${trigger.entity_id || 'device'} becomes ${trigger.state || 'on/off'}`
      if (trigger.for_minutes) s += ` for ${trigger.for_minutes} min`
      return s
    }
    case 'zone': {
      const who  = trigger.entity_id || 'person'
      const zone = (trigger.zone || 'zone.home').replace('zone.', '')
      const evt  = trigger.event === 'leave' ? 'leaves' : 'enters'
      return `When ${who} ${evt} ${zone}`
    }
    case 'sunrise': return trigger.offset ? `Sunrise ${trigger.offset}` : 'At sunrise'
    case 'sunset':  return trigger.offset ? `Sunset ${trigger.offset}` : 'At sunset'
    case 'webhook': return `Webhook: ${trigger.webhook_id || '(no id)'}`
    default:        return trigger.type
  }
}

function actionSummary(action) {
  switch (action.type) {
    case 'call_service': return `${(action.service_value || action.service?.split('.')[1] || 'control').replace(/_/g, ' ')} ${action.entity_id || '?'}`
    case 'ir_command':   return `${action.ir_device_name || 'IR device'} → ${action.ir_sequence || action.ir_command || '?'}`
    case 'ziggy_intent': return `Run: ${action.virtual_device_name || action.capability || 'capability'}`
    case 'send_intent':  return `Command: "${action.text || '?'}"`
    case 'delay':        return `Wait ${action.seconds || '?'} seconds`
    case 'notify':       return `Notify: "${action.message || '?'}"`
    default:             return action.type
  }
}

function conditionSummary(c) {
  if (c.type === 'time') {
    const parts = []
    if (c.after)  parts.push(`after ${c.after}`)
    if (c.before) parts.push(`before ${c.before}`)
    return parts.length ? `Time window: ${parts.join(' and ')}` : 'Time window'
  }
  if (!c.entity_id) return 'Incomplete condition'
  const name = c.entity_id.split('.')[1]?.replace(/_/g, ' ') || c.entity_id
  switch (c.operator) {
    case 'is':     return `${name} is ${c.value || 'on'}`
    case 'is_not': return `${name} is not ${c.value || 'on'}`
    case 'above':  return `${name} > ${c.value}`
    case 'below':  return `${name} < ${c.value}`
    default:       return c.entity_id
  }
}

const ACTION_TYPE_ICON = { call_service: '⚙', ir_command: '📡', ziggy_intent: '⚡', send_intent: '💬', delay: '⏱', notify: '📣' }

const selectStyle = {
  width: '100%', height: 38, padding: '0 28px 0 10px',
  background: 'var(--surface)', border: '0.5px solid var(--line)',
  borderRadius: 9, color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13,
  outline: 'none', appearance: 'none',
  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.4)' d='M0 0h10L5 6z'/></svg>")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
}

// ── SendIntentEditor ──────────────────────────────────────────────────────────
function SendIntentEditor({ value, onChange }) {
  const [showTemplates, setShowTemplates] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <Input
          placeholder="e.g. set bedroom lights to 50% brightness"
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{ flex: 1 }}
        />
        <button onClick={() => setShowTemplates(v => !v)} style={{
          padding: '0 10px', borderRadius: 9,
          background: 'var(--bg-2)', border: '0.5px solid var(--line)',
          color: 'var(--ink-mute)', cursor: 'pointer', fontSize: 14, flexShrink: 0,
        }}>📝</button>
      </div>
      {showTemplates && (
        <div style={{ borderRadius: 11, border: '0.5px solid var(--line)', overflow: 'hidden', background: 'var(--surface)' }}>
          {SEND_INTENT_TEMPLATES.map(({ group, items }) => (
            <div key={group}>
              <p className="z-eyebrow" style={{ padding: '8px 10px 4px' }}>{group}</p>
              {items.map(tpl => (
                <button key={tpl} onClick={() => { onChange(tpl); setShowTemplates(false) }}
                  style={{
                    display: 'block', width: '100%', padding: '6px 10px',
                    background: 'none', border: 'none', textAlign: 'left',
                    fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >{tpl}</button>
              ))}
            </div>
          ))}
        </div>
      )}
      <p style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
        Replace [room] with the actual room name.
      </p>
    </div>
  )
}

// ── NeedsInputFields ──────────────────────────────────────────────────────────
function NeedsInputFields({ fields, entityId, serviceData, onChangeServiceData }) {
  const [attrs, setAttrs] = useState({})
  useEffect(() => {
    if (!entityId || !fields.some(f => f.fetchKey)) return
    getEntityState(entityId).then(data => setAttrs(data.attributes || {})).catch(() => {})
  }, [entityId])
  return fields.map(({ key, label, placeholder, isNumber, fetchKey }) => {
    const options    = fetchKey ? (attrs[fetchKey] || []) : []
    const currentVal = (serviceData || {})[key] ?? ''
    if (fetchKey && options.length > 0) {
      return (
        <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>{label}</label>
          <select style={selectStyle} value={currentVal} onChange={e => onChangeServiceData({ ...(serviceData || {}), [key]: e.target.value })}>
            <option value="">— Pick {label} —</option>
            {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>
      )
    }
    if (fetchKey && !entityId) return (
      <p key={key} style={{ fontSize: 11, color: 'var(--ink-faint)', fontStyle: 'italic' }}>Select an entity above to see {label.toLowerCase()} options.</p>
    )
    return (
      <Input
        key={key}
        label={label}
        placeholder={fetchKey && entityId ? 'Loading…' : placeholder}
        type={isNumber ? 'number' : 'text'}
        value={currentVal}
        onChange={e => { const v = isNumber ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value; onChangeServiceData({ ...(serviceData || {}), [key]: v }) }}
      />
    )
  })
}

// ── VirtualDeviceSelect ───────────────────────────────────────────────────────
function VirtualDeviceSelect({ value, runtimeParams, onDeviceChange, onParamChange }) {
  const [devices, setDevices] = useState([])
  const [capMap,  setCapMap]  = useState({})
  useEffect(() => {
    getVirtualDevices().then(d => setDevices(d.devices || [])).catch(() => {})
    getCapabilities().then(d => { const m = {}; (d.capabilities || []).forEach(c => { m[c.id] = c }); setCapMap(m) }).catch(() => {})
  }, [])
  const selectedDev    = devices.find(d => d.id === value)
  const cap            = selectedDev ? capMap[selectedDev.capability] : null
  const runtimeEntries = cap ? Object.entries(cap.params_schema || {}).filter(([, s]) => (s.param_type || 'config') === 'runtime') : []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Select
        label="Ziggy capability device"
        value={value || ''}
        onChange={e => { const dev = devices.find(d => d.id === e.target.value); onDeviceChange(e.target.value, dev) }}
        options={[{ value: '', label: '— Pick a capability —' }, ...devices.map(d => ({ value: d.id, label: `${d.icon} ${d.name}` }))]}
      />
      {runtimeEntries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 12, borderLeft: '2px solid var(--line)' }}>
          {runtimeEntries.map(([key, schema]) => (
            <Input key={key} label={schema.label} value={(runtimeParams || {})[key] ?? ''} onChange={e => onParamChange(key, e.target.value)} placeholder={schema.placeholder || ''} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── MergedActionPicker ────────────────────────────────────────────────────────
function MergedActionPicker({ haActions, irDevice, haValue, onChangeHa, onPickIrCommand }) {
  const learned = new Set(irDevice?.learned_commands || [])
  const cmds    = irDevice?.commands || {}
  const irList  = Object.keys(cmds).filter(c => cmds[c] && learned.has(c))

  const handleChange = e => {
    const val = e.target.value
    if (val.startsWith('__ir__:')) onPickIrCommand(val.slice(7))
    else onChangeHa(val)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>Action</label>
      <select style={selectStyle} value={haValue} onChange={handleChange}>
        <optgroup label="⚙ Wi-Fi / HA">
          {haActions.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </optgroup>
        {irList.length > 0 && (
          <optgroup label={`📡 IR Blaster · ${irDevice?.name}`}>
            {irList.map(cmd => <option key={cmd} value={`__ir__:${cmd}`}>{cmd.replace(/_/g, ' ')}</option>)}
          </optgroup>
        )}
      </select>
      {irList.length > 0 && <p style={{ fontSize: 10, color: 'var(--ink-faint)' }}>Choosing an IR option converts this step to an IR command.</p>}
    </div>
  )
}

// ── Step indicator ────────────────────────────────────────────────────────────
const STEPS = ['Name', 'Trigger', 'Conditions', 'Actions', 'Review']

function StepIndicator({ current }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 20 }}>
      {STEPS.map((s, i) => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700,
            background: i < current ? 'var(--ink)' : i === current ? `color-mix(in srgb, var(--ink) 12%, var(--surface))` : 'var(--bg-2)',
            color: i < current ? 'var(--bg)' : i === current ? 'var(--ink)' : 'var(--ink-faint)',
            border: i === current ? '1.5px solid var(--ink)' : '0.5px solid var(--line)',
          }}>
            {i < current ? '✓' : i + 1}
          </div>
          {i < STEPS.length - 1 && (
            <div style={{ width: 20, height: 1, background: i < current ? 'var(--ink)' : 'var(--line)' }} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── ZoneTriggerEditor ─────────────────────────────────────────────────────────
function ZoneTriggerEditor({ trigger, onChange }) {
  const [zones, setZones] = useState([])
  useEffect(() => {
    getEntities('zone').then(r => {
      const list = (r.entities || r || []).filter(e => e.entity_id?.startsWith('zone.') && e.entity_id !== 'zone.home' ? true : true)
      setZones(list)
    }).catch(() => {})
  }, [])

  const zoneOptions = [
    { value: 'zone.home', label: 'Home zone (arrived)' },
    ...zones.filter(z => z.entity_id !== 'zone.home').map(z => ({
      value: z.entity_id,
      label: (z.attributes?.friendly_name || z.entity_id.replace('zone.', '')).replace(/_/g, ' '),
    })),
  ]

  const eventOptions = [
    { value: 'enter', label: 'Enters zone' },
    { value: 'leave', label: 'Leaves zone' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <EntitySelect
        label="Person or device to track"
        value={trigger.entity_id || ''}
        onChange={v => onChange({ ...trigger, entity_id: v })}
        allowedDomains={TRACKER_DOMAINS}
        placeholder="Select person or device tracker…"
      />
      <Select
        label="Zone"
        options={zoneOptions}
        value={trigger.zone || 'zone.home'}
        onChange={e => onChange({ ...trigger, zone: e.target.value })}
      />
      {!trigger.zone || trigger.zone === 'zone.home' ? null : null}
      <Select
        label="When"
        options={eventOptions}
        value={trigger.event || 'enter'}
        onChange={e => onChange({ ...trigger, event: e.target.value })}
      />

      {/* Tip: approaching home */}
      <div style={{
        padding: '10px 12px', borderRadius: 10,
        background: `color-mix(in srgb, var(--info) 6%, var(--surface))`,
        border: `0.5px solid color-mix(in srgb, var(--info) 25%, var(--line))`,
      }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--info)', marginBottom: 4 }}>
          Triggering BEFORE you arrive
        </p>
        <p style={{ fontSize: 11, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
          The Home zone fires when you physically reach home. For a head-start (e.g. turn on AC while still 5 minutes away), create a second zone in Home Assistant with a larger radius — for example a "Near Home" zone at 2–3 km. Then select that zone here instead.
        </p>
      </div>
    </div>
  )
}

// ── TriggerEditor ─────────────────────────────────────────────────────────────
function TriggerEditor({ trigger, onChange }) {
  const { entities } = useDeviceStore()
  const effectiveType = trigger.type || 'time'
  const triggerDomain = trigger.entity_id?.split('.')?.[0] || null
  const triggerEntity = trigger.entity_id ? entities.find(e => e.entity_id === trigger.entity_id) : null
  const isTracker     = triggerDomain === 'person' || triggerDomain === 'device_tracker'
  const stateOptions  = isTracker
    ? TRACKER_TRIGGER_STATES
    : (triggerDomain === 'binary_sensor' && triggerEntity?.device_class)
      ? (BINARY_SENSOR_TRIGGER_STATES[triggerEntity.device_class] || DEFAULT_BINARY_TRIGGER)
      : DEFAULT_BINARY_TRIGGER

  const handleTypeChange = e => {
    const next = e.target.value
    // Reset to clean defaults when switching type
    if (next === 'zone')    onChange({ type: 'zone',    entity_id: '', zone: 'zone.home', event: 'enter' })
    else if (next === 'state')   onChange({ type: 'state',   entity_id: '', state: 'on' })
    else if (next === 'time')    onChange({ type: 'time',    time: '' })
    else if (next === 'webhook') onChange({ type: 'webhook', webhook_id: '' })
    else                         onChange({ ...trigger, type: next })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Select label="Trigger type" options={TRIGGER_TYPES} value={effectiveType} onChange={handleTypeChange} />

      {effectiveType === 'time' && (
        <Input label="Time (HH:MM)" type="time" value={trigger.time || ''} onChange={e => onChange({ ...trigger, type: 'time', time: e.target.value })} />
      )}

      {effectiveType === 'state' && (
        <>
          <EntitySelect
            label="Entity"
            value={trigger.entity_id || ''}
            onChange={v => {
              const dom = v?.split('.')?.[0]
              const isT = dom === 'person' || dom === 'device_tracker'
              onChange({ ...trigger, entity_id: v, state: isT ? 'home' : 'on', for_minutes: undefined })
            }}
          />
          <Select
            label={isTracker ? 'When' : 'New state'}
            options={stateOptions}
            value={trigger.state || (isTracker ? 'home' : 'on')}
            onChange={e => onChange({ ...trigger, state: e.target.value })}
          />
          <Input
            label="Must stay in this state for (minutes, optional)"
            type="number"
            placeholder="e.g. 30 — leave empty to trigger instantly"
            value={trigger.for_minutes || ''}
            onChange={e => {
              const v = e.target.value
              onChange({ ...trigger, for_minutes: v ? parseInt(v) : undefined })
            }}
          />
        </>
      )}

      {effectiveType === 'zone' && (
        <ZoneTriggerEditor trigger={trigger} onChange={onChange} />
      )}

      {(effectiveType === 'sunrise' || effectiveType === 'sunset') && (
        <Input label="Offset (e.g. +00:30 or -00:15)" placeholder="+00:00" value={trigger.offset || ''} onChange={e => onChange({ ...trigger, offset: e.target.value })} />
      )}

      {effectiveType === 'webhook' && (
        <Input label="Webhook ID" placeholder="my_webhook_id" value={trigger.webhook_id || ''} onChange={e => onChange({ ...trigger, webhook_id: e.target.value })} />
      )}
    </div>
  )
}

const CONDITION_TYPES = [
  { value: 'entity', label: 'Entity state' },
  { value: 'time',   label: 'Time window' },
]

// ── ConditionRow ──────────────────────────────────────────────────────────────
function ConditionRow({ condition, onChange, onRemove }) {
  const { entities } = useDeviceStore()
  const condType    = condition.type || 'entity'
  const domain      = condition.entity_id?.split('.')?.[0] || null
  const entity      = condition.entity_id ? entities.find(e => e.entity_id === condition.entity_id) : null
  const deviceClass = entity?.device_class || null
  const isNumeric   = domain === 'sensor'
  const isBinary    = domain === 'binary_sensor'
  const isTracker   = domain === 'person' || domain === 'device_tracker'
  const stateOptions   = isTracker
    ? [{ value: 'home', label: 'Is home' }, { value: 'not_home', label: 'Is away' }]
    : isBinary
    ? (BINARY_SENSOR_CONDITION_STATES[deviceClass] || DEFAULT_BINARY_CONDITION)
    : []
  const operatorOptions = isNumeric
    ? [{ value: 'above', label: 'Is above' }, { value: 'below', label: 'Is below' }]
    : isTracker
    ? [{ value: 'is', label: 'Is' }]
    : [{ value: 'is', label: 'Is' }, { value: 'is_not', label: 'Is not' }]
  const unitHint = entity?.unit_of_measurement || ''

  const sharedWrapper = (children) => (
    <div style={{
      border: `0.5px solid color-mix(in srgb, var(--warn) 30%, var(--line))`,
      borderRadius: 11, padding: 12,
      background: `color-mix(in srgb, var(--warn) 4%, var(--surface))`,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p className="z-eyebrow">Only if…</p>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 4 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
      <Select
        label="Condition type"
        options={CONDITION_TYPES}
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
          label="After (HH:MM)"
          type="time"
          value={condition.after || ''}
          onChange={e => onChange({ ...condition, after: e.target.value })}
        />
        <Input
          label="Before (HH:MM)"
          type="time"
          value={condition.before || ''}
          onChange={e => onChange({ ...condition, before: e.target.value })}
        />
        <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
          Overnight ranges work — e.g. after 21:00, before 07:00
        </p>
      </>
    )
  }

  // ── Entity state ──────────────────────────────────────────────────────────
  return sharedWrapper(
    <>
      <EntitySelect
        label="Entity"
        value={condition.entity_id || ''}
        onChange={v => {
          const dom = v?.split('.')?.[0]
          const isT = dom === 'person' || dom === 'device_tracker'
          const isN = dom === 'sensor'
          onChange({ ...condition, type: 'entity', entity_id: v, operator: isN ? 'above' : 'is', value: isT ? 'home' : (isN ? '' : 'on') })
        }}
        placeholder="Select entity…"
      />
      {condition.entity_id && (
        <>
          <Select
            options={operatorOptions}
            value={condition.operator || (isNumeric ? 'above' : 'is')}
            onChange={e => onChange({ ...condition, operator: e.target.value })}
          />
          {isNumeric ? (
            <Input
              label={unitHint ? `Threshold (${unitHint})` : 'Threshold'}
              type="number"
              placeholder="e.g. 25"
              value={condition.value ?? ''}
              onChange={e => onChange({ ...condition, value: e.target.value })}
            />
          ) : (isTracker || isBinary) ? (
            <Select
              options={stateOptions}
              value={condition.value || (isTracker ? 'home' : 'on')}
              onChange={e => onChange({ ...condition, value: e.target.value })}
            />
          ) : null}
        </>
      )}
    </>
  )
}

// ── ActionRow ─────────────────────────────────────────────────────────────────
function ActionRow({ action, index, onChange, onRemove, collapsed, onToggleCollapse, dragHandleProps }) {
  const { entities } = useDeviceStore()
  const domain = action.entity_id?.split('.')?.[0] || null
  const availableActions = domain ? getActionsForDomain(domain) : [{ value: 'turn_on', label: 'Turn On' }, { value: 'turn_off', label: 'Turn Off' }, { value: 'toggle', label: 'Toggle' }]
  const linkedIr = entities.find(e => e.entity_id === action.entity_id)?._linkedIr || null

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
          background: `color-mix(in srgb, var(--info) 14%, transparent)`,
          color: 'var(--info)', fontSize: 10, fontWeight: 700,
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
      border: `0.5px solid color-mix(in srgb, var(--info) 35%, var(--line))`,
      borderRadius: 11, padding: 12, display: 'flex', flexDirection: 'column', gap: 10,
      background: `color-mix(in srgb, var(--info) 5%, var(--surface))`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--ink-faint)', cursor: 'grab', touchAction: 'none' }} {...dragHandleProps}>
            <svg width="12" height="16" viewBox="0 0 9 13" fill="currentColor"><circle cx="2" cy="2" r="1.1"/><circle cx="7" cy="2" r="1.1"/><circle cx="2" cy="6.5" r="1.1"/><circle cx="7" cy="6.5" r="1.1"/><circle cx="2" cy="11" r="1.1"/><circle cx="7" cy="11" r="1.1"/></svg>
          </span>
          <p className="z-eyebrow">Action {index + 1}</p>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={onToggleCollapse} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--ink-mute)', fontFamily: 'inherit', padding: '4px 8px', borderRadius: 7 }}>Collapse</button>
          <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 4 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
          </button>
        </div>
      </div>

      <Select options={ACTION_TYPES} value={action.type || 'call_service'} onChange={e => onChange({ type: e.target.value, entity_id: '', service: '' })} />

      {action.type === 'ir_command' && <IRDeviceSelect value={action} onChange={patch => onChange({ ...action, ...patch })} />}

      {action.type === 'ziggy_intent' && (
        <VirtualDeviceSelect
          value={action.virtual_device_id || ''}
          runtimeParams={action.runtime_params || {}}
          onDeviceChange={(id, dev) => onChange({ ...action, virtual_device_id: id, capability: dev?.capability || '', virtual_device_name: dev?.name || '', runtime_params: {} })}
          onParamChange={(key, val) => onChange({ ...action, runtime_params: { ...(action.runtime_params || {}), [key]: val } })}
        />
      )}

      {action.type === 'call_service' && (
        <>
          <EntitySelect value={action.entity_id || ''} onChange={v => onChange({ ...action, entity_id: v, service: 'homeassistant.turn_on', service_value: 'turn_on', service_data: undefined })} placeholder="Select entity…" allowedDomains={CONTROLLABLE_DOMAINS} />
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
              options={availableActions}
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
      {action.type === 'delay'       && <Input type="number" placeholder="Seconds" value={action.seconds || ''} onChange={e => onChange({ ...action, seconds: parseInt(e.target.value) })} />}
      {action.type === 'notify'      && <Input placeholder="Message" value={action.message || ''} onChange={e => onChange({ ...action, message: e.target.value })} />}
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

// ── ReviewPanel ───────────────────────────────────────────────────────────────
function ReviewPanel({ name, description, trigger, conditions = [], actions }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--bg-2)', border: '0.5px solid var(--line)' }}>
        <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 15, marginBottom: 4 }}>{name || '(no name)'}</p>
        {description && <p style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{description}</p>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 999,
            background: `color-mix(in srgb, var(--info) 12%, transparent)`, color: 'var(--info)',
            fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace',
          }}>
            {TRIGGER_TYPES.find(t => t.value === (trigger?.type || 'time'))?.label}
          </span>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{triggerSummary(trigger)}</span>
        </div>
      </div>
      {conditions.filter(c => c.entity_id).length > 0 && (
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 8 }}>Conditions ({conditions.filter(c => c.entity_id).length})</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {conditions.filter(c => c.entity_id).map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: `0.5px solid color-mix(in srgb, var(--warn) 30%, var(--line))`, background: `color-mix(in srgb, var(--warn) 4%, var(--surface))` }}>
                <span style={{ fontSize: 13, flexShrink: 0 }}>🔍</span>
                <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{conditionSummary(c)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {actions.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--ink-faint)', textAlign: 'center', padding: '12px 0', fontStyle: 'italic' }}>No actions added</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p className="z-eyebrow">{actions.length} action{actions.length !== 1 ? 's' : ''}</p>
          {actions.map((a, i) => (
            <div key={a._key || i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--line)', background: 'var(--surface)' }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1, background: `color-mix(in srgb, var(--info) 12%, transparent)`, color: 'var(--info)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"IBM Plex Mono", monospace' }}>{i + 1}</span>
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{ACTION_TYPES.find(t => t.value === a.type)?.label || a.type}</p>
                <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: '"IBM Plex Mono", monospace' }}>{actionSummary(a)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── AutomationWizard ──────────────────────────────────────────────────────────
function AutomationWizard({ initial, onSave, onClose }) {
  const [step,             setStep]           = useState(0)
  const [name,             setName]           = useState(initial?.name || '')
  const [description,      setDescription]    = useState(initial?.description || '')
  const [selectedRooms,    setSelectedRooms]  = useState(initial?.rooms || [])
  const [availableRooms,   setAvailableRooms] = useState([])
  const [trigger,          setTrigger]        = useState(initial?.trigger || { type: 'time', time: '' })
  const [actions,          setActions]        = useState(() => (initial?.actions || []).map(a => ({ ...a, _key: a._key || crypto.randomUUID() })))
  const [conditions,       setConditions]     = useState(() => (initial?.conditions || []).map(c => ({ ...c, _key: c._key || crypto.randomUUID() })))
  const [collapsedActions, setCollapsedActions] = useState(new Set())
  const [saving,           setSaving]         = useState(false)

  useEffect(() => { getAllRooms().then(r => setAvailableRooms(Array.isArray(r) ? r : r.rooms ?? [])).catch(() => {}) }, [])

  const toggleRoom = roomId => setSelectedRooms(prev => prev.includes(roomId) ? prev.filter(id => id !== roomId) : [...prev, roomId])

  const addAction = () => {
    const newKey = crypto.randomUUID()
    setCollapsedActions(prev => { const next = new Set(prev); actions.forEach(a => next.add(a._key)); return next })
    setActions(a => [...a, { type: 'call_service', entity_id: '', service: 'homeassistant.turn_on', _key: newKey }])
  }

  const updateAction    = (i, val) => setActions(a => a.map((x, j) => j === i ? { ...val, _key: x._key } : x))
  const removeAction    = key => { setActions(a => a.filter(x => x._key !== key)); setCollapsedActions(prev => { const next = new Set(prev); next.delete(key); return next }) }
  const toggleCollapse  = key => setCollapsedActions(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })
  const canNext = () => step === 0 ? name.trim().length > 0 : !!(trigger.type || 'time')

  const handleSave = async () => {
    setSaving(true)
    const cleanConditions = conditions.map(({ _key, ...rest }) => rest).filter(c => c.entity_id)
    const cleanActions = actions.map(({ _key, ...rest }) => rest)
    await onSave({ name, description, trigger, conditions: cleanConditions, actions: cleanActions, rooms: selectedRooms })
    setSaving(false); onClose()
  }

  return (
    <div>
      <StepIndicator current={step} />
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}>
          {step === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Input label="Automation name" placeholder="e.g. Morning AC" value={name} onChange={e => setName(e.target.value)} />
              <Textarea label="Description (optional)" placeholder="What does this automation do?" value={description} onChange={e => setDescription(e.target.value)} rows={3} />
              {availableRooms.length > 0 && (
                <div>
                  <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Rooms (optional)</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {availableRooms.map(r => {
                      const sel = selectedRooms.includes(r.id)
                      return (
                        <button key={r.id} type="button" onClick={() => toggleRoom(r.id)} style={{
                          padding: '4px 11px', borderRadius: 999, fontSize: 12, fontWeight: 500,
                          background: sel ? 'var(--ink)' : 'var(--surface)',
                          color: sel ? 'var(--bg)' : 'var(--ink-mute)',
                          border: sel ? 'none' : '0.5px solid var(--line)',
                          cursor: 'pointer', fontFamily: 'inherit',
                        }}>{r.name}</button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          {step === 1 && <TriggerEditor trigger={trigger} onChange={setTrigger} />}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 2 }}>
                Optional. Conditions must be true at trigger time for actions to run.
              </p>
              {conditions.map((cond, i) => (
                <ConditionRow
                  key={cond._key}
                  condition={cond}
                  onChange={v => setConditions(cs => cs.map((c, j) => j === i ? { ...v, _key: c._key } : c))}
                  onRemove={() => setConditions(cs => cs.filter((_, j) => j !== i))}
                />
              ))}
              <button
                onClick={() => setConditions(cs => [...cs, { type: 'entity', entity_id: '', operator: 'is', value: 'on', _key: crypto.randomUUID() }])}
                className="z-btn-secondary"
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                Add condition
              </button>
            </div>
          )}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Reorder.Group axis="y" values={actions} onReorder={setActions} style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {actions.map((action, i) => (
                  <DraggableActionRow key={action._key} action={action} index={i} onChange={v => updateAction(i, v)} onRemove={() => removeAction(action._key)} collapsed={collapsedActions.has(action._key)} onToggleCollapse={() => toggleCollapse(action._key)} />
                ))}
              </Reorder.Group>
              <button onClick={addAction} className="z-btn-secondary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                Add action
              </button>
            </div>
          )}
          {step === 4 && <ReviewPanel name={name} description={description} trigger={trigger} conditions={conditions.map(({ _key, ...rest }) => rest)} actions={actions.map(({ _key, ...rest }) => ({ ...rest, _key }))} />}
        </motion.div>
      </AnimatePresence>
      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        {step > 0 && <button onClick={() => setStep(s => s - 1)} className="z-btn-secondary" style={{ flex: 1 }}>Back</button>}
        {step < STEPS.length - 1
          ? <button onClick={() => setStep(s => s + 1)} disabled={!canNext()} className="z-btn-primary" style={{ flex: 1 }}>Next</button>
          : <button onClick={handleSave} disabled={saving} className="z-btn-primary" style={{ flex: 1 }}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Create automation'}</button>
        }
      </div>
    </div>
  )
}

// ── AutomationViewModal ───────────────────────────────────────────────────────
function AutomationViewModal({ automation, roomNameMap }) {
  if (!automation) return null
  const lastRun = formatRelativeTime(automation.last_triggered)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: automation.enabled ? `color-mix(in srgb, var(--info) 12%, var(--surface))` : 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={automation.enabled ? 'var(--info)' : 'var(--ink-faint)'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 15 }}>{automation.name}</p>
          {automation.description && <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>{automation.description}</p>}
        </div>
      </div>
      <div style={{ padding: '12px 14px', borderRadius: 11, background: 'var(--bg-2)', border: '0.5px solid var(--line)' }}>
        <p className="z-eyebrow" style={{ marginBottom: 6 }}>Trigger</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: `color-mix(in srgb, var(--info) 12%, transparent)`, color: 'var(--info)', fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace' }}>
            {TRIGGER_TYPES.find(t => t.value === automation.trigger?.type)?.label || 'Unknown'}
          </span>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{triggerSummary(automation.trigger)}</span>
        </div>
      </div>
      {(automation.conditions?.filter(c => c.entity_id).length > 0) && (
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 8 }}>Conditions ({automation.conditions.filter(c => c.entity_id).length})</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {automation.conditions.filter(c => c.entity_id).map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: `0.5px solid color-mix(in srgb, var(--warn) 30%, var(--line))`, background: `color-mix(in srgb, var(--warn) 4%, var(--surface))` }}>
                <span style={{ fontSize: 13, flexShrink: 0 }}>🔍</span>
                <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{conditionSummary(c)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>Actions ({automation.actions?.length || 0})</p>
        {(!automation.actions || automation.actions.length === 0)
          ? <p style={{ fontSize: 13, color: 'var(--ink-faint)', fontStyle: 'italic' }}>No actions configured</p>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {automation.actions.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--line)', background: 'var(--surface)' }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: `color-mix(in srgb, var(--info) 12%, transparent)`, color: 'var(--info)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: '"IBM Plex Mono", monospace' }}>{i + 1}</span>
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{ACTION_TYPES.find(t => t.value === a.type)?.label || a.type}</p>
                    <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2, fontFamily: '"IBM Plex Mono", monospace' }}>{actionSummary(a)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
      {(automation.rooms || []).length > 0 && (
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 6 }}>Rooms</p>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {automation.rooms.map(r => (
              <span key={r} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: `color-mix(in srgb, var(--info) 10%, var(--surface))`, color: 'var(--info)', border: '0.5px solid var(--line)' }}>
                {roomNameMap?.[r] || r.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace', background: `color-mix(in srgb, ${automation.enabled ? 'var(--ok)' : 'var(--ink-mute)'} 12%, transparent)`, color: automation.enabled ? 'var(--ok)' : 'var(--ink-mute)' }}>
          {automation.enabled ? 'ENABLED' : 'DISABLED'}
        </span>
        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace', background: 'var(--bg-2)', color: 'var(--ink-faint)' }}>
          {automation.source === 'ziggy' ? 'Local scheduler' : 'HA-triggered'}
        </span>
        {lastRun && (
          <span style={{ fontSize: 11, color: 'var(--ink-faint)', marginLeft: 'auto', fontFamily: '"IBM Plex Mono", monospace' }}>last ran {lastRun}</span>
        )}
      </div>
    </div>
  )
}

// ── AutomationCard ────────────────────────────────────────────────────────────
function AutomationCard({ automation, onToggle, onView, onEdit, onDelete, onTrigger }) {
  const triggerLabel = TRIGGER_TYPES.find(t => t.value === automation.trigger?.type)?.label

  // Check if any action entity is currently unavailable
  const { entities } = useDeviceStore()
  const offlineEntities = (() => {
    const offlineSet = new Set(entities.filter(e => e.state === 'unavailable' || e.state === 'unknown').map(e => e.entity_id))
    return (automation.actions || [])
      .filter(a => a.entity_id && offlineSet.has(a.entity_id))
      .map(a => a.entity_id)
  })()
  const hasOfflineDep = automation.enabled && offlineEntities.length > 0

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
      <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface)', border: `0.5px solid ${hasOfflineDep ? 'color-mix(in srgb, var(--warn) 40%, var(--line))' : 'var(--line)'}`, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: automation.enabled ? `color-mix(in srgb, var(--info) 12%, var(--surface))` : 'var(--bg-2)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={automation.enabled ? 'var(--info)' : 'var(--ink-faint)'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{automation.name}</p>
          {automation.description && <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{automation.description}</p>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            {triggerLabel && (
              <span style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 999, fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace', background: `color-mix(in srgb, ${automation.enabled ? 'var(--info)' : 'var(--ink-mute)'} 12%, transparent)`, color: automation.enabled ? 'var(--info)' : 'var(--ink-faint)' }}>
                {triggerLabel}
              </span>
            )}
            {automation.trigger?.time && <span style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{automation.trigger.time}</span>}
            <span style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{automation.actions?.length || 0} step{automation.actions?.length !== 1 ? 's' : ''}</span>
            {(automation.rooms || []).length > 0 && <span style={{ fontSize: 10.5, color: 'var(--ink-mute)' }}>{(automation.rooms || []).length} room{(automation.rooms || []).length !== 1 ? 's' : ''}</span>}
          </div>
          {hasOfflineDep && (
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--warn)', fontFamily: '"IBM Plex Mono", monospace' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              {offlineEntities.length === 1
                ? `device offline — may not run`
                : `${offlineEntities.length} devices offline — may not run`}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
          <Toggle checked={automation.enabled} onCheckedChange={() => onToggle(automation.id)} />
          <div style={{ display: 'flex', gap: 2 }}>
            {[
              { onClick: () => onTrigger(automation.id), color: 'var(--ok)', title: 'Run now', path: <path d="M5 3l14 9-14 9V3z" fill="currentColor" stroke="none"/> },
              { onClick: () => onView(automation),       color: 'var(--ink-mute)', title: 'View',    path: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></> },
              { onClick: () => onEdit(automation),       color: 'var(--ink-mute)', title: 'Edit',    path: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></> },
              { onClick: () => onDelete(automation.id),  color: 'var(--accent)',   title: 'Delete',  path: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></> },
            ].map(({ onClick, color, title, path }) => (
              <button key={title} onClick={onClick} title={title} style={{ background: 'none', border: 'none', cursor: 'pointer', color, padding: 4 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
              </button>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ── TemplateCard ──────────────────────────────────────────────────────────────
const TIER_STYLE = {
  ready:       { border: 'color-mix(in srgb, var(--ok)   30%, var(--line))', bg: 'color-mix(in srgb, var(--ok)   4%, var(--surface))', badgeBg: 'color-mix(in srgb, var(--ok)   14%, transparent)', badgeColor: 'var(--ok)',      badgeText: 'READY' },
  partial:     { border: 'color-mix(in srgb, var(--warn) 40%, var(--line))', bg: 'color-mix(in srgb, var(--warn) 4%, var(--surface))', badgeBg: 'color-mix(in srgb, var(--warn) 14%, transparent)', badgeColor: 'var(--warn)',    badgeText: 'INCOMPLETE' },
  unavailable: { border: 'var(--line)',                                       bg: 'var(--surface)',                                      badgeBg: 'var(--bg-2)',                                       badgeColor: 'var(--ink-faint)', badgeText: 'NOT AVAILABLE' },
}

function TemplateCard({ template, onConfigure }) {
  const tier        = template.tier || (template.can_run ? 'ready' : 'unavailable')
  const ts          = TIER_STYLE[tier] || TIER_STYLE.unavailable
  const matched     = template.matched_labels || []
  const missReq     = template.missing_req_labels || []
  const missOpt     = template.missing_opt_labels || []
  const canConfigure = tier === 'ready' || tier === 'partial'
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={{
      padding: '14px 16px', borderRadius: 12,
      background: ts.bg, border: `0.5px solid ${ts.border}`,
      display: 'flex', alignItems: 'flex-start', gap: 12,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `color-mix(in srgb, ${ts.badgeColor} 10%, var(--surface))`,
        fontSize: 18,
      }}>
        {template.icon}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Name row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3, flexWrap: 'wrap' }}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14, letterSpacing: '-0.01em' }}>{template.name}</p>
          <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 999, fontWeight: 700, fontFamily: '"IBM Plex Mono", monospace', background: ts.badgeBg, color: ts.badgeColor }}>
            {ts.badgeText}
          </span>
          {template.already_exists && (
            <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 999, fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace', background: `color-mix(in srgb, var(--ok) 14%, transparent)`, color: 'var(--ok)' }}>
              ACTIVE
            </span>
          )}
        </div>

        <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 8, lineHeight: 1.4 }}>{template.description}</p>

        {/* Device chips */}
        <button
          onClick={() => setExpanded(v => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ink-mute)', fontFamily: 'inherit', marginBottom: expanded ? 8 : 0 }}
        >
          <span style={{ transform: expanded ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>›</span>
          {tier === 'ready'
            ? `${matched.length} device${matched.length !== 1 ? 's' : ''} ready`
            : tier === 'partial'
            ? `${matched.length} of ${matched.length + missReq.length} required devices found`
            : `${missReq.length} device${missReq.length !== 1 ? 's' : ''} needed`
          }
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.15 }} style={{ overflow: 'hidden', marginBottom: 6 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 4 }}>
                {matched.map(m => (
                  <div key={m.cap} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--ok)', fontSize: 11, flexShrink: 0 }}>✓</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-2)' }}>{m.label}</span>
                    {m.entity && <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.entity}</span>}
                  </div>
                ))}
                {missReq.map(m => (
                  <div key={m.cap} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--warn)', fontSize: 11, flexShrink: 0 }}>✗</span>
                    <span style={{ fontSize: 11, color: 'var(--warn)' }}>{m.label}</span>
                    <span style={{ fontSize: 10, color: 'var(--warn)', fontFamily: '"IBM Plex Mono", monospace', opacity: 0.7 }}>required</span>
                  </div>
                ))}
                {missOpt.map(m => (
                  <div key={m.cap} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--ink-faint)', fontSize: 11, flexShrink: 0 }}>○</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{m.label}</span>
                    <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>optional</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div style={{ flexShrink: 0 }}>
        <button
          onClick={() => onConfigure(template)}
          disabled={!canConfigure}
          className={tier === 'ready' ? 'z-btn-primary' : 'z-btn-secondary'}
          style={{ fontSize: 12, padding: '6px 12px', borderRadius: 9, whiteSpace: 'nowrap', opacity: canConfigure ? 1 : 0.35 }}
        >
          {tier === 'ready' ? 'Configure' : tier === 'partial' ? 'Configure' : 'Add devices'}
        </button>
      </div>
    </div>
  )
}

// ── LibraryModal ──────────────────────────────────────────────────────────────
function LibraryModal({ open, onClose, onConfigure }) {
  const [templates, setTemplates] = useState([])
  const [loading,   setLoading]   = useState(false)
  const [search,    setSearch]    = useState('')
  const [category,  setCategory]  = useState('all')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    getAutomationTemplates()
      .then(r => setTemplates(r.templates || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open])

  const categories = ['all', ...Array.from(new Set(templates.map(t => t.category)))]
  const filtered = templates.filter(t =>
    (category === 'all' || t.category === category) &&
    (search === '' || t.name.toLowerCase().includes(search.toLowerCase()) || t.description.toLowerCase().includes(search.toLowerCase()))
  )
  const ready       = filtered.filter(t => t.tier === 'ready')
  const partial     = filtered.filter(t => t.tier === 'partial')
  const unavailable = filtered.filter(t => t.tier === 'unavailable')

  if (!open) return null
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      padding: '0 0 0 0',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <motion.div
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', damping: 24, stiffness: 260 }}
        style={{
          width: '100%', maxWidth: 720,
          maxHeight: '85vh', borderRadius: '18px 18px 0 0',
          background: 'var(--bg)', display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '18px 20px 12px', borderBottom: '0.5px solid var(--line)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <p className="z-eyebrow" style={{ marginBottom: 2 }}>Curated automations</p>
              <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Automation Library</h2>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: 'var(--ink-mute)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <input
            type="text"
            placeholder="Search templates…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', height: 36, padding: '0 12px', borderRadius: 9,
              background: 'var(--surface)', border: '0.5px solid var(--line)',
              color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 10, overflowX: 'auto', paddingBottom: 2 }}>
            {categories.map(cat => (
              <button key={cat} onClick={() => setCategory(cat)} style={{
                padding: '4px 12px', borderRadius: 999, fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
                background: category === cat ? 'var(--ink)' : 'var(--surface)',
                color: category === cat ? 'var(--bg)' : 'var(--ink-mute)',
                border: category === cat ? 'none' : '0.5px solid var(--line)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px' }}>
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1,2,3].map(i => <div key={i} style={{ height: 80, borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.5 }} />)}
            </div>
          )}
          {!loading && (
            <>
              {ready.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <p className="z-eyebrow" style={{ marginBottom: 10, color: 'var(--ok)' }}>Ready to configure ({ready.length})</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {ready.map(t => <TemplateCard key={t.id} template={t} onConfigure={tmpl => { onConfigure(tmpl); onClose() }} />)}
                  </div>
                </div>
              )}
              {partial.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <p className="z-eyebrow" style={{ marginBottom: 6, color: 'var(--warn)' }}>Add devices to unlock ({partial.length})</p>
                  <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 10, lineHeight: 1.4 }}>
                    You have some required devices. Add the missing ones, then reload to see these move to Ready.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {partial.map(t => <TemplateCard key={t.id} template={t} onConfigure={tmpl => { onConfigure(tmpl); onClose() }} />)}
                  </div>
                </div>
              )}
              {unavailable.length > 0 && (
                <div>
                  <p className="z-eyebrow" style={{ marginBottom: 10, color: 'var(--ink-faint)' }}>Not available ({unavailable.length})</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {unavailable.map(t => <TemplateCard key={t.id} template={t} onConfigure={tmpl => { onConfigure(tmpl); onClose() }} />)}
                  </div>
                </div>
              )}
              {filtered.length === 0 && (
                <p style={{ textAlign: 'center', padding: '32px 0', fontSize: 13, color: 'var(--ink-faint)' }}>No templates match your search.</p>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Automations() {
  const { automations, loading, fetchAutomations, addAutomation, removeAutomation, toggleAutomation, triggerAutomation, loadAutomationConfig } = useAutomationStore()
  const { addToast } = useUIStore()
  const { ziggyRooms } = useDeviceStore()
  const [showWizard,        setShowWizard]        = useState(false)
  const [editTarget,        setEditTarget]         = useState(null)
  const [viewTarget,        setViewTarget]         = useState(null)
  const [suggestedTemplates, setSuggestedTemplates] = useState([])
  const [showLibrary,       setShowLibrary]        = useState(false)
  const [suggestionsOpen,   setSuggestionsOpen]    = useState(true)

  const roomNameMap = Object.fromEntries(ziggyRooms.map(r => [r.id, r.name]))

  useEffect(() => {
    fetchAutomations()
    getSuggestedTemplates()
      .then(r => setSuggestedTemplates(r.suggested || []))
      .catch(() => {})
  }, [])

  const handleConfigureTemplate = (template) => {
    if (!template.wizard_prefill) return
    setEditTarget({ ...template.wizard_prefill, _isTemplate: true, _templateId: template.id })
    setShowWizard(true)
  }

  const handleSave = async (data) => {
    try { await addAutomation({ ...data, id: editTarget?.id }); addToast(editTarget ? 'Automation updated' : 'Automation saved', 'success'); await fetchAutomations() }
    catch { addToast('Failed to save automation', 'error') }
  }
  const handleDelete = async (id) => {
    try { await removeAutomation(id); addToast('Automation deleted', 'success') }
    catch { addToast('Failed to delete', 'error') }
  }
  const handleEdit = async (automation) => {
    try { const config = await loadAutomationConfig(automation.id); setEditTarget(config || automation) }
    catch { setEditTarget(automation) }
    setShowWizard(true)
  }
  const handleView = async (automation) => {
    try { const config = await loadAutomationConfig(automation.id); setViewTarget(config || automation) }
    catch { setViewTarget(automation) }
  }
  const handleClose = () => { setShowWizard(false); setEditTarget(null) }
  const enabled = automations.filter(a => a.enabled).length

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 20px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>React to events automatically</p>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}>Automations</h1>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4, fontFamily: '"IBM Plex Mono", monospace' }}>
            {enabled} enabled · {automations.length} total
          </p>
        </div>
        <div style={{ display: 'flex', gap: 7, flexShrink: 0 }}>
          <button onClick={() => setShowLibrary(true)} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            Library
          </button>
          <button onClick={() => { setEditTarget(null); setShowWizard(true) }} className="z-btn-primary" style={{ padding: '9px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            Custom
          </button>
        </div>
      </div>

      {/* ── Recommended by Ziggy ─────────────────────────────────────────── */}
      {suggestedTemplates.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <button
            onClick={() => setSuggestionsOpen(v => !v)}
            style={{ width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', marginBottom: suggestionsOpen ? 10 : 0 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <p className="z-eyebrow">Recommended by Ziggy</p>
                {suggestedTemplates.filter(t => t.tier === 'ready' && !t.already_exists).length > 0 && (
                  <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 999, fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace', background: `color-mix(in srgb, var(--ok) 14%, transparent)`, color: 'var(--ok)' }}>
                    {suggestedTemplates.filter(t => t.tier === 'ready' && !t.already_exists).length} ready
                  </span>
                )}
                {suggestedTemplates.filter(t => t.tier === 'partial').length > 0 && (
                  <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 999, fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace', background: `color-mix(in srgb, var(--warn) 14%, transparent)`, color: 'var(--warn)' }}>
                    {suggestedTemplates.filter(t => t.tier === 'partial').length} incomplete
                  </span>
                )}
              </div>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: suggestionsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}><path d="M6 9l6 6 6-6"/></svg>
            </div>
          </button>
          <AnimatePresence>
            {suggestionsOpen && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }} style={{ overflow: 'hidden' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {suggestedTemplates.slice(0, 5).map(t => (
                    <TemplateCard key={t.id} template={t} onConfigure={handleConfigureTemplate} />
                  ))}
                  {suggestedTemplates.length > 5 && (
                    <button onClick={() => setShowLibrary(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--ink-mute)', textAlign: 'center', padding: '8px 0', fontFamily: 'inherit' }}>
                      +{suggestedTemplates.length - 5} more in Library →
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── My Automations ───────────────────────────────────────────────── */}
      {automations.length > 0 && <p className="z-eyebrow" style={{ marginBottom: 10 }}>My Automations</p>}

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 82, borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
        </div>
      )}

      {!loading && automations.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>No automations yet</p>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 16 }}>Create one to automate your home</p>
          <button onClick={() => setShowWizard(true)} className="z-btn-secondary" style={{ padding: '8px 14px', borderRadius: 9, fontFamily: 'inherit' }}>Create automation</button>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {automations.map(a => (
            <AutomationCard key={a.id} automation={a} onToggle={toggleAutomation} onView={handleView} onEdit={handleEdit} onDelete={handleDelete}
              onTrigger={async id => { try { await triggerAutomation(id); addToast('Triggered', 'success') } catch { addToast('Failed to trigger', 'error') } }} />
          ))}
        </div>
      </AnimatePresence>

      <LibraryModal
        open={showLibrary}
        onClose={() => setShowLibrary(false)}
        onConfigure={handleConfigureTemplate}
      />

      <Modal open={showWizard} onClose={handleClose} title={
        editTarget?._isTemplate ? `Configure: ${editTarget.name}` :
        editTarget ? `Edit: ${editTarget.name}` : 'New Custom Automation'
      }>
        <AutomationWizard key={editTarget?.id || '__new__'} initial={editTarget} onSave={handleSave} onClose={handleClose} />
      </Modal>

      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title="Automation details">
        <AutomationViewModal automation={viewTarget} roomNameMap={roomNameMap} />
      </Modal>
    </div>
  )
}
