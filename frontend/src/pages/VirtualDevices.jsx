import { useEffect, useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Edit2, Play, Cpu } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { Toggle } from '../components/ui/Toggle'
import { useUIStore } from '../stores/uiStore'
import { useDeviceStore } from '../stores/deviceStore'
import { cn } from '../lib/utils'
import {
  getCapabilities, getVirtualDevices, createVirtualDevice,
  patchVirtualDevice, deleteVirtualDevice, triggerVirtualDevice,
  getEntities,
} from '../lib/api'

// Dropdown that fetches HA entities and stores friendly_name.toLowerCase() as value
function EntityHintSelect({ label, domain, value, onChange }) {
  const [options, setOptions] = useState([])

  useEffect(() => {
    getEntities(domain)
      .then((res) => {
        const entities = res.entities || []
        setOptions(
          entities.map((e) => ({
            value: (e.friendly_name || e.entity_id.split('.')[1]).toLowerCase(),
            label: e.friendly_name || e.entity_id.split('.')[1],
          }))
        )
      })
      .catch(() => {})
  }, [domain])

  return (
    <Select
      label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      options={[{ value: '', label: '— pick one —' }, ...options]}
    />
  )
}

// ── Param helpers ─────────────────────────────────────────────────────────────

/** Filter a params_schema to only config or only runtime entries */
function filterParams(schema, type) {
  return Object.entries(schema || {}).filter(([, s]) => (s.param_type || 'config') === type)
}

function hasRuntimeParams(capability) {
  return filterParams(capability?.params_schema, 'runtime').length > 0
}

// ── Reusable field ────────────────────────────────────────────────────────────

function ParamField({ schema, value, onChange }) {
  if (schema.input_mode === 'media_select') {
    return (
      <EntityHintSelect
        label={schema.label + (schema.required ? ' *' : '')}
        domain="media_player"
        value={value}
        onChange={onChange}
      />
    )
  }
  if (schema.input_mode === 'camera_select') {
    return (
      <EntityHintSelect
        label={schema.label + (schema.required ? ' *' : '')}
        domain="camera"
        value={value}
        onChange={onChange}
      />
    )
  }
  if (schema.type === 'boolean') {
    return (
      <label className="flex items-center gap-3 cursor-pointer">
        <Toggle checked={!!value} onCheckedChange={onChange} />
        <span className="text-sm text-zinc-700 dark:text-zinc-300">{schema.label}</span>
      </label>
    )
  }
  if (schema.type === 'select') {
    return (
      <Select
        label={schema.label}
        value={value ?? schema.default ?? ''}
        onChange={(e) => onChange(e.target.value)}
        options={(schema.options || []).map((o) => ({ value: o, label: o }))}
      />
    )
  }
  return (
    <Input
      label={schema.label + (schema.required ? ' *' : '')}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={schema.placeholder ?? (schema.default != null ? String(schema.default) : '')}
    />
  )
}

// ── Wizard ────────────────────────────────────────────────────────────────────

const WIZARD_STEPS = ['Capability', 'Configure', 'Assign']

function StepIndicator({ current }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {WIZARD_STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div className={cn(
            'w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-colors',
            i < current ? 'bg-violet-600 text-white'
              : i === current ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600 ring-2 ring-violet-600'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
          )}>
            {i < current ? '✓' : i + 1}
          </div>
          {i < WIZARD_STEPS.length - 1 && (
            <div className={cn('w-8 h-0.5 rounded', i < current ? 'bg-violet-600' : 'bg-zinc-200 dark:bg-zinc-700')} />
          )}
        </div>
      ))}
    </div>
  )
}

