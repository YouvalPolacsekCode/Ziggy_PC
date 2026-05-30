import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Modal } from '../components/ui/Modal'
import { Input, Textarea } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { EntitySelect, getActionsForDomain, getActionLabel } from '../components/ui/EntitySelect'
import { useAutomationStore } from '../stores/automationStore'
import { useUIStore } from '../stores/uiStore'
import { useDeviceStore } from '../stores/deviceStore'
import { getEntityState, getSuggestedRoutines } from '../lib/api'
import IRDeviceSelect from '../components/IRDeviceSelect'
import MediaPlayActionEditor from '../components/media/MediaPlayActionEditor'
import { useFeature } from '../stores/featuresStore'
import { useT } from '../lib/i18n'

const ICONS = ['⚡', '☀️', '🌙', '🏠', '🎬', '🏋️', '🛏️', '☕', '🌿', '🔒', '💡', '🎵']

// Stable per-step uid so React keys survive reorder/delete. Without this,
// deleting step N caused steps below to inherit the deleted row's component
// state (in-flight attribute fetches, transient inputs), surfacing as stale
// dropdown options on the wrong step.
let _stepUidCounter = 0
const newStepUid = () => `s_${Date.now().toString(36)}_${(_stepUidCounter++).toString(36)}`
const ensureStepUid = (step) => (step && step._uid ? step : { ...step, _uid: newStepUid() })

// Per-step type, the minimum fields required for a routine step to actually do
// anything when executed. Wizard blocks Save until every step satisfies its
// validator — otherwise the backend silently persists broken steps (empty
// entity_id → HA call with no target, etc.).
// Returns a translation key (or null) so the message stays localized.
const validateStep = (step) => {
  switch (step.type) {
    case 'device':     return step.entity_id ? null : 'routines.validate.device'
    case 'ir_command': return (step.ir_device_id && (step.ir_command || step.ir_sequence)) ? null : 'routines.validate.ir'
    case 'automation': return step.automation_id ? null : 'routines.validate.automation'
    case 'delay':      return (Number(step.delay_seconds) > 0) ? null : 'routines.validate.delay'
    case 'notify':     return step.message ? null : 'routines.validate.notify'
    case 'message':    return (step.text && step.text.trim()) ? null : 'routines.validate.message'
    case 'media_play': return (step.speaker_entity && step.service && step.profile) ? null : 'media.action.validate'
    default:           return null
  }
}
const DAYS  = [{ id: 'mon', label: 'M' }, { id: 'tue', label: 'T' }, { id: 'wed', label: 'W' }, { id: 'thu', label: 'T' }, { id: 'fri', label: 'F' }, { id: 'sat', label: 'S' }, { id: 'sun', label: 'S' }]
// Step type list — labels are translation keys, resolved at render time.
const STEP_TYPES = [
  { value: 'device',     labelKey: 'routines.stepType.device' },
  { value: 'automation', labelKey: 'routines.stepType.automation' },
  { value: 'ir_command', labelKey: 'routines.stepType.ir_command' },
  { value: 'delay',      labelKey: 'routines.stepType.delay' },
  { value: 'notify',     labelKey: 'routines.stepType.notify' },
  { value: 'message',    labelKey: 'routines.stepType.message' },
  // media_play is appended at render time inside StepRow when the
  // media_music feature flag is on — keeping it out of this static list
  // means existing routines load their step labels cleanly without the
  // flag.
]

const selectStyle = {
  width: '100%', height: 38, padding: '0 28px 0 10px',
  background: 'var(--surface)', border: '0.5px solid var(--line)',
  borderRadius: 9, color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13,
  outline: 'none', appearance: 'none',
  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.4)' d='M0 0h10L5 6z'/></svg>")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
}

// ── AutomationPicker ──────────────────────────────────────────────────────────
function AutomationPicker({ value, onChange }) {
  const t = useT()
  const { automations, fetchAutomations } = useAutomationStore()
  useEffect(() => { if (automations.length === 0) fetchAutomations() }, [])
  return (
    <Select
      label={t('routines.field.automationToRun')}
      value={value || ''}
      onChange={e => {
        const id = e.target.value
        const auto = automations.find(a => a.id === id)
        onChange({ automation_id: id, automation_name: auto?.name || id })
      }}
      options={[
        { value: '', label: automations.length ? t('routines.field.pickAutomation') : t('routines.field.noAutomations') },
        ...automations.map(a => ({ value: a.id, label: a.name })),
      ]}
    />
  )
}

