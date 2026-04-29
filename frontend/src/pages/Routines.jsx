import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Edit2, Play, RotateCcw, Clock, ChevronRight } from 'lucide-react'
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

const ICONS = ['⚡', '☀️', '🌙', '🏠', '🎬', '🏋️', '🛏️', '☕', '🌿', '🔒', '💡', '🎵']

const DAYS = [
  { id: 'mon', label: 'M' },
  { id: 'tue', label: 'T' },
  { id: 'wed', label: 'W' },
  { id: 'thu', label: 'T' },
  { id: 'fri', label: 'F' },
  { id: 'sat', label: 'S' },
  { id: 'sun', label: 'S' },
]

const STEP_TYPES = [
  { value: 'device',       label: '💡 Device control' },
  { value: 'ir_command',   label: '📡 IR Command' },
  { value: 'ziggy_intent', label: '⚡ Ziggy Capability' },
  { value: 'scene',        label: '🎨 Scene' },
  { value: 'delay',        label: '⏱ Wait' },
  { value: 'message',      label: '💬 Send command' },
]

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

const STEPS_WIZARD = ['Name', 'Schedule', 'Steps', 'Review']

function StepIndicator({ current }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {STEPS_WIZARD.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div className={cn(
            'w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-colors',
            i < current ? 'bg-violet-600 text-white'
              : i === current ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600 ring-2 ring-violet-600'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
          )}>
            {i < current ? '✓' : i + 1}
          </div>
          {i < STEPS_WIZARD.length - 1 && (
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

function StepRow({ step, index, onChange, onRemove, collapsed, onToggleCollapse }) {
  const domain = step.entity_id?.split('.')?.[0] || null
  const availableActions = (step.type === 'device' && domain)
    ? getActionsForDomain(domain)
    : [
        { value: 'turn_on', label: 'Turn On' },
        { value: 'turn_off', label: 'Turn Off' },
        { value: 'toggle', label: 'Toggle' },
      ]

  const stepLabel = step.type === 'device'
    ? `${availableActions.find(a => a.value === step.action)?.label || 'Control'} · ${step.entity_id || '?'}`
    : step.type === 'ir_command' ? `📡 ${step.ir_device_name || 'IR'} → ${step.ir_sequence || step.ir_command || '?'}`
    : step.type === 'ziggy_intent' ? `⚡ ${step.virtual_device_name || step.capability || 'Capability'}`
    : step.type === 'delay' ? `Wait ${step.delay_seconds || '?'}s`
    : step.type === 'scene' ? `Scene: ${step.entity_id || '?'}`
    : step.text || 'Send command'

  if (collapsed) {
    return (
      <div
        onClick={onToggleCollapse}
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
      >
        <span className="w-5 h-5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 text-[10px] font-bold flex items-center justify-center shrink-0">
          {index + 1}
        </span>
        <span className="flex-1 text-xs text-zinc-700 dark:text-zinc-300 truncate">{stepLabel}</span>
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
        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Step {index + 1}</span>
        <div className="flex gap-1">
          <button onClick={onToggleCollapse} className="text-zinc-400 hover:text-zinc-600 p-1 text-xs">Collapse</button>
          <button onClick={onRemove} className="text-red-400 hover:text-red-600 p-1">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <Select
        options={STEP_TYPES}
        value={step.type || 'device'}
        onChange={(e) => onChange({ type: e.target.value })}
      />
      {step.type === 'ir_command' && (
        <IRDeviceSelect
          value={step}
          onChange={(patch) => onChange({ ...step, ...patch })}
        />
      )}
      {step.type === 'ziggy_intent' && (
        <VirtualDeviceSelect
          value={step.virtual_device_id || ''}
          runtimeParams={step.runtime_params || {}}
          onDeviceChange={(id, dev) => onChange({
            ...step,
            virtual_device_id: id,
            capability: dev?.capability || '',
            virtual_device_name: dev?.name || '',
            runtime_params: {},
          })}
          onParamChange={(key, val) => onChange({
            ...step,
            runtime_params: { ...(step.runtime_params || {}), [key]: val },
          })}
        />
      )}
      {step.type === 'device' && (
        <>
          <EntitySelect
            value={step.entity_id || ''}
            onChange={(v) => onChange({ ...step, entity_id: v, action: 'turn_on' })}
            placeholder="Select entity…"
          />
          <Select
            options={availableActions}
            value={step.action || 'turn_on'}
            onChange={(e) => onChange({ ...step, action: e.target.value })}
          />
        </>
      )}
      {step.type === 'delay' && (
        <Input
          type="number"
          placeholder="Seconds to wait"
          value={step.delay_seconds || ''}
          onChange={(e) => onChange({ ...step, delay_seconds: parseInt(e.target.value) })}
        />
      )}
      {step.type === 'message' && (
        <Input
          placeholder="Command (e.g. turn off all lights)"
          value={step.text || ''}
          onChange={(e) => onChange({ ...step, text: e.target.value })}
        />
      )}
      {step.type === 'scene' && (
        <EntitySelect
          value={step.entity_id || ''}
          onChange={(v) => onChange({ ...step, entity_id: v })}
          domain="scene"
          placeholder="Select scene…"
        />
      )}
    </div>
  )
}

function RoutineWizard({ initial, onSave, onClose }) {
  const [wizardStep, setWizardStep] = useState(0)
  const [name, setName] = useState(initial?.name || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [icon, setIcon] = useState(initial?.icon || '⚡')
  const [scheduleType, setScheduleType] = useState(initial?.schedule?.type || 'manual')
  const [scheduleTime, setScheduleTime] = useState(initial?.schedule?.time || '08:00')
  const [days, setDays] = useState(initial?.schedule?.days || [])
  const [steps, setSteps] = useState(initial?.steps || [])
  const [collapsedSteps, setCollapsedSteps] = useState(new Set())
  const [saving, setSaving] = useState(false)

  const toggleDay = (d) =>
    setDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d])

  const addStep = () => {
    setCollapsedSteps((prev) => {
      const next = new Set(prev)
      steps.forEach((_, i) => next.add(i))
      return next
    })
    setSteps((s) => [...s, { type: 'device', entity_id: '', action: 'turn_on' }])
  }

  const updateStep = (i, val) => setSteps((s) => s.map((x, j) => (j === i ? val : x)))

  const removeStep = (i) => {
    setSteps((s) => s.filter((_, j) => j !== i))
    setCollapsedSteps((prev) => {
      const next = new Set()
      prev.forEach((idx) => { if (idx < i) next.add(idx); else if (idx > i) next.add(idx - 1) })
      return next
    })
  }

  const toggleCollapseStep = (i) =>
    setCollapsedSteps((prev) => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })

  const canNext = () => wizardStep === 0 ? name.trim().length > 0 : true

  const handleSave = async () => {
    setSaving(true)
    await onSave({
      name, description, icon,
      schedule: { type: scheduleType, time: scheduleTime, days },
      steps,
    })
    setSaving(false)
    onClose()
  }

  return (
    <div>
      <StepIndicator current={wizardStep} />

      <AnimatePresence mode="wait">
        <motion.div
          key={wizardStep}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.15 }}
        >
          {wizardStep === 0 && (
            <div className="flex flex-col gap-4">
              {/* Icon picker */}
              <div>
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Icon</p>
                <div className="flex flex-wrap gap-2">
                  {ICONS.map((ic) => (
                    <button
                      key={ic}
                      onClick={() => setIcon(ic)}
                      className={cn(
                        'w-9 h-9 rounded-xl text-xl flex items-center justify-center transition-all',
                        ic === icon
                          ? 'bg-violet-100 dark:bg-violet-900/40 ring-2 ring-violet-500'
                          : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                      )}
                    >
                      {ic}
                    </button>
                  ))}
                </div>
              </div>
              <Input
                label="Routine name"
                placeholder="e.g. Good Morning"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              <Textarea
                label="Description (optional)"
                placeholder="What does this routine do?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
          )}

          {wizardStep === 1 && (
            <div className="flex flex-col gap-4">
              <Select
                label="Schedule type"
                options={[
                  { value: 'manual', label: '▶ Manual only' },
                  { value: 'daily', label: '📅 Daily at a time' },
                  { value: 'weekly', label: '🗓 Weekly on specific days' },
                ]}
                value={scheduleType}
                onChange={(e) => setScheduleType(e.target.value)}
              />
              {(scheduleType === 'daily' || scheduleType === 'weekly') && (
                <Input
                  label="Time"
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                />
              )}
              {scheduleType === 'weekly' && (
                <div>
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Days</p>
                  <div className="flex gap-2">
                    {DAYS.map(({ id, label }) => (
                      <button
                        key={id}
                        onClick={() => toggleDay(id)}
                        className={cn(
                          'w-9 h-9 rounded-full text-xs font-semibold transition-all',
                          days.includes(id)
                            ? 'bg-violet-600 text-white'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {wizardStep === 2 && (
            <div className="flex flex-col gap-3">
              {steps.map((step, i) => (
                <StepRow
                  key={i}
                  step={step}
                  index={i}
                  onChange={(v) => updateStep(i, v)}
                  onRemove={() => removeStep(i)}
                  collapsed={collapsedSteps.has(i)}
                  onToggleCollapse={() => toggleCollapseStep(i)}
                />
              ))}
              <Button variant="secondary" onClick={addStep} className="w-full">
                <Plus size={14} /> Add step
              </Button>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="flex flex-col gap-3">
              <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">{icon}</span>
                  <div>
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">{name}</p>
                    {description && <p className="text-xs text-zinc-500">{description}</p>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Badge variant={scheduleType === 'manual' ? 'default' : 'violet'}>
                    {scheduleType === 'manual' ? 'Manual' : scheduleType === 'daily' ? `Daily ${scheduleTime}` : `Weekly ${scheduleTime}`}
                  </Badge>
                  {scheduleType === 'weekly' && days.map((d) => (
                    <Badge key={d}>{d}</Badge>
                  ))}
                </div>
              </div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {steps.length} step{steps.length !== 1 ? 's' : ''}
              </p>
              {steps.map((s, i) => (
                <div key={i} className="text-sm text-zinc-500 flex items-center gap-2">
                  <span>{STEP_TYPES.find((t) => t.value === s.type)?.label.split(' ')[0]}</span>
                  <span>{s.entity_id || s.text || `${s.delay_seconds}s`}</span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="flex gap-2 mt-6">
        {wizardStep > 0 && (
          <Button variant="secondary" onClick={() => setWizardStep((s) => s - 1)} className="flex-1">
            Back
          </Button>
        )}
        {wizardStep < STEPS_WIZARD.length - 1 ? (
          <Button variant="primary" onClick={() => setWizardStep((s) => s + 1)} disabled={!canNext()} className="flex-1">
            Next
          </Button>
        ) : (
          <Button variant="violet" onClick={handleSave} disabled={saving} className="flex-1">
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Create routine'}
          </Button>
        )}
      </div>
    </div>
  )
}

function RoutineCard({ routine, onToggle, onEdit, onDelete, onRun }) {
  const schedType = routine.schedule?.type || 'manual'

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0',
            routine.enabled ? 'bg-zinc-100 dark:bg-zinc-800' : 'bg-zinc-50 dark:bg-zinc-900 opacity-50'
          )}>
            {routine.icon || '⚡'}
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">{routine.name}</p>
            {routine.description && (
              <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-0.5 truncate">{routine.description}</p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <Badge variant={schedType !== 'manual' ? 'violet' : 'default'} className="text-[10px]">
                {schedType === 'manual' ? 'Manual' : schedType === 'daily' ? `Daily ${routine.schedule.time}` : `Weekly`}
              </Badge>
              <span className="text-[10px] text-zinc-400">
                {routine.steps?.length || 0} step{routine.steps?.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <Toggle checked={routine.enabled} onCheckedChange={() => onToggle(routine.id)} />
            <div className="flex gap-1">
              <button
                onClick={() => onRun(routine)}
                className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                title="Run now"
              >
                <Play size={13} />
              </button>
              <button
                onClick={() => onEdit(routine)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <Edit2 size={13} />
              </button>
              <button
                onClick={() => onDelete(routine.id)}
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

export default function Routines() {
  const { routines, loading, fetchRoutines, addRoutine, toggleRoutine, removeRoutine, runRoutine, loadRoutineConfig } =
    useAutomationStore()
  const { addToast } = useUIStore()
  const [showWizard, setShowWizard] = useState(false)
  const [editTarget, setEditTarget] = useState(null)

  useEffect(() => { fetchRoutines() }, [])

  const handleSave = async (data) => {
    try {
      await addRoutine(data)
      addToast('Script saved to Home Assistant', 'success')
    } catch {
      addToast('Failed to save routine', 'error')
    }
  }

  const handleDelete = async (id) => {
    try {
      await removeRoutine(id)
      addToast('Deleted from Home Assistant', 'success')
    } catch {
      addToast('Failed to delete', 'error')
    }
  }

  const handleRun = async (routine) => {
    try {
      await runRoutine(routine.id)
      addToast(`Running "${routine.name}"`, 'success')
    } catch {
      addToast('Failed to run routine', 'error')
    }
  }

  const handleEdit = async (routine) => {
    try {
      const config = await loadRoutineConfig(routine.id)
      setEditTarget(config || routine)
    } catch {
      setEditTarget(routine)
    }
    setShowWizard(true)
  }

  const handleClose = () => {
    setShowWizard(false)
    setEditTarget(null)
  }

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Routines</h1>
          <p className="text-sm text-zinc-400 dark:text-zinc-600 mt-0.5">
            {routines.filter((r) => r.enabled).length} enabled · {routines.length} total
          </p>
        </div>
        <Button onClick={() => setShowWizard(true)} size="sm">
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

      {!loading && routines.length === 0 && (
        <div className="text-center py-20 text-zinc-400 dark:text-zinc-600">
          <RotateCcw size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No routines yet</p>
          <p className="text-xs mt-1 mb-4">Build sequences of actions to run on demand</p>
          <Button variant="secondary" onClick={() => setShowWizard(true)} size="sm">
            <Plus size={14} /> Create routine
          </Button>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        <div className="flex flex-col gap-3">
          {routines.map((r) => (
            <RoutineCard
              key={r.id}
              routine={r}
              onToggle={toggleRoutine}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onRun={handleRun}
            />
          ))}
        </div>
      </AnimatePresence>

      <Modal
        open={showWizard}
        onClose={handleClose}
        title={editTarget ? 'Edit Routine' : 'New Routine'}
      >
        <RoutineWizard initial={editTarget} onSave={handleSave} onClose={handleClose} />
      </Modal>
    </div>
  )
}
