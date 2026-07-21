import React, { useMemo, useState } from 'react'
import { Input } from '../ui/Input'
import { Toggle } from '../ui/Toggle'
import { useT } from '../../lib/i18n'
import { useDeviceStore } from '../../stores/deviceStore'
import { createAutomation, deleteAutomation } from '../../lib/api'
import { entityDisplayName } from '../../lib/utils'

// ── LeaveHomeWizard ───────────────────────────────────────────────────────────
// Dedicated plain-language view/edit for the Leave Home automation. One modal
// for create (from the Library) and edit (from the active card). Auto-populated:
// on create it auto-detects the best trigger source; on edit it reads the
// existing automation. Saves a single automation (id ziggy_leave_home) — the
// lights-off runs via the reliable turn_off_all_lights step, not the flaky
// send_intent path.

const LEAVE_HOME_ID = 'ziggy_leave_home'

export default function LeaveHomeWizard({ initial, onSaved, onClose }) {
  const t = useT()
  const entities = useDeviceStore((s) => s.entities)

  // Candidate trigger sources in the home.
  const gpsCands = useMemo(() => entities.filter((e) => e.domain === 'person' || e.domain === 'device_tracker'), [entities])
  const motionCands = useMemo(() => entities.filter((e) => e.domain === 'binary_sensor' && (e.device_class === 'motion' || e.device_class === 'occupancy')), [entities])
  const doorCands = useMemo(() => entities.filter((e) => e.domain === 'binary_sensor' && (e.device_class === 'door' || e.device_class === 'opening')), [entities])
  const acEntity = useMemo(() => entities.find((e) => e.domain === 'climate'), [entities])

  const sources = useMemo(() => {
    const out = []
    if (gpsCands.length)    out.push({ key: 'gps',    icon: '📍', entities: gpsCands })
    if (motionCands.length) out.push({ key: 'motion', icon: '🚶', entities: motionCands })
    if (doorCands.length)   out.push({ key: 'door',   icon: '🚪', entities: doorCands })
    return out
  }, [gpsCands, motionCands, doorCands])

  const isUpdate = !!initial?._isInstalled

  // Derive initial state: from the existing automation on edit, else auto-detect.
  const derived = useMemo(() => {
    const trig = initial?.trigger
    if (trig?.entity_id) {
      if (trig.state === 'not_home') return { source: 'gps', entity: trig.entity_id, min: 30 }
      if (trig.state === 'off' && trig.for_minutes) return { source: 'motion', entity: trig.entity_id, min: trig.for_minutes }
      if (trig.state === 'off') return { source: 'door', entity: trig.entity_id, min: 30 }
    }
    const first = sources[0]
    return { source: first?.key || 'gps', entity: first?.entities?.[0]?.entity_id || '', min: 30 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const acts = initial?.actions || []
  const [source, setSource]   = useState(derived.source)
  const [entity, setEntity]   = useState(derived.entity)
  const [motionMin, setMotionMin] = useState(derived.min)
  const [acOff, setAcOff]     = useState(isUpdate
    ? acts.some((a) => (a.type === 'call_service' && (a.entity_id || '').startsWith('climate')) || a.type === 'ir_command')
    : !!acEntity)
  const [notify, setNotify]   = useState(isUpdate ? acts.some((a) => a.type === 'notify') : true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  const curSource = sources.find((s) => s.key === source) || sources[0]
  // Keep `entity` valid for the chosen source.
  const sourceEntities = curSource?.entities || []
  const activeEntity = sourceEntities.find((e) => e.entity_id === entity) ? entity : (sourceEntities[0]?.entity_id || '')

  const canSave = !!activeEntity && !saving

  const buildAutomation = () => {
    const trigger = source === 'gps'
      ? { type: 'state', entity_id: activeEntity, state: 'not_home' }
      : source === 'motion'
        ? { type: 'state', entity_id: activeEntity, state: 'off', for_minutes: Number(motionMin) || 30 }
        : { type: 'state', entity_id: activeEntity, state: 'off' }
    // Multi-person guard for the motion source: only when there's no motion now.
    const conditions = source === 'motion'
      ? [{ entity_id: activeEntity, operator: 'is', value: 'off' }] : []
    const actions = [{ type: 'turn_off_all_lights' }]
    if (acOff && acEntity) {
      if (acEntity.entity_id.startsWith('ir.')) {
        actions.push({ type: 'ir_command', ir_device_id: acEntity.entity_id.slice(3), ir_command: 'power_off' })
      } else {
        actions.push({ type: 'call_service', entity_id: acEntity.entity_id, service: 'climate.turn_off', service_value: 'turn_off' })
      }
    }
    if (notify) actions.push({ type: 'notify', title: 'Leave Home', message: t('automations.leaveHome.notifyMsg') })
    return {
      id: initial?.id || LEAVE_HOME_ID,
      name: 'Leave Home',
      description: t('automations.leaveHome.desc'),
      trigger, conditions, actions, rooms: [],
    }
  }

  const handleSave = async () => {
    setSaving(true); setError(null)
    try {
      await createAutomation(buildAutomation())
      await onSaved?.({ updated: isUpdate })
    } catch (e) {
      setError(e?.userMessage || e?.message || t('automations.leaveHome.failed')); setSaving(false)
    }
  }
  const handleRemove = async () => {
    setSaving(true); setError(null)
    try { await deleteAutomation(initial?.id || LEAVE_HOME_ID); await onSaved?.({ removed: true }) }
    catch (e) { setError(e?.userMessage || e?.message || t('automations.leaveHome.failed')); setSaving(false) }
  }

  const srcLabel = (k) => t(`automations.leaveHome.source.${k}`)
  const srcDesc  = (k) => t(`automations.leaveHome.source.${k}Desc`)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 2px' }} dir="auto">
      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }} dir="auto">
        {t('automations.leaveHome.subtitle')}
      </p>

      {/* Trigger source */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.leaveHome.triggerLabel')}</p>
        {sources.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--warn)', padding: '10px 12px', background: 'color-mix(in srgb, var(--warn) 8%, transparent)', borderRadius: 10 }} dir="auto">
            {t('automations.leaveHome.noSource')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, border: '0.5px solid var(--line)', borderRadius: 10, padding: 6, background: 'var(--surface)' }}>
            {sources.map((s) => {
              const sel = s.key === source
              return (
                <button key={s.key} type="button" onClick={() => setSource(s.key)}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 10px', borderRadius: 8,
                    background: sel ? 'color-mix(in srgb, var(--ok) 9%, transparent)' : 'transparent',
                    border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}>
                  <span style={{ width: 15, height: 15, borderRadius: 999, flexShrink: 0, marginTop: 2,
                    border: `1.5px solid ${sel ? 'var(--ok)' : 'var(--line)'}`, background: sel ? 'var(--ok)' : 'transparent' }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, color: 'var(--ink)' }} dir="auto">{s.icon} {srcLabel(s.key)}</span>
                    <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-faint)' }} dir="auto">{srcDesc(s.key)}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* Which sensor of the chosen source, when there's more than one. */}
        {sourceEntities.length > 1 && (
          <div style={{ marginTop: 8 }}>
            <p className="z-eyebrow" style={{ marginBottom: 6 }}>{t('automations.leaveHome.whichSensor')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, border: '0.5px solid var(--line)', borderRadius: 10, padding: 5, background: 'var(--surface)' }}>
              {sourceEntities.map((e) => {
                const sel = e.entity_id === activeEntity
                return (
                  <button key={e.entity_id} type="button" onClick={() => setEntity(e.entity_id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 7,
                      background: sel ? 'color-mix(in srgb, var(--ok) 9%, transparent)' : 'transparent',
                      border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}>
                    <span style={{ width: 13, height: 13, borderRadius: 999, flexShrink: 0,
                      border: `1.5px solid ${sel ? 'var(--ok)' : 'var(--line)'}`, background: sel ? 'var(--ok)' : 'transparent' }} />
                    <span style={{ fontSize: 12.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{entityDisplayName(e) || e.entity_id}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Motion delay */}
        {source === 'motion' && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--ink-mute)' }} dir="auto">{t('automations.leaveHome.afterNoMotion')}</span>
            <div style={{ width: 70 }}>
              <Input type="number" inputMode="numeric" min={1} max={240} value={motionMin} onChange={(e) => setMotionMin(e.target.value)} />
            </div>
            <span style={{ fontSize: 12, color: 'var(--ink-mute)' }} dir="auto">{t('automations.leaveHome.minutes')}</span>
          </div>
        )}
      </div>

      {/* What to turn off */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.leaveHome.turnOffLabel')}</p>
        <div style={{ border: '0.5px solid var(--line)', borderRadius: 12, background: 'var(--surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px' }}>
            <span style={{ fontSize: 13, color: 'var(--ink)' }} dir="auto">💡 {t('automations.leaveHome.lights')}</span>
            <span style={{ fontSize: 11, color: 'var(--ink-faint)' }} dir="auto">{t('automations.leaveHome.always')}</span>
          </div>
          {acEntity && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderTop: '0.5px solid var(--line)' }}>
              <span style={{ fontSize: 13, color: 'var(--ink)' }} dir="auto">❄️ {t('automations.leaveHome.ac')}</span>
              <Toggle checked={acOff} onCheckedChange={setAcOff} />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderTop: '0.5px solid var(--line)' }}>
            <span style={{ fontSize: 13, color: 'var(--ink)' }} dir="auto">🔔 {t('automations.leaveHome.notify')}</span>
            <Toggle checked={notify} onCheckedChange={setNotify} />
          </div>
        </div>
      </div>

      {error && (
        <p style={{ fontSize: 12, color: 'var(--accent)', padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>{error}</p>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          {isUpdate && (
            <button type="button" onClick={handleRemove} disabled={saving} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, color: 'var(--accent)' }}>
              {t('automations.leaveHome.delete')}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13 }}>{t('common.cancel')}</button>
          <button type="button" onClick={handleSave} disabled={!canSave} className="z-btn-primary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, opacity: canSave ? 1 : 0.5 }}>
            {isUpdate ? t('automations.leaveHome.update') : t('automations.leaveHome.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
