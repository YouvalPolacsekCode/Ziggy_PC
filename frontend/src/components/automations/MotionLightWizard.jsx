import React, { useEffect, useMemo, useState } from 'react'
import { Input } from '../ui/Input'
import { Toggle } from '../ui/Toggle'
import { useT } from '../../lib/i18n'
import { useDeviceStore } from '../../stores/deviceStore'
import { createAutomation, deleteAutomation, getEntities } from '../../lib/api'
import { entityDisplayName } from '../../lib/utils'

// ── MotionLightWizard ─────────────────────────────────────────────────────────
// Dedicated view/edit for Motion Light. One modal for create + edit.
//
// ROOM-AWARE: each selected sensor drives only the lights in ITS OWN room — so
// office motion lights the office, living-room motion lights the living room.
// When more than one room is involved it's saved as a paired automation (one
// stage per room, extra stages hidden); a single room stays a single automation.
// Falls back to "any → all" only when there's no room info to pair on.
//
// The light off uses wait_for_state(motion → off) + a linger, and the executor
// dedupes concurrent runs, so continued movement holds the light on (re-extends).

const BASE_ID = 'ziggy_motion_light'
const WAIT_TIMEOUT_S = 60 * 60
const NO_ROOM = '__none__'
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'room'

export default function MotionLightWizard({ initial, onSaved, onClose, confirmDelete, automations = [] }) {
  const t = useT()
  const storeEntities = useDeviceStore((s) => s.entities)
  const ziggyRooms = useDeviceStore((s) => s.ziggyRooms)

  const motionEnts = useMemo(
    () => storeEntities.filter((e) => e.domain === 'binary_sensor' && ['motion', 'occupancy', 'presence'].includes(e.device_class)),
    [storeEntities])
  const [lightEnts, setLightEnts] = useState(() => storeEntities.filter((e) => e.domain === 'light'))
  useEffect(() => {
    let alive = true
    getEntities('light', { all: true }).then((r) => {
      if (!alive) return
      const list = (r?.entities || []).map((e) => ({ ...e, domain: e.domain || 'light' }))
      if (list.length) setLightEnts(list)
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  const roomMap = useMemo(() => {
    const m = {}
    for (const r of ziggyRooms || []) for (const eid of (r.entities || [])) m[eid] = r.name
    return m
  }, [ziggyRooms])
  const roomOf = (eid) => roomMap[eid] || NO_ROOM

  const isUpdate = !!initial?._isInstalled

  // Edit: reconstruct the union of sensors + lights across ALL motion-light
  // stages (base + per-room), since the card only carries the first stage.
  const derived = useMemo(() => {
    const mine = (automations || []).filter((a) => a.id === BASE_ID || String(a.id).startsWith(BASE_ID + '_'))
    const src = mine.length ? mine : (initial ? [initial] : [])
    const mSet = new Set(), lSet = new Set()
    let bright = 60, linger = 120, timeCond = null
    for (const a of src) {
      const trig = a.trigger || {}
      const tids = Array.isArray(trig.entity_id) ? trig.entity_id : (trig.entity_id ? [trig.entity_id] : [])
      tids.forEach((id) => mSet.add(id))
      for (const act of (a.actions || [])) {
        if (act.type === 'call_service' && act.service === 'light.turn_on') { lSet.add(act.entity_id); if (act.service_data?.brightness_pct != null) bright = act.service_data.brightness_pct }
        if (act.type === 'delay' && act.seconds != null) linger = act.seconds
      }
      const tc = (a.conditions || []).find((c) => c.type === 'time')
      if (tc) timeCond = tc
    }
    const mIds = [...mSet], lIds = [...lSet]
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

  // Preview: how the selection groups into per-room pairs.
  const groups = useMemo(() => {
    const sBy = {}, lBy = {}
    motionIds.forEach((id) => { const r = roomOf(id); (sBy[r] = sBy[r] || []).push(id) })
    lightIds.forEach((id) => { const r = roomOf(id); (lBy[r] = lBy[r] || []).push(id) })
    const rooms = Object.keys(sBy).filter((r) => (lBy[r] || []).length)
    return rooms.map((r) => ({ room: r, sensors: sBy[r], lights: lBy[r] }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionMode, lightsMode, chosenM, chosenL, motionIds.length, lightIds.length, roomMap])

  const conditions = () => nightOnly ? [{ type: 'time', after, before }] : []
  const stageActions = (sensors, lights) => {
    const B = Math.max(1, Math.min(100, Number(brightness) || 60))
    return [
      ...lights.map((id) => ({ type: 'call_service', entity_id: id, service: 'light.turn_on', service_value: 'turn_on', service_data: { brightness_pct: B } })),
      ...sensors.map((id) => ({ type: 'wait_for_state', entity_id: id, state: 'off', timeout_seconds: WAIT_TIMEOUT_S, on_timeout: 'continue' })),
      { type: 'delay', seconds: Math.max(5, (Number(lingerMin) || 2) * 60) },
      ...lights.map((id) => ({ type: 'call_service', entity_id: id, service: 'light.turn_off', service_value: 'turn_off' })),
    ]
  }
  const roomLabel = (r) => r === NO_ROOM ? t('automations.motionLight.otherRoom') : r

  const build = () => {
    // No pairable room info → one "any → all" automation (graceful fallback).
    if (groups.length <= 1) {
      const g = groups[0] || { sensors: motionIds, lights: lightIds }
      return { payload: { id: initial?.id || BASE_ID, name: 'Motion Light', description: t('automations.motionLight.desc'), trigger: { type: 'state', entity_id: g.sensors, state: 'on' }, conditions: conditions(), actions: stageActions(g.sensors, g.lights), rooms: [] }, ids: [BASE_ID] }
    }
    // Multiple rooms → paired, one stage per room.
    const stages = groups.map((g, i) => ({
      key: slug(g.room === NO_ROOM ? 'other' : g.room),
      name: i === 0 ? 'Motion Light' : `Motion Light — ${roomLabel(g.room)}`,
      description: t('automations.motionLight.desc'),
      trigger: { type: 'state', entity_id: g.sensors, state: 'on' },
      conditions: conditions(),
      actions: stageActions(g.sensors, g.lights),
      rooms: [],
    }))
    const ids = stages.map((s, i) => i === 0 ? BASE_ID : `${BASE_ID}_${s.key}`)
    return { payload: { id: BASE_ID, base_id: BASE_ID, name: 'Motion Light', description: t('automations.motionLight.desc'), paired: true, stages, trigger: stages[0].trigger, conditions: stages[0].conditions, actions: stages[0].actions, rooms: [] }, ids }
  }

  const existingIds = () => (automations || []).filter((a) => a.id === BASE_ID || String(a.id).startsWith(BASE_ID + '_')).map((a) => a.id)

  const handleSave = async () => {
    setSaving(true); setError(null)
    try {
      const { payload, ids } = build()
      await createAutomation(payload)
      // Drop any room-stage that's no longer part of the setup.
      for (const id of existingIds()) if (!ids.includes(id)) { try { await deleteAutomation(id) } catch {} }
      await onSaved?.({ updated: isUpdate })
    } catch (e) { setError(e?.userMessage || e?.message || t('automations.motionLight.failed')); setSaving(false) }
  }
  const handleRemove = async () => {
    if (confirmDelete && !(await confirmDelete(t('automations.motionLight.title')))) return
    setSaving(true); setError(null)
    try {
      const ids = existingIds().length ? existingIds() : [initial?.id || BASE_ID]
      for (const id of ids) { try { await deleteAutomation(id) } catch {} }
      await onSaved?.({ removed: true })
    } catch (e) { setError(e?.userMessage || e?.message || t('automations.motionLight.failed')); setSaving(false) }
  }

  const toggleM = (id, ents) => { if (id === '__init__') { setChosenM(new Set(ents.map((e) => e.entity_id))); return } toggle(setChosenM)(id) }
  const toggleL = (id, ents) => { if (id === '__init__') { setChosenL(new Set(ents.map((e) => e.entity_id))); return } toggle(setChosenL)(id) }

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
                const r = roomOf(e.entity_id)
                const nm = entityDisplayName(e) || e.entity_id
                const label = r !== NO_ROOM && !nm.toLowerCase().includes(String(r).toLowerCase()) ? `${nm} · ${r}` : nm
                return (
                  <button key={e.entity_id} type="button" onClick={() => onToggle(e.entity_id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px', borderRadius: 7, background: on ? 'color-mix(in srgb, var(--ok) 8%, transparent)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}>
                    <span style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, border: `1.5px solid ${on ? 'var(--ok)' : 'var(--line)'}`, background: on ? 'var(--ok)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--bg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6"/></svg>}
                    </span>
                    <span style={{ fontSize: 12.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{label}</span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 2px' }} dir="auto">
      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }} dir="auto">{t('automations.motionLight.subtitle')}</p>

      <Picker label={t('automations.motionLight.motionLabel')} mode={motionMode} setMode={setMotionMode} ents={motionEnts} chosen={chosenM} onToggle={toggleM} emptyKey="automations.motionLight.noMotion" icon="🚶" />
      <Picker label={t('automations.motionLight.lightsLabel')} mode={lightsMode} setMode={setLightsMode} ents={lightEnts} chosen={chosenL} onToggle={toggleL} emptyKey="automations.motionLight.noLights" icon="💡" />

      {/* Room-pairing preview */}
      {groups.length > 1 && (
        <div style={{ border: '0.5px solid var(--line)', borderRadius: 12, background: 'var(--surface)', padding: '10px 12px' }}>
          <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', margin: '0 0 6px' }} dir="auto">{t('automations.motionLight.pairsBy')}</p>
          {groups.map((g) => (
            <p key={g.room} style={{ fontSize: 12, color: 'var(--ink-mute)', margin: '2px 0' }} dir="auto">🚶 {roomLabel(g.room)} → 💡 {t('automations.motionLight.nLights', { n: g.lights.length })}</p>
          ))}
        </div>
      )}

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
