import React, { useEffect, useMemo, useState } from 'react'
import { Input } from '../ui/Input'
import { useT } from '../../lib/i18n'
import { useDeviceStore } from '../../stores/deviceStore'
import { createAutomation, deleteAutomation } from '../../lib/api'
import { entityDisplayName } from '../../lib/utils'

// ── NightWatchWizard ──────────────────────────────────────────────────────────
// Dedicated view/edit for Night Watch — a 3-stage night routine saved as a
// paired automation:
//   1. Activate  (at your set time, IF the bedroom sensor sees you): snapshot +
//      dim the lights, and ARM the alert.
//   2. Alert     (armed only): a quiet push if the living-room sensor stirs.
//   3. Disarm    (at sunrise): disable the alert + restore the lights.
//
// The stages are stitched by config id. HA derives an automation's entity slug
// from its ALIAS, so we name the alert stage "<base> alert" — which slugs back
// to its own config id — so the disarm condition (automation.<base>_alert) is
// real. All copy is localized. The two helper stages are hidden from the list.

const BASE_ID = 'ziggy_night_watch'
const ALERT_ID = `${BASE_ID}_alert`

export default function NightWatchWizard({ initial, onSaved, onClose, confirmDelete }) {
  const t = useT()
  const storeEntities = useDeviceStore((s) => s.entities)

  const presenceEnts = useMemo(
    () => storeEntities.filter((e) => e.domain === 'binary_sensor' && ['presence', 'occupancy', 'motion'].includes(e.device_class)),
    [storeEntities])
  const lightEnts = useMemo(() => storeEntities.filter((e) => e.domain === 'light'), [storeEntities])

  const isUpdate = !!initial?._isInstalled

  const derived = useMemo(() => {
    // Edit: read back from the activate stage (the top-level trigger/actions
    // mirror it) + any carried stages.
    const trig = initial?.trigger || {}
    const conds = initial?.conditions || []
    const acts = initial?.actions || []
    const dimAct = acts.find((a) => a.type === 'call_service' && a.service === 'light.turn_on')
    const savedIds = acts.find((a) => a.type === 'save_entity_states')?.entity_ids || []
    const alertStage = (initial?.stages || []).find((s) => (s.key || '') === 'alert')
    const alertTrig = alertStage?.trigger || {}
    const livingIds = Array.isArray(alertTrig.entity_id) ? alertTrig.entity_id : (alertTrig.entity_id ? [alertTrig.entity_id] : [])
    return {
      armTime: (trig.time || '00:00').slice(0, 5),
      bedroom: conds.find((c) => c.entity_id)?.entity_id || '',
      living: livingIds,
      dimLevel: dimAct?.service_data?.brightness_pct ?? 10,
      lightsMode: (isUpdate && savedIds.length && savedIds.length < lightEnts.length) ? 'choose' : 'all',
      chosen: savedIds,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [armTime, setArmTime] = useState(derived.armTime)
  const [bedroom, setBedroom] = useState(derived.bedroom)
  const [living, setLiving] = useState(() => new Set(derived.living))
  const [dimLevel, setDimLevel] = useState(derived.dimLevel)
  const [lightsMode, setLightsMode] = useState(derived.lightsMode)
  const [chosen, setChosen] = useState(() => new Set(derived.chosen))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!bedroom && presenceEnts[0]) setBedroom(presenceEnts[0].entity_id)
    if (living.size === 0 && presenceEnts[1]) setLiving(new Set([presenceEnts[1].entity_id]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenceEnts])

  const lightIds = lightsMode === 'all' ? lightEnts.map((e) => e.entity_id) : Array.from(chosen)
  const livingIds = Array.from(living)
  const toggleLiving = (id) => setLiving((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleLight = (id) => setChosen((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const canSave = !!bedroom && livingIds.length > 0 && lightIds.length > 0 && !saving

  const buildNightWatch = () => {
    const D = Math.max(1, Math.min(100, Number(dimLevel) || 10))
    const activate = {
      key: 'activate',
      name: 'Night Watch',
      description: t('automations.nightWatch.stageActivate'),
      trigger: { type: 'time', time: armTime },
      conditions: [{ entity_id: bedroom, operator: 'is', value: 'on' }],
      actions: [
        { type: 'save_entity_states', namespace: 'night_watch', state_key: 'saved_lights', entity_ids: lightIds },
        ...lightIds.map((id) => ({ type: 'call_service', entity_id: id, service: 'light.turn_on', service_value: 'turn_on', service_data: { brightness_pct: D } })),
        { type: 'automation', automation_id: ALERT_ID, mode: 'enable' },
      ],
      rooms: [],
    }
    const alert = {
      key: 'alert',
      // Named so its HA entity slug == its config id (ziggy_night_watch_alert),
      // which the disarm condition below relies on.
      name: 'Ziggy Night Watch alert',
      description: t('automations.nightWatch.stageAlert'),
      trigger: { type: 'state', entity_id: livingIds, state: 'on' },
      conditions: [],
      actions: [{ type: 'notify', title: 'Ziggy', message: t('automations.nightWatch.alertMsg') }],
      rooms: [],
      _initial_enabled: false,
    }
    const disarm = {
      key: 'disarm',
      name: 'Ziggy Night Watch disarm',
      description: t('automations.nightWatch.stageDisarm'),
      trigger: { type: 'sunrise', offset: '' },
      conditions: [{ entity_id: `automation.${ALERT_ID}`, operator: 'is', value: 'on' }],
      actions: [
        { type: 'automation', automation_id: ALERT_ID, mode: 'disable' },
        { type: 'restore_entity_states', namespace: 'night_watch', state_key: 'saved_lights' },
      ],
      rooms: [],
    }
    return {
      id: initial?.id || BASE_ID,
      base_id: BASE_ID,
      name: 'Night Watch',
      description: t('automations.nightWatch.desc'),
      paired: true,
      stages: [activate, alert, disarm],
      // Mirror the activate stage at top level so edit round-trips.
      trigger: activate.trigger,
      conditions: activate.conditions,
      actions: activate.actions,
      rooms: [],
    }
  }

  const handleSave = async () => {
    setSaving(true); setError(null)
    try { await createAutomation(buildNightWatch()); await onSaved?.({ updated: isUpdate }) }
    catch (e) { setError(e?.userMessage || e?.message || t('automations.nightWatch.failed')); setSaving(false) }
  }
  const handleRemove = async () => {
    if (confirmDelete && !(await confirmDelete(t('automations.nightWatch.title')))) return
    setSaving(true); setError(null)
    try {
      await deleteAutomation(initial?.id || BASE_ID)
      try { await deleteAutomation(ALERT_ID) } catch {}
      try { await deleteAutomation(`${BASE_ID}_disarm`) } catch {}
      await onSaved?.({ removed: true })
    } catch (e) { setError(e?.userMessage || e?.message || t('automations.nightWatch.failed')); setSaving(false) }
  }

  const RadioRow = ({ e, sel, onClick }) => (
    <button type="button" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 7, background: sel ? 'color-mix(in srgb, var(--ok) 9%, transparent)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}>
      <span style={{ width: 13, height: 13, borderRadius: 999, flexShrink: 0, border: `1.5px solid ${sel ? 'var(--ok)' : 'var(--line)'}`, background: sel ? 'var(--ok)' : 'transparent' }} />
      <span style={{ fontSize: 12.5, color: 'var(--ink)' }} dir="auto">{entityDisplayName(e) || e.entity_id}</span>
    </button>
  )
  const CheckRow = ({ e, on, onClick }) => (
    <button type="button" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px', borderRadius: 7, background: on ? 'color-mix(in srgb, var(--ok) 8%, transparent)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}>
      <span style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, border: `1.5px solid ${on ? 'var(--ok)' : 'var(--line)'}`, background: on ? 'var(--ok)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--bg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6"/></svg>}
      </span>
      <span style={{ fontSize: 12.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{entityDisplayName(e) || e.entity_id}</span>
    </button>
  )
  const box = { display: 'flex', flexDirection: 'column', gap: 3, border: '0.5px solid var(--line)', borderRadius: 10, padding: 5, background: 'var(--surface)', maxHeight: 150, overflowY: 'auto' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 2px' }} dir="auto">
      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }} dir="auto">{t('automations.nightWatch.subtitle')}</p>

      {presenceEnts.length < 2 && (
        <p style={{ fontSize: 12, color: 'var(--warn)', padding: '10px 12px', background: 'color-mix(in srgb, var(--warn) 8%, transparent)', borderRadius: 10 }} dir="auto">{t('automations.nightWatch.needTwo')}</p>
      )}

      {/* Arm time */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="z-eyebrow" style={{ flex: 1 }}>{t('automations.nightWatch.armLabel')}</span>
        <div style={{ width: 100 }}><Input type="time" value={armTime} onChange={(e) => setArmTime(e.target.value)} /></div>
      </div>

      {/* Bedroom sensor */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.nightWatch.bedroomLabel')}</p>
        {presenceEnts.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--warn)' }} dir="auto">{t('automations.nightWatch.noSensors')}</p>
        ) : (
          <div style={box}>{presenceEnts.map((e) => <RadioRow key={e.entity_id} e={e} sel={e.entity_id === bedroom} onClick={() => setBedroom(e.entity_id)} />)}</div>
        )}
      </div>

      {/* Living-room sensor(s) */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.nightWatch.livingLabel')}</p>
        <div style={box}>{presenceEnts.filter((e) => e.entity_id !== bedroom).map((e) => <CheckRow key={e.entity_id} e={e} on={living.has(e.entity_id)} onClick={() => toggleLiving(e.entity_id)} />)}</div>
      </div>

      {/* Lights + dim level */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.nightWatch.lightsLabel')}</p>
        <div style={{ display: 'flex', gap: 6, marginBottom: lightsMode === 'choose' ? 8 : 0 }}>
          {['all', 'choose'].map((m) => {
            const sel = lightsMode === m
            return (
              <button key={m} type="button" onClick={() => { setLightsMode(m); if (m === 'choose' && chosen.size === 0) setChosen(new Set(lightEnts.map((e) => e.entity_id))) }}
                style={{ padding: '7px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', border: sel ? 'none' : '0.5px solid var(--line)', background: sel ? 'var(--ink)' : 'var(--surface)', color: sel ? 'var(--bg)' : 'var(--ink-mute)' }} dir="auto">
                💡 {t(m === 'all' ? 'automations.nightWatch.allLights' : 'automations.nightWatch.chooseLights')}
              </button>
            )
          })}
        </div>
        {lightsMode === 'choose' && (
          <div style={box}>{lightEnts.map((e) => <CheckRow key={e.entity_id} e={e} on={chosen.has(e.entity_id)} onClick={() => toggleLight(e.entity_id)} />)}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <span style={{ fontSize: 12.5, color: 'var(--ink)', flex: 1 }} dir="auto">🌙 {t('automations.nightWatch.dimTo')}</span>
          <div style={{ width: 56 }}><Input type="number" inputMode="numeric" min={1} max={100} value={dimLevel} onChange={(e) => setDimLevel(e.target.value)} /></div>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>%</span>
        </div>
      </div>

      {error && <p style={{ fontSize: 12, color: 'var(--accent)', padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
        <div>{isUpdate && (
          <button type="button" onClick={handleRemove} disabled={saving} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, color: 'var(--accent)' }}>{t('automations.nightWatch.delete')}</button>
        )}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13 }}>{t('common.cancel')}</button>
          <button type="button" onClick={handleSave} disabled={!canSave} className="z-btn-primary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, opacity: canSave ? 1 : 0.5 }}>{isUpdate ? t('automations.nightWatch.update') : t('automations.nightWatch.confirm')}</button>
        </div>
      </div>
    </div>
  )
}
