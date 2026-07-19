import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useT, useLangStore } from '../../lib/i18n'
import { getRooms, designSmartRoom, applyAutomationBundle } from '../../lib/api'
import OccupancySensorForm from './OccupancySensorForm'

// ── SmartRoomWizard ───────────────────────────────────────────────────────────
// Step-by-step, terse/technical creation of a Smart Room. Replaces the generic
// (cramped, wordy) BundlePreviewCard for the Smart Room flow.
//
// Flow:  pick room → PRESENCE (prereq: reuse existing sensor, else create one)
//        → 1 Day-on → 2 Night-on → 3 Night-guard → 4 Off → Summary → Create.
// Each rule step shows When → Do + the key fields editable; the guard step is
// its own explained step (the sleeping-wife protection). All rules trigger on
// the room's ONE fused presence sensor, shown throughout.
//
// Props: onSaved, onClose, initialRoom, initialRoomName (edit mode).
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_OPTS = {
  day_brightness: 100,
  night_brightness: 30,
  night_kelvin: 2700,
  night_start: '19:00',
  night_end: '06:30',
  off_delay_minutes: 5,
  guard_hold_seconds: 30,   // how long someone counts as "still here" after going still
}

const STEPS = ['presence', 'day', 'night', 'guard', 'off', 'summary']

// tiny styled controls -------------------------------------------------------
const fieldRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '7px 0' }
const lbl = { fontSize: 12, color: 'var(--ink-mute)' }
const val = { fontSize: 12.5, color: 'var(--ink)', fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600 }

function Range({ min, max, step, value, onChange, suffix }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'flex-end' }}>
      <input type="range" min={min} max={max} step={step || 1} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, maxWidth: 130, accentColor: 'var(--accent)' }} />
      <span style={{ ...val, minWidth: 46, textAlign: 'end' }}>{value}{suffix}</span>
    </div>
  )
}
function Num({ value, onChange, min, max, suffix }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input type="number" min={min} max={max} value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, parseInt(e.target.value, 10) || min)))}
        style={{ width: 54, ...val, padding: '3px 6px', borderRadius: 7, border: '0.5px solid var(--line)', background: 'var(--surface)' }} />
      <span style={lbl}>{suffix}</span>
    </span>
  )
}
function Time({ value, onChange }) {
  return (
    <input type="time" value={value} onChange={(e) => onChange(e.target.value)}
      style={{ ...val, padding: '3px 6px', borderRadius: 7, border: '0.5px solid var(--line)', background: 'var(--surface)' }} />
  )
}

// A rule step shell: eyebrow + When/Do lines + editable fields + nav.
function RuleStep({ icon, title, when, doLine, children, idx, total, onBack, onNext, nextLabel, t }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} dir="auto">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p className="z-eyebrow" style={{ margin: 0 }}>{title}</p>
        <span style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{idx}/{total}</span>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 20, lineHeight: 1 }}>{icon}</span>
        <div style={{ flex: 1, fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.5 }}>
          <div><span style={lbl}>{t('automations.smartRoom.wiz.when')} </span><span dir="auto">{when}</span></div>
          {doLine && <div><span style={lbl}>{t('automations.smartRoom.wiz.do')} </span><span dir="auto">{doLine}</span></div>}
        </div>
      </div>
      {children && <div style={{ borderTop: '0.5px solid var(--line)', paddingTop: 4 }}>{children}</div>}
      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
        <button type="button" onClick={onBack} className="z-btn-secondary" style={{ flex: 1 }}>
          {t('automations.smartRoom.wiz.back')}
        </button>
        <button type="button" onClick={onNext} className="z-btn-primary" style={{ flex: 1 }}>
          {nextLabel || t('automations.smartRoom.wiz.next')}
        </button>
      </div>
    </div>
  )
}

