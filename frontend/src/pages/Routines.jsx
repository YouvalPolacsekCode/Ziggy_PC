import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Modal } from '../components/ui/Modal'
import { Input, Textarea } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { EntitySelect, getActionsForDomain } from '../components/ui/EntitySelect'
import { useAutomationStore } from '../stores/automationStore'
import { useUIStore } from '../stores/uiStore'
import { useDeviceStore } from '../stores/deviceStore'
import { getVirtualDevices, getCapabilities, getEntityState } from '../lib/api'
import IRDeviceSelect from '../components/IRDeviceSelect'

const ICONS = ['⚡', '☀️', '🌙', '🏠', '🎬', '🏋️', '🛏️', '☕', '🌿', '🔒', '💡', '🎵']
const DAYS  = [{ id: 'mon', label: 'M' }, { id: 'tue', label: 'T' }, { id: 'wed', label: 'W' }, { id: 'thu', label: 'T' }, { id: 'fri', label: 'F' }, { id: 'sat', label: 'S' }, { id: 'sun', label: 'S' }]
const STEP_TYPES = [
  { value: 'device',       label: 'Device control' },
  { value: 'ir_command',   label: 'IR Command' },
  { value: 'ziggy_intent', label: 'Ziggy Capability' },
  { value: 'scene',        label: 'Scene' },
  { value: 'delay',        label: 'Wait' },
  { value: 'message',      label: 'Send command' },
]