// ── SendIntentEditor ──────────────────────────────────────────────────────────
// Group label is a translation key; the items themselves stay in English because
// they double as the natural-language phrase sent to Ziggy's intent parser.
const SEND_TEMPLATES = [
  { groupKey: 'automations.sendIntent.gLights',  items: ['Turn off all lights', 'Turn on the lights in [room]', 'Set brightness in [room] to 50%'] },
  { groupKey: 'automations.sendIntent.gClimate', items: ['Set AC in [room] to 22 degrees', 'Turn on AC in [room]', 'Set AC mode to cool in [room]'] },
  { groupKey: 'automations.sendIntent.gTvMedia', items: ['Turn on the TV in [room]', 'Turn off the TV in [room]'] },
  { groupKey: 'automations.sendIntent.gGeneral', items: ['Turn off everything', 'Good night', 'Good morning'] },
]

function SendIntentEditor({ value, onChange }) {
  const t = useT()
  const [showT, setShowT] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <Input placeholder={t('automations.sendIntent.placeholder')} value={value} onChange={e => onChange(e.target.value)} style={{ flex: 1 }} dir="auto" />
        <button onClick={() => setShowT(v => !v)} style={{ padding: '0 10px', borderRadius: 9, background: 'var(--bg-2)', border: '0.5px solid var(--line)', color: 'var(--ink-mute)', cursor: 'pointer', fontSize: 14, flexShrink: 0 }}>📝</button>
      </div>
      {showT && (
        <div style={{ borderRadius: 11, border: '0.5px solid var(--line)', overflow: 'hidden', background: 'var(--surface)' }}>
          {SEND_TEMPLATES.map(({ groupKey, items }) => (
            <div key={groupKey}>
              <p className="z-eyebrow" style={{ padding: '8px 10px 4px' }}>{t(groupKey)}</p>
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
      <p style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{t('automations.sendIntent.replaceHint')}</p>
    </div>
  )
}

// ── NeedsInputFields ──────────────────────────────────────────────────────────
function NeedsInputFields({ fields, entityId, serviceData, onChangeServiceData }) {
  const t = useT()
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
          <option value="">{t('automations.needs.pickLabel', { label })}</option>
          {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </div>
    )
    if (fetchKey && !entityId) return <p key={key} style={{ fontSize: 11, color: 'var(--ink-faint)', fontStyle: 'italic' }}>{t('automations.needs.entityHint', { label: (label || '').toLowerCase() })}</p>
    return <Input key={key} label={label} placeholder={fetchKey && entityId ? t('automations.needs.loading') : placeholder} type={isNumber ? 'number' : 'text'} value={currentVal} onChange={e => { const v = isNumber ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value; onChangeServiceData({ ...(serviceData || {}), [key]: v }) }} dir="auto" />
  })
}

// ── MergedActionPicker ────────────────────────────────────────────────────────
function MergedActionPicker({ haActions, irDevice, haValue, onChangeHa, onPickIrCommand }) {
  const t = useT()
  const learned = new Set(irDevice?.learned_commands || [])
  const irList  = Object.keys(irDevice?.commands || {}).filter(c => irDevice.commands[c] && learned.has(c))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>{t('automations.action.label')}</label>
      <select style={selectStyle} value={haValue} onChange={e => { const v = e.target.value; if (v.startsWith('__ir__:')) onPickIrCommand(v.slice(7)); else onChangeHa(v) }}>
        <optgroup label={t('automations.action.haGroup')}>{haActions.map(a => <option key={a.value} value={a.value}>{getActionLabel(a, t)}</option>)}</optgroup>
        {irList.length > 0 && <optgroup label={t('automations.action.irGroup', { name: irDevice?.name || '' })}>{irList.map(cmd => <option key={cmd} value={`__ir__:${cmd}`}>{cmd.replace(/_/g, ' ')}</option>)}</optgroup>}
      </select>
    </div>
  )
}

// ── StepRow ───────────────────────────────────────────────────────────────────
function StepRow({ step, index, onChange, onRemove, collapsed, onToggleCollapse, validationError }) {
  const t = useT()
  const mediaMusic = useFeature('media_music')
  const { entities } = useDeviceStore()
  const domain = step.entity_id?.split('.')?.[0] || null
  const availableActions = (step.type === 'device' && domain) ? getActionsForDomain(domain) : [{ value: 'turn_on', labelKey: 'entitySelect.action.turnOn', label: 'Turn On' }, { value: 'turn_off', labelKey: 'entitySelect.action.turnOff', label: 'Turn Off' }, { value: 'toggle', labelKey: 'entitySelect.action.toggle', label: 'Toggle' }]
  const linkedIr = entities.find(e => e.entity_id === step.entity_id)?._linkedIr || null
  // Step type list — append "Play media" when the media_music flag is on so
  // existing routine steps still resolve their label even after the flag
  // gets disabled later.
  const stepTypeOptions = mediaMusic
    ? [...STEP_TYPES, { value: 'media_play', labelKey: 'media.action.playMedia' }]
    : STEP_TYPES
  const stepLabel = step.type === 'device' ? `${getActionLabel(availableActions.find(a => a.value === step.action), t) || 'Control'} · ${step.entity_id || '?'}`
    : step.type === 'ir_command' ? `📡 ${step.ir_device_name || 'IR'} → ${step.ir_sequence || step.ir_command || '?'}`
    : step.type === 'automation' ? `▶ ${step.automation_name || step.automation_id || 'Automation'}`
    : step.type === 'delay' ? `Wait ${step.delay_seconds || '?'}s`
    : step.type === 'notify' ? `📣 ${step.message || 'Notification'}`
    : step.type === 'media_play' ? `🎵 ${step.service || '?'} → ${step.speaker_entity || '?'}`
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
      {/* Spread step into the patch — otherwise switching type would wipe the
          step entirely (the new {type:'x'} object replaces step, dropping
          entity_id / action / service_data / etc.). Clear only fields that
          don't make sense for the new type at execute time; the validator
          will gate Save if anything else is missing. */}
      <Select options={stepTypeOptions} value={step.type || 'device'} onChange={e => {
        const nextType = e.target.value
        if (nextType === 'media_play') {
          onChange({ _uid: step._uid, type: nextType, speaker_entity: '', service: 'spotify', profile: '', mode: 'playlist' })
        } else {
          onChange({ ...step, type: nextType })
        }
      }} />
      {validationError && (
        <p style={{ fontSize: 11, color: 'var(--err)', margin: '-4px 0 0', fontFamily: '"IBM Plex Mono", monospace' }}>
          ⚠ {validationError}
        </p>
      )}
      {step.type === 'ir_command' && <IRDeviceSelect value={step} onChange={patch => onChange({ ...step, ...patch })} />}
      {step.type === 'automation' && (
        <AutomationPicker
          value={step.automation_id || ''}
          onChange={patch => onChange({ ...step, ...patch })}
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
            <Select options={availableActions.map(a => ({ ...a, label: getActionLabel(a, t) }))} value={step.action || 'turn_on'} onChange={e => { const sel = e.target.value; const def = availableActions.find(a => a.value === sel) || {}; onChange({ ...step, action: sel, ha_service: def.haService || sel, service_data: def.serviceData || undefined }) }} />
          )}
          {(() => {
            const def = availableActions.find(a => a.value === (step.action || 'turn_on'))
            return def?.needsInput ? <NeedsInputFields fields={def.needsInput} entityId={step.entity_id} serviceData={step.service_data} onChangeServiceData={data => onChange({ ...step, service_data: data })} /> : null
          })()}
        </>
      )}
      {step.type === 'delay'   && <Input type="number" placeholder="Seconds to wait" value={step.delay_seconds || ''} onChange={e => onChange({ ...step, delay_seconds: parseInt(e.target.value) })} />}
      {step.type === 'notify'  && (
        <>
          <Input label="Title (optional)" placeholder="e.g. Morning" value={step.title || ''} onChange={e => onChange({ ...step, title: e.target.value })} />
          <Input label="Message" placeholder="Notification text" value={step.message || ''} onChange={e => onChange({ ...step, message: e.target.value })} />
        </>
      )}
      {step.type === 'message' && <SendIntentEditor value={step.text || ''} onChange={text => onChange({ ...step, text })} />}
      {step.type === 'media_play' && mediaMusic && (
        <MediaPlayActionEditor action={step} onChange={onChange} />
      )}
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
export function RoutineWizard({ initial, onSave, onClose }) {
  const [wizardStep,     setWizardStep]    = useState(0)
  const [name,           setName]          = useState(initial?.name || '')
  const [description,    setDescription]   = useState(initial?.description || '')
  const [icon,           setIcon]          = useState(initial?.icon || '⚡')
  // Backfill _uid on every step from `initial` so editing existing routines
  // gets stable React keys too (the backend doesn't round-trip _uid).
  const [steps,          setSteps]         = useState(() => (initial?.steps || []).map(ensureStepUid))
  // Track collapsed state by step uid, NOT array index — index-keyed Sets
  // get scrambled by reorder/delete and surface as "wrong step collapsed".
  const [collapsedUids,  setCollapsedUids] = useState(new Set())
  const [saving,         setSaving]        = useState(false)
  const [showErrors,     setShowErrors]    = useState(false)

  const stepErrors = useMemo(() => steps.map(validateStep), [steps])
  const firstInvalidIdx = stepErrors.findIndex(e => e !== null)

  const addStep = () => {
    setCollapsedUids(prev => { const next = new Set(prev); steps.forEach(s => next.add(s._uid)); return next })
    setSteps(s => [...s, { _uid: newStepUid(), type: 'device', entity_id: '', action: 'turn_on' }])
  }
  const updateStep         = (i, val) => setSteps(s => s.map((x, j) => j === i ? { ...val, _uid: x._uid } : x))
  const removeStep         = (i) => setSteps(s => s.filter((_, j) => j !== i))
  const toggleCollapseStep = (uid) => setCollapsedUids(prev => { const next = new Set(prev); next.has(uid) ? next.delete(uid) : next.add(uid); return next })
  const canNext = () => {
    if (wizardStep === 0) return name.trim().length > 0
    if (wizardStep === 1) return firstInvalidIdx === -1
    return true
  }

  const handleSave = async () => {
    if (firstInvalidIdx !== -1) {
      // Bounce the user back to the Steps page with errors visible — saving
      // an invalid step would silently persist a broken routine.
      setShowErrors(true)
      setWizardStep(1)
      // Expand the first invalid step so the error is immediately visible.
      setCollapsedUids(prev => { const next = new Set(prev); next.delete(steps[firstInvalidIdx]._uid); return next })
      return
    }
    setSaving(true)
    try {
      // Strip the FE-only _uid before persisting; pass through the id so the
      // backend updates in place instead of slugify-on-name (which would orphan
      // the old script on rename and append a duplicate card on the UI side).
      const cleanSteps = steps.map(({ _uid, ...rest }) => rest)
      await onSave({ id: initial?.id, name, description, icon, schedule: { type: 'manual' }, steps: cleanSteps })
    } finally {
      setSaving(false)
      onClose()
    }
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
              {steps.map((step, i) => (
                <StepRow
                  key={step._uid}
                  step={step}
                  index={i}
                  onChange={v => updateStep(i, v)}
                  onRemove={() => removeStep(i)}
                  collapsed={collapsedUids.has(step._uid)}
                  onToggleCollapse={() => toggleCollapseStep(step._uid)}
                  validationError={showErrors ? stepErrors[i] : null}
                />
              ))}
              <button onClick={addStep} className="z-btn-secondary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                Add step
              </button>
              {showErrors && firstInvalidIdx !== -1 && (
                <p style={{ fontSize: 11.5, color: 'var(--err)', textAlign: 'center', marginTop: 4 }}>
                  Step {firstInvalidIdx + 1} needs to be completed before saving.
                </p>
              )}
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
          ? (
              <button
                onClick={() => {
                  // On Steps page, reveal validation errors if the user tries to
                  // proceed with an invalid step rather than silently no-op'ing
                  // a disabled button.
                  if (wizardStep === 1 && firstInvalidIdx !== -1) { setShowErrors(true); return }
                  setWizardStep(s => s + 1)
                }}
                disabled={!canNext()}
                className="z-btn-primary"
                style={{ flex: 1 }}
              >
                Next
              </button>
            )
          : <button onClick={handleSave} disabled={saving} className="z-btn-primary" style={{ flex: 1 }}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Create routine'}</button>
        }
      </div>
    </div>
  )
}

