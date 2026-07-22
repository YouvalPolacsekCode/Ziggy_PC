import React, { useEffect, useMemo, useState } from 'react'
import { Input } from '../ui/Input'
import { Toggle } from '../ui/Toggle'
import { useT } from '../../lib/i18n'
import { useDeviceStore } from '../../stores/deviceStore'
import { createAutomation, deleteAutomation } from '../../lib/api'
import { entityDisplayName } from '../../lib/utils'

// ── WindowAcWizard ────────────────────────────────────────────────────────────
// Dedicated view/edit for "Window Open — AC Off". One modal for create + edit.
//
// Two modes:
//   • Just tell me (default): an actionable push with a one-tap "turn off AC"
//     button when a window opens while the AC runs.
//   • Turn it off: pause the AC automatically, and (optionally) resume it when
//     every watched window is closed again.
// Works with a smart (HA) AC OR an IR AC. Watches all window/door sensors, or a
// chosen subset. A grace delay avoids nagging on a quick open/close. All copy is
// localized (no hardcoded strings).

const WINDOW_AC_ID = 'ziggy_window_ac_off'
const RESUME_TIMEOUT_S = 6 * 60 * 60   // give up waiting for "all closed" after 6h, then resume

export default function WindowAcWizard({ initial, onSaved, onClose, confirmDelete }) {
  const t = useT()
  const storeEntities = useDeviceStore((s) => s.entities)

  const acEnts = useMemo(
    () => storeEntities.filter((e) => e.domain === 'climate' || String(e.entity_id).startsWith('ir.')),
    [storeEntities])
  const winEnts = useMemo(
    () => storeEntities.filter((e) => e.domain === 'binary_sensor' && ['window', 'door', 'opening', 'garage_door'].includes(e.device_class)),
    [storeEntities])

  const isUpdate = !!initial?._isInstalled

  const derived = useMemo(() => {
    const acts = initial?.actions || []
    const trig = initial?.trigger || {}
    const offAct = acts.find((a) => a.type === 'ir_command' || (a.type === 'call_service' && String(a.entity_id).startsWith('climate')) || (a.type === 'notify_actionable'))
    // AC id: from an ir_command, a climate call_service, or the notify button.
    let acId = ''
    for (const a of acts) {
      if (a.type === 'ir_command') { acId = `ir.${a.ir_device_id}`; break }
      if (a.type === 'call_service' && String(a.entity_id).startsWith('climate')) { acId = a.entity_id; break }
      if (a.type === 'notify_actionable') {
        const btn = (a.actions || [])[0]?.action
        if (btn?.type === 'ir_command') { acId = `ir.${btn.ir_device_id}`; break }
        if (btn?.entity_id) { acId = btn.entity_id; break }
      }
    }
    const mode = acts.some((a) => a.type === 'notify_actionable') ? 'notify' : 'auto'
    const chosenWin = Array.isArray(trig.entity_id) ? trig.entity_id : (trig.entity_id ? [trig.entity_id] : [])
    return {
      acId,
      mode: isUpdate ? mode : 'notify',
      windowsMode: (isUpdate && chosenWin.length && chosenWin.length < winEnts.length) ? 'choose' : 'all',
      chosen: chosenWin,
      resume: isUpdate ? acts.some((a) => a.type === 'wait_for_state') : true,
      graceMin: trig.for_minutes ?? 1,
      alsoNotify: isUpdate ? (mode === 'notify' || acts.some((a) => a.type === 'notify')) : true,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [acId, setAcId] = useState(derived.acId)
  const [mode, setMode] = useState(derived.mode)          // 'notify' | 'auto'
  const [windowsMode, setWindowsMode] = useState(derived.windowsMode)
  const [chosen, setChosen] = useState(() => new Set(derived.chosen))
  const [resume, setResume] = useState(derived.resume)
  const [graceMin, setGraceMin] = useState(derived.graceMin)
  const [alsoNotify, setAlsoNotify] = useState(derived.alsoNotify)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!acId && acEnts[0]) setAcId(acEnts[0].entity_id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acEnts])

  const acObj = acEnts.find((e) => e.entity_id === acId)
  const isIr = acObj && String(acObj.entity_id).startsWith('ir.')
  const winIds = windowsMode === 'all' ? winEnts.map((e) => e.entity_id) : Array.from(chosen)
  const toggleWin = (id) => setChosen((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const canSave = !!acId && winIds.length > 0 && !saving

  const offAction = () => isIr
    ? { type: 'ir_command', ir_device_id: acObj.entity_id.slice(3), ir_command: 'turn_off' }
    : { type: 'call_service', entity_id: acId, service: 'climate.turn_off', service_value: 'turn_off' }
  const onAction = () => isIr
    ? { type: 'ir_command', ir_device_id: acObj.entity_id.slice(3), ir_command: 'turn_on' }
    : { type: 'call_service', entity_id: acId, service: 'climate.turn_on', service_value: 'turn_on' }

  const buildWindowAc = () => {
    const trigger = { type: 'state', entity_id: winIds, state: 'on' }
    if (Number(graceMin) > 0) trigger.for_minutes = Number(graceMin)
    // Condition: the AC is actually running (else opening a window is a no-op).
    const conditions = [isIr
      ? { type: 'ir_device_state', ir_device_id: acObj.entity_id.slice(3), operator: 'is', value: 'on' }
      : { entity_id: acId, operator: 'is_not', value: 'off' }]

    const actions = []
    if (mode === 'notify') {
      actions.push({
        type: 'notify_actionable',
        title: t('automations.windowAc.title'),
        message: t('automations.windowAc.notifyMsg'),
        actions: [{ label: t('automations.windowAc.offBtn'), action: offAction() }],
      })
    } else {
      actions.push(offAction())
      if (alsoNotify) actions.push({ type: 'notify', title: t('automations.windowAc.title'), message: t('automations.windowAc.autoMsg') })
      if (resume) {
        // Resume once EVERY watched window is closed (chained waits — each passes
        // immediately if already shut), then turn the AC back on.
        winIds.forEach((id) => actions.push({ type: 'wait_for_state', entity_id: id, state: 'off', timeout_seconds: RESUME_TIMEOUT_S, on_timeout: 'continue' }))
        actions.push(onAction())
      }
    }
    return { id: initial?.id || WINDOW_AC_ID, name: 'Window Open — AC Off', description: t('automations.windowAc.desc'), trigger, conditions, actions, rooms: [] }
  }

  const handleSave = async () => {
    setSaving(true); setError(null)
    try { await createAutomation(buildWindowAc()); await onSaved?.({ updated: isUpdate }) }
    catch (e) { setError(e?.userMessage || e?.message || t('automations.windowAc.failed')); setSaving(false) }
  }
  const handleRemove = async () => {
    if (confirmDelete && !(await confirmDelete(t('automations.windowAc.title')))) return
    setSaving(true); setError(null)
    try { await deleteAutomation(initial?.id || WINDOW_AC_ID); await onSaved?.({ removed: true }) }
    catch (e) { setError(e?.userMessage || e?.message || t('automations.windowAc.failed')); setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 2px' }} dir="auto">
      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }} dir="auto">{t('automations.windowAc.subtitle')}</p>

      {/* Which AC */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.windowAc.acLabel')}</p>
        {acEnts.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--warn)', padding: '10px 12px', background: 'color-mix(in srgb, var(--warn) 8%, transparent)', borderRadius: 10 }} dir="auto">{t('automations.windowAc.noAc')}</p>
        ) : acEnts.length === 1 ? (
          <p style={{ fontSize: 12.5, color: 'var(--ink)', padding: '9px 11px', border: '0.5px solid var(--line)', borderRadius: 10, background: 'var(--surface)' }} dir="auto">❄️ {entityDisplayName(acEnts[0]) || acEnts[0].entity_id}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, border: '0.5px solid var(--line)', borderRadius: 10, padding: 5, background: 'var(--surface)' }}>
            {acEnts.map((e) => {
              const sel = e.entity_id === acId
              return (
                <button key={e.entity_id} type="button" onClick={() => setAcId(e.entity_id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 7, background: sel ? 'color-mix(in srgb, var(--ok) 9%, transparent)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}>
                  <span style={{ width: 13, height: 13, borderRadius: 999, flexShrink: 0, border: `1.5px solid ${sel ? 'var(--ok)' : 'var(--line)'}`, background: sel ? 'var(--ok)' : 'transparent' }} />
                  <span style={{ fontSize: 12.5, color: 'var(--ink)' }} dir="auto">❄️ {entityDisplayName(e) || e.entity_id}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Which windows */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.windowAc.windowsLabel')}</p>
        {winEnts.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--warn)', padding: '10px 12px', background: 'color-mix(in srgb, var(--warn) 8%, transparent)', borderRadius: 10 }} dir="auto">{t('automations.windowAc.noWindows')}</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: windowsMode === 'choose' ? 8 : 0 }}>
              {['all', 'choose'].map((m) => {
                const sel = windowsMode === m
                return (
                  <button key={m} type="button" onClick={() => { setWindowsMode(m); if (m === 'choose' && chosen.size === 0) setChosen(new Set(winEnts.map((e) => e.entity_id))) }}
                    style={{ padding: '7px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', border: sel ? 'none' : '0.5px solid var(--line)', background: sel ? 'var(--ink)' : 'var(--surface)', color: sel ? 'var(--bg)' : 'var(--ink-mute)' }} dir="auto">
                    🪟 {t(m === 'all' ? 'automations.windowAc.winAll' : 'automations.windowAc.winChoose')}
                  </button>
                )
              })}
            </div>
            {windowsMode === 'choose' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, border: '0.5px solid var(--line)', borderRadius: 10, padding: 6, background: 'var(--surface)', maxHeight: 180, overflowY: 'auto' }}>
                {winEnts.map((e) => {
                  const on = chosen.has(e.entity_id)
                  return (
                    <button key={e.entity_id} type="button" onClick={() => toggleWin(e.entity_id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px', borderRadius: 7, background: on ? 'color-mix(in srgb, var(--ok) 8%, transparent)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}>
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

      {/* Mode */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.windowAc.modeLabel')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, border: '0.5px solid var(--line)', borderRadius: 10, padding: 6, background: 'var(--surface)' }}>
          {[['notify', '🔔'], ['auto', '⚡']].map(([m, icon]) => {
            const sel = mode === m
            return (
              <button key={m} type="button" onClick={() => setMode(m)}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 10px', borderRadius: 8, background: sel ? 'color-mix(in srgb, var(--ok) 9%, transparent)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}>
                <span style={{ width: 15, height: 15, borderRadius: 999, flexShrink: 0, marginTop: 2, border: `1.5px solid ${sel ? 'var(--ok)' : 'var(--line)'}`, background: sel ? 'var(--ok)' : 'transparent' }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, color: 'var(--ink)' }} dir="auto">{icon} {t(`automations.windowAc.mode.${m}`)}</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-faint)' }} dir="auto">{t(`automations.windowAc.mode.${m}Desc`)}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Options */}
      <div style={{ border: '0.5px solid var(--line)', borderRadius: 12, background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 13px' }}>
          <span style={{ fontSize: 12.5, color: 'var(--ink)' }} dir="auto">{t('automations.windowAc.grace')}</span>
          <div style={{ width: 56 }}><Input type="number" inputMode="numeric" min={0} max={60} value={graceMin} onChange={(e) => setGraceMin(e.target.value)} /></div>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }} dir="auto">{t('automations.windowAc.minutes')}</span>
        </div>
        {mode === 'auto' && (
          <>
            <Row label={`🔁 ${t('automations.windowAc.resume')}`} sub={t('automations.windowAc.resumeSub')} checked={resume} onChange={setResume} border />
            <Row label={`🔔 ${t('automations.windowAc.alsoNotify')}`} checked={alsoNotify} onChange={setAlsoNotify} border />
          </>
        )}
      </div>

      {error && <p style={{ fontSize: 12, color: 'var(--accent)', padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
        <div>{isUpdate && (
          <button type="button" onClick={handleRemove} disabled={saving} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, color: 'var(--accent)' }}>{t('automations.windowAc.delete')}</button>
        )}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13 }}>{t('common.cancel')}</button>
          <button type="button" onClick={handleSave} disabled={!canSave} className="z-btn-primary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, opacity: canSave ? 1 : 0.5 }}>{isUpdate ? t('automations.windowAc.update') : t('automations.windowAc.confirm')}</button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, sub, checked, onChange, border }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 13px', borderTop: border ? '0.5px solid var(--line)' : 'none' }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, color: 'var(--ink)' }} dir="auto">{label}</span>
        {sub && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 1 }} dir="auto">{sub}</span>}
      </span>
      <Toggle checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