const selectStyle = {
  width: '100%', height: 38, padding: '0 28px 0 10px',
  background: 'var(--surface)', border: '0.5px solid var(--line)',
  borderRadius: 9, color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13,
  outline: 'none', appearance: 'none',
  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.4)' d='M0 0h10L5 6z'/></svg>")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
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
          <p className="z-eyebrow">Step values</p>
          {runtimeEntries.map(([key, schema]) => (
            <Input key={key} label={schema.label} value={(runtimeParams || {})[key] ?? ''} onChange={e => onParamChange(key, e.target.value)} placeholder={schema.placeholder || ''} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── SendIntentEditor ──────────────────────────────────────────────────────────
const SEND_TEMPLATES = [
  { group: 'Lights', items: ['Turn off all lights', 'Turn on the lights in [room]', 'Set brightness in [room] to 50%'] },
  { group: 'Climate', items: ['Set AC in [room] to 22 degrees', 'Turn on AC in [room]', 'Set AC mode to cool in [room]'] },
  { group: 'TV & Media', items: ['Turn on the TV in [room]', 'Turn off the TV in [room]'] },
  { group: 'General', items: ['Turn off everything', 'Good night', 'Good morning'] },
]

function SendIntentEditor({ value, onChange }) {
  const [showT, setShowT] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <Input placeholder="e.g. set bedroom lights to 50% brightness" value={value} onChange={e => onChange(e.target.value)} style={{ flex: 1 }} />
        <button onClick={() => setShowT(v => !v)} style={{ padding: '0 10px', borderRadius: 9, background: 'var(--bg-2)', border: '0.5px solid var(--line)', color: 'var(--ink-mute)', cursor: 'pointer', fontSize: 14, flexShrink: 0 }}>📝</button>
      </div>
      {showT && (
        <div style={{ borderRadius: 11, border: '0.5px solid var(--line)', overflow: 'hidden', background: 'var(--surface)' }}>
          {SEND_TEMPLATES.map(({ group, items }) => (
            <div key={group}>
              <p className="z-eyebrow" style={{ padding: '8px 10px 4px' }}>{group}</p>
              {items.map(tpl => (
                <button key={tpl} onClick={() => { onChange(tpl); setShowT(false) }} style={{ display: 'block', width: '100%', padding: '6px 10px', background: 'none', border: 'none', textAlign: 'left', fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer', fontFamily: 'inherit' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >{tpl}</button>
              ))}
            </div>
          ))}
        </div>
      )}
      <p style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>Replace [room] with the actual room name.</p>
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
    const options = fetchKey ? (attrs[fetchKey] || []) : []
    const currentVal = (serviceData || {})[key] ?? ''
    if (fetchKey && options.length > 0) return (
      <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>{label}</label>
        <select style={selectStyle} value={currentVal} onChange={e => onChangeServiceData({ ...(serviceData || {}), [key]: e.target.value })}>
          <option value="">— Pick {label} —</option>
          {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </div>
    )
    if (fetchKey && !entityId) return <p key={key} style={{ fontSize: 11, color: 'var(--ink-faint)', fontStyle: 'italic' }}>Select an entity above to see options.</p>
    return <Input key={key} label={label} placeholder={fetchKey && entityId ? 'Loading…' : placeholder} type={isNumber ? 'number' : 'text'} value={currentVal} onChange={e => { const v = isNumber ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value; onChangeServiceData({ ...(serviceData || {}), [key]: v }) }} />
  })
}

// ── MergedActionPicker ────────────────────────────────────────────────────────
function MergedActionPicker({ haActions, irDevice, haValue, onChangeHa, onPickIrCommand }) {
  const learned = new Set(irDevice?.learned_commands || [])
  const irList  = Object.keys(irDevice?.commands || {}).filter(c => irDevice.commands[c] && learned.has(c))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>Action</label>
      <select style={selectStyle} value={haValue} onChange={e => { const v = e.target.value; if (v.startsWith('__ir__:')) onPickIrCommand(v.slice(7)); else onChangeHa(v) }}>
        <optgroup label="⚙ Wi-Fi / HA">{haActions.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}</optgroup>
        {irList.length > 0 && <optgroup label={`📡 IR · ${irDevice?.name}`}>{irList.map(cmd => <option key={cmd} value={`__ir__:${cmd}`}>{cmd.replace(/_/g, ' ')}</option>)}</optgroup>}
      </select>
    </div>
  )
}

// ── StepRow ───────────────────────────────────────────────────────────────────
function StepRow({ step, index, onChange, onRemove, collapsed, onToggleCollapse }) {
  const { entities } = useDeviceStore()
  const domain = step.entity_id?.split('.')?.[0] || null
  const availableActions = (step.type === 'device' && domain) ? getActionsForDomain(domain) : [{ value: 'turn_on', label: 'Turn On' }, { value: 'turn_off', label: 'Turn Off' }, { value: 'toggle', label: 'Toggle' }]
  const linkedIr = entities.find(e => e.entity_id === step.entity_id)?._linkedIr || null
  const stepLabel = step.type === 'device' ? `${availableActions.find(a => a.value === step.action)?.label || 'Control'} · ${step.entity_id || '?'}`
    : step.type === 'ir_command' ? `📡 ${step.ir_device_name || 'IR'} → ${step.ir_sequence || step.ir_command || '?'}`
    : step.type === 'ziggy_intent' ? `⚡ ${step.virtual_device_name || step.capability || 'Capability'}`
    : step.type === 'delay' ? `Wait ${step.delay_seconds || '?'}s`
    : step.type === 'scene' ? `Scene: ${step.entity_id || '?'}`
    : step.text || 'Send command'

  if (collapsed) {
    return (
      <div onClick={onToggleCollapse} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, background: 'var(--surface)', border: '0.5px solid var(--line)', cursor: 'pointer' }}>
        <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, background: `color-mix(in srgb, var(--ok) 12%, transparent)`, color: 'var(--ok)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"IBM Plex Mono", monospace' }}>
          {index + 1}
        </span>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stepLabel}</span>
        <button onClick={e => { e.stopPropagation(); onRemove() }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
    )
  }

  return (
    <div style={{ border: `0.5px solid color-mix(in srgb, var(--ok) 30%, var(--line))`, borderRadius: 11, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, background: `color-mix(in srgb, var(--ok) 4%, var(--surface))` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p className="z-eyebrow">Step {index + 1}</p>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={onToggleCollapse} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--ink-mute)', fontFamily: 'inherit', padding: '4px 8px', borderRadius: 7 }}>Collapse</button>
          <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 4 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
          </button>
        </div>
      </div>
      <Select options={STEP_TYPES} value={step.type || 'device'} onChange={e => onChange({ type: e.target.value })} />
      {step.type === 'ir_command' && <IRDeviceSelect value={step} onChange={patch => onChange({ ...step, ...patch })} />}
      {step.type === 'ziggy_intent' && (
        <VirtualDeviceSelect
          value={step.virtual_device_id || ''} runtimeParams={step.runtime_params || {}}
          onDeviceChange={(id, dev) => onChange({ ...step, virtual_device_id: id, capability: dev?.capability || '', virtual_device_name: dev?.name || '', runtime_params: {} })}
          onParamChange={(key, val) => onChange({ ...step, runtime_params: { ...(step.runtime_params || {}), [key]: val } })}
        />
      )}
      {step.type === 'device' && (
        <>
          <EntitySelect value={step.entity_id || ''} onChange={v => onChange({ ...step, entity_id: v, action: 'turn_on', ha_service: 'turn_on', service_data: undefined })} placeholder="Select entity…" />
          {linkedIr && step.entity_id ? (
            <MergedActionPicker
              haActions={availableActions} irDevice={linkedIr} haValue={step.action || 'turn_on'}
              onChangeHa={val => { const def = availableActions.find(a => a.value === val) || {}; onChange({ ...step, action: val, ha_service: def.haService || val, service_data: def.serviceData || undefined }) }}
              onPickIrCommand={cmd => onChange({ ...step, type: 'ir_command', ir_device_id: linkedIr.id, ir_device_name: linkedIr.name, ir_command: cmd, ir_sequence: undefined, action: undefined, ha_service: undefined, service_data: undefined })}
            />
          ) : (
            <Select options={availableActions} value={step.action || 'turn_on'} onChange={e => { const sel = e.target.value; const def = availableActions.find(a => a.value === sel) || {}; onChange({ ...step, action: sel, ha_service: def.haService || sel, service_data: def.serviceData || undefined }) }} />
          )}
          {(() => {
            const def = availableActions.find(a => a.value === (step.action || 'turn_on'))
            return def?.needsInput ? <NeedsInputFields fields={def.needsInput} entityId={step.entity_id} serviceData={step.service_data} onChangeServiceData={data => onChange({ ...step, service_data: data })} /> : null
          })()}
        </>
      )}
      {step.type === 'delay'   && <Input type="number" placeholder="Seconds to wait" value={step.delay_seconds || ''} onChange={e => onChange({ ...step, delay_seconds: parseInt(e.target.value) })} />}
      {step.type === 'message' && <SendIntentEditor value={step.text || ''} onChange={text => onChange({ ...step, text })} />}
      {step.type === 'scene'   && <EntitySelect value={step.entity_id || ''} onChange={v => onChange({ ...step, entity_id: v })} domain="scene" placeholder="Select scene…" />}
    </div>
  )
}

