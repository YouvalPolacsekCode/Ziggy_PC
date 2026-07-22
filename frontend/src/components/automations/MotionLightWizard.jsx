import React, { useEffect, useMemo, useState } from 'react'
import { Input } from '../ui/Input'
import { Toggle } from '../ui/Toggle'
import { useT } from '../../lib/i18n'
import { useDeviceStore } from '../../stores/deviceStore'
import { createAutomation, deleteAutomation } from '../../lib/api'
import { entityDisplayName } from '../../lib/utils'

// ── MotionLightWizard ─────────────────────────────────────────────────────────
// Dedicated view/edit for Motion Light. One modal for create + edit.
//
// Light on when motion is seen, off a while after the motion stops. The "off"
// uses wait_for_state(motion → off) + a linger delay, and the executor dedupes
// concurrent runs — so continued motion holds the light on (it re-extends)
// instead of snapping off mid-presence. Optional night-only window + brightness.

const MOTION_LIGHT_ID = 'ziggy_motion_light'
const WAIT_TIMEOUT_S = 60 * 60   // safety: stop waiting for "motion off" after 1h

export default function MotionLightWizard({ initial, onSaved, onClose, confirmDelete }) {
  const t = useT()
  const storeEntities = useDeviceStore((s) => s.entities)

  const motionEnts = useMemo(
    () => storeEntities.filter((e) => e.domain === 'binary_sensor' && ['motion', 'occupancy', 'presence'].includes(e.device_class)),
    [storeEntities])
  const lightEnts = useMemo(() => storeEntities.filter((e) => e.domain === 'light'), [storeEntities])

  const isUpdate = !!initial?._isInstalled

  const derived = useMemo(() => {
    const trig = initial?.trigger || {}
    const acts = initial?.actions || []
    const conds = initial?.conditions || []
    const mIds = Array.isArray(trig.entity_id) ? trig.entity_id : (trig.entity_id ? [trig.entity_id] : [])
    const onActs = acts.filter((a) => a.type === 'call_service' && a.service === 'light.turn_on')
    const lIds = onActs.map((a) => a.entity_id)
    const bright = onActs[0]?.service_data?.brightness_pct ?? 60
    const linger = acts.find((a) => a.type === 'delay')?.seconds ?? 120
    const timeCond = conds.find((c) => c.type === 'time')
    return {
      motionMode: (isUpdate && mIds.length && mIds.length < motionEnts.length) ? 'choose' : 'all',
      chosenM: mIds,
      lightsMode: (isUpdate && lIds.length && lIds.length < lightEnts.length) ? 'choose' : 'all',
      chosenL: lIds,
      brightness: bright,
      lingerMin: Math.max(1, Math.round((linger || 120) / 60)),
      nightOnly: isUpdate ? !!timeCond : true,
      after: timeCond?.after || '21:00',
      before: timeCond?.before || '07:00',
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [motionMode, setMotionMode] = useState(derived.motionMode)
  const [chosenM, setChosenM] = useState(() => new Set(derived.chosenM))
  const [lightsMode, setLightsMode] = useState(derived.lightsMode)
  const [chosenL, setChosenL] = useState(() => new Set(derived.chosenL))
  const [brightness, setBrightness] = useState(derived.brightness)
  const [lingerMin, setLingerMin] = useState(derived.lingerMin)
  const [nightOnly, setNightOnly] = useState(derived.nightOnly)
  const [after, setAfter] = useState(derived.after)
  const [before, setBefore] = useState(derived.before)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const motionIds = motionMode === 'all' ? motionEnts.map((e) => e.entity_id) : Array.from(chosenM)
  const lightIds = lightsMode === 'all' ? lightEnts.map((e) => e.entity_id) : Array.from(chosenL)
  const toggle = (setFn) => (id) => setFn((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const canSave = motionIds.length > 0 && lightIds.length > 0 && !saving

  const buildMotionLight = () => {
    const trigger = { type: 'state', entity_id: motionIds, state: 'on' }
    const conditions = nightOnly ? [{ type: 'time', after, before }] : []
    const B = Math.max(1, Math.min(100, Number(brightness) || 60))
    const actions = [
      ...lightIds.map((id) => ({ type: 'call_service', entity_id: id, service: 'light.turn_on', service_value: 'turn_on', service_data: { brightness_pct: B } })),
      ...motionIds.map((id) => ({ type: 'wait_for_state', entity_id: id, state: 'off', timeout_seconds: WAIT_TIMEOUT_S, on_timeout: 'continue' })),
      { type: 'delay', seconds: Math.max(5, (Number(lingerMin) || 2) * 60) },
      ...lightIds.map((id) => ({ type: 'call_service', entity_id: id, service: 'light.turn_off', service_value: 'turn_off' })),
    ]
    return { id: initial?.id || MOTION_LIGHT_ID, name: 'Motion Light', description: t('automations.motionLight.desc'), trigger, conditions, actions, rooms: [] }
  }

  const handleSave = async () => {
    setSaving(true); setError(null)
    try { await createAutomation(buildMotionLight()); await onSaved?.({ updated: isUpdate }) }
    catch (e) { setError(e?.userMessage || e?.message || t('automations.motionLight.failed')); setSaving(false) }
  }
  const handleRemove = async () => {
    if (confirmDelete && !(await confirmDelete(t('automations.motionLight.title')))) return
    setSaving(true); setError(null)
    try { await deleteAutomation(initial?.id || MOTION_LIGHT_ID); await onSaved?.({ removed: true }) }
    catch (e) { setError(e?.userMessage || e?.message || t('automations.motionLight.failed')); setSaving(false) }
  }

  const Picker = ({ label, mode, setMode, ents, chosen, onToggle, emptyKey, icon }) => (
    <div>
      <p className="z-eyebrow" style={{ marginBottom: 8 }}>{label}</p>
      {ents.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--warn)', padding: '10px 12px', background: 'color-mix(in srgb, var(--warn) 8%, transparent)', borderRadius: 10 }} dir="auto">{t(emptyKey)}</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: mode === 'choose' ? 8 : 0 }}>
            {['all', 'choose'].map((m) => {
              const sel = mode === m
              return (
                <button key={m} type="button" onClick={() => { setMode(m); if (m === 'choose' && chosen.size === 0) onToggle('__init__', ents) }}
                  style={{ padding: '7px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', border: sel ? 'none' : '0.5px solid var(--line)', background: sel ? 'var(--ink)' : 'var(--surface)', color: sel ? 'var(--bg)' : 'var(--ink-mute)' }} dir="auto">
                  {icon} {t(m === 'all' ? 'automations.motionLight.all' : 'automations.motionLight.choose')}
                </button>
              )
            })}
          </div>
          {mode === 'choose' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, border: '0.5px solid var(--line)', borderRadius: 10, padding: 6, background: 'var(--surface)', maxHeight: 170, overflowY: 'auto' }}>
              {ents.map((e) => {
                const on = chosen.has(e.entity_id)
                return (
                  <button key={e.entity_id} type="button" onClick={() => onToggle(e.entity_id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px', borderRadius: 7, background: on ? 'color-mix(in srgb, var(--ok) 8%, transparent)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}>
                    <span style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, border: `1.5px solid ${on ? 'var(--ok)' : 'var(--line)'}`, background: on ? 'var(--ok)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--bg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6"/></svg>}
                    </span>
                    <span style={{ fontSize: 12.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{entityDisplayName(e) || e.entity_id}</span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )

  const toggleM = (id, ents) => { if (id === '__init__') { setChosenM(new Set(ents.map((e) => e.entity_id))); return } toggle(setChosenM)(id) }
  const toggleL = (id, ents) => { if (id === '__init__') { setChosenL(new Set(ents.map((e) => e.entity_id))); return } toggle(setChosenL)(id) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 2px' }} dir="auto">
      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }} dir="auto">{t('automations.motionLight.subtitle')}</p>

      <Picker label={t('automations.motionLight.motionLabel')} mode={motionMode} setMode={setMotionMode} ents={motionEnts} chosen={chosenM} onToggle={toggleM} emptyKey="automations.motionLight.noMotion" icon="🚶" />
      <Picker label={t('automations.motionLight.lightsLabel')} mode={lightsMode} setMode={setLightsMode} ents={lightEnts} chosen={chosenL} onToggle={toggleL} emptyKey="automations.motionLight.noLights" icon="💡" />

      {/* Brightness + linger */}
      <div style={{ border: '0.5px solid var(--line)', borderRadius: 12, background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 13px' }}>
          <span style={{ fontSize: 12.5, color: 'var(--ink)', flex: 1 }} dir="auto">💡 {t('automations.motionLight.brightness')}</span>
          <div style={{ width: 60 }}><Input type="number" inputMode="numeric" min={1} max={100} value={brightness} onChange={(e) => setBrightness(e.target.value)} /></div>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>%</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 13px', borderTop: '0.5px solid var(--line)' }}>
          <span style={{ fontSize: 12.5, color: 'var(--ink)', flex: 1 }} dir="auto">⏱ {t('automations.motionLight.offAfter')}</span>
          <div style={{ width: 56 }}><Input type="number" inputMode="numeric" min={1} max={120} value={lingerMin} onChange={(e) => setLingerMin(e.target.value)} /></div>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }} dir="auto">{t('automations.motionLight.minutes')}</span>
        </div>
      </div>

      {/* Night-only */}
      <div style={{ border: '0.5px solid var(--line)', borderRadius: 12, background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 13px' }}>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13, color: 'var(--ink)' }} dir="auto">🌙 {t('automations.motionLight.nightOnly')}</span>
            <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 1 }} dir="auto">{t('automations.motionLight.nightOnlySub')}</span>
          </span>
          <Toggle checked={nightOnly} onCheckedChange={setNightOnly} />
        </div>
        {nightOnly && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 13px 11px' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-mute)' }} dir="auto">{t('automations.motionLight.from')}</span>
            <div style={{ width: 92 }}><Input type="time" value={after} onChange={(e) => setAfter(e.target.value)} /></div>
            <span style={{ fontSize: 12, color: 'var(--ink-mute)' }} dir="auto">{t('automations.motionLight.to')}</span>
            <div style={{ width: 92 }}><Input type="time" value={before} onChange={(e) => setBefore(e.target.value)} /></div>
          </div>
        )}
      </div>

      {error && <p style={{ fontSize: 12, color: 'var(--accent)', padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
        <div>{isUpdate && (
          <button type="button" onClick={handleRemove} disabled={saving} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, color: 'var(--accent)' }}>{t('automations.motionLight.delete')}</button>
        )}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13 }}>{t('common.cancel')}</button>
          <button type="button" onClick={handleSave} disabled={!canSave} className="z-btn-primary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, opacity: canSave ? 1 : 0.5 }}>{isUpdate ? t('automations.motionLight.update') : t('automations.motionLight.confirm')}</button>
        </div>
      </div>
    </div>
  )
}
