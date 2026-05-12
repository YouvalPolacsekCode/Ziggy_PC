import { useEffect, useState } from 'react'
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion'
import { Plus, Zap, Trash2, Edit2, ChevronRight, ChevronDown, Clock, Play, GripVertical, Eye, X, Home } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Input, Textarea } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { EntitySelect, getActionsForDomain } from '../components/ui/EntitySelect'
import { useAutomationStore } from '../stores/automationStore'
import { useUIStore } from '../stores/uiStore'
import { useDeviceStore } from '../stores/deviceStore'
import { cn } from '../lib/utils'
import { getVirtualDevices, getCapabilities, getAllRooms, getEntityState } from '../lib/api'
import IRDeviceSelect from '../components/IRDeviceSelect'

// ─── Trigger & action metadata ────────────────────────────────────────────────
const TRIGGER_TYPES = [
  { value: 'time',    label: '⏰ Time' },
  { value: 'state',   label: '🔄 Device State' },
  { value: 'sunrise', label: '🌅 Sunrise' },
  { value: 'sunset',  label: '🌇 Sunset' },
  { value: 'webhook', label: '🔗 Webhook' },
]

const ACTION_TYPES = [
  { value: 'call_service', label: '⚙️ Control Device' },
  { value: 'ir_command',   label: '📡 IR Command' },
  { value: 'ziggy_intent', label: '⚡ Ziggy Capability' },
  { value: 'send_intent',  label: '💬 Send Command' },
  { value: 'delay',        label: '⏱ Wait' },
  { value: 'notify',       label: '📣 Notify' },
]

// ─── Send Intent — structured command templates ───────────────────────────────

const SEND_INTENT_TEMPLATES = [
  { group: 'Lights', items: [
    'Turn off all lights',
    'Turn on the lights in [room]',
    'Set brightness in [room] to 50%',
    'Set lights in [room] to warm white',
    'Set lights in [room] to cool white',
    'Set lights in [room] to red',
  ]},
  { group: 'Climate', items: [
    'Set AC in [room] to 22 degrees',
    'Turn on AC in [room]',
    'Turn off AC in [room]',
    'Set AC mode to cool in [room]',
    'Set fan mode to auto in [room]',
  ]},
  { group: 'TV & Media', items: [
    'Turn on the TV in [room]',
    'Turn off the TV in [room]',
    'Set volume to 30 on TV in [room]',
    'Pause the TV in [room]',
    'Switch TV source to HDMI 1 in [room]',
  ]},
  { group: 'Covers', items: [
    'Open the blinds in [room]',
    'Close the blinds in [room]',
    'Set blinds to 50% in [room]',
  ]},
  { group: 'General', items: [
    'Turn off everything',
    'Good night',
    'Good morning',
  ]},
]

