/**
 * IrWalkWizard — guided "teach Ziggy your AC remote" flow.
 *
 * The user walks through a scripted sequence of remote presses (temperature
 * ladder, mode cycle, fan cycle, swing, power) while the IR listener captures
 * each press. The backend drives the step machine; this page renders the
 * current step, reflects live captures (via the 'ziggy:ir_walk_capture'
 * window event re-broadcast from App.jsx), collects the user's observations,
 * and runs the final validation pass.
 *
 * Everything is self-contained here on purpose — sub-components live in this
 * file. Mobile-first, RTL-safe (logical flex layout only, no hardcoded
 * left/right).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Check, Radio, Sparkles, PartyPopper, Ear } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { T_ENTER } from '../lib/motion'
import { useUIStore } from '../stores/uiStore'
import { useT } from '../lib/i18n'
import {
  irWalkStart, irWalkObserve, irWalkNext, irWalkFinish,
  irWalkValidate, irWalkAbort, irSend,
} from '../lib/api'

// How long we give the sensor to report a press the user says they made.
const PRESS_TIMEOUT_MS = 4000
// Consecutive unheard presses before we suggest the unplug/replug recovery.
const MISSES_BEFORE_RECOVERY = 3
// Gap between validation-pass sends.
const VALIDATION_GAP_MS = 2000

const MODE_CHIPS = ['cool', 'dry', 'fan', 'heat', 'auto']
const FAN_CHIPS  = ['low', 'medium', 'high', 'auto']

const INPUT_CLS = 'w-full h-11 px-4 rounded-[10px] text-body border border-line bg-surface text-ink focus:outline-none focus:border-ink-mute'

// ── Small shared pieces ───────────────────────────────────────────────────────

function ProgressBar({ index, total }) {
  const pct = total > 0 ? Math.min(100, Math.round(((index + 1) / total) * 100)) : 0
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={index + 1}
         style={{ height: 8, borderRadius: 999, background: 'var(--line)', overflow: 'hidden' }}>
      <motion.div
        animate={{ width: `${pct}%` }}
        transition={T_ENTER}
        style={{ height: '100%', borderRadius: 999, background: 'var(--ink)' }}
      />
    </div>
  )
}

// Chip row — logical flex layout, wraps on narrow phones, RTL-safe.
function Chips({ options, value, onPick, labelFor }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map((opt) => {
        const active = value === opt
        return (
          <button
            key={opt}
            onClick={() => onPick(opt)}
            aria-pressed={active}
            style={{
              minHeight: 44, padding: '8px 16px', borderRadius: 999, fontSize: 15, fontWeight: active ? 600 : 500,
              fontFamily: 'inherit', cursor: 'pointer',
              background: active ? 'var(--surface-2)' : 'var(--surface)',
              color: active ? 'var(--ink)' : 'var(--ink-mute)',
              border: `0.5px solid ${active ? 'var(--line-2)' : 'var(--line)'}`,
              transition: 'background var(--dur-press) var(--ease-standard), color var(--dur-press) var(--ease-standard)',
            }}
          >
            {labelFor ? labelFor(opt) : opt}
          </button>
        )
      })}
    </div>
  )
}

// Big animated "Heard it!" flash. Re-keyed per capture so every press
// re-triggers the pop even in a fast burst.
function CaptureFlash({ seq, label }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (seq === 0) return
    setVisible(true)
    const t = setTimeout(() => setVisible(false), 1100)
    return () => clearTimeout(t)
  }, [seq])
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={seq}
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.15 }}
          transition={T_ENTER}
          style={{
            position: 'fixed', inset: 0, zIndex: 60, pointerEvents: 'none',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
          }}
        >
          <div style={{
            width: 96, height: 96, borderRadius: '50%',
            background: 'var(--ok)', color: 'var(--on-accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 40px rgba(0,0,0,0.25)',
          }}>
            <Check size={52} strokeWidth={3} />
          </div>
          <span style={{
            fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--on-accent)',
            background: 'var(--ok)', padding: '8px 16px', borderRadius: 999,
            boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
          }}>{label}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Pulsing "Ziggy is listening" indicator shown while we wait for a press.
function ListeningPulse({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 0' }}>
      <motion.span
        animate={{ scale: [1, 1.25, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        style={{ display: 'inline-flex', color: 'var(--accent)' }}
      >
        <Ear size={20} strokeWidth={1.75} />
      </motion.span>
      <span style={{ fontSize: 15, lineHeight: '20px', color: 'var(--ink-mute)', fontWeight: 500 }}>{label}</span>
    </div>
  )
}

// Simple centered confirm dialog (abort). Fixed overlay, logical layout.
function ConfirmDialog({ title, body, yesLabel, noLabel, onYes, onNo, busy }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 70, background: 'var(--backdrop)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <motion.div
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
        transition={T_ENTER}
        role="dialog" aria-modal="true"
        style={{
          background: 'var(--surface)', border: '0.5px solid var(--line)', borderRadius: 'var(--r-sheet)',
          padding: 24, width: '100%', maxWidth: 360,
        }}
      >
        <p className="z-title" style={{ marginBottom: 8 }}>{title}</p>
        <p className="z-subhead" style={{ marginBottom: 16 }}>{body}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="md" onClick={onNo} disabled={busy}>{noLabel}</Button>
          <Button variant="danger" size="md" onClick={onYes} disabled={busy}>{yesLabel}</Button>
        </div>
      </motion.div>
    </div>
  )
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export default function IrWalkWizard() {
  const t = useT()
  const navigate = useNavigate()
  const { deviceId } = useParams()
  const addToast = useUIStore((s) => s.addToast)

  // Session lifecycle
  const [phase, setPhase] = useState('loading') // loading | active | finishing | summary | done_ok | done_listen | error
  const [session, setSession] = useState(null)   // { session_id, steps_total }
  const [step, setStep] = useState(null)         // backend step object
  const [stepIndex, setStepIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  // Live-capture state (per current step)
  const [captures, setCaptures] = useState(0)
  const [flashSeq, setFlashSeq] = useState(0)
  const [awaitingObservation, setAwaitingObservation] = useState(false)
  const [missCount, setMissCount] = useState(0)
  const [showMissHint, setShowMissHint] = useState(false)
  const [waitingForPress, setWaitingForPress] = useState(false) // "I pressed it" 4s window armed

  // Per-step form state
  const [setupTemp, setSetupTemp] = useState(24)
  const [setupFan, setSetupFan] = useState('low')
  const [ladderAsk, setLadderAsk] = useState(false)
  const [ladderTemp, setLadderTemp] = useState('')
  const [modeFree, setModeFree] = useState('')

  // Finish / validation state
  const [finishData, setFinishData] = useState(null)
  const [valProgress, setValProgress] = useState(null) // { i, total } while sending
  const [valAsking, setValAsking] = useState(false)

  const [confirmAbort, setConfirmAbort] = useState(false)

  const sessionIdRef = useRef(null)
  const startedRef = useRef(false)
  const advancedRef = useRef(false)   // guards double auto-advance on no-observation steps
  const pressTimerRef = useRef(null)
  const stepRef = useRef(null)
  const missCountRef = useRef(0)
  stepRef.current = step

  const fail = useCallback((e, fallbackKey) => {
    addToast(e?.message || t(fallbackKey || 'irWalk.errorGeneric'), 'error')
  }, [addToast, t])

  // ── Start session on mount ──
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    let cancelled = false
    irWalkStart(deviceId)
      .then((res) => {
        if (cancelled) return
        sessionIdRef.current = res.session_id
        setSession({ session_id: res.session_id, steps_total: res.steps_total })
        setStep(res.step)
        setStepIndex(res.step_index ?? 0)
        setPhase('active')
      })
      .catch((e) => {
        if (cancelled) return
        setErrorMsg(e?.message || t('irWalk.startFailed'))
        setPhase('error')
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId])

  // ── Live capture listener ──
  useEffect(() => {
    const handler = (e) => {
      const d = e.detail
      if (!d || !sessionIdRef.current || d.session_id !== sessionIdRef.current) return
      // A real capture: clear the miss machinery, flash the ✓, count it.
      if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null }
      missCountRef.current = 0
      setMissCount(0)
      setShowMissHint(false)
      setWaitingForPress(false)
      setCaptures((c) => c + 1)
      setFlashSeq((s) => s + 1)
      const st = stepRef.current
      if (!st) return
      // Steps that need a per-press answer: open the observation prompt.
      if (['mode', 'fan', 'swing', 'power_result'].includes(st.needs_observation)) {
        setAwaitingObservation(true)
      }
    }
    window.addEventListener('ziggy:ir_walk_capture', handler)
    return () => window.removeEventListener('ziggy:ir_walk_capture', handler)
  }, [])

  // ── Auto-advance steps that need no observation (e.g. baseline) ──
  useEffect(() => {
    if (phase !== 'active' || !step) return
    if (step.kind === 'setup' || step.needs_observation) return
    const needed = Math.max(1, step.min_presses || 1)
    if (captures >= needed && !advancedRef.current) {
      advancedRef.current = true
      // Small delay so the ✓ flash lands before the step swaps.
      const timer = setTimeout(() => { doNext() }, 900)
      return () => clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captures, step, phase])

  // Cleanup the press timer on unmount
  useEffect(() => () => { if (pressTimerRef.current) clearTimeout(pressTimerRef.current) }, [])

  const resetStepState = () => {
    setCaptures(0)
    setAwaitingObservation(false)
    setLadderAsk(false)
    setLadderTemp('')
    setModeFree('')
    setWaitingForPress(false)
    setShowMissHint(false)
    missCountRef.current = 0
    setMissCount(0)
    advancedRef.current = false
    if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null }
  }

  const applyStepResponse = (res) => {
    if (res.done) { runFinish(); return }
    resetStepState()
    setStep(res.step)
    if (res.step_index != null) setStepIndex(res.step_index)
    else setStepIndex((i) => i + 1)
  }

  const doObserve = async (observed) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await irWalkObserve(sessionIdRef.current, observed)
      applyStepResponse(res)
    } catch (e) { fail(e) }
    finally { setBusy(false) }
  }

  const doNext = async () => {
    if (!sessionIdRef.current) return
    setBusy(true)
    try {
      const res = await irWalkNext(sessionIdRef.current)
      applyStepResponse(res)
    } catch (e) {
      advancedRef.current = false
      fail(e)
    }
    finally { setBusy(false) }
  }

  const runFinish = async () => {
    setPhase('finishing')
    try {
      const res = await irWalkFinish(sessionIdRef.current)
      setFinishData(res)
      setPhase('summary')
    } catch (e) {
      fail(e)
      setErrorMsg(e?.message || t('irWalk.errorGeneric'))
      setPhase('error')
    }
  }

  const doAbort = async () => {
    setBusy(true)
    try { if (sessionIdRef.current) await irWalkAbort(sessionIdRef.current) }
    catch { /* leaving anyway */ }
    finally {
      setBusy(false)
      setConfirmAbort(false)
      navigate('/devices')
    }
  }

  // "I pressed it" — arm a 4s window; if no capture lands, count a miss.
  const reportPress = () => {
    if (waitingForPress) return
    setWaitingForPress(true)
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null
      setWaitingForPress(false)
      missCountRef.current += 1
      setMissCount(missCountRef.current)
      setShowMissHint(true)
    }, PRESS_TIMEOUT_MS)
  }

  // Validation pass — send each command with 2s gaps, then ask "did it obey?"
  const runValidation = async () => {
    const cmds = finishData?.validation_commands || []
    if (cmds.length === 0) { setValAsking(true); return }
    for (let i = 0; i < cmds.length; i++) {
      setValProgress({ i: i + 1, total: cmds.length })
      try { await irSend(deviceId, cmds[i]) }
      catch (e) { fail(e) }
      if (i < cmds.length - 1) await new Promise((r) => setTimeout(r, VALIDATION_GAP_MS))
    }
    setValProgress(null)
    setValAsking(true)
  }

  const answerValidation = async (obeyed) => {
    setBusy(true)
    try {
      const res = await irWalkValidate(sessionIdRef.current, obeyed)
      setPhase(res.activated ? 'done_ok' : 'done_listen')
    } catch (e) { fail(e) }
    finally { setBusy(false) }
  }

  // ── Step body renderers ─────────────────────────────────────────────────────

  const instructionKey = step
    ? (step.instruction_key || `irWalk.step.${step.id}.instruction`)
    : null

  const renderObservationPrompt = () => {
    const kind = step.needs_observation
    if (kind === 'mode') {
      const opts = step.observation_options?.length ? step.observation_options : MODE_CHIPS
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="z-headline">{t('irWalk.mode.what')}</p>
          <Chips options={opts} onPick={(m) => doObserve({ mode: m })}
            labelFor={(m) => t(`irWalk.mode.${m}`) !== `irWalk.mode.${m}` ? t(`irWalk.mode.${m}`) : m} />
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className={INPUT_CLS}
              placeholder={t('irWalk.mode.otherPlaceholder')}
              value={modeFree}
              onChange={(e) => setModeFree(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && modeFree.trim()) doObserve({ mode: modeFree.trim().toLowerCase() }) }}
            />
            <Button variant="secondary" size="md" disabled={!modeFree.trim() || busy}
              onClick={() => doObserve({ mode: modeFree.trim().toLowerCase() })}>
              {t('irWalk.confirm')}
            </Button>
          </div>
        </div>
      )
    }
    if (kind === 'fan') {
      const opts = step.observation_options?.length ? step.observation_options : FAN_CHIPS
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="z-headline">{t('irWalk.fan.what')}</p>
          <Chips options={opts} onPick={(f) => doObserve({ fan: f })}
            labelFor={(f) => t(`irWalk.fan.${f}`) !== `irWalk.fan.${f}` ? t(`irWalk.fan.${f}`) : f} />
        </div>
      )
    }
    if (kind === 'swing') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="z-headline">{t('irWalk.swing.what')}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" size="lg" style={{ flex: 1 }} disabled={busy}
              onClick={() => doObserve({ swing: true })}>{t('common.yes')}</Button>
            <Button variant="secondary" size="lg" style={{ flex: 1 }} disabled={busy}
              onClick={() => doObserve({ swing: false })}>{t('common.no')}</Button>
          </div>
        </div>
      )
    }
    if (kind === 'power_result') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="z-headline">{t('irWalk.power.what')}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" size="lg" style={{ flex: 1 }} disabled={busy}
              onClick={() => doObserve({ result: 'turned_off' })}>{t('irWalk.power.turnedOff')}</Button>
            <Button variant="primary" size="lg" style={{ flex: 1 }} disabled={busy}
              onClick={() => doObserve({ result: 'turned_on' })}>{t('irWalk.power.turnedOn')}</Button>
          </div>
        </div>
      )
    }
    return null
  }

  const renderStepBody = () => {
    if (!step) return null

    // 1) Setup: no captures — instructions + baseline inputs.
    if (step.kind === 'setup') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 15, lineHeight: '20px', fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
              {t('irWalk.setup.tempLabel')}
            </label>
            <input
              type="number" inputMode="numeric" min={16} max={31}
              className={INPUT_CLS}
              value={setupTemp}
              onChange={(e) => setSetupTemp(e.target.value)}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 15, lineHeight: '20px', fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
              {t('irWalk.setup.fanLabel')}
            </label>
            <Chips options={['low']} value={setupFan} onPick={setSetupFan}
              labelFor={(f) => t(`irWalk.fan.${f}`)} />
          </div>
          <Button variant="primary" size="lg" disabled={busy}
            onClick={() => doObserve({ mode: 'cool', temp: Number(setupTemp) || 24, fan: setupFan, swing: false })}>
            {t('irWalk.setup.start')}
          </Button>
        </div>
      )
    }

    // Ladder "what temp did you reach?" prompt.
    if (ladderAsk) {
      const isDown = step.id === 'ladder_down'
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="z-headline">
            {isDown ? t('irWalk.ladder.askMin') : t('irWalk.ladder.askMax')}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number" inputMode="numeric" min={10} max={40} autoFocus
              className={INPUT_CLS}
              value={ladderTemp}
              onChange={(e) => setLadderTemp(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && ladderTemp !== '') doObserve({ temp: Number(ladderTemp) }) }}
            />
            <Button variant="primary" size="md" disabled={ladderTemp === '' || busy}
              onClick={() => doObserve({ temp: Number(ladderTemp) })}>
              {t('irWalk.confirm')}
            </Button>
          </div>
        </div>
      )
    }

    // Per-press observation prompt (mode / fan / swing / power).
    if (awaitingObservation) return renderObservationPrompt()

    // 2) Default "listening" body: press counter + hints + step buttons.
    const isLadder = step.needs_observation === 'temp'
    const isCycle = step.needs_observation === 'mode' || step.needs_observation === 'fan'
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ListeningPulse label={t('irWalk.listening')} />

        {captures > 0 && (
          <p className="z-mono" style={{ textAlign: 'center', fontSize: 15, lineHeight: '20px', color: 'var(--ink)', fontWeight: 600 }}>
            {t('irWalk.pressesHeard', { n: captures })}
          </p>
        )}

        {/* Miss hints — gentle first, recovery after 3 consecutive misses */}
        {showMissHint && (
          <div style={{
            background: 'var(--surface-2)', border: '0.5px solid var(--line)',
            borderRadius: 'var(--r-ctl)', padding: '12px 16px',
          }}>
            <p style={{ fontSize: 15, lineHeight: '20px', color: 'var(--ink)' }}>
              {missCount >= MISSES_BEFORE_RECOVERY ? t('irWalk.recoveryHint') : t('irWalk.missHint')}
            </p>
          </div>
        )}

        {/* "I pressed it" — arms the 4s no-capture window */}
        <button
          onClick={reportPress}
          disabled={waitingForPress}
          style={{
            background: 'none', border: 'none', cursor: waitingForPress ? 'default' : 'pointer',
            color: waitingForPress ? 'var(--ink-faint)' : 'var(--ink-mute)',
            fontSize: 15, lineHeight: '20px', fontWeight: 500, fontFamily: 'inherit',
            minHeight: 44, padding: '8px 16px', textDecoration: 'underline',
          }}
        >
          {waitingForPress ? t('irWalk.stillListening') : t('irWalk.iPressed')}
        </button>

        {/* Ladder: "I reached min/max" */}
        {isLadder && (
          <Button variant="primary" size="lg" disabled={busy} onClick={() => setLadderAsk(true)}>
            {step.done_button_key
              ? t(step.done_button_key)
              : (step.id === 'ladder_down' ? t('irWalk.ladder.reachedMin') : t('irWalk.ladder.reachedMax'))}
          </Button>
        )}

        {/* Mode/fan cycle: "I've seen all …" finishes the step */}
        {isCycle && captures > 0 && (
          <Button variant="secondary" size="lg" disabled={busy} onClick={() => doObserve({ done: true })}>
            {step.done_button_key
              ? t(step.done_button_key)
              : (step.needs_observation === 'mode' ? t('irWalk.mode.seenAll') : t('irWalk.fan.seenAll'))}
          </Button>
        )}
      </div>
    )
  }

  // ── Finish / summary / validation screen ────────────────────────────────────

  const renderSummary = () => {
    const s = finishData?.summary || {}
    const facts = []
    if (s.temps) facts.push(t('irWalk.finish.summaryTemps', { range: s.temps }))
    if (s.modes?.length) facts.push(t('irWalk.finish.summaryModes', { n: s.modes.length, list: s.modes.join(', ') }))
    if (s.fans?.length) facts.push(t('irWalk.finish.summaryFans', { n: s.fans.length, list: s.fans.join(', ') }))
    if (s.swing) facts.push(t('irWalk.finish.swingYes'))
    if (s.power) facts.push(t('irWalk.finish.powerYes'))
    const unresolved = finishData?.unresolved || []

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={T_ENTER}
            style={{
              width: 64, height: 64, borderRadius: '50%', margin: '0 auto 12px',
              background: 'var(--accent)', color: 'var(--on-accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
            <Sparkles size={32} strokeWidth={1.75} />
          </motion.div>
          <p className="z-title">{t('irWalk.finish.title')}</p>
        </div>

        {facts.length > 0 && (
          <Card soft style={{ padding: 16 }}>
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
              {facts.map((f, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 15, lineHeight: '20px', color: 'var(--ink)' }}>
                  <Check size={20} strokeWidth={2} style={{ color: 'var(--ok)', flexShrink: 0 }} />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {unresolved.length > 0 && (
          <Card soft style={{ padding: 16 }}>
            <p style={{ fontSize: 15, lineHeight: '20px', fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
              {t('irWalk.finish.unresolvedTitle')}
            </p>
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
              {unresolved.map((u, i) => (
                <li key={i} className="z-subhead">· {u}</li>
              ))}
            </ul>
          </Card>
        )}

        {/* Validation pass */}
        <div style={{ borderTop: '0.5px solid var(--line)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="z-headline">{t('irWalk.validate.title')}</p>
          <p className="z-subhead">{t('irWalk.validate.hint')}</p>

          {valProgress ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', padding: '8px 0' }}>
              <span className="z-pulse" style={{ display: 'inline-flex', color: 'var(--ink-mute)' }}>
                <Radio size={20} strokeWidth={1.75} />
              </span>
              <span className="z-mono" style={{ fontSize: 15, lineHeight: '20px', color: 'var(--ink)', fontWeight: 600 }}>
                {t('irWalk.validate.sending', { i: valProgress.i, total: valProgress.total })}
              </span>
            </div>
          ) : valAsking ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p className="z-headline">{t('irWalk.validate.didObey')}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="primary" size="lg" style={{ flex: 1 }} disabled={busy}
                  onClick={() => answerValidation(true)}>{t('irWalk.validate.yes')}</Button>
                <Button variant="secondary" size="lg" style={{ flex: 1 }} disabled={busy}
                  onClick={() => answerValidation(false)}>{t('irWalk.validate.no')}</Button>
              </div>
            </div>
          ) : (
            <Button variant="primary" size="lg" onClick={runValidation}>
              {t('irWalk.validate.go')}
            </Button>
          )}
        </div>
      </div>
    )
  }

  const renderDone = (ok) => (
    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 0' }}>
      <motion.div
        initial={{ scale: 0.5, opacity: 0, rotate: ok ? -12 : 0 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={T_ENTER}
        style={{
          width: 72, height: 72, borderRadius: '50%', margin: '0 auto',
          background: ok ? 'var(--ok)' : 'var(--surface-2)',
          color: ok ? 'var(--on-accent)' : 'var(--ink-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        {ok ? <PartyPopper size={32} strokeWidth={1.75} /> : <Ear size={32} strokeWidth={1.75} />}
      </motion.div>
      <p className="z-title">
        {ok ? t('irWalk.validate.successTitle') : t('irWalk.finish.title')}
      </p>
      <p className="z-body" style={{ color: 'var(--ink-mute)', maxWidth: 360, margin: '0 auto' }}>
        {ok ? t('irWalk.validate.successBody') : t('irWalk.validate.failBody')}
      </p>
      <Button variant="primary" size="lg" style={{ marginTop: 8 }} onClick={() => navigate('/devices')}>
        {t('common.done')}
      </Button>
    </div>
  )

  // ── Layout ──────────────────────────────────────────────────────────────────

  const showProgress = phase === 'active' && session
  const showAbort = phase === 'active' || phase === 'loading' || phase === 'finishing'

  return (
    <div style={{ maxWidth: 'var(--page-max-w-narrow)', margin: '0 auto', padding: '24px 20px 24px' }}>
      <CaptureFlash seq={flashSeq} label={t('irWalk.heard')} />

      {/* Header: title + abort. justify-between keeps the X on the inline-end
          edge in both LTR and RTL. */}
      <div className="z-page-head" style={{ marginBottom: 16 }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="z-display">{t('irWalk.title')}</h1>
          {showProgress && (
            <p className="z-footnote z-mono">
              {t('irWalk.stepOf', { current: Math.min(stepIndex + 1, session.steps_total), total: session.steps_total })}
            </p>
          )}
        </div>
        {showAbort && (
          <button
            onClick={() => setConfirmAbort(true)}
            aria-label={t('irWalk.abort')}
            className="z-icon-btn"
          >
            <X size={20} strokeWidth={1.75} />
          </button>
        )}
      </div>

      {showProgress && (
        <div style={{ marginBottom: 16 }}>
          <ProgressBar index={stepIndex} total={session.steps_total} />
        </div>
      )}

      {/* ── Phase bodies ── */}
      {phase === 'loading' && (
        <p className="z-subhead" style={{ textAlign: 'center', padding: '32px 0' }}>
          {t('irWalk.loading')}
        </p>
      )}

      {phase === 'error' && (
        <div style={{ textAlign: 'center', padding: '32px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p role="alert" style={{ fontSize: 17, lineHeight: '22px', color: 'var(--err-text)' }}>{errorMsg || t('irWalk.errorGeneric')}</p>
          <Button variant="secondary" size="md" style={{ margin: '0 auto' }} onClick={() => navigate('/devices')}>
            {t('common.back')}
          </Button>
        </div>
      )}

      {phase === 'active' && step && (
        <AnimatePresence mode="wait">
          <motion.div
            key={`${step.id}-${stepIndex}-${awaitingObservation}-${ladderAsk}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={T_ENTER}
          >
            <Card style={{ padding: 16 }}>
              <p className="z-body" style={{ marginBottom: 16 }}>
                {t(instructionKey)}
              </p>
              {renderStepBody()}
            </Card>
          </motion.div>
        </AnimatePresence>
      )}

      {phase === 'finishing' && (
        <div style={{ textAlign: 'center', padding: '48px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span className="z-spin" style={{ display: 'inline-flex', margin: '0 auto', color: 'var(--ink-mute)' }}>
            <Sparkles size={28} strokeWidth={1.75} />
          </span>
          <p className="z-subhead">{t('irWalk.finish.analyzing')}</p>
        </div>
      )}

      {phase === 'summary' && finishData && (
        <Card style={{ padding: 16 }}>{renderSummary()}</Card>
      )}

      {phase === 'done_ok' && renderDone(true)}
      {phase === 'done_listen' && renderDone(false)}

      {confirmAbort && (
        <ConfirmDialog
          title={t('irWalk.abortConfirmTitle')}
          body={t('irWalk.abortConfirmBody')}
          yesLabel={t('irWalk.abortConfirmYes')}
          noLabel={t('irWalk.abortConfirmNo')}
          onYes={doAbort}
          onNo={() => setConfirmAbort(false)}
          busy={busy}
        />
      )}
    </div>
  )
}
