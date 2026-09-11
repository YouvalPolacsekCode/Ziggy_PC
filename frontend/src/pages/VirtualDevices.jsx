import { useEffect, useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Edit2, Play, Cpu, Check, MapPin } from 'lucide-react'
import { T_ENTER } from '../lib/motion'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { Toggle } from '../components/ui/Toggle'
import { useUIStore } from '../stores/uiStore'
import { useDeviceStore } from '../stores/deviceStore'
import { cn, entityDisplayName } from '../lib/utils'
import {
  getCapabilities, getVirtualDevices, createVirtualDevice,
  patchVirtualDevice, deleteVirtualDevice, triggerVirtualDevice,
  getEntities,
} from '../lib/api'
import { useT } from '../lib/i18n'

// Dropdown that fetches HA entities and stores friendly_name.toLowerCase() as value
function EntityHintSelect({ label, domain, value, onChange }) {
  const t = useT()
  const [options, setOptions] = useState([])

  useEffect(() => {
    getEntities(domain)
      .then((res) => {
        const entities = res.entities || []
        setOptions(
          entities.map((e) => ({
            // value is a case-insensitive key — stored lowercase for stable
            // matching. label honors display_name first so a Ziggy rename
            // is reflected here without waiting for HA's registry push.
            value: entityDisplayName(e).toLowerCase(),
            label: entityDisplayName(e),
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
      options={[{ value: '', label: t('virtual.pickOne') }, ...options]}
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
      <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
        <Toggle checked={!!value} onCheckedChange={onChange} />
        <span style={{ fontSize: 17, lineHeight: '22px', color: 'var(--ink)' }}>{schema.label}</span>
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
      dir="auto"
    />
  )
}

// Filter chip — active is surface-2 + ink + hairline, never inverted (the
// inverted look is reserved for the one primary action on the screen).
function filterChip(active) {
  return {
    minHeight: 36, padding: '8px 16px', borderRadius: 999, fontSize: 13, lineHeight: '18px',
    fontWeight: active ? 600 : 500, cursor: 'pointer', fontFamily: 'inherit',
    background: active ? 'var(--surface-2)' : 'var(--surface)',
    color: active ? 'var(--ink)' : 'var(--ink-mute)',
    border: `0.5px solid ${active ? 'var(--line-2)' : 'var(--line)'}`,
    transition: 'background var(--dur-press) var(--ease-standard), color var(--dur-press) var(--ease-standard)',
  }
}

// ── Wizard ────────────────────────────────────────────────────────────────────

const WIZARD_STEP_KEYS = ['stepCapability', 'stepConfigure', 'stepAssign']
const WIZARD_STEP_COUNT = WIZARD_STEP_KEYS.length

function StepIndicator({ current }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
      {WIZARD_STEP_KEYS.map((s, i) => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="z-mono" style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, background: i < current ? 'var(--ink)' : i === current ? 'var(--surface-2)' : 'var(--surface)', color: i < current ? 'var(--bg)' : i === current ? 'var(--ink)' : 'var(--ink-mute)', border: i === current ? '1px solid var(--ink)' : i < current ? 'none' : '0.5px solid var(--line)', transition: 'background var(--dur-state) var(--ease-standard)' }}>
            {i < current ? <Check size={14} strokeWidth={2.5} aria-hidden /> : i + 1}
          </div>
          {i < WIZARD_STEP_COUNT - 1 && <div style={{ width: 24, height: 1, background: i < current ? 'var(--ink)' : 'var(--line)' }} />}
        </div>
      ))}
    </div>
  )
}

function AddVirtualDeviceWizard({ onSave, onClose, rooms, categories, capabilities }) {
  const t = useT()
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
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={T_ENTER}
        >
          {/* Step 0 — pick capability */}
          {step === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => setFilterCat('all')} aria-pressed={filterCat === 'all'} className="z-button" style={filterChip(filterCat === 'all')}>{t('virtual.allCats')}</button>
                {categories.map(cat => (
                  <button key={cat.id} onClick={() => setFilterCat(cat.id)} aria-pressed={filterCat === cat.id} className="z-button" style={filterChip(filterCat === cat.id)}>
                    {cat.icon} {cat.label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflowY: 'auto' }} className="scrollbar-thin">
                {filteredCaps.map(cap => (
                  <button key={cap.id} onClick={() => selectCapability(cap)} aria-pressed={selectedCap?.id === cap.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '12px 16px', borderRadius: 'var(--r-ctl)', textAlign: 'start', cursor: 'pointer', fontFamily: 'inherit',
                    background: selectedCap?.id === cap.id ? 'var(--surface-2)' : 'var(--surface)',
                    border: `0.5px solid ${selectedCap?.id === cap.id ? 'var(--line-2)' : 'var(--line)'}`,
                    transition: 'background var(--dur-state) var(--ease-standard), border-color var(--dur-state) var(--ease-standard)',
                  }}>
                    <span style={{ fontSize: 22, lineHeight: '24px', flexShrink: 0 }} aria-hidden>{cap.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{cap.name}</p>
                      <p style={{ fontSize: 15, lineHeight: '20px', color: 'var(--ink-mute)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{cap.description}</p>
                    </div>
                    {selectedCap?.id === cap.id && <Check size={20} strokeWidth={2} style={{ color: 'var(--ink)', flexShrink: 0 }} aria-hidden />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 1 — configure: only config params */}
          {step === 1 && selectedCap && (
            <div className="flex flex-col gap-4">
              <Input
                label={t('virtual.deviceName')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                dir="auto"
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
                <p className="text-subhead text-ink-mute text-center py-2">
                  {t('virtual.noConfig')}
                </p>
              )}

              {/* Inform user about runtime params */}
              {runtimeParams.length > 0 && (
                <div className="rounded-card bg-surface-2 border border-line px-4 py-3 mt-1">
                  <p className="text-subhead text-ink-mute mb-2">{t('virtual.runtimeIntro')}</p>
                  <div className="flex flex-wrap gap-2">
                    {runtimeParams.map(([key, schema]) => (
                      <span key={key} className="z-chip">
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
                label={t('virtual.assignRoom')}
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                options={[
                  { value: '', label: t('virtual.noRoom') },
                  ...rooms.map((r) => ({ value: r.id, label: r.name })),
                ]}
              />
              <div className="bg-surface-2 rounded-[16px] p-4">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-title2" aria-hidden>{selectedCap?.icon}</span>
                  <div>
                    <p className="text-body font-semibold text-ink" dir="auto">{name}</p>
                    <p className="text-subhead text-ink-mute" dir="auto">{selectedCap?.description}</p>
                  </div>
                </div>
                {Object.keys(params).filter((k) => params[k] != null && params[k] !== '').length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {Object.entries(params).map(([k, v]) =>
                      v != null && v !== '' ? (
                        <Badge key={k} className="text-[11px]">{k}: {String(v)}</Badge>
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
        {step > 0 && <button onClick={() => setStep(s => s - 1)} className="z-btn-secondary" style={{ flex: 1 }}>{t('virtual.back')}</button>}
        {step < WIZARD_STEP_COUNT - 1
          ? <button onClick={() => setStep(s => s + 1)} disabled={!canNext()} className="z-btn-primary" style={{ flex: 1 }}>{t('virtual.next')}</button>
          : <button onClick={handleSave} disabled={saving || !canNext()} className="z-btn-primary" style={{ flex: 1 }}>{saving ? t('virtual.saving') : t('virtual.addDevice')}</button>
        }
      </div>
    </div>
  )
}

// ── Runtime params trigger modal ──────────────────────────────────────────────

function TriggerModal({ device, capability, onConfirm, onClose }) {
  const t = useT()
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
        <span className="text-title2" aria-hidden>{device.icon}</span>
        <div>
          <p className="text-body font-semibold text-ink" dir="auto">{device.name}</p>
          <p className="text-subhead text-ink-mute" dir="auto">{capability?.description}</p>
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
        <button onClick={onClose} className="z-btn-secondary" style={{ flex: 1 }}>{t('virtual.cancel')}</button>
        <button onClick={handleRun} disabled={running} className="z-btn-primary" style={{ flex: 1 }}>{running ? t('virtual.running') : t('virtual.run')}</button>
      </div>
    </div>
  )
}

// ── Device card ───────────────────────────────────────────────────────────────

function VirtualDeviceCard({ device, onToggle, onTrigger, onEdit, onDelete, triggering }) {
  const t = useT()
  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={T_ENTER}>
      <div className="z-card" style={{ padding: 16, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: 'var(--r-ctl)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, lineHeight: '24px', background: device.enabled ? 'var(--surface-2)' : 'var(--surface)', border: '0.5px solid var(--line)', color: device.enabled ? 'var(--ink)' : 'var(--ink-faint)' }} aria-hidden>
          {device.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{device.name}</p>
          <p className="z-footnote z-code" style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{device.capability}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {device.category && (
              <span className="z-chip">{device.category}</span>
            )}
            {device.room && (
              <span className="z-footnote" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <MapPin size={14} strokeWidth={1.75} aria-hidden /> {device.room}
              </span>
            )}
            {device.last_triggered && <span className="z-footnote z-mono">{t('virtual.lastRun', { when: device.last_triggered })}</span>}
          </div>
          {Object.keys(device.default_params || {}).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
              {Object.entries(device.default_params).slice(0, 3).map(([k, v]) => (
                <span key={k} className="z-footnote z-mono" style={{ background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 'var(--r-chip)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160, whiteSpace: 'nowrap' }}>
                  {k}: {String(v)}
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <Toggle checked={device.enabled} onCheckedChange={() => onToggle(device)} />
          <div style={{ display: 'flex', gap: 0 }}>
            {[
              { onClick: () => onTrigger(device), Icon: Play,   color: triggering === device.id ? 'var(--ink-faint)' : 'var(--ink-2)', disabled: triggering === device.id, title: t('virtual.runNow') },
              { onClick: () => onEdit(device),    Icon: Edit2,  color: 'var(--ink-2)', title: t('virtual.editTitle') },
              { onClick: () => onDelete(device),  Icon: Trash2, color: 'var(--err)',   title: t('virtual.deleteTitle') },
            ].map(({ onClick, Icon, color, disabled, title }) => (
              <button key={title} onClick={onClick} disabled={disabled} title={title} aria-label={title} className="z-icon-btn" style={{ background: 'transparent', border: 'none', cursor: disabled ? 'default' : 'pointer', color }}>
                <Icon size={20} strokeWidth={1.75} aria-hidden />
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
  const t = useT()
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
      <Input label={t('virtual.deviceName').replace(' *', '')} value={name} onChange={(e) => setName(e.target.value)} autoFocus dir="auto" />

      {configParams.map(([key, schema]) => (
        <ParamField key={key} schema={schema} value={params[key]} onChange={(v) => setParam(key, v)} />
      ))}

      <Select
        label={t('virtual.room')}
        value={room}
        onChange={(e) => setRoom(e.target.value)}
        options={[
          { value: '', label: t('virtual.noRoom') },
          ...rooms.map((r) => ({ value: r.id, label: r.name })),
        ]}
      />
      <label className="flex items-center gap-3 cursor-pointer">
        <Toggle checked={enabled} onCheckedChange={setEnabled} />
        <span className="text-subhead text-ink-2">{t('virtual.enabled')}</span>
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={onClose} className="z-btn-secondary" style={{ flex: 1 }}>{t('virtual.cancel')}</button>
        <button onClick={handleSave} disabled={saving || !name.trim()} className="z-btn-primary" style={{ flex: 1 }}>{saving ? t('virtual.saving') : t('common.save')}</button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function VirtualDevices({ embedded = false }) {
  const t = useT()
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
      addToast(t('virtual.toastFailedLoad'), 'error')
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
      addToast(t('virtual.toastAdded', { name: res.device.name }), 'success')
    } catch (e) {
      addToast(e.message || t('virtual.toastFailedCreate'), 'error')
      throw e
    }
  }

  const handlePatch = async (id, updates) => {
    try {
      const updated = await patchVirtualDevice(id, updates)
      setDevices((prev) => prev.map((d) => (d.id === id ? updated : d)))
      addToast(t('virtual.toastUpdated'), 'success')
    } catch (e) {
      addToast(e.message || t('virtual.toastFailedUpdate'), 'error')
    }
  }

  const handleToggle = (device) => handlePatch(device.id, { enabled: !device.enabled })

  const handleDelete = async (device) => {
    try {
      await deleteVirtualDevice(device.id)
      setDevices((prev) => prev.filter((d) => d.id !== device.id))
      addToast(t('virtual.toastDeleted', { name: device.name }), 'success')
    } catch {
      addToast(t('virtual.toastFailedDelete'), 'error')
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
        result.ok ? `✓ ${device.name}: ${result.message || t('common.done')}` : `✗ ${result.message || t('common.failed')}`,
        result.ok ? 'success' : 'error',
      )
      fetchDevices()
    } catch (e) {
      addToast(e.message || t('virtual.toastTriggerFailed'), 'error')
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
    <div style={embedded ? {} : { maxWidth: 'var(--page-max-w)', margin: '0 auto', padding: '24px 20px 24px' }}>
      {/* Header — hidden when embedded */}
      {!embedded && (
        <div className="z-page-head">
          <div>
            <p className="z-eyebrow">{t('virtual.softwareOnly')}</p>
            <h1 className="z-display" style={{ margin: 0 }}>{t('virtual.heading')}</h1>
            <p className="z-footnote z-mono">
              {t('virtual.statusCounts', { active: devices.filter(d => d.enabled).length, total: devices.length })}
            </p>
          </div>
          <button onClick={() => setShowAdd(true)} className="z-btn-primary z-button" style={{ flexShrink: 0 }}>
            <Plus size={18} strokeWidth={2} aria-hidden /> {t('virtual.addCapability')}
          </button>
        </div>
      )}
      {embedded && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <button onClick={() => setShowAdd(true)} className="z-btn-primary z-button">
            <Plus size={18} strokeWidth={2} aria-hidden /> {t('virtual.addCapability')}
          </button>
        </div>
      )}

      {/* Category filter */}
      {devices.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <button onClick={() => setFilterCat('all')} aria-pressed={filterCat === 'all'} className="z-button" style={filterChip(filterCat === 'all')}>
            {t('virtual.allFilter', { n: devices.length })}
          </button>
          {categories.filter(c => catCounts[c.id] > 0).map(cat => (
            <button key={cat.id} onClick={() => setFilterCat(cat.id)} aria-pressed={filterCat === cat.id} className="z-button" style={filterChip(filterCat === cat.id)}>
              {cat.icon} {cat.label} ({catCounts[cat.id]})
            </button>
          ))}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 76, borderRadius: 'var(--r-card)', background: 'var(--surface-2)', border: '0.5px solid var(--line)' }} />)}
        </div>
      )}

      {/* Empty state */}
      {!loading && devices.length === 0 && (
        <div className="z-card" style={{ textAlign: 'center', padding: 32 }}>
          <p className="z-body" style={{ fontWeight: 600, marginBottom: 4 }}>{t('virtual.emptyTitle')}</p>
          <p className="z-subhead" style={{ marginBottom: 16 }}>{t('virtual.emptyHelp')}</p>
          <button onClick={() => setShowAdd(true)} className="z-btn-secondary z-button">
            <Plus size={18} strokeWidth={2} aria-hidden /> {t('virtual.addFirst')}
          </button>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t('virtual.modalAdd')}>
        <AddVirtualDeviceWizard
          onSave={handleCreate}
          onClose={() => setShowAdd(false)}
          rooms={rooms}
          categories={categories}
          capabilities={capabilities}
        />
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editDevice} onClose={() => setEditDevice(null)} title={t('virtual.modalEdit')}>
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
        title={triggerDevice ? t('virtual.modalRun', { name: triggerDevice.name }) : ''}
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