// ── Step indicator ────────────────────────────────────────────────────────────
const STEPS_WIZARD = ['Name', 'Steps', 'Review']

function StepIndicator({ current }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 20 }}>
      {STEPS_WIZARD.map((s, i) => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, background: i < current ? 'var(--ink)' : i === current ? `color-mix(in srgb, var(--ink) 12%, var(--surface))` : 'var(--bg-2)', color: i < current ? 'var(--bg)' : i === current ? 'var(--ink)' : 'var(--ink-faint)', border: i === current ? '1.5px solid var(--ink)' : '0.5px solid var(--line)' }}>
            {i < current ? '✓' : i + 1}
          </div>
          {i < STEPS_WIZARD.length - 1 && <div style={{ width: 20, height: 1, background: i < current ? 'var(--ink)' : 'var(--line)' }} />}
        </div>
      ))}
    </div>
  )
}

// ── RoutineWizard ─────────────────────────────────────────────────────────────
function RoutineWizard({ initial, onSave, onClose }) {
  const [wizardStep,     setWizardStep]    = useState(0)
  const [name,           setName]          = useState(initial?.name || '')
  const [description,    setDescription]   = useState(initial?.description || '')
  const [icon,           setIcon]          = useState(initial?.icon || '⚡')
  const [steps,          setSteps]         = useState(initial?.steps || [])
  const [collapsedSteps, setCollapsedSteps] = useState(new Set())
  const [saving,         setSaving]        = useState(false)

  const addStep = () => {
    setCollapsedSteps(prev => { const next = new Set(prev); steps.forEach((_, i) => next.add(i)); return next })
    setSteps(s => [...s, { type: 'device', entity_id: '', action: 'turn_on' }])
  }
  const updateStep         = (i, val) => setSteps(s => s.map((x, j) => j === i ? val : x))
  const removeStep         = (i) => { setSteps(s => s.filter((_, j) => j !== i)); setCollapsedSteps(prev => { const next = new Set(); prev.forEach(idx => { if (idx < i) next.add(idx); else if (idx > i) next.add(idx - 1) }); return next }) }
  const toggleCollapseStep = (i) => setCollapsedSteps(prev => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next })
  const canNext = () => wizardStep === 0 ? name.trim().length > 0 : true

  const handleSave = async () => {
    setSaving(true)
    await onSave({ name, description, icon, schedule: { type: 'manual' }, steps })
    setSaving(false); onClose()
  }

  return (
    <div>
      <StepIndicator current={wizardStep} />
      <AnimatePresence mode="wait">
        <motion.div key={wizardStep} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}>
          {wizardStep === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 8 }}>Icon</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {ICONS.map(ic => (
                    <button key={ic} onClick={() => setIcon(ic)} style={{
                      width: 36, height: 36, borderRadius: 10, fontSize: 18,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: ic === icon ? `color-mix(in srgb, var(--accent) 12%, var(--surface))` : 'var(--bg-2)',
                      border: ic === icon ? '1.5px solid var(--accent)' : '0.5px solid var(--line)',
                      cursor: 'pointer',
                    }}>{ic}</button>
                  ))}
                </div>
              </div>
              <Input label="Routine name" placeholder="e.g. Good Morning" value={name} onChange={e => setName(e.target.value)} autoFocus />
              <Textarea label="Description (optional)" placeholder="What does this routine do?" value={description} onChange={e => setDescription(e.target.value)} rows={2} />
            </div>
          )}
          {wizardStep === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {steps.map((step, i) => <StepRow key={i} step={step} index={i} onChange={v => updateStep(i, v)} onRemove={() => removeStep(i)} collapsed={collapsedSteps.has(i)} onToggleCollapse={() => toggleCollapseStep(i)} />)}
              <button onClick={addStep} className="z-btn-secondary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                Add step
              </button>
            </div>
          )}
          {wizardStep === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--bg-2)', border: '0.5px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 22 }}>{icon}</span>
                  <div>
                    <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 15 }}>{name}</p>
                    {description && <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>{description}</p>}
                  </div>
                </div>
              </div>
              <p className="z-eyebrow">{steps.length} step{steps.length !== 1 ? 's' : ''}</p>
              {steps.map((s, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--ink-mute)', display: 'flex', gap: 6 }}>
                  <span style={{ fontFamily: '"IBM Plex Mono", monospace', color: 'var(--ink-faint)' }}>{i + 1}</span>
                  <span>{STEP_TYPES.find(t => t.value === s.type)?.label}</span>
                  <span style={{ color: 'var(--ink-faint)' }}>{s.entity_id || s.text || (s.delay_seconds && `${s.delay_seconds}s`) || ''}</span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        {wizardStep > 0 && <button onClick={() => setWizardStep(s => s - 1)} className="z-btn-secondary" style={{ flex: 1 }}>Back</button>}
        {wizardStep < STEPS_WIZARD.length - 1
          ? <button onClick={() => setWizardStep(s => s + 1)} disabled={!canNext()} className="z-btn-primary" style={{ flex: 1 }}>Next</button>
          : <button onClick={handleSave} disabled={saving} className="z-btn-primary" style={{ flex: 1 }}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Create routine'}</button>
        }
      </div>
    </div>
  )
}