// ── RoutineCard ───────────────────────────────────────────────────────────────
// Visually mirrors AutomationCard from Automations.jsx: tinted icon square on
// the left, name + description + meta pills in the middle, right-side icon
// buttons (Run · View · Edit · Delete). No toggle because routines are always
// manual-run; no expand-on-click because the View modal now owns that role.
// React.memo so a parent re-render (WS bumps, sibling state) doesn't drag
// every row in the list through an unnecessary render.
const RoutineCard = React.memo(function RoutineCard({ routine, onView, onEdit, onDelete, onRun }) {
  const stepCount = (routine.steps || []).length
  // Use the same tint family AutomationCard uses for the most prominent state
  // (ok/green): routines are "ready, manual, on-demand".
  const tint = 'var(--ok)'

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
      <div style={{
        padding: '14px 16px', borderRadius: 12,
        background: 'var(--surface)', border: '0.5px solid var(--line)',
        display: 'flex', alignItems: 'flex-start', gap: 12,
      }}>
        {/* Tinted icon square — matches AutomationCard's left affordance */}
        <div style={{
          width: 38, height: 38, borderRadius: 11, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `color-mix(in srgb, ${tint} 12%, var(--surface-2))`,
          fontSize: 18,
        }}>
          {routine.icon || '⚡'}
        </div>

        {/* Name + description + meta pills */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {routine.name}
          </p>
          {routine.description && (
            <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {routine.description}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 9.5, padding: '1px 7px', borderRadius: 999, fontWeight: 600,
              fontFamily: '"IBM Plex Mono", monospace',
              background: `color-mix(in srgb, ${tint} 12%, transparent)`, color: tint,
            }}>
              ROUTINE
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
              {stepCount} step{stepCount !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Right column — no toggle (routines are manual-only); same icon row
            as AutomationCard so the two surfaces feel like siblings. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 2 }}>
            {[
              { onClick: () => onRun(routine),       color: 'var(--ok)',       title: 'Run now', path: <path d="M5 3l14 9-14 9V3z" fill="currentColor" stroke="none"/> },
              { onClick: () => onView(routine),      color: 'var(--ink-mute)', title: 'View',    path: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></> },
              { onClick: () => onEdit(routine),      color: 'var(--ink-mute)', title: 'Edit',    path: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></> },
              { onClick: () => onDelete(routine.id), color: 'var(--accent)',   title: 'Delete',  path: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></> },
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
})

// ── RoutineViewModal ──────────────────────────────────────────────────────────
// Read-only view of a routine. Mirrors AutomationViewModal's structure so
// "View" feels the same across both surfaces, with quick Run / Edit footer.
function RoutineViewModal({ routine, onEdit, onRun, onClose }) {
  if (!routine) return null
  const steps = routine.steps || []
  const stepSummary = (s) => {
    switch (s.type) {
      case 'device':     return `${s.entity_id || '?'} → ${s.action || s.ha_service || 'control'}`
      case 'ir_command': return `${s.ir_device_name || 'IR device'} → ${s.ir_sequence || s.ir_command || '?'}`
      case 'automation': return s.automation_name || s.automation_id || '?'
      case 'delay':      return `Wait ${s.delay_seconds || '?'}s`
      case 'notify':     return s.message || s.title || 'Notification'
      case 'message':    return `"${s.text || '?'}"`
      default:           return s.type || ''
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: 'color-mix(in srgb, var(--ok) 12%, var(--surface))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
          {routine.icon || '⚡'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 15 }}>{routine.name}</p>
          {routine.description && <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>{routine.description}</p>}
        </div>
      </div>

      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>Steps ({steps.length})</p>
        {steps.length === 0
          ? <p style={{ fontSize: 13, color: 'var(--ink-faint)', fontStyle: 'italic' }}>No steps configured.</p>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {steps.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--line)', background: 'var(--surface)' }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'color-mix(in srgb, var(--ok) 12%, transparent)', color: 'var(--ok)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: '"IBM Plex Mono", monospace' }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                      {STEP_TYPES.find(t => t.value === s.type)?.label || s.type}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2, fontFamily: '"IBM Plex Mono", monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {stepSummary(s)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      <div style={{ display: 'flex', gap: 8, paddingTop: 4, borderTop: '0.5px solid var(--line)' }}>
        <button onClick={() => { onRun(routine); onClose?.() }} className="z-btn-secondary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
          Run now
        </button>
        <button onClick={() => { onEdit(routine); onClose?.() }} className="z-btn-primary" style={{ flex: 1 }}>
          Edit
        </button>
      </div>
    </div>
  )
}

// ── SuggestedRoutineCard ─────────────────────────────────────────────────────
// Mirrors RoutineCard's tinted-square / name / meta-pill layout but swaps the
// right-side action row for a single Configure button. Suggested routines are
// curated templates from /api/routines/suggested — they never auto-deploy; the
// button opens RoutineWizard prefilled with the template's steps and the user
// confirms before save. Visual distinction: a muted "SUGGESTED" pill instead of
// "ROUTINE", and a slightly different tint so the user can tell suggested from
// installed routines at a glance.
const SuggestedRoutineCard = React.memo(function SuggestedRoutineCard({ template, onConfigure }) {
  const t = useT()
  const tier = template.tier || 'ready'
  // Suggested templates get a softer tint to read as "available" rather than
  // "installed" — mirrors how SuggestedTemplates render in Automations.jsx.
  const tint = tier === 'ready' ? 'var(--info)' : tier === 'partial' ? 'var(--warn)' : 'var(--ink-faint)'
  const stepCount = (template.wizard_prefill?.steps || []).length

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
      <div style={{
        padding: '14px 16px', borderRadius: 12,
        background: 'var(--surface)', border: '0.5px solid var(--line)',
        display: 'flex', alignItems: 'flex-start', gap: 12,
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: 11, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `color-mix(in srgb, ${tint} 12%, var(--surface-2))`,
          fontSize: 18,
        }}>
          {template.icon || '⚡'}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14, letterSpacing: '-0.01em' }}>
            {template.name}
          </p>
          {template.description && (
            <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2, lineHeight: 1.4 }}>
              {template.description}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 9.5, padding: '1px 7px', borderRadius: 999, fontWeight: 600,
              fontFamily: '"IBM Plex Mono", monospace',
              background: `color-mix(in srgb, ${tint} 12%, transparent)`, color: tint,
            }}>
              {t('routines.suggested.tag')}
            </span>
            {stepCount > 0 && (
              <span style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
                {stepCount} step{stepCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <div style={{ flexShrink: 0 }}>
          <button
            onClick={() => onConfigure(template)}
            disabled={tier === 'unavailable'}
            className={tier === 'ready' ? 'z-btn-primary' : 'z-btn-secondary'}
            style={{ fontSize: 12, padding: '6px 12px', borderRadius: 9, whiteSpace: 'nowrap', opacity: tier === 'unavailable' ? 0.4 : 1 }}
          >
            {t('routines.suggested.configure')}
          </button>
        </div>
      </div>
    </motion.div>
  )
})