function AddVirtualDeviceWizard({ onSave, onClose, rooms, categories, capabilities }) {
  const [step, setStep] = useState(0)
  const [selectedCap, setSelectedCap] = useState(null)
  const [name, setName] = useState('')
  const [params, setParams] = useState({})
  const [room, setRoom] = useState('')
  const [filterCat, setFilterCat] = useState('all')
  const [saving, setSaving] = useState(false)

  const filteredCaps = filterCat === 'all'
    ? capabilities
    : capabilities.filter((c) => c.category === filterCat)

  // Config params only — these are what define the device instance
  const configParams = selectedCap ? filterParams(selectedCap.params_schema, 'config') : []
  const runtimeParams = selectedCap ? filterParams(selectedCap.params_schema, 'runtime') : []

  const selectCapability = (cap) => {
    setSelectedCap(cap)
    setName(cap.name)
    const defaults = {}
    Object.entries(cap.params_schema || {}).forEach(([k, s]) => {
      if ((s.param_type || 'config') === 'config' && s.default != null) defaults[k] = s.default
    })
    setParams(defaults)
  }

  const setParam = (key, value) => setParams((p) => ({ ...p, [key]: value }))

  const canNext = () => {
    if (step === 0) return !!selectedCap
    if (step === 1) {
      const allConfigRequired = configParams.every(([k, s]) =>
        !s.required || (params[k] != null && params[k] !== '')
      )
      return allConfigRequired && name.trim().length > 0
    }
    return true
  }

  const handleSave = async () => {
    setSaving(true)
    await onSave({
      name: name.trim(),
      capability: selectedCap.id,
      room: room || null,
      default_params: params,
    })
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
          {/* Step 0 — pick capability */}
          {step === 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setFilterCat('all')}
                  className={cn('px-3 py-1 rounded-full text-xs font-medium transition-colors',
                    filterCat === 'all' ? 'bg-violet-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                  )}
                >All</button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setFilterCat(cat.id)}
                    className={cn('px-3 py-1 rounded-full text-xs font-medium transition-colors',
                      filterCat === cat.id ? 'bg-violet-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                    )}
                  >
                    {cat.icon} {cat.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto scrollbar-thin pr-1">
                {filteredCaps.map((cap) => (
                  <button
                    key={cap.id}
                    onClick={() => selectCapability(cap)}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all',
                      selectedCap?.id === cap.id
                        ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20'
                        : 'border-zinc-200 dark:border-zinc-700 hover:border-violet-300 dark:hover:border-violet-700 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                    )}
                  >
                    <span className="text-xl shrink-0">{cap.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{cap.name}</p>
                      <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate">{cap.description}</p>
                    </div>
                    {selectedCap?.id === cap.id && <span className="text-violet-500 shrink-0">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 1 — configure: only config params */}
          {step === 1 && selectedCap && (
            <div className="flex flex-col gap-4">
              <Input
                label="Device name *"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />

              {configParams.map(([key, schema]) => (
                <ParamField
                  key={key}
                  schema={schema}
                  value={params[key]}
                  onChange={(v) => setParam(key, v)}
                />
              ))}

              {configParams.length === 0 && (
                <p className="text-sm text-zinc-400 dark:text-zinc-500 text-center py-2">
                  No configuration needed for this capability.
                </p>
              )}

              {/* Inform user about runtime params */}
              {runtimeParams.length > 0 && (
                <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 px-4 py-3 mt-1">
                  <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Provided at runtime by voice or automation:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {runtimeParams.map(([key, schema]) => (
                      <span key={key} className="text-[11px] text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-700 px-2 py-0.5 rounded-full">
                        {schema.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2 — assign to room */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <Select
                label="Assign to room (optional)"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                options={[
                  { value: '', label: '— No room —' },
                  ...rooms.map((r) => ({ value: r.id, label: r.name })),
                ]}
              />
              <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">{selectedCap?.icon}</span>
                  <div>
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">{name}</p>
                    <p className="text-xs text-zinc-400">{selectedCap?.description}</p>
                  </div>
                </div>
                {Object.keys(params).filter((k) => params[k] != null && params[k] !== '').length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {Object.entries(params).map(([k, v]) =>
                      v != null && v !== '' ? (
                        <Badge key={k} className="text-[10px]">{k}: {String(v)}</Badge>
                      ) : null
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="flex gap-2 mt-6">
        {step > 0 && (
          <Button variant="secondary" onClick={() => setStep((s) => s - 1)} className="flex-1">Back</Button>
        )}
        {step < WIZARD_STEPS.length - 1 ? (
          <Button variant="primary" onClick={() => setStep((s) => s + 1)} disabled={!canNext()} className="flex-1">
            Next
          </Button>
        ) : (
          <Button variant="violet" onClick={handleSave} disabled={saving || !canNext()} className="flex-1">
            {saving ? 'Saving…' : 'Add device'}
          </Button>
        )}
      </div>
    </div>
  )
}

// ── Runtime params trigger modal ──────────────────────────────────────────────

function TriggerModal({ device, capability, onConfirm, onClose }) {
  const runtimeEntries = filterParams(capability?.params_schema, 'runtime')
  const [values, setValues] = useState({})
  const [running, setRunning] = useState(false)

  const setValue = (key, val) => setValues((v) => ({ ...v, [key]: val }))

  const handleRun = async () => {
    setRunning(true)
    await onConfirm(device, values)
    setRunning(false)
    onClose()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 mb-1">
        <span className="text-2xl">{device.icon}</span>
        <div>
          <p className="font-semibold text-zinc-900 dark:text-zinc-100">{device.name}</p>
          <p className="text-xs text-zinc-400">{capability?.description}</p>
        </div>
      </div>

      {runtimeEntries.map(([key, schema]) => (
        <ParamField
          key={key}
          schema={schema}
          value={values[key]}
          onChange={(v) => setValue(key, v)}
        />
      ))}

      <div className="flex gap-2 mt-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
        <Button variant="violet" onClick={handleRun} disabled={running} className="flex-1">
          {running ? 'Running…' : 'Run'}
        </Button>
      </div>
    </div>
  )
}

// ── Device card ───────────────────────────────────────────────────────────────

function VirtualDeviceCard({ device, onToggle, onTrigger, onEdit, onDelete, triggering }) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0',
            device.enabled ? 'bg-violet-50 dark:bg-violet-900/20' : 'bg-zinc-100 dark:bg-zinc-800 opacity-50'
          )}>
            {device.icon}
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">{device.name}</p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate mt-0.5">{device.capability}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <Badge variant="violet" className="text-[10px]">{device.category}</Badge>
              {device.room && <Badge className="text-[10px]">📍 {device.room}</Badge>}
              {device.last_triggered && (
                <span className="text-[10px] text-zinc-400">Last run: {device.last_triggered}</span>
              )}
            </div>
            {Object.keys(device.default_params || {}).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {Object.entries(device.default_params).slice(0, 3).map(([k, v]) => (
                  <span key={k} className="text-[10px] text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-md truncate max-w-[120px]">
                    {k}: {String(v)}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <Toggle checked={device.enabled} onCheckedChange={() => onToggle(device)} />
            <div className="flex gap-1">
              <button
                onClick={() => onTrigger(device)}
                disabled={triggering === device.id}
                className={cn(
                  'p-1.5 rounded-lg transition-colors',
                  triggering === device.id
                    ? 'text-zinc-300 dark:text-zinc-600 cursor-not-allowed'
                    : 'text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
                )}
                title="Run now"
              >
                <Play size={13} />
              </button>
              <button
                onClick={() => onEdit(device)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <Edit2 size={13} />
              </button>
              <button
                onClick={() => onDelete(device)}
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

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditVirtualDevice({ device, capability, rooms, onSave, onClose }) {
  const [name, setName] = useState(device.name)
  const [room, setRoom] = useState(device.room || '')
  const [enabled, setEnabled] = useState(device.enabled)
  const [params, setParams] = useState(device.default_params || {})
  const [saving, setSaving] = useState(false)

  const configParams = filterParams(capability?.params_schema, 'config')
  const setParam = (key, val) => setParams((p) => ({ ...p, [key]: val }))

  const handleSave = async () => {
    setSaving(true)
    await onSave(device.id, { name, room: room || null, enabled, default_params: params })
    setSaving(false)
    onClose()
  }

  return (
    <div className="flex flex-col gap-4">
      <Input label="Device name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />

      {configParams.map(([key, schema]) => (
        <ParamField key={key} schema={schema} value={params[key]} onChange={(v) => setParam(key, v)} />
      ))}

      <Select
        label="Room"
        value={room}
        onChange={(e) => setRoom(e.target.value)}
        options={[
          { value: '', label: '— No room —' },
          ...rooms.map((r) => ({ value: r.id, label: r.name })),
        ]}
      />
      <label className="flex items-center gap-3 cursor-pointer">
        <Toggle checked={enabled} onCheckedChange={setEnabled} />
        <span className="text-sm text-zinc-700 dark:text-zinc-300">Enabled</span>
      </label>
      <div className="flex gap-2 mt-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
        <Button variant="violet" onClick={handleSave} disabled={saving || !name.trim()} className="flex-1">
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function VirtualDevices() {
  const { addToast } = useUIStore()
  const { getRooms } = useDeviceStore()
  const [devices, setDevices] = useState([])
  const [capabilities, setCapabilities] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editDevice, setEditDevice] = useState(null)
  const [triggerDevice, setTriggerDevice] = useState(null)
  const [triggering, setTriggering] = useState(null)
  const [filterCat, setFilterCat] = useState('all')

  const rooms = getRooms()

  // Build a quick lookup map: capability id → capability object
  const capMap = useMemo(
    () => Object.fromEntries(capabilities.map((c) => [c.id, c])),
    [capabilities]
  )

  const fetchDevices = useCallback(async () => {
    try {
      const data = await getVirtualDevices()
      setDevices(data.devices || [])
    } catch {
      addToast('Failed to load virtual devices', 'error')
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetchDevices(),
      getCapabilities().then((d) => {
        setCapabilities(d.capabilities || [])
        setCategories(d.categories || [])
      }),
    ]).finally(() => setLoading(false))
  }, [])

  const handleCreate = async (data) => {
    try {
      const res = await createVirtualDevice(data)
      setDevices((prev) => [...prev, res.device])
      addToast(`"${res.device.name}" added`, 'success')
    } catch (e) {
      addToast(e.message || 'Failed to create device', 'error')
      throw e
    }
  }

  const handlePatch = async (id, updates) => {
    try {
      const updated = await patchVirtualDevice(id, updates)
      setDevices((prev) => prev.map((d) => (d.id === id ? updated : d)))
      addToast('Device updated', 'success')
    } catch (e) {
      addToast(e.message || 'Failed to update', 'error')
    }
  }

  const handleToggle = (device) => handlePatch(device.id, { enabled: !device.enabled })

  const handleDelete = async (device) => {
    try {
      await deleteVirtualDevice(device.id)
      setDevices((prev) => prev.filter((d) => d.id !== device.id))
      addToast(`"${device.name}" deleted`, 'success')
    } catch {
      addToast('Failed to delete', 'error')
    }
  }

  /** If the capability has runtime params, open the prompt modal. Otherwise trigger directly. */
  const handleTrigger = (device) => {
    const cap = capMap[device.capability]
    if (cap && hasRuntimeParams(cap)) {
      setTriggerDevice(device)
    } else {
      doTrigger(device, null)
    }
  }

  const doTrigger = async (device, runtimeParams) => {
    setTriggering(device.id)
    try {
      const result = await triggerVirtualDevice(device.id, runtimeParams)
      addToast(
        result.ok ? `✓ ${device.name}: ${result.message || 'Done'}` : `✗ ${result.message || 'Failed'}`,
        result.ok ? 'success' : 'error',
      )
      fetchDevices()
    } catch (e) {
      addToast(e.message || 'Trigger failed', 'error')
    } finally {
      setTriggering(null)
    }
  }

  const filtered = filterCat === 'all' ? devices : devices.filter((d) => d.category === filterCat)
  const catCounts = categories.reduce((acc, cat) => {
    acc[cat.id] = devices.filter((d) => d.category === cat.id).length
    return acc
  }, {})

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Capabilities</h1>
          <p className="text-sm text-zinc-400 dark:text-zinc-600 mt-0.5">
            {devices.filter((d) => d.enabled).length} active · {devices.length} total
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)} size="sm">
          <Plus size={14} /> Add capability
        </Button>
      </div>

      {/* Category filter */}
      {devices.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-4">
          <button
            onClick={() => setFilterCat('all')}
            className={cn('px-3 py-1 rounded-full text-xs font-medium transition-colors',
              filterCat === 'all' ? 'bg-violet-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700'
            )}
          >
            All ({devices.length})
          </button>
          {categories.filter((c) => catCounts[c.id] > 0).map((cat) => (
            <button
              key={cat.id}
              onClick={() => setFilterCat(cat.id)}
              className={cn('px-3 py-1 rounded-full text-xs font-medium transition-colors',
                filterCat === cat.id ? 'bg-violet-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              )}
            >
              {cat.icon} {cat.label} ({catCounts[cat.id]})
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-2xl bg-zinc-100 dark:bg-zinc-800 animate-pulse" />)}
        </div>
      )}

      {!loading && devices.length === 0 && (
        <div className="text-center py-20 text-zinc-400 dark:text-zinc-600">
          <Cpu size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No capabilities configured yet</p>
          <p className="text-xs mt-1 mb-4">Add YouTube, Spotify, weather, email readers, and more</p>
          <Button variant="secondary" size="sm" onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Add first capability
          </Button>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        <div className="flex flex-col gap-3">
          {filtered.map((device) => (
            <VirtualDeviceCard
              key={device.id}
              device={device}
              onToggle={handleToggle}
              onTrigger={handleTrigger}
              onEdit={setEditDevice}
              onDelete={handleDelete}
              triggering={triggering}
            />
          ))}
        </div>
      </AnimatePresence>

      {/* Add wizard */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Capability">
        <AddVirtualDeviceWizard
          onSave={handleCreate}
          onClose={() => setShowAdd(false)}
          rooms={rooms}
          categories={categories}
          capabilities={capabilities}
        />
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editDevice} onClose={() => setEditDevice(null)} title="Edit Capability">
        {editDevice && (
          <EditVirtualDevice
            device={editDevice}
            capability={capMap[editDevice.capability]}
            rooms={rooms}
            onSave={handlePatch}
            onClose={() => setEditDevice(null)}
          />
        )}
      </Modal>

      {/* Runtime params trigger modal */}
      <Modal
        open={!!triggerDevice}
        onClose={() => setTriggerDevice(null)}
        title={`Run: ${triggerDevice?.name}`}
      >
        {triggerDevice && (
          <TriggerModal
            device={triggerDevice}
            capability={capMap[triggerDevice.capability]}
            onConfirm={doTrigger}
            onClose={() => setTriggerDevice(null)}
          />
        )}
      </Modal>
    </div>
  )
}
