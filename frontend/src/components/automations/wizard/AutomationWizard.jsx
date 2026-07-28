import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import { Input, Textarea } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { useT } from '../../../lib/i18n'
import { getAllRooms } from '../../../lib/api'
import { getRunModes } from '../../../lib/automations/types'
import { safeUuid } from '../../../lib/uuid'
import TriggerEditor from './TriggerEditor'
import ConditionRow from './ConditionRow'
import { AndConnector } from './Atoms'
import { DraggableActionRow } from './ActionRow'
import ReviewPanel from './ReviewPanel'
import { StepFrame } from '../bundles/engine/StepFrame'

// ── AutomationWizard ──────────────────────────────────────────────────────────
// The free-form builder, rendered through the SAME StepFrame shell as every
// bundle wizard (same header, dots, counter, nav) — so custom creation and
// bundle creation speak one visual language. Its step bodies keep their
// dedicated editors (trigger / conditions / actions / review).

const STEP_KEYS = ['stepName', 'stepTrigger', 'stepConditions', 'stepActions', 'stepReview']
const STEP_COUNT = STEP_KEYS.length

function AutomationWizard({ initial, onSave, onClose }) {
  const t = useT()
  const [step,             setStep]           = useState(0)
  const [name,             setName]           = useState(initial?.name || '')
  const [description,      setDescription]    = useState(initial?.description || '')
  const [selectedRooms,    setSelectedRooms]  = useState(initial?.rooms || [])
  const [availableRooms,   setAvailableRooms] = useState([])
  const [trigger,          setTrigger]        = useState(initial?.trigger || { type: 'time', time: '' })
  const [actions,          setActions]        = useState(() => (initial?.actions || []).map(a => ({ ...a, _key: a._key || safeUuid() })))
  const [conditions,       setConditions]     = useState(() => (initial?.conditions || []).map(c => ({ ...c, _key: c._key || safeUuid() })))
  const [collapsedActions, setCollapsedActions] = useState(new Set())
  const [mode,             setMode]           = useState(initial?.mode || 'single')
  const [saving,           setSaving]         = useState(false)

  useEffect(() => { getAllRooms().then(r => setAvailableRooms(Array.isArray(r) ? r : r.rooms ?? [])).catch(() => {}) }, [])

  const toggleRoom = roomId => setSelectedRooms(prev => prev.includes(roomId) ? prev.filter(id => id !== roomId) : [...prev, roomId])

  const addAction = () => {
    const newKey = safeUuid()
    setCollapsedActions(prev => { const next = new Set(prev); actions.forEach(a => next.add(a._key)); return next })
    setActions(a => [...a, { type: 'call_service', entity_id: '', service: 'homeassistant.turn_on', _key: newKey }])
  }

  const updateAction    = (i, val) => setActions(a => a.map((x, j) => j === i ? { ...val, _key: x._key } : x))
  const removeAction    = key => { setActions(a => a.filter(x => x._key !== key)); setCollapsedActions(prev => { const next = new Set(prev); next.delete(key); return next }) }
  const toggleCollapse  = key => setCollapsedActions(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })
  const canNext = () => step === 0 ? name.trim().length > 0 : !!(trigger.type || 'time')

  const handleSave = async () => {
    setSaving(true)
    // Keep entity-state conditions that have an entity AND time-window conditions
    // that have at least one bound. Anything else is half-filled noise.
    const cleanConditions = conditions
      .map(({ _key, ...rest }) => rest)
      .filter(c => (c.type === 'time' ? (c.after || c.before) : !!c.entity_id))
    const cleanActions = actions.map(({ _key, ...rest }) => rest)
    // The "occupancy" trigger is a UI convenience — resolve it to the state
    // trigger the backend understands (a room's presence sensor going on/off).
    let outTrigger = trigger
    if (trigger?.type === 'occupancy') {
      outTrigger = { type: 'state', entity_id: trigger.entity_id || '', state: trigger.state === 'off' ? 'off' : 'on' }
      if (trigger.for_minutes) outTrigger.for_minutes = trigger.for_minutes
    }
    await onSave({ name, description, trigger: outTrigger, conditions: cleanConditions, actions: cleanActions, rooms: selectedRooms, mode })
    setSaving(false); onClose()
  }

  // Track the furthest step reached so back-jumping is free but forward-jumping
  // past unfilled gates isn't. Editing unlocks every step.
  const [maxReached, setMaxReached] = useState(initial ? STEP_COUNT - 1 : 0)
  useEffect(() => { if (step > maxReached) setMaxReached(step) }, [step, maxReached])

  // Template-supplied wizard warnings (e.g. Night Watch single-mmWave guard).
  const wizardWarnings = Array.isArray(initial?.warnings) ? initial.warnings : []

  const isLast = step === STEP_COUNT - 1
  const primaryLabel = isLast
    ? (saving ? t('automations.wizard.saving') : initial ? t('automations.wizard.saveChanges') : t('automations.wizard.create'))
    : t('automations.bundles.next')

  return (
    <StepFrame
      title={t(`automations.wizard.${STEP_KEYS[step]}`)}
      step={step} total={STEP_COUNT} maxReached={maxReached}
      onJump={(i) => setStep(i)}
      onBack={() => (step === 0 ? onClose() : setStep(s => s - 1))}
      backLabel={step === 0 ? t('common.cancel') : t('automations.bundles.back')}
      onPrimary={isLast ? handleSave : () => setStep(s => s + 1)}
      primaryDisabled={isLast ? saving : !canNext()}
      primaryLabel={primaryLabel}
    >
      {wizardWarnings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {wizardWarnings.map(w => (
            <div
              key={w.id || w.text}
              dir="auto"
              style={{
                padding: '8px 12px', borderRadius: 8, fontSize: 12.5, lineHeight: 1.45,
                background: w.level === 'warn' ? 'rgba(255, 196, 0, 0.12)' : 'var(--surface)',
                border: '0.5px solid ' + (w.level === 'warn' ? 'rgba(255, 196, 0, 0.45)' : 'var(--line)'),
                color: 'var(--ink)',
              }}
            >
              {w.text}
            </div>
          ))}
        </div>
      )}
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}>
          {step === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Input label={t('automations.namePlaceholder')} placeholder={t('automations.wizard.namePlaceholder')} value={name} onChange={e => setName(e.target.value)} dir="auto" />
              <Textarea label={t('automations.wizard.descriptionLabel')} placeholder={t('automations.wizard.descriptionPlaceholder')} value={description} onChange={e => setDescription(e.target.value)} rows={3} dir="auto" />
              {availableRooms.length > 0 && (
                <div>
                  <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>{t('automations.wizard.roomsLabel')}</p>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 2 }}>
                {t('automations.wizard.conditionsHint')}
              </p>
              {conditions.map((cond, i) => (
                <div key={cond._key} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {i > 0 && <AndConnector />}
                  <ConditionRow
                    condition={cond}
                    onChange={v => setConditions(cs => cs.map((c, j) => j === i ? { ...v, _key: c._key } : c))}
                    onRemove={() => setConditions(cs => cs.filter((_, j) => j !== i))}
                  />
                </div>
              ))}
              <button
                onClick={() => setConditions(cs => [...cs, { type: 'entity', entity_id: '', operator: 'is', value: 'on', _key: safeUuid() }])}
                className="z-btn-secondary"
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                {conditions.length === 0 ? t('automations.wizard.addCondition') : t('automations.wizard.addAnotherCondition')}
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
                {t('automations.wizard.addAction')}
              </button>
            </div>
          )}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <ReviewPanel name={name} description={description} trigger={trigger} conditions={conditions.map(({ _key, ...rest }) => rest)} actions={actions.map(({ _key, ...rest }) => ({ ...rest, _key }))} />
              <div>
                <Select label={t('automations.mode.label')} options={getRunModes()} value={mode} onChange={e => setMode(e.target.value)} />
                <p style={{ fontSize: 11, color: 'var(--ink-faint)', margin: '4px 0 0', lineHeight: 1.4 }} dir="auto">
                  {t('automations.mode.hint')}
                </p>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </StepFrame>
  )
}

export default AutomationWizard