export default function SmartRoomWizard({ onSaved, onClose, initialRoom = null, initialRoomName = '' }) {
  const t = useT()
  const lang = useLangStore((s) => s.lang)

  const [rooms, setRooms] = useState([])
  const [loadingRooms, setLoadingRooms] = useState(true)
  const [phase, setPhase] = useState(initialRoom ? 'resolving' : 'pick')  // pick|resolving|needSensor|steps|applying|done|error|decline
  const [stepIdx, setStepIdx] = useState(0)
  const [room, setRoom] = useState(initialRoom ? { id: initialRoom, name: initialRoomName || initialRoom } : null)
  const [occEntity, setOccEntity] = useState(null)
  const [opts, setOpts] = useState(DEFAULT_OPTS)
  const [bundle, setBundle] = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  const setOpt = (k, v) => setOpts((o) => ({ ...o, [k]: v }))
  const roomLabel = room?.name || room?.id || ''
  const sensorLabel = t('automations.smartRoom.wiz.presenceName', { room: roomLabel })

  useEffect(() => {
    let alive = true
    getRooms().then((r) => { if (alive) { setRooms(r?.rooms || []); setLoadingRooms(false) } })
              .catch(() => { if (alive) setLoadingRooms(false) })
    if (initialRoom) resolvePresence({ id: initialRoom, name: initialRoomName || initialRoom })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ask the recipe for the room; it tells us the occupancy entity or that we need one.
  const resolvePresence = async (roomObj) => {
    setRoom(roomObj); setPhase('resolving'); setErrorMsg(null)
    try {
      const res = await designSmartRoom(roomObj.id || roomObj.name, undefined, lang)
      if (res?.needs_occupancy) { setPhase('needSensor'); return }
      const b = res?.bundle
      if (!b) throw new Error('no bundle')
      if (b.decline) { setBundle(b); setPhase('decline'); return }
      setOccEntity(b.occupancy_entity || null)
      setStepIdx(0); setPhase('steps')
    } catch (e) {
      setErrorMsg(e?.userMessage || e?.message || t('automations.smartRoom.designFailed')); setPhase('error')
    }
  }

  const step = STEPS[stepIdx]
  const back = () => (stepIdx === 0 ? (initialRoom ? onClose?.() : setPhase('pick')) : setStepIdx(stepIdx - 1))
  const next = () => setStepIdx(stepIdx + 1)

  const create = async () => {
    setPhase('applying'); setErrorMsg(null)
    try {
      const res = await designSmartRoom(room.id || room.name, occEntity || undefined, lang, opts)
      const b = res?.bundle
      if (!b || res?.needs_occupancy) throw new Error('design failed')
      const applied = await applyAutomationBundle(b)
      if (applied?.ok === false && (applied?.created || []).length === 0) throw new Error('apply failed')
      setPhase('done'); onSaved?.()
    } catch (e) {
      setErrorMsg(e?.userMessage || e?.message || t('automations.smartRoom.designFailed')); setPhase('error')
    }
  }

  // ── PICK ──
  if (phase === 'pick') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: 0 }} dir="auto">{t('automations.smartRoom.pickPrompt')}</p>
        {loadingRooms ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[1, 2, 3].map(i => <div key={i} style={{ height: 46, borderRadius: 10, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}</div>
        ) : rooms.length === 0 ? (
          <p style={{ fontSize: 12.5, color: 'var(--ink-faint)' }} dir="auto">{t('automations.smartRoom.noRooms')}</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {rooms.map(r => (
              <button key={r.id || r.name} type="button" onClick={() => resolvePresence(r)} className="z-btn-secondary"
                style={{ padding: '12px 14px', borderRadius: 11, textAlign: 'start', fontSize: 13.5, fontWeight: 600 }} dir="auto">
                {r.name || r.id}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── RESOLVING / APPLYING spinner ──
  if (phase === 'resolving' || phase === 'applying') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '32px 12px' }}>
        <motion.span style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent' }}
          animate={{ rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }} />
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', textAlign: 'center' }} dir="auto">
          {phase === 'applying' ? t('automations.smartRoom.wiz.creating', { room: roomLabel }) : t('automations.smartRoom.designing', { room: roomLabel })}
        </p>
      </div>
    )
  }

  // ── NEED SENSOR: reuse the existing presence-sensor creator ──
  if (phase === 'needSensor') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0, lineHeight: 1.5 }} dir="auto">{t('automations.smartRoom.needPresence', { room: roomLabel })}</p>
        <OccupancySensorForm initialRoom={roomLabel}
          onCreated={(res) => { setOccEntity(res?.entity_id || null); setStepIdx(0); setPhase('steps') }}
          onClose={() => {}} />
      </div>
    )
  }

  // ── DECLINE / ERROR ──
  if (phase === 'decline' || phase === 'error') {
    const msg = phase === 'decline' ? (bundle?.decline || t('automations.smartRoom.nothingToBuild', { room: roomLabel })) : (errorMsg || t('automations.smartRoom.designFailed'))
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '8px 0' }}>
        <p style={{ fontSize: 13, color: phase === 'error' ? 'var(--err)' : 'var(--ink)', margin: 0, lineHeight: 1.5 }} dir="auto">{msg}</p>
        <button type="button" onClick={() => setPhase('pick')} className="z-btn-secondary" style={{ alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 9 }}>
          {t('automations.smartRoom.chooseAnother')}
        </button>
      </div>
    )
  }

  // ── STEPS ──
  const total = STEPS.length
  const nStep = stepIdx + 1

  if (step === 'presence') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} dir="auto">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p className="z-eyebrow" style={{ margin: 0 }}>{t('automations.smartRoom.wiz.presenceTitle')}</p>
          <span style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{nStep}/{total}</span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 20 }}>🧍</span>
          <div style={{ flex: 1, fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.5 }}>
            <div style={{ fontWeight: 600 }}>{sensorLabel}</div>
            <p style={{ fontSize: 11.5, color: 'var(--ink-mute)', margin: '4px 0 0' }}>{t('automations.smartRoom.wiz.presenceIntro')}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
          <button type="button" onClick={() => (initialRoom ? onClose?.() : setPhase('pick'))} className="z-btn-secondary" style={{ flex: 1 }}>{t('automations.smartRoom.wiz.back')}</button>
          <button type="button" onClick={next} className="z-btn-primary" style={{ flex: 1 }}>{t('automations.smartRoom.wiz.next')}</button>
        </div>
      </div>
    )
  }

  if (step === 'day') {
    return (
      <RuleStep icon="☀️" title={t('automations.smartRoom.wiz.dayTitle')} idx={nStep} total={total} onBack={back} onNext={next} t={t}
        when={t('automations.smartRoom.wiz.dayWhen', { from: opts.night_end, to: opts.night_start })}
        doLine={t('automations.smartRoom.wiz.onDo', { pct: opts.day_brightness })}>
        <div style={fieldRow}><span style={lbl}>{t('automations.smartRoom.wiz.brightness')}</span><Range min={10} max={100} step={5} value={opts.day_brightness} onChange={(v) => setOpt('day_brightness', v)} suffix="%" /></div>
      </RuleStep>
    )
  }

  if (step === 'night') {
    return (
      <RuleStep icon="🌙" title={t('automations.smartRoom.wiz.nightTitle')} idx={nStep} total={total} onBack={back} onNext={next} t={t}
        when={t('automations.smartRoom.wiz.nightWhen', { from: opts.night_start, to: opts.night_end })}
        doLine={t('automations.smartRoom.wiz.onDoWarm', { pct: opts.night_brightness, k: opts.night_kelvin })}>
        <div style={fieldRow}><span style={lbl}>{t('automations.smartRoom.wiz.brightness')}</span><Range min={5} max={100} step={5} value={opts.night_brightness} onChange={(v) => setOpt('night_brightness', v)} suffix="%" /></div>
        <div style={fieldRow}><span style={lbl}>{t('automations.smartRoom.wiz.warmth')}</span><Range min={2000} max={4000} step={100} value={opts.night_kelvin} onChange={(v) => setOpt('night_kelvin', v)} suffix="K" /></div>
        <div style={fieldRow}><span style={lbl}>{t('automations.smartRoom.wiz.nightWindow')}</span><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Time value={opts.night_start} onChange={(v) => setOpt('night_start', v)} /><span style={lbl}>–</span><Time value={opts.night_end} onChange={(v) => setOpt('night_end', v)} /></span></div>
      </RuleStep>
    )
  }

  if (step === 'guard') {
    return (
      <RuleStep icon="😴" title={t('automations.smartRoom.wiz.guardTitle')} idx={nStep} total={total} onBack={back} onNext={next} t={t}
        when={t('automations.smartRoom.wiz.guardWhen')}
        doLine={t('automations.smartRoom.wiz.guardDo')}>
        <p style={{ fontSize: 11.5, color: 'var(--ink-mute)', margin: '0 0 4px', lineHeight: 1.5 }} dir="auto">{t('automations.smartRoom.wiz.guardWhy')}</p>
        <div style={fieldRow}>
          <span style={lbl}>{t('automations.smartRoom.wiz.guardHold')}</span>
          <span style={val}>{opts.guard_hold_seconds}{t('automations.smartRoom.wiz.sec')} · <span style={{ fontFamily: 'inherit', fontWeight: 400, color: 'var(--ink-faint)' }}>{t('automations.smartRoom.wiz.guardHoldNote')}</span></span>
        </div>
      </RuleStep>
    )
  }

  if (step === 'off') {
    return (
      <RuleStep icon="🚪" title={t('automations.smartRoom.wiz.offTitle')} idx={nStep} total={total} onBack={back} onNext={next} t={t}
        nextLabel={t('automations.smartRoom.wiz.next')}
        when={t('automations.smartRoom.wiz.offWhen', { n: opts.off_delay_minutes })}
        doLine={t('automations.smartRoom.wiz.offDo')}>
        <div style={fieldRow}><span style={lbl}>{t('automations.smartRoom.wiz.offAfter')}</span><Num value={opts.off_delay_minutes} onChange={(v) => setOpt('off_delay_minutes', v)} min={1} max={120} suffix={t('automations.smartRoom.wiz.min')} /></div>
      </RuleStep>
    )
  }

  // ── SUMMARY ──
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} dir="auto">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p className="z-eyebrow" style={{ margin: 0 }}>{t('automations.smartRoom.wiz.summaryTitle', { room: roomLabel })}</p>
        <span style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{nStep}/{total}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[
          ['☀️', t('automations.smartRoom.wiz.sumDay', { pct: opts.day_brightness })],
          ['🌙', t('automations.smartRoom.wiz.sumNight', { pct: opts.night_brightness, k: opts.night_kelvin })],
          ['😴', t('automations.smartRoom.wiz.sumGuard')],
          ['🚪', t('automations.smartRoom.wiz.sumOff', { n: opts.off_delay_minutes })],
        ].map(([ic, txt], i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 9, border: '0.5px solid var(--line)', background: 'var(--surface)' }}>
            <span style={{ fontSize: 15 }}>{ic}</span><span style={{ fontSize: 12.5, color: 'var(--ink)' }} dir="auto">{txt}</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11, color: 'var(--ink-faint)', margin: 0 }} dir="auto">{t('automations.smartRoom.wiz.sumUses', { sensor: sensorLabel })}</p>
      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
        <button type="button" onClick={back} className="z-btn-secondary" style={{ flex: 1 }}>{t('automations.smartRoom.wiz.back')}</button>
        <button type="button" onClick={create} className="z-btn-primary" style={{ flex: 1 }}>{t('automations.smartRoom.wiz.create', { room: roomLabel })}</button>
      </div>
    </div>
  )
}
