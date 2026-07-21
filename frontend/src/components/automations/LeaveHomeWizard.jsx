import React, { useEffect, useMemo, useState } from 'react'
import { Input } from '../ui/Input'
import { Toggle } from '../ui/Toggle'
import { useT } from '../../lib/i18n'
import { useDeviceStore } from '../../stores/deviceStore'
import { createAutomation, deleteAutomation, getEntities } from '../../lib/api'
import { entityDisplayName } from '../../lib/utils'

// ── LeaveHomeWizard ───────────────────────────────────────────────────────────
// Dedicated plain-language view/edit for Leave Home. One modal for create + edit.
// "Everyone left" is aggregate: Phone = ALL tracked people away; No-movement =
// EVERY motion/presence sensor quiet for N min (whole house). Lights: all, or a
// chosen subset. Optional security alert (a 2nd automation): everyone away AND a
// sensor sees movement → notify. Lights-off uses the reliable turn_off_all_lights
// step. Persons/trackers are hidden from the device list, so we fetch them
// unfiltered (getEntities all:true).

const LEAVE_HOME_ID = 'ziggy_leave_home'
const ALERT_ID = 'ziggy_leave_home_alert'

export default function LeaveHomeWizard({ initial, onSaved, onClose }) {
  const t = useT()
  const storeEntities = useDeviceStore((s) => s.entities)

  const [presence, setPresence] = useState([])   // person.* / device_tracker.* (fetched unfiltered)

  // Motion/presence sensors + lights + AC come from the (unfiltered-enough) store.
  const motionEnts = useMemo(() => storeEntities.filter((e) => e.domain === 'binary_sensor' && (e.device_class === 'motion' || e.device_class === 'occupancy')), [storeEntities])
  const doorEnts   = useMemo(() => storeEntities.filter((e) => e.domain === 'binary_sensor' && (e.device_class === 'door' || e.device_class === 'opening')), [storeEntities])
  const lightEnts  = useMemo(() => storeEntities.filter((e) => e.domain === 'light'), [storeEntities])
  const acEntity   = useMemo(() => storeEntities.find((e) => e.domain === 'climate'), [storeEntities])

  useEffect(() => {
    let alive = true
    Promise.all([
      getEntities('person', { all: true }).catch(() => ({ entities: [] })),
      getEntities('device_tracker', { all: true }).catch(() => ({ entities: [] })),
    ]).then(([p, d]) => {
      if (!alive) return
      const all = [...(p.entities || []), ...(d.entities || [])]
      setPresence(all.map((e) => ({ ...e, domain: e.domain || e.entity_id.split('.')[0] })))
    })
    return () => { alive = false }
  }, [])

  const isUpdate = !!initial?._isInstalled
  const motionIds = useMemo(() => motionEnts.map((e) => e.entity_id), [motionEnts])
  // Only presence entities that are ACTUALLY tracking (state home/away) can drive
  // a leave trigger — an unconfigured HA person sits at "unknown" and would never
  // fire. So the Phone source only appears once presence is really wired up.
  const usablePresence = useMemo(
    () => presence.filter((e) => ['home', 'not_home', 'away'].includes(String(e.state || '').toLowerCase())),
    [presence])
  const presenceIds = useMemo(() => usablePresence.map((e) => e.entity_id), [usablePresence])

  // Available trigger sources.
  const sources = useMemo(() => {
    const out = []
    if (usablePresence.length) out.push('phone')
    if (motionEnts.length)     out.push('motion')
    if (doorEnts.length)       out.push('door')
    return out
  }, [usablePresence, motionEnts, doorEnts])

  // Derive initial state from the existing automation (edit) or defaults (create).
  const derived = useMemo(() => {
    const trig = initial?.trigger
    const st = trig?.state
    let source = null, door = doorEnts[0]?.entity_id || '', min = 30
    if (st === 'not_home') source = 'phone'
    else if (st === 'off' && trig?.for_minutes) { source = 'motion'; min = trig.for_minutes }
    else if (st === 'off') { source = 'door'; const e = trig?.entity_id; door = Array.isArray(e) ? e[0] : (e || door) }
    const acts = initial?.actions || []
    const chosen = acts.filter((a) => a.type === 'call_service' && (a.entity_id || '').startsWith('light.')).map((a) => a.entity_id)
    return {
      source, door, min,
      lightsMode: chosen.length ? 'choose' : 'all',
      chosen,
      acOff: isUpdate ? acts.some((a) => (a.type === 'call_service' && (a.entity_id || '').startsWith('climate')) || a.type === 'ir_command') : true,
      notify: isUpdate ? acts.some((a) => a.type === 'notify') : true,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [source, setSource] = useState(derived.source)
  const [doorEntity, setDoorEntity] = useState(derived.door)
  const [motionMin, setMotionMin] = useState(derived.min)
  const [lightsMode, setLightsMode] = useState(derived.lightsMode)
  const [chosen, setChosen] = useState(() => new Set(derived.chosen))
  const [acOff, setAcOff] = useState(derived.acOff)
  const [notify, setNotify] = useState(derived.notify)
  const [alert, setAlert] = useState(!!initial?.securityAlert)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Default the source once candidates load (create flow).
  useEffect(() => {
    if (!source && sources.length) setSource(sources[0])
    if (!doorEntity && doorEnts[0]) setDoorEntity(doorEnts[0].entity_id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources])

  const toggleLight = (id) => setChosen((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const lightsOk = lightsMode === 'all' || chosen.size > 0
  const canSave = !!source && lightsOk && !saving

  const lightActions = () => lightsMode === 'all'
    ? [{ type: 'turn_off_all_lights' }]
    : Array.from(chosen).map((id) => ({ type: 'call_service', entity_id: id, service: 'light.turn_off', service_value: 'turn_off' }))

  const acAction = () => {
    if (!acOff || !acEntity) return null
    return acEntity.entity_id.startsWith('ir.')
      ? { type: 'ir_command', ir_device_id: acEntity.entity_id.slice(3), ir_command: 'power_off' }
      : { type: 'call_service', entity_id: acEntity.entity_id, service: 'climate.turn_off', service_value: 'turn_off' }
  }

  const buildLeaveHome = () => {
    const trigger = source === 'phone'
      ? { type: 'state', entity_id: presenceIds, state: 'not_home' }
      : source === 'motion'
        ? { type: 'state', entity_id: motionIds, state: 'off', for_minutes: Number(motionMin) || 30 }
        : { type: 'state', entity_id: doorEntity, state: 'off' }
    // Aggregate guard: EVERYONE away / EVERY sensor quiet (not just one).
    const conditions = source === 'phone'
      ? presenceIds.map((id) => ({ entity_id: id, operator: 'is', value: 'not_home' }))
      : source === 'motion'
        ? motionIds.map((id) => ({ entity_id: id, operator: 'is', value: 'off' }))
        : []
    const actions = [...lightActions()]
    const ac = acAction(); if (ac) actions.push(ac)
    if (notify) actions.push({ type: 'notify', title: 'Leave Home', message: t('automations.leaveHome.notifyMsg') })
    return { id: initial?.id || LEAVE_HOME_ID, name: 'Leave Home', description: t('automations.leaveHome.desc'), trigger, conditions, actions, rooms: [] }
  }

  // Security alert: any sensor sees movement WHILE everyone is away → notify.
  const buildAlert = () => ({
    id: ALERT_ID, name: 'Leave Home — Away Alert', description: t('automations.leaveHome.alertDesc'),
    trigger: { type: 'state', entity_id: motionIds, state: 'on' },
    conditions: presenceIds.map((id) => ({ entity_id: id, operator: 'is', value: 'not_home' })),
    actions: [{ type: 'notify', title: 'Ziggy', message: t('automations.leaveHome.alertMsg') }],
    rooms: [],
  })

  const handleSave = async () => {
    setSaving(true); setError(null)
    try {
      await createAutomation(buildLeaveHome())
      if (alert && presenceIds.length && motionIds.length) await createAutomation(buildAlert())
      else { try { await deleteAutomation(ALERT_ID) } catch {} }   // removed / never on
      await onSaved?.({ updated: isUpdate })
    } catch (e) {
      setError(e?.userMessage || e?.message || t('automations.leaveHome.failed')); setSaving(false)
    }
  }
  const handleRemove = async () => {
    setSaving(true); setError(null)
    try {
      await deleteAutomation(initial?.id || LEAVE_HOME_ID)
      try { await deleteAutomation(ALERT_ID) } catch {}
      await onSaved?.({ removed: true })
    } catch (e) { setError(e?.userMessage || e?.message || t('automations.leaveHome.failed')); setSaving(false) }
  }

  const alertAvailable = usablePresence.length > 0 && motionEnts.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 2px' }} dir="auto">
      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }} dir="auto">{t('automations.leaveHome.subtitle')}</p>

      {/* Trigger source */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.leaveHome.triggerLabel')}</p>
        {sources.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--warn)', padding: '10px 12px', background: 'color-mix(in srgb, var(--warn) 8%, transparent)', borderRadius: 10 }} dir="auto">{t('automations.leaveHome.noSource')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, border: '0.5px solid var(--line)', borderRadius: 10, padding: 6, background: 'var(--surface)' }}>
            {sources.map((k) => {
              const sel = k === source
              const icon = k === 'phone' ? '📍' : k === 'motion' ? '🚶' : '🚪'
              const cnt = k === 'phone' ? usablePresence.length : k === 'motion' ? motionEnts.length : doorEnts.length
              return (
                <button key={k} type="button" onClick={() => setSource(k)}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 10px', borderRadius: 8,
                    background: sel ? 'color-mix(in srgb, var(--ok) 9%, transparent)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}>
                  <span style={{ width: 15, height: 15, borderRadius: 999, flexShrink: 0, marginTop: 2, border: `1.5px solid ${sel ? 'var(--ok)' : 'var(--line)'}`, background: sel ? 'var(--ok)' : 'transparent' }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, color: 'var(--ink)' }} dir="auto">{icon} {t(`automations.leaveHome.source.${k}`)}</span>
                    <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-faint)' }} dir="auto">
                      {t(`automations.leaveHome.source.${k}Desc`)}{(k === 'phone' || k === 'motion') && cnt > 1 ? ` · ${t('automations.leaveHome.allN', { n: cnt })}` : ''}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* Motion delay */}
        {source === 'motion' && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--ink-mute)' }} dir="auto">{t('automations.leaveHome.afterNoMotion')}</span>
            <div style={{ width: 70 }}><Input type="number" inputMode="numeric" min={1} max={240} value={motionMin} onChange={(e) => setMotionMin(e.target.value)} /></div>
            <span style={{ fontSize: 12, color: 'var(--ink-mute)' }} dir="auto">{t('automations.leaveHome.minutes')}</span>
          </div>
        )}
        {/* Which door (when >1) */}
        {source === 'door' && doorEnts.length > 1 && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3, border: '0.5px solid var(--line)', borderRadius: 10, padding: 5, background: 'var(--surface)' }}>
            {doorEnts.map((e) => {
              const sel = e.entity_id === doorEntity
              return (
                <button key={e.entity_id} type="button" onClick={() => setDoorEntity(e.entity_id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 7, background: sel ? 'color-mix(in srgb, var(--ok) 9%, transparent)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}>
                  <span style={{ width: 13, height: 13, borderRadius: 999, flexShrink: 0, border: `1.5px solid ${sel ? 'var(--ok)' : 'var(--line)'}`, background: sel ? 'var(--ok)' : 'transparent' }} />
                  <span style={{ fontSize: 12.5, color: 'var(--ink)' }} dir="auto">{entityDisplayName(e) || e.entity_id}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Lights */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.leaveHome.turnOffLabel')}</p>
        <div style={{ display: 'flex', gap: 6, marginBottom: chosenVisible(lightsMode) ? 8 : 0 }}>
          {['all', 'choose'].map((m) => {
            const sel = lightsMode === m
            return (
              <button key={m} type="button" onClick={() => { setLightsMode(m); if (m === 'choose' && chosen.size === 0) setChosen(new Set(lightEnts.map((e) => e.entity_id))) }}
                style={{ padding: '7px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', border: sel ? 'none' : '0.5px solid var(--line)', background: sel ? 'var(--ink)' : 'var(--surface)', color: sel ? 'var(--bg)' : 'var(--ink-mute)' }} dir="auto">
                💡 {t(m === 'all' ? 'automations.leaveHome.lightsAll' : 'automations.leaveHome.lightsChoose')}
              </button>
            )
          })}
        </div>
        {lightsMode === 'choose' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, border: '0.5px solid var(--line)', borderRadius: 10, padding: 6, background: 'var(--surface)', maxHeight: 200, overflowY: 'auto' }}>
            {lightEnts.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--ink-faint)', padding: 6 }} dir="auto">{t('automations.leaveHome.noLights')}</p>
            ) : lightEnts.map((e) => {
              const on = chosen.has(e.entity_id)
              return (
                <button key={e.entity_id} type="button" onClick={() => toggleLight(e.entity_id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px', borderRadius: 7, background: on ? 'color-mix(in srgb, var(--ok) 8%, transparent)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}>
                  <span style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, border: `1.5px solid ${on ? 'var(--ok)' : 'var(--line)'}`, background: on ? 'var(--ok)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--bg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6"/></svg>}
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{entityDisplayName(e) || e.entity_id}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* AC + Notify + Security alert */}
      <div style={{ border: '0.5px solid var(--line)', borderRadius: 12, background: 'var(--surface)' }}>
        {acEntity && (
          <Row label={`❄️ ${t('automations.leaveHome.ac')}`} checked={acOff} onChange={setAcOff} />
        )}
        <Row label={`🔔 ${t('automations.leaveHome.notify')}`} checked={notify} onChange={setNotify} border={!!acEntity} />
        {alertAvailable && (
          <Row label={`🚨 ${t('automations.leaveHome.alertLabel')}`} sub={t('automations.leaveHome.alertSub')} checked={alert} onChange={setAlert} border />
        )}
      </div>

      {error && <p style={{ fontSize: 12, color: 'var(--accent)', padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
        <div>{isUpdate && (
          <button type="button" onClick={handleRemove} disabled={saving} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, color: 'var(--accent)' }}>{t('automations.leaveHome.delete')}</button>
        )}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13 }}>{t('common.cancel')}</button>
          <button type="button" onClick={handleSave} disabled={!canSave} className="z-btn-primary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, opacity: canSave ? 1 : 0.5 }}>{isUpdate ? t('automations.leaveHome.update') : t('automations.leaveHome.confirm')}</button>
        </div>
      </div>
    </div>
  )
}

function chosenVisible(mode) { return mode === 'choose' }

function Row({ label, sub, checked, onChange, border }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 14px', borderTop: border ? '0.5px solid var(--line)' : 'none' }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, color: 'var(--ink)' }} dir="auto">{label}</span>
        {sub && <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }} dir="auto">{sub}</span>}
      </span>
      <Toggle checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