// ── RoutineCard (Checklist-B variant — expands to show steps) ─────────────────
function RoutineCard({ routine, onEdit, onDelete, onRun, expanded, onExpand }) {
  const hasSteps = (routine.steps || []).length > 0

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}
      style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {routine.icon && <span style={{ marginRight: 6 }}>{routine.icon}</span>}{routine.name}
          </p>
          {hasSteps && (
            <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 2, fontFamily: '"IBM Plex Mono", monospace' }}>
              {routine.steps.length} step{routine.steps.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button onClick={() => onRun(routine)} title="Run now" style={{ background: 'transparent', border: '0.5px solid var(--line)', borderRadius: 8, padding: '5px 9px', color: 'var(--ok)', fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>Run</button>
          {[
            { onClick: () => onEdit(routine), title: 'Edit', path: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></> },
            { onClick: () => onDelete(routine.id), title: 'Delete', path: <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>, color: 'var(--accent)' },
          ].map(({ onClick, title, path, color }) => (
            <button key={title} onClick={onClick} title={title} style={{ background: 'none', border: 'none', cursor: 'pointer', color: color || 'var(--ink-faint)', padding: 4 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
            </button>
          ))}
          {hasSteps && (
            <button onClick={onExpand} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* Expanded steps */}
      <AnimatePresence>
        {expanded && hasSteps && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.15 }} style={{ overflow: 'hidden' }}>
            <div style={{ paddingTop: 10, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {routine.steps.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 9.5, color: 'var(--ink-faint)', minWidth: 16 }}>{i + 1}</span>
                  <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{STEP_TYPES.find(t => t.value === s.type)?.label}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--ink-faint)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.entity_id || s.text || (s.delay_seconds && `${s.delay_seconds}s`) || ''}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Routines() {
  const { routines, loading, fetchRoutines, addRoutine, removeRoutine, runRoutine, loadRoutineConfig } = useAutomationStore()
  const { addToast } = useUIStore()
  const [showWizard, setShowWizard] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => { fetchRoutines() }, [])

  const handleSave   = async data => { try { await addRoutine(data); addToast('Routine saved', 'success') } catch { addToast('Failed to save routine', 'error') } }
  const handleDelete = async id => { try { await removeRoutine(id); addToast('Deleted', 'success') } catch { addToast('Failed to delete', 'error') } }
  const handleRun    = async r => { try { await runRoutine(r.id); addToast(`Running "${r.name}"`, 'success') } catch { addToast('Failed to run', 'error') } }
  const handleEdit   = async r => {
    try { const config = await loadRoutineConfig(r.id); setEditTarget(config || r) } catch { setEditTarget(r) }
    setShowWizard(true)
  }
  const handleClose = () => { setShowWizard(false); setEditTarget(null) }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 20px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>Sequences of steps</p>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}>Routines</h1>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4, fontFamily: '"IBM Plex Mono", monospace' }}>{routines.length} routine{routines.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setShowWizard(true)} className="z-btn-primary" style={{ padding: '9px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          New
        </button>
      </div>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 62, borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
        </div>
      )}

      {!loading && routines.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>No routines yet</p>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 16 }}>Build sequences of actions to run on demand</p>
          <button onClick={() => setShowWizard(true)} className="z-btn-secondary" style={{ padding: '8px 14px', borderRadius: 9, fontFamily: 'inherit' }}>Create routine</button>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {routines.map(r => (
            <RoutineCard key={r.id} routine={r} onEdit={handleEdit} onDelete={handleDelete} onRun={handleRun}
              expanded={expandedId === r.id} onExpand={() => setExpandedId(prev => prev === r.id ? null : r.id)} />
          ))}
        </div>
      </AnimatePresence>

      <Modal open={showWizard} onClose={handleClose} title={editTarget ? 'Edit Routine' : 'New Routine'}>
        <RoutineWizard initial={editTarget} onSave={handleSave} onClose={handleClose} />
      </Modal>
    </div>
  )
}
