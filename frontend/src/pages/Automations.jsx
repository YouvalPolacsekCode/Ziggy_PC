import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Zap, Trash2, Edit2, ChevronRight, Clock, Play } from 'lucide-react'
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
import { cn } from '../lib/utils'
import { getVirtualDevices, getCapabilities } from '../lib/api'
import IRDeviceSelect from '../components/IRDeviceSelect'

// ─── Trigger types ────────────────────────────────────────────────────────────
const TRIGGER_TYPES = [
  { value: 'time', label: '⏰ Time' },
  { value: 'state', label: '🔄 Device State' },
  { value: 'sunrise', label: '🌅 Sunrise' },
  { value: 'sunset', label: '🌇 Sunset' },
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

// ─── Virtual device selector with runtime params ──────────────────────────────
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
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 font-medium uppercase tracking-wide">
            Step values (leave blank to use voice at runtime)
          </p>
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

// ─── Wizard steps ─────────────────────────────────────────────────────────────
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
            <div className={cn(
              'w-6 h-0.5 rounded',
              i < current ? 'bg-violet-600' : 'bg-zinc-200 dark:bg-zinc-700'
            )} />
          )}
        </div>
      ))}
    </div>
  )
}

function TriggerEditor({ trigger, onChange }) {
  return (
    <div className="flex flex-col gap-4">
      <Select
        label="Trigger type"
        options={TRIGGER_TYPES}
        value={trigger.type || 'time'}
        onChange={(e) => onChange({ type: e.target.value })}
      />
      {trigger.type === 'time' && (
        <Input
          label="Time (HH:MM)"
          type="time"
          value={trigger.time || ''}
          onChange={(e) => onChange({ ...trigger, time: e.target.value })}
        />
      )}
      {trigger.type === 'state' && (
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
      {(trigger.type === 'sunrise' || trigger.type === 'sunset') && (
        <Input
          label="Offset (e.g. +00:30 or -00:15)"
          placeholder="+00:00"
          value={trigger.offset || ''}
          onChange={(e) => onChange({ ...trigger, offset: e.target.value })}
        />
      )}
      {trigger.type === 'webhook' && (
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

function ActionRow({ action, index, onChange, onRemove, collapsed, onToggleCollapse }) {
  const domain = action.entity_id?.split('.')?.[0] || null
  const availableActions = domain ? getActionsForDomain(domain) : [
    { value: 'turn_on', label: 'Turn On' },
    { value: 'turn_off', label: 'Turn Off' },
    { value: 'toggle', label: 'Toggle' },
  ]

  const actionLabel = action.type === 'call_service'
    ? `${availableActions.find(a => a.value === action.service?.split('.')[1])?.label || 'Control'} · ${action.entity_id || '?'}`
    : action.type === 'ir_command' ? `📡 ${action.ir_device_name || 'IR'} → ${action.ir_sequence || action.ir_command || '?'}`
    : action.type === 'ziggy_intent' ? `⚡ ${action.virtual_device_name || action.capability || 'Capability'}`
    : action.type === 'send_intent' ? action.text || 'Send Command'
    : action.type === 'delay' ? `Wait ${action.seconds || '?'}s`
    : action.message || 'Notify'

  if (collapsed) {
    return (
      <div
        onClick={onToggleCollapse}
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
      >
        <span className="w-5 h-5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 text-[10px] font-bold flex items-center justify-center shrink-0">
          {index + 1}
        </span>
        <span className="flex-1 text-xs text-zinc-700 dark:text-zinc-300 truncate">{actionLabel}</span>
        <ChevronRight size={13} className="text-zinc-400 rotate-90" />
        <button onClick={(e) => { e.stopPropagation(); onRemove() }} className="text-zinc-300 hover:text-red-500 p-0.5 transition-colors">
          <Trash2 size={12} />
        </button>
      </div>
    )
  }

  return (
    <div className="border border-violet-200 dark:border-violet-800/50 rounded-xl p-3 flex flex-col gap-3 bg-violet-50/30 dark:bg-violet-900/10">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Action {index + 1}</span>
        <div className="flex gap-1">
          <button onClick={onToggleCollapse} className="text-zinc-400 hover:text-zinc-600 p-1 text-xs">Collapse</button>
          <button onClick={onRemove} className="text-red-400 hover:text-red-600 p-1">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <Select
        options={ACTION_TYPES}
        value={action.type || 'call_service'}
        onChange={(e) => onChange({ type: e.target.value, entity_id: '', service: '' })}
      />
      {action.type === 'ir_command' && (
        <IRDeviceSelect
          value={action}
          onChange={(patch) => onChange({ ...action, ...patch })}
        />
      )}
      {action.type === 'ziggy_intent' && (
        <VirtualDeviceSelect
          value={action.virtual_device_id || ''}
          runtimeParams={action.runtime_params || {}}
          onDeviceChange={(id, dev) => onChange({
            ...action,
            virtual_device_id: id,
            capability: dev?.capability || '',
            virtual_device_name: dev?.name || '',
            runtime_params: {},
          })}
          onParamChange={(key, val) => onChange({
            ...action,
            runtime_params: { ...(action.runtime_params || {}), [key]: val },
          })}
        />
      )}
      {action.type === 'call_service' && (
        <>
          <EntitySelect
            value={action.entity_id || ''}
            onChange={(v) => onChange({ ...action, entity_id: v, service: `homeassistant.turn_on` })}
            placeholder="Select entity…"
          />
          <Select
            options={availableActions}
            value={action.service?.split('.')[1] || 'turn_on'}
            onChange={(e) => onChange({ ...action, service: `homeassistant.${e.target.value}` })}
          />
        </>
      )}
      {action.type === 'send_intent' && (
        <Input
          placeholder="Command text (e.g. turn off all lights)"
          value={action.text || ''}
          onChange={(e) => onChange({ ...action, text: e.target.value })}
        />
      )}
      {action.type === 'delay' && (
        <Input
          type="number"
          placeholder="Seconds"
          value={action.seconds || ''}
          onChange={(e) => onChange({ ...action, seconds: parseInt(e.target.value) })}
        />
      )}
      {action.type === 'notify' && (
        <Input
          placeholder="Message"
          value={action.message || ''}
          onChange={(e) => onChange({ ...action, message: e.target.value })}
        />
      )}
    </div>
  )
}

function AutomationWizard({ initial, onSave, onClose }) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState(initial?.name || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [trigger, setTrigger] = useState(initial?.trigger || { type: 'time', time: '08:00' })
  const [actions, setActions] = useState(initial?.actions || [])
  const [collapsedActions, setCollapsedActions] = useState(new Set())
  const [saving, setSaving] = useState(false)

  const addAction = () => {
    setCollapsedActions((prev) => {
      const next = new Set(prev)
      actions.forEach((_, i) => next.add(i))
      return next
    })
    setActions((a) => [...a, { type: 'call_service', entity_id: '', service: 'homeassistant.turn_on' }])
  }

  const updateAction = (i, val) =>
    setActions((a) => a.map((x, j) => (j === i ? val : x)))

  const removeAction = (i) => {
    setActions((a) => a.filter((_, j) => j !== i))
    setCollapsedActions((prev) => {
      const next = new Set()
      prev.forEach((idx) => { if (idx < i) next.add(idx); else if (idx > i) next.add(idx - 1) })
      return next
    })
  }

  const toggleCollapse = (i) =>
    setCollapsedActions((prev) => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })

  const canNext = () => {
    if (step === 0) return name.trim().length > 0
    if (step === 1) return !!trigger.type
    return true
  }

  const handleSave = async () => {
    setSaving(true)
    await onSave({ name, description, trigger, conditions: [], actions })
    setSaving(false)
    onClose()
  }

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
              <Input
                label="Automation name"
                placeholder="e.g. Morning Lights"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              <Textarea
                label="Description (optional)"
                placeholder="What does this automation do?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          )}

          {step === 1 && (
            <TriggerEditor trigger={trigger} onChange={setTrigger} />
          )}

          {step === 2 && (
            <div className="flex flex-col gap-3">
              {actions.map((action, i) => (
                <ActionRow
                  key={i}
                  action={action}
                  index={i}
                  onChange={(v) => updateAction(i, v)}
                  onRemove={() => removeAction(i)}
                  collapsed={collapsedActions.has(i)}
                  onToggleCollapse={() => toggleCollapse(i)}
                />
              ))}
              <Button variant="secondary" onClick={addAction} className="w-full">
                <Plus size={14} /> Add action
              </Button>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-3">
              <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4 flex flex-col gap-2">
                <p className="font-semibold text-zinc-900 dark:text-zinc-100">{name}</p>
                {description && <p className="text-sm text-zinc-500">{description}</p>}
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="violet">
                    {TRIGGER_TYPES.find((t) => t.value === trigger.type)?.label}
                  </Badge>
                  {trigger.time && <Badge>{trigger.time}</Badge>}
                  {trigger.entity_id && <Badge>{trigger.entity_id}</Badge>}
                </div>
              </div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {actions.length} action{actions.length !== 1 ? 's' : ''}
              </p>
              {actions.map((a, i) => (
                <div key={i} className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                  <span className="text-base">{ACTION_TYPES.find((t) => t.value === a.type)?.label.split(' ')[0]}</span>
                  <span>{a.entity_id || a.text || a.message || `${a.seconds}s`}</span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Nav buttons */}
      <div className="flex gap-2 mt-6">
        {step > 0 && (
          <Button variant="secondary" onClick={() => setStep((s) => s - 1)} className="flex-1">
            Back
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          <Button
            variant="primary"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canNext()}
            className="flex-1"
          >
            Next
          </Button>
        ) : (
          <Button
            variant="violet"
            onClick={handleSave}
            disabled={saving}
            className="flex-1"
          >
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Create automation'}
          </Button>
        )}
      </div>
    </div>
  )
}

function AutomationCard({ automation, onToggle, onEdit, onDelete, onTrigger }) {
  const triggerLabel = TRIGGER_TYPES.find((t) => t.value === automation.trigger?.type)?.label || 'Unknown'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
    >
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
            automation.enabled ? 'bg-violet-50 dark:bg-violet-900/20' : 'bg-zinc-100 dark:bg-zinc-800'
          )}>
            <Zap size={18} className={automation.enabled ? 'text-violet-600' : 'text-zinc-400'} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">{automation.name}</p>
            </div>
            {automation.description && (
              <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-0.5 truncate">{automation.description}</p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <Badge variant={automation.enabled ? 'violet' : 'default'} className="text-[10px]">
                {triggerLabel}
              </Badge>
              {automation.trigger?.time && (
                <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                  <Clock size={10} /> {automation.trigger.time}
                </span>
              )}
              <span className="text-[10px] text-zinc-400">
                {automation.actions?.length || 0} action{automation.actions?.length !== 1 ? 's' : ''}
              </span>
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
                onClick={() => onEdit(automation)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <Edit2 size={13} />
              </button>
              <button
                onClick={() => onDelete(automation.id)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
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

export default function Automations() {
  const {
    automations, loading, fetchAutomations, addAutomation, removeAutomation,
    toggleAutomation, triggerAutomation, loadAutomationConfig,
  } = useAutomationStore()
  const { addToast } = useUIStore()
  const [showWizard, setShowWizard] = useState(false)
  const [editTarget, setEditTarget] = useState(null)

  useEffect(() => { fetchAutomations() }, [])

  const handleSave = async (data) => {
    try {
      await addAutomation(data)
      addToast('Automation saved to Home Assistant', 'success')
    } catch {
      addToast('Failed to save automation', 'error')
    }
  }

  const handleDelete = async (id) => {
    try {
      await removeAutomation(id)
      addToast('Deleted from Home Assistant', 'success')
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

  const handleClose = () => {
    setShowWizard(false)
    setEditTarget(null)
  }

  const enabled = automations.filter((a) => a.enabled).length

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Automations</h1>
          <p className="text-sm text-zinc-400 dark:text-zinc-600 mt-0.5">
            {enabled} enabled · {automations.length} total
          </p>
        </div>
        <Button onClick={() => setShowWizard(true)} size="sm">
          <Plus size={14} /> New
        </Button>
      </div>

      {/* List */}
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

      {/* Wizard modal */}
      <Modal
        open={showWizard}
        onClose={handleClose}
        title={editTarget ? 'Edit Automation' : 'New Automation'}
      >
        <AutomationWizard
          initial={editTarget}
          onSave={handleSave}
          onClose={handleClose}
        />
      </Modal>
    </div>
  )
}