function SendIntentEditor({ value, onChange }) {
  const [showTemplates, setShowTemplates] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          placeholder="e.g. set bedroom lights to 50% brightness"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1"
        />
        <button
          onClick={() => setShowTemplates((v) => !v)}
          className="shrink-0 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          title="Command templates"
        >
          📝
        </button>
      </div>
      {showTemplates && (
        <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
          {SEND_INTENT_TEMPLATES.map(({ group, items }) => (
            <div key={group}>
              <p className="px-3 pt-2 pb-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-400">{group}</p>
              {items.map((tpl) => (
                <button
                  key={tpl}
                  onClick={() => { onChange(tpl); setShowTemplates(false) }}
                  className="w-full text-left px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  {tpl}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-zinc-400">
        Ziggy's AI interprets this command at run time. Replace <span className="font-mono text-zinc-500">[room]</span> with the actual room name.
      </p>
    </div>
  )
}

// ─── NeedsInputFields — live entity-aware parameter picker ────────────────────
// Renders a dropdown (using live HA entity attributes) or a text/number input
// for each field in an action's needsInput definition.

const SELECT_CLS = 'h-10 rounded-xl px-3 text-sm appearance-none bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500 transition-colors'

function NeedsInputFields({ fields, entityId, serviceData, onChangeServiceData }) {
  const [attrs, setAttrs] = useState({})

  useEffect(() => {
    if (!entityId || !fields.some((f) => f.fetchKey)) return
    getEntityState(entityId)
      .then((data) => setAttrs(data.attributes || {}))
      .catch(() => {})
  }, [entityId])

  return fields.map(({ key, label, placeholder, isNumber, fetchKey }) => {
    const options = fetchKey ? (attrs[fetchKey] || []) : []
    const currentVal = (serviceData || {})[key] ?? ''

    if (fetchKey && options.length > 0) {
      return (
        <div key={key} className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</label>
          <select
            value={currentVal}
            onChange={(e) => onChangeServiceData({ ...(serviceData || {}), [key]: e.target.value })}
            className={SELECT_CLS}
          >
            <option value="">— Pick {label} —</option>
            {options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      )
    }

    if (fetchKey && !entityId) {
      return (
        <p key={key} className="text-xs text-zinc-400 italic">Select an entity above to see {label.toLowerCase()} options.</p>
      )
    }

    return (
      <Input
        key={key}
        label={label}
        placeholder={fetchKey && entityId ? 'Loading…' : placeholder}
        type={isNumber ? 'number' : 'text'}
        value={currentVal}
        onChange={(e) => {
          const raw = e.target.value
          const val = isNumber ? (raw === '' ? '' : Number(raw)) : raw
          onChangeServiceData({ ...(serviceData || {}), [key]: val })
        }}
      />
    )
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function triggerSummary(trigger) {
  if (!trigger?.type) return 'No trigger set'
  switch (trigger.type) {
    case 'time':    return trigger.time ? `Every day at ${trigger.time}` : 'Time trigger (no time set)'
    case 'state':   return `When ${trigger.entity_id || 'device'} turns ${trigger.state || 'on/off'}`
    case 'sunrise': return trigger.offset ? `Sunrise ${trigger.offset}` : 'At sunrise'
    case 'sunset':  return trigger.offset ? `Sunset ${trigger.offset}` : 'At sunset'
    case 'webhook': return `Webhook: ${trigger.webhook_id || '(no id)'}`
    default:        return trigger.type
  }
}

function actionSummary(action) {
  switch (action.type) {
    case 'call_service': {
      const verb = action.service_value || action.service?.split('.')[1] || 'control'
      return `${verb.replace(/_/g, ' ')} ${action.entity_id || '?'}`
    }
    case 'ir_command': {
      const cmd = action.ir_sequence || action.ir_command || '?'
      return `${action.ir_device_name || 'IR device'} → ${cmd}`
    }
    case 'ziggy_intent': return `Run: ${action.virtual_device_name || action.capability || 'capability'}`
    case 'send_intent':  return `Command: "${action.text || '?'}"`
    case 'delay':        return `Wait ${action.seconds || '?'} seconds`
    case 'notify':       return `Notify: "${action.message || '?'}"`
    default:             return action.type
  }
}

function actionIcon(type) {
  const map = { call_service: '⚙️', ir_command: '📡', ziggy_intent: '⚡', send_intent: '💬', delay: '⏱', notify: '📣' }
  return map[type] || '•'
}

// ─── Virtual device selector ──────────────────────────────────────────────────
function VirtualDeviceSelect({ value, runtimeParams, onDeviceChange, onParamChange }) {
  const [devices, setDevices] = useState([])
  const [capMap, setCapMap] = useState({})

  useEffect(() => {
    getVirtualDevices().then((d) => setDevices(d.devices || [])).catch(() => {})
    getCapabilities().then((d) => {
      const m = {}
      ;(d.capabilities || []).forEach((c) => { m[c.id] = c })
      setCapMap(m)
    }).catch(() => {})
  }, [])

  const selectedDev = devices.find((d) => d.id === value)
  const cap = selectedDev ? capMap[selectedDev.capability] : null
  const runtimeEntries = cap
    ? Object.entries(cap.params_schema || {}).filter(([, s]) => (s.param_type || 'config') === 'runtime')
    : []

  return (
    <div className="flex flex-col gap-3">
      <Select
        label="Ziggy capability device"
        value={value || ''}
        onChange={(e) => {
          const dev = devices.find((d) => d.id === e.target.value)
          onDeviceChange(e.target.value, dev)
        }}
        options={[
          { value: '', label: '— Pick a capability —' },
          ...devices.map((d) => ({ value: d.id, label: `${d.icon} ${d.name}` })),
        ]}
      />
      {runtimeEntries.length > 0 && (
        <div className="flex flex-col gap-2 pl-3 border-l-2 border-violet-200 dark:border-violet-800">
          {runtimeEntries.map(([key, schema]) => (
            <Input
              key={key}
              label={schema.label}
              value={(runtimeParams || {})[key] ?? ''}
              onChange={(e) => onParamChange(key, e.target.value)}
              placeholder={schema.placeholder || ''}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Step indicator ───────────────────────────────────────────────────────────
const STEPS = ['Name', 'Trigger', 'Actions', 'Review']

function StepIndicator({ current }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div className={cn(
            'w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-colors',
            i < current ? 'bg-violet-600 text-white'
              : i === current ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600 ring-2 ring-violet-600'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
          )}>
            {i < current ? '✓' : i + 1}
          </div>
          {i < STEPS.length - 1 && (
            <div className={cn('w-6 h-0.5 rounded', i < current ? 'bg-violet-600' : 'bg-zinc-200 dark:bg-zinc-700')} />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Trigger editor ───────────────────────────────────────────────────────────
function TriggerEditor({ trigger, onChange }) {
  // Normalize the trigger type — the select always defaults to 'time' visually,
  // so the conditional rendering must match that default too.
  const effectiveType = trigger.type || 'time'

  return (
    <div className="flex flex-col gap-4">
      <Select
        label="Trigger type"
        options={TRIGGER_TYPES}
        value={effectiveType}
        onChange={(e) => onChange({ ...trigger, type: e.target.value })}
      />
      {effectiveType === 'time' && (
        <Input
          label="Time (HH:MM)"
          type="time"
          value={trigger.time || ''}
          onChange={(e) => onChange({ ...trigger, type: 'time', time: e.target.value })}
        />
      )}
      {effectiveType === 'state' && (
        <>
          <EntitySelect
            label="Entity"
            value={trigger.entity_id || ''}
            onChange={(v) => onChange({ ...trigger, entity_id: v })}
          />
          <Select
            label="New state"
            options={[{ value: 'on', label: 'Turns on' }, { value: 'off', label: 'Turns off' }]}
            value={trigger.state || 'on'}
            onChange={(e) => onChange({ ...trigger, state: e.target.value })}
          />
        </>
      )}
      {(effectiveType === 'sunrise' || effectiveType === 'sunset') && (
        <Input
          label="Offset (e.g. +00:30 or -00:15)"
          placeholder="+00:00"
          value={trigger.offset || ''}
          onChange={(e) => onChange({ ...trigger, offset: e.target.value })}
        />
      )}
      {effectiveType === 'webhook' && (
        <Input
          label="Webhook ID"
          placeholder="my_webhook_id"
          value={trigger.webhook_id || ''}
          onChange={(e) => onChange({ ...trigger, webhook_id: e.target.value })}
        />
      )}
    </div>
  )
}

// ─── Action row (expanded / collapsed) ───────────────────────────────────────
// ─── Linked IR section — appears inside call_service / device editors ─────────
// Shows IR commands for the physical device that is linked to the selected HA entity.
// Picking a command converts the whole step to ir_command type with the device pre-filled.
function LinkedIrSection({ irDevice, onPickCommand }) {
  const [expanded, setExpanded] = useState(false)
  const learned = new Set(irDevice.learned_commands || [])
  const cmds = irDevice.commands || {}
  const canDo = (cmd) => cmd in cmds && learned.has(cmd)
  const available = Object.keys(cmds).filter(canDo)
  if (available.length === 0) return null

  const hasPower = canDo('power')
  const others = available.filter((c) => c !== 'power')

  return (
    <div className="rounded-xl border border-violet-200 dark:border-violet-800/50 p-3 bg-violet-50/40 dark:bg-violet-900/10">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-bold uppercase tracking-wider text-violet-500">IR Remote</span>
          <span className="text-[10px] text-zinc-400 truncate">· {irDevice.name}</span>
        </div>
        <span className="text-[9px] text-zinc-400 shrink-0">{available.length} cmds</span>
      </div>
      <p className="text-[10px] text-zinc-400 mb-2 leading-relaxed">
        Select an IR command — this action will switch to an IR command type.
      </p>

      {hasPower && (
        <button
          onClick={() => onPickCommand('power')}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 mb-2 rounded-lg bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-xs font-semibold hover:bg-violet-200 dark:hover:bg-violet-900/60 transition-colors"
        >
          ⏻ Power (IR)
        </button>
      )}

      {others.length > 0 && (
        <>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[10px] text-violet-500 hover:text-violet-600 font-medium transition-colors"
          >
            <ChevronDown size={10} className={cn('transition-transform duration-150', expanded && 'rotate-180')} />
            {expanded ? 'Less' : `${others.length} more IR commands`}
          </button>
          {expanded && (
            <div className="flex gap-1.5 flex-wrap mt-2">
              {others.map((cmd) => (
                <button
                  key={cmd}
                  onClick={() => onPickCommand(cmd)}
                  className="px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-[10px] font-medium"
                >
                  {cmd.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ActionRow({ action, index, onChange, onRemove, collapsed, onToggleCollapse, dragHandleProps }) {
  const { entities } = useDeviceStore()
  const domain = action.entity_id?.split('.')?.[0] || null
  const availableActions = domain ? getActionsForDomain(domain) : [
    { value: 'turn_on', label: 'Turn On' },
    { value: 'turn_off', label: 'Turn Off' },
    { value: 'toggle', label: 'Toggle' },
  ]

  // Linked IR device for the selected entity (if any) — surfaces IR commands inline
  const linkedIr = entities.find((e) => e.entity_id === action.entity_id)?._linkedIr || null

  const label = actionSummary(action)

  if (collapsed) {
    return (
      <div
        onClick={onToggleCollapse}
        className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
      >
        <div
          className="text-zinc-300 hover:text-zinc-500 cursor-grab active:cursor-grabbing shrink-0 touch-none"
          onClick={(e) => e.stopPropagation()}
          {...dragHandleProps}
        >
          <GripVertical size={14} />
        </div>
        <span className="w-5 h-5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 text-[10px] font-bold flex items-center justify-center shrink-0">
          {index + 1}
        </span>
        <span className="text-sm shrink-0">{actionIcon(action.type)}</span>
        <span className="flex-1 text-xs text-zinc-700 dark:text-zinc-300 truncate">{label}</span>
        <ChevronRight size={13} className="text-zinc-400 rotate-90 shrink-0" />
        <button
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="text-zinc-300 hover:text-red-500 p-0.5 transition-colors shrink-0"
        >
          <Trash2 size={12} />
        </button>
      </div>
    )
  }

  return (
    <div className="border border-violet-200 dark:border-violet-800/50 rounded-xl p-3 flex flex-col gap-3 bg-violet-50/30 dark:bg-violet-900/10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-zinc-300 hover:text-zinc-500 cursor-grab active:cursor-grabbing touch-none" {...dragHandleProps}>
            <GripVertical size={14} />
          </div>
          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Action {index + 1}</span>
        </div>
        <div className="flex gap-1">
          <button onClick={onToggleCollapse} className="text-zinc-400 hover:text-zinc-600 p-1 text-xs">Collapse</button>
          <button onClick={onRemove} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
        </div>
      </div>
      <Select
        options={ACTION_TYPES}
        value={action.type || 'call_service'}
        onChange={(e) => onChange({ type: e.target.value, entity_id: '', service: '' })}
      />
      {action.type === 'ir_command' && (
        <IRDeviceSelect value={action} onChange={(patch) => onChange({ ...action, ...patch })} />
      )}
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
          <EntitySelect
            value={action.entity_id || ''}
            onChange={(v) => onChange({ ...action, entity_id: v, service: 'homeassistant.turn_on', service_value: 'turn_on', service_data: undefined })}
            placeholder="Select entity…"
          />
          <Select
            options={availableActions}
            value={action.service_value || action.service?.split('.')[1] || 'turn_on'}
            onChange={(e) => {
              const selectedVal = e.target.value
              const def = availableActions.find((a) => a.value === selectedVal) || {}
              onChange({
                ...action,
                service_value: selectedVal,
                service: `homeassistant.${def.haService || selectedVal}`,
                service_data: def.serviceData || undefined,
              })
            }}
          />
          {/* needsInput: live entity-aware parameter picker */}
          {(() => {
            const selVal = action.service_value || action.service?.split('.')[1] || 'turn_on'
            const def = availableActions.find((a) => a.value === selVal)
            return def?.needsInput ? (
              <NeedsInputFields
                fields={def.needsInput}
                entityId={action.entity_id}
                serviceData={action.service_data}
                onChangeServiceData={(data) => onChange({ ...action, service_data: data })}
              />
            ) : null
          })()}

          {/* Linked IR device — show IR commands alongside HA actions */}
          {linkedIr && action.entity_id && (
            <LinkedIrSection
              irDevice={linkedIr}
              onPickCommand={(cmd) => onChange({
                ...action,
                type: 'ir_command',
                ir_device_id: linkedIr.id,
                ir_device_name: linkedIr.name,
                ir_command: cmd,
                ir_sequence: undefined,
                service: undefined,
                service_value: undefined,
                service_data: undefined,
              })}
            />
          )}
        </>
      )}
      {action.type === 'send_intent' && (
        <SendIntentEditor value={action.text || ''} onChange={(text) => onChange({ ...action, text })} />
      )}
      {action.type === 'delay' && (
        <Input type="number" placeholder="Seconds" value={action.seconds || ''} onChange={(e) => onChange({ ...action, seconds: parseInt(e.target.value) })} />
      )}
      {action.type === 'notify' && (
        <Input placeholder="Message" value={action.message || ''} onChange={(e) => onChange({ ...action, message: e.target.value })} />
      )}
    </div>
  )
}

// ─── Draggable wrapper ────────────────────────────────────────────────────────
function DraggableActionRow({ action, index, onChange, onRemove, collapsed, onToggleCollapse }) {
  const controls = useDragControls()
  return (
    <Reorder.Item value={action} dragControls={controls} dragListener={false} className="list-none">
      <ActionRow
        action={action}
        index={index}
        onChange={onChange}
        onRemove={onRemove}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
        dragHandleProps={{ onPointerDown: (e) => controls.start(e) }}
      />
    </Reorder.Item>
  )
}

// ─── Review step (step 3) ─────────────────────────────────────────────────────
function ReviewPanel({ name, description, trigger, actions }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Name & trigger */}
      <div className="rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 p-4 flex flex-col gap-2">
        <p className="font-semibold text-zinc-900 dark:text-zinc-100 text-base">{name || '(no name)'}</p>
        {description && <p className="text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <Badge variant="violet" className="text-xs">
            {TRIGGER_TYPES.find((t) => t.value === (trigger?.type || 'time'))?.label}
          </Badge>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{triggerSummary(trigger)}</span>
        </div>
      </div>

      {/* Actions */}
      {actions.length === 0 ? (
        <p className="text-sm text-zinc-400 italic text-center py-3">No actions added</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            {actions.length} action{actions.length !== 1 ? 's' : ''} · in order
          </p>
          {actions.map((a, i) => (
            <div
              key={a._key || i}
              className="flex items-start gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2.5"
            >
              <span className="w-5 h-5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                {i + 1}
              </span>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                  {ACTION_TYPES.find((t) => t.value === a.type)?.label || a.type}
                </span>
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
                  {actionSummary(a)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Automation wizard ────────────────────────────────────────────────────────
function AutomationWizard({ initial, onSave, onClose }) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState(initial?.name || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [selectedRooms, setSelectedRooms] = useState(initial?.rooms || [])
  const [availableRooms, setAvailableRooms] = useState([])
  const [trigger, setTrigger] = useState(initial?.trigger || { type: 'time', time: '' })
  const [actions, setActions] = useState(() =>
    (initial?.actions || []).map((a) => ({ ...a, _key: a._key || crypto.randomUUID() }))
  )
  const [collapsedActions, setCollapsedActions] = useState(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getAllRooms().then((r) => setAvailableRooms(Array.isArray(r) ? r : r.rooms ?? [])).catch(() => {})
  }, [])

  const toggleRoom = (roomId) =>
    setSelectedRooms((prev) =>
      prev.includes(roomId) ? prev.filter((id) => id !== roomId) : [...prev, roomId]
    )

  const addAction = () => {
    const newKey = crypto.randomUUID()
    setCollapsedActions((prev) => {
      const next = new Set(prev)
      actions.forEach((a) => next.add(a._key))
      return next
    })
    setActions((a) => [...a, { type: 'call_service', entity_id: '', service: 'homeassistant.turn_on', _key: newKey }])
  }

  const updateAction = (i, val) =>
    setActions((a) => a.map((x, j) => (j === i ? { ...val, _key: x._key } : x)))

  const removeAction = (key) => {
    setActions((a) => a.filter((x) => x._key !== key))
    setCollapsedActions((prev) => { const next = new Set(prev); next.delete(key); return next })
  }

  const toggleCollapse = (key) =>
    setCollapsedActions((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const canNext = () => {
    if (step === 0) return name.trim().length > 0
    if (step === 1) return !!(trigger.type || 'time')
    return true
  }

  const handleSave = async () => {
    setSaving(true)
    const cleanActions = actions.map(({ _key, ...rest }) => rest)
    await onSave({ name, description, trigger, conditions: [], actions: cleanActions, rooms: selectedRooms })
    setSaving(false)
    onClose()
  }

  // Strip internal _key from actions before rendering review
  const reviewActions = actions.map(({ _key, ...rest }) => ({ ...rest, _key }))

  return (
    <div>
      <StepIndicator current={step} />

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.15 }}
        >
          {step === 0 && (
            <div className="flex flex-col gap-4">
              {/* No autoFocus — prevents mobile keyboard from jumping on open */}
              <Input
                label="Automation name"
                placeholder="e.g. Morning AC"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Textarea
                label="Description (optional)"
                placeholder="What does this automation do?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
              {/* Room assignment */}
              {availableRooms.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5 flex items-center gap-1.5">
                    <Home size={13} className="text-zinc-400" /> Rooms (optional)
                  </p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-600 mb-2">
                    Tag this automation to rooms so it appears in room detail views.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {availableRooms.map((r) => {
                      const isSelected = selectedRooms.includes(r.id)
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => toggleRoom(r.id)}
                          className={cn(
                            'px-3 py-1 rounded-full text-xs font-medium border transition-all',
                            isSelected
                              ? 'bg-violet-600 border-violet-600 text-white'
                              : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-400'
                          )}
                        >
                          {r.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <TriggerEditor trigger={trigger} onChange={setTrigger} />
          )}

          {step === 2 && (
            <div className="flex flex-col gap-3">
              <Reorder.Group
                axis="y"
                values={actions}
                onReorder={setActions}
                className="flex flex-col gap-3"
                style={{ listStyle: 'none', padding: 0, margin: 0 }}
              >
                {actions.map((action, i) => (
                  <DraggableActionRow
                    key={action._key}
                    action={action}
                    index={i}
                    onChange={(v) => updateAction(i, v)}
                    onRemove={() => removeAction(action._key)}
                    collapsed={collapsedActions.has(action._key)}
                    onToggleCollapse={() => toggleCollapse(action._key)}
                  />
                ))}
              </Reorder.Group>
              <Button variant="secondary" onClick={addAction} className="w-full">
                <Plus size={14} /> Add action
              </Button>
            </div>
          )}

          {step === 3 && (
            <ReviewPanel
              name={name}
              description={description}
              trigger={trigger}
              actions={reviewActions}
            />
          )}
        </motion.div>
      </AnimatePresence>

      <div className="flex gap-2 mt-6">
        {step > 0 && (
          <Button variant="secondary" onClick={() => setStep((s) => s - 1)} className="flex-1">Back</Button>
        )}
        {step < STEPS.length - 1 ? (
          <Button variant="primary" onClick={() => setStep((s) => s + 1)} disabled={!canNext()} className="flex-1">Next</Button>
        ) : (
          <Button variant="violet" onClick={handleSave} disabled={saving} className="flex-1">
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Create automation'}
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── View modal (read-only) ───────────────────────────────────────────────────
function AutomationViewModal({ automation, onClose }) {
  if (!automation) return null
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className={cn(
          'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
          automation.enabled ? 'bg-violet-50 dark:bg-violet-900/20' : 'bg-zinc-100 dark:bg-zinc-800'
        )}>
          <Zap size={18} className={automation.enabled ? 'text-violet-600' : 'text-zinc-400'} />
        </div>
        <div>
          <p className="font-semibold text-zinc-900 dark:text-zinc-100">{automation.name}</p>
          {automation.description && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{automation.description}</p>
          )}
        </div>
      </div>

      {/* Trigger */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60 p-3">
        <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Trigger</p>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="violet" className="text-xs">
            {TRIGGER_TYPES.find((t) => t.value === automation.trigger?.type)?.label || 'Unknown'}
          </Badge>
          <span className="text-sm text-zinc-600 dark:text-zinc-300">{triggerSummary(automation.trigger)}</span>
        </div>
      </div>

      {/* Actions */}
      <div>
        <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-2">
          Actions ({automation.actions?.length || 0})
        </p>
        {(!automation.actions || automation.actions.length === 0) ? (
          <p className="text-sm text-zinc-400 italic">No actions configured</p>
        ) : (
          <div className="flex flex-col gap-2">
            {automation.actions.map((a, i) => (
              <div key={i} className="flex items-start gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2.5">
                <span className="w-5 h-5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                    {ACTION_TYPES.find((t) => t.value === a.type)?.label || a.type}
                  </span>
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
                    {actionSummary(a)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="flex gap-2 flex-wrap">
        <Badge variant={automation.enabled ? 'violet' : 'default'} className="text-xs">
          {automation.enabled ? 'Enabled' : 'Disabled'}
        </Badge>
        {automation.source === 'ziggy' && (
          <Badge className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
            Ziggy-only
          </Badge>
        )}
        {automation.source === 'ha' && (
          <Badge className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
            Home Assistant
          </Badge>
        )}
      </div>
    </div>
  )
}

// ─── Automation card ──────────────────────────────────────────────────────────
function AutomationCard({ automation, onToggle, onView, onEdit, onDelete, onTrigger }) {
  const triggerLabel = TRIGGER_TYPES.find((t) => t.value === automation.trigger?.type)?.label

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
            automation.enabled ? 'bg-violet-50 dark:bg-violet-900/20' : 'bg-zinc-100 dark:bg-zinc-800'
          )}>
            <Zap size={18} className={automation.enabled ? 'text-violet-600' : 'text-zinc-400'} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">{automation.name}</p>
              {automation.source === 'ziggy' && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-medium shrink-0">Ziggy</span>
              )}
            </div>
            {automation.description && (
              <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-0.5 truncate">{automation.description}</p>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {triggerLabel && (
                <Badge variant={automation.enabled ? 'violet' : 'default'} className="text-[10px]">
                  {triggerLabel}
                </Badge>
              )}
              {automation.trigger?.time && (
                <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                  <Clock size={10} /> {automation.trigger.time}
                </span>
              )}
              <span className="text-[10px] text-zinc-400">
                {automation.actions?.length || 0} action{automation.actions?.length !== 1 ? 's' : ''}
              </span>
              {(automation.rooms || []).length > 0 && (
                <span className="text-[10px] text-violet-500 flex items-center gap-0.5">
                  <Home size={9} />
                  {(automation.rooms || []).length} room{(automation.rooms || []).length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <Toggle checked={automation.enabled} onCheckedChange={() => onToggle(automation.id)} />
            <div className="flex gap-1">
              <button
                onClick={() => onTrigger(automation.id)}
                className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                title="Run now"
              >
                <Play size={13} />
              </button>
              <button
                onClick={() => onView(automation)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
                title="View"
              >
                <Eye size={13} />
              </button>
              <button
                onClick={() => onEdit(automation)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                title="Edit"
              >
                <Edit2 size={13} />
              </button>
              <button
                onClick={() => onDelete(automation.id)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                title="Delete"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Automations() {
  const {
    automations, loading, fetchAutomations, addAutomation, removeAutomation,
    toggleAutomation, triggerAutomation, loadAutomationConfig,
  } = useAutomationStore()
  const { addToast } = useUIStore()
  const [showWizard, setShowWizard] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [viewTarget, setViewTarget] = useState(null)

  useEffect(() => { fetchAutomations() }, [])

  const handleSave = async (data) => {
    try {
      await addAutomation({ ...data, id: editTarget?.id })
      addToast(editTarget ? 'Automation updated' : 'Automation saved', 'success')
      // Always refresh from server after save to guarantee consistent state.
      await fetchAutomations()
    } catch {
      addToast('Failed to save automation', 'error')
    }
  }

  const handleDelete = async (id) => {
    try {
      await removeAutomation(id)
      addToast('Automation deleted', 'success')
    } catch {
      addToast('Failed to delete', 'error')
    }
  }

  const handleEdit = async (automation) => {
    try {
      const config = await loadAutomationConfig(automation.id)
      setEditTarget(config || automation)
    } catch {
      setEditTarget(automation)
    }
    setShowWizard(true)
  }

  const handleView = async (automation) => {
    try {
      const config = await loadAutomationConfig(automation.id)
      setViewTarget(config || automation)
    } catch {
      setViewTarget(automation)
    }
  }

  const handleClose = () => {
    setShowWizard(false)
    setEditTarget(null)
  }

  const enabled = automations.filter((a) => a.enabled).length

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Automations</h1>
          <p className="text-sm text-zinc-400 dark:text-zinc-600 mt-0.5">
            React to events automatically · {enabled} enabled
          </p>
        </div>
        <Button onClick={() => { setEditTarget(null); setShowWizard(true) }} size="sm">
          <Plus size={14} /> New
        </Button>
      </div>

      {loading && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && automations.length === 0 && (
        <div className="text-center py-20 text-zinc-400 dark:text-zinc-600">
          <Zap size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No automations yet</p>
          <p className="text-xs mt-1 mb-4">Create one to automate your home</p>
          <Button variant="secondary" onClick={() => setShowWizard(true)} size="sm">
            <Plus size={14} /> Create automation
          </Button>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        <div className="flex flex-col gap-3">
          {automations.map((a) => (
            <AutomationCard
              key={a.id}
              automation={a}
              onToggle={toggleAutomation}
              onView={handleView}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onTrigger={async (id) => {
                try { await triggerAutomation(id); addToast('Automation triggered', 'success') }
                catch { addToast('Failed to trigger', 'error') }
              }}
            />
          ))}
        </div>
      </AnimatePresence>

      {/* Edit / create wizard */}
      <Modal
        open={showWizard}
        onClose={handleClose}
        title={editTarget ? `Edit: ${editTarget.name}` : 'New Automation'}
      >
        {/* key forces wizard to remount when switching between automations,
            resetting all step/state/collapse state cleanly. */}
        <AutomationWizard
          key={editTarget?.id || '__new__'}
          initial={editTarget}
          onSave={handleSave}
          onClose={handleClose}
        />
      </Modal>

      {/* View modal (read-only) */}
      <Modal
        open={!!viewTarget}
        onClose={() => setViewTarget(null)}
        title="Automation details"
      >
        <AutomationViewModal automation={viewTarget} onClose={() => setViewTarget(null)} />
      </Modal>
    </div>
  )
}
