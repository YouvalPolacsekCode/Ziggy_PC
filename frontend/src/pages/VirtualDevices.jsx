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
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <Toggle checked={!!value} onCheckedChange={onChange} />
        <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{schema.label}</span>
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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 20 }}>
      {WIZARD_STEPS.map((s, i) => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, background: i < current ? 'var(--ink)' : i === current ? `color-mix(in srgb, var(--ink) 12%, var(--surface))` : 'var(--bg-2)', color: i < current ? 'var(--bg)' : i === current ? 'var(--ink)' : 'var(--ink-faint)', border: i === current ? '1.5px solid var(--ink)' : '0.5px solid var(--line)' }}>
            {i < current ? '✓' : i + 1}
          </div>
          {i < WIZARD_STEPS.length - 1 && <div style={{ width: 24, height: 1, background: i < current ? 'var(--ink)' : 'var(--line)' }} />}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <button onClick={() => setFilterCat('all')} style={{ padding: '4px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', background: filterCat === 'all' ? 'var(--ink)' : 'var(--surface)', color: filterCat === 'all' ? 'var(--bg)' : 'var(--ink-mute)', border: filterCat === 'all' ? 'none' : '0.5px solid var(--line)' }}>All</button>
                {categories.map(cat => (
                  <button key={cat.id} onClick={() => setFilterCat(cat.id)} style={{ padding: '4px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', background: filterCat === cat.id ? 'var(--ink)' : 'var(--surface)', color: filterCat === cat.id ? 'var(--bg)' : 'var(--ink-mute)', border: filterCat === cat.id ? 'none' : '0.5px solid var(--line)' }}>
                    {cat.icon} {cat.label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 260, overflowY: 'auto' }} className="scrollbar-thin">
                {filteredCaps.map(cap => (
                  <button key={cap.id} onClick={() => selectCapability(cap)} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 11, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                    background: selectedCap?.id === cap.id ? `color-mix(in srgb, var(--accent) 8%, var(--surface))` : 'var(--surface)',
                    border: `0.5px solid ${selectedCap?.id === cap.id ? 'var(--accent)' : 'var(--line)'}`,
                  }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>{cap.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cap.name}</p>
                      <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cap.description}</p>
                    </div>
                    {selectedCap?.id === cap.id && <span style={{ color: 'var(--accent)', flexShrink: 0 }}>✓</span>}
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

      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        {step > 0 && <button onClick={() => setStep(s => s - 1)} className="z-btn-secondary" style={{ flex: 1 }}>Back</button>}
        {step < WIZARD_STEPS.length - 1
          ? <button onClick={() => setStep(s => s + 1)} disabled={!canNext()} className="z-btn-primary" style={{ flex: 1 }}>Next</button>
          : <button onClick={handleSave} disabled={saving || !canNext()} className="z-btn-primary" style={{ flex: 1 }}>{saving ? 'Saving…' : 'Add device'}</button>
        }
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

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={onClose} className="z-btn-secondary" style={{ flex: 1 }}>Cancel</button>
        <button onClick={handleRun} disabled={running} className="z-btn-primary" style={{ flex: 1 }}>{running ? 'Running…' : 'Run'}</button>
      </div>
    </div>
  )
}

// ── Device card ───────────────────────────────────────────────────────────────

function VirtualDeviceCard({ device, onToggle, onTrigger, onEdit, onDelete, triggering }) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
      <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, background: device.enabled ? `color-mix(in srgb, var(--info) 12%, var(--surface))` : 'var(--bg-2)', opacity: device.enabled ? 1 : 0.55 }}>
          {device.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{device.name}</p>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2, fontFamily: '"IBM Plex Mono", monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{device.capability}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {device.category && (
              <span style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 999, background: `color-mix(in srgb, var(--info) 12%, transparent)`, color: 'var(--info)', fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{device.category}</span>
            )}
            {device.room && <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>📍 {device.room}</span>}
            {device.last_triggered && <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>last run {device.last_triggered}</span>}
          </div>
          {Object.keys(device.default_params || {}).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
              {Object.entries(device.default_params).slice(0, 3).map(([k, v]) => (
                <span key={k} style={{ fontSize: 9.5, color: 'var(--ink-faint)', background: 'var(--bg-2)', padding: '2px 7px', borderRadius: 5, fontFamily: '"IBM Plex Mono", monospace', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 130, whiteSpace: 'nowrap' }}>
                  {k}: {String(v)}
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
          <Toggle checked={device.enabled} onCheckedChange={() => onToggle(device)} />
          <div style={{ display: 'flex', gap: 2 }}>
            {[
              { onClick: () => onTrigger(device), color: triggering === device.id ? 'var(--ink-faint)' : 'var(--ok)', disabled: triggering === device.id, title: 'Run now', path: <path d="M5 3l14 9-14 9V3z" fill="currentColor" stroke="none"/> },
              { onClick: () => onEdit(device), color: 'var(--ink-faint)', title: 'Edit', path: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></> },
              { onClick: () => onDelete(device), color: 'var(--accent)', title: 'Delete', path: <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/> },
            ].map(({ onClick, color, disabled, title, path }) => (
              <button key={title} onClick={onClick} disabled={disabled} title={title} style={{ background: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer', color, padding: 4, opacity: disabled ? 0.4 : 1 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
              </button>
            ))}
          </div>
        </div>
      </div>
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
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={onClose} className="z-btn-secondary" style={{ flex: 1 }}>Cancel</button>
        <button onClick={handleSave} disabled={saving || !name.trim()} className="z-btn-primary" style={{ flex: 1 }}>{saving ? 'Saving…' : 'Save'}</button>
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
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 20px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>Software-only devices</p>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}>Capabilities</h1>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4, fontFamily: '"IBM Plex Mono", monospace' }}>
            {devices.filter(d => d.enabled).length} active · {devices.length} total
          </p>
        </div>
        <button onClick={() => setShowAdd(true)} className="z-btn-primary" style={{ padding: '9px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, flexShrink: 0 }}>
          <Plus size={13} /> Add capability
        </button>
      </div>

      {/* Category filter */}
      {devices.length > 0 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 18 }}>
          <button onClick={() => setFilterCat('all')} style={{ padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', background: filterCat === 'all' ? 'var(--ink)' : 'var(--surface)', color: filterCat === 'all' ? 'var(--bg)' : 'var(--ink-mute)', border: filterCat === 'all' ? 'none' : '0.5px solid var(--line)' }}>
            All ({devices.length})
          </button>
          {categories.filter(c => catCounts[c.id] > 0).map(cat => (
            <button key={cat.id} onClick={() => setFilterCat(cat.id)} style={{ padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', background: filterCat === cat.id ? 'var(--ink)' : 'var(--surface)', color: filterCat === cat.id ? 'var(--bg)' : 'var(--ink-mute)', border: filterCat === cat.id ? 'none' : '0.5px solid var(--line)' }}>
              {cat.icon} {cat.label} ({catCounts[cat.id]})
            </button>
          ))}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 72, borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
        </div>
      )}

      {/* Empty state */}
      {!loading && devices.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>No capabilities configured yet</p>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 16 }}>Add YouTube, Spotify, weather, email readers, and more</p>
          <button onClick={() => setShowAdd(true)} className="z-btn-secondary" style={{ padding: '8px 14px', borderRadius: 9, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Plus size={13} /> Add first capability
          </button>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {filtered.map(device => (
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