// ── Page ──────────────────────────────────────────────────────────────────────
/**
 * Headerless routines list + wizard. Renders inside any container, no page
 * chrome. Used standalone via the <Routines /> page default export AND as a
 * tab body inside the Automations page.
 */
export function RoutinesListPanel() {
  const { routines, loading, fetchRoutines, saveRoutine, removeRoutine, runRoutine, loadRoutineConfig } = useAutomationStore()
  const { addToast } = useUIStore()
  const t = useT()
  const [showWizard, setShowWizard] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [viewTarget, setViewTarget] = useState(null)
  // Suggested routine templates from /api/routines/suggested. Filtered to
  // `tier !== 'unavailable'` and `already_exists !== true` so we never show
  // a card the user can't act on or that duplicates an existing routine.
  const [suggested, setSuggested] = useState([])

  // Only fetch on first visit — re-fetching on every mount toggles `loading`
  // in the store, which flashes skeletons mid-tab-transition and looks jumpy.
  useEffect(() => { if (routines.length === 0) fetchRoutines() }, [])

  // Suggested routines: fire-and-forget. A failure (e.g. backend not yet
  // restarted with the new endpoint) leaves `suggested` empty — the section
  // just doesn't render. No skeleton, no error toast: this is an additive
  // surface and the existing routines list is the primary content.
  useEffect(() => {
    getSuggestedRoutines()
      .then(r => setSuggested(Array.isArray(r?.suggested) ? r.suggested : []))
      .catch(() => setSuggested([]))
  }, [])

  // saveRoutine handles both create AND update (id present = update in place).
  // Without this, edits would slugify-on-name → orphan the original script
  // and append a duplicate card to the UI list.
  const handleSave   = async data => { try { await saveRoutine(data); addToast(data.id ? 'Routine updated' : 'Routine saved', 'success') } catch { addToast('Failed to save routine', 'error') } }
  const handleDelete = async id => { try { await removeRoutine(id); addToast('Deleted', 'success') } catch { addToast('Failed to delete', 'error') } }
  // No optimistic "Running…" toast — App.jsx's WS execution_result handler
  // surfaces the actual outcome (success step count or failure detail). Two
  // toasts would either be redundant ("Running" + "completed") or contradict
  // each other ("Running" green then "failed" red).
  const handleRun    = async r => { try { await runRoutine(r.id) } catch { addToast('Failed to run', 'error') } }
  const handleEdit   = async r => {
    // If steps are already loaded (view→edit path), open immediately so the
    // modal transition doesn't visibly break. Otherwise (Edit button on a
    // list-shape card with steps:[]) fetch first — opening with empty steps
    // and then remounting on resolve would lose any in-progress edits the
    // user makes in the first ~200ms.
    if (Array.isArray(r.steps) && r.steps.length > 0) {
      setEditTarget(r); setShowWizard(true)
      // Refresh from server in the background to pick up any out-of-band
      // changes; safe because we don't remount the wizard.
      loadRoutineConfig(r.id).catch(() => {})
      return
    }
    try { const config = await loadRoutineConfig(r.id); setEditTarget(config || r) } catch { setEditTarget(r) }
    setShowWizard(true)
  }
  const handleView = async r => {
    try { const config = await loadRoutineConfig(r.id); setViewTarget(config || r) } catch { setViewTarget(r) }
  }
  // Configure a suggested-routine template: open the wizard with the template's
  // prefill so the user reviews and saves. Suggested templates never auto-deploy.
  const handleConfigureSuggested = (template) => {
    const prefill = template.wizard_prefill || {
      name: template.name || '',
      description: template.description || '',
      icon: template.icon || '⚡',
      steps: [],
    }
    setEditTarget(prefill)
    setShowWizard(true)
  }
  const handleClose = () => { setShowWizard(false); setEditTarget(null) }

  // Filter once: hide unavailable tier (user can't act on it) and dedupe
  // against existing routines so we don't suggest something the user already
  // built. Computed here (not in useMemo) — the suggested list is tiny.
  const suggestedToRender = suggested.filter(s => s.tier !== 'unavailable' && !s.already_exists)

  return (
    <>
      {loading && routines.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 62, borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
        </div>
      )}

      {/* Suggested routines section — renders above the existing list so the
          user sees curated next steps first. Hidden entirely when empty so
          there's no visual weight when no template matches the user's setup. */}
      {suggestedToRender.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <p className="z-eyebrow" style={{ marginBottom: 8, color: 'var(--ink-mute)' }}>
            {t('routines.suggested.sectionTitle')}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {suggestedToRender.map(s => (
              <SuggestedRoutineCard key={s.id} template={s} onConfigure={handleConfigureSuggested} />
            ))}
          </div>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {routines.map(r => (
            <RoutineCard key={r.id} routine={r} onView={handleView} onEdit={handleEdit} onDelete={handleDelete} onRun={handleRun} />
          ))}
        </div>
      </AnimatePresence>

      {!loading && routines.length > 0 && (
        <button
          onClick={() => setShowWizard(true)}
          style={{
            marginTop: 8, width: '100%', padding: '13px',
            borderRadius: 14, background: 'var(--surface)',
            border: '1px dashed var(--line-2)',
            color: 'var(--ink-2)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'inherit',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          New routine
        </button>
      )}

      <Modal open={showWizard} onClose={handleClose} title={editTarget ? 'Edit Routine' : 'New Routine'}>
        <RoutineWizard initial={editTarget} onSave={handleSave} onClose={handleClose} />
      </Modal>

      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title="Routine details">
        <RoutineViewModal
          routine={viewTarget}
          onEdit={(r) => {
            // viewTarget already holds the full config (handleView fetched it),
            // so we can open the wizard in the same tick we close the view —
            // no await-blank-await race. handleEdit will short-circuit its
            // fetch since r.steps is populated.
            setViewTarget(null)
            handleEdit(r)
          }}
          onRun={(r) => handleRun(r)}
          onClose={() => setViewTarget(null)}
        />
      </Modal>
    </>
  )
}

export default function Routines() {
  const { routines } = useAutomationStore()
  return (
    <div style={{ maxWidth: 'var(--page-max-w)', margin: '0 auto', padding: '24px 20px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>Sequences of steps</p>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}>Routines</h1>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4, fontFamily: '"IBM Plex Mono", monospace' }}>{routines.length} routine{routines.length !== 1 ? 's' : ''}</p>
        </div>
      </div>
      <RoutinesListPanel />
    </div>
  )
}
