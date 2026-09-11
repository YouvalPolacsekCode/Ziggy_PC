import { useEffect, useRef, useState } from 'react'
import { Flame, Loader2, Power } from 'lucide-react'
import { useUIStore } from '../../../stores/uiStore'
import { sendDeviceCommand } from '../../../lib/devices'
import { getDeviceCommands, executeDeviceCommand } from '../../../lib/api'
import { useT, t as i18nT } from '../../../lib/i18n'

/**
 * Boiler (water_heater) hero remote.
 *
 * Surfaces switcher_kis.turn_on_with_timer as the primary affordance when
 * the entity supports it. Falls back to generic on/off when the linked
 * integration doesn't expose a timer service — so the same component
 * works for plain water_heater entities AND Switcher boilers.
 *
 * When the user picks a timer preset, we draw a countdown ring around the
 * "Heating" status that depletes as the device's remaining_time attribute
 * decreases. The total (denominator) is the duration the user originally
 * picked — persisted to localStorage so it survives a page reload, cleared
 * when the device goes off.
 */

const PRESET_MINUTES = [15, 30, 60, 90]

function parseRemaining(attrs) {
  if (!attrs) return null
  const candidates = [
    attrs.time_left, attrs.remain_time, attrs.remain_time_min,
    attrs.remaining_minutes, attrs.auto_shutdown_remaining_minutes,
    attrs.minutes_remaining,
  ]
  // Return a float in minutes — sub-minute precision matters for the MM:SS
  // ticker label. Math.round used to flatten "29.5" → 30 here, which broke
  // the local interpolation anchor (we'd start ticking from a rounded-up
  // starting point and the user saw the seconds reset on the next HA push).
  for (const c of candidates) {
    if (c == null) continue
    if (typeof c === 'number' && !Number.isNaN(c)) return c
    if (typeof c === 'string') {
      // "HH:MM:SS" or "MM:SS" string
      if (c.includes(':')) {
        const parts = c.split(':').map(Number)
        if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60
        if (parts.length === 2) return parts[0] + parts[1] / 60
      }
      const n = Number(c)
      if (!Number.isNaN(n)) return n
    }
  }
  return null
}

// MM:SS formatter — total minutes (float) → "MM:SS" (zero-padded). The
// ticker label drives the "alive" feel; the SVG ring depletes by sub-pixel
// per second on a 30-min timer, so the eye reads the seconds instead.
function formatMmss(min) {
  const totalSec = Math.max(0, Math.round(min * 60))
  const mm = Math.floor(totalSec / 60)
  const ss = totalSec % 60
  return `${mm}:${ss.toString().padStart(2, '0')}`
}

// Countdown ring storage key — per entity so multiple boilers don't collide.
const timerKey      = (eid) => `ziggy:boilerTimer:${eid}`
const timerStartKey = (eid) => `ziggy:boilerTimerStart:${eid}`

function CountdownDial({ remainingMin, totalMin, isHeating, predicted }) {
  // Visible arc represents REMAINING time. Starts full, depletes as the
  // boiler counts down. When totalMin isn't known (e.g. plain turn_on with
  // no timer), the dial collapses to a static ring around the icon.
  const r = 62
  const circ = 2 * Math.PI * r
  const haveCountdown = totalMin != null && totalMin > 0 && remainingMin != null
  const frac = haveCountdown
    ? Math.max(0, Math.min(1, remainingMin / totalMin))
    : 1
  const offset = circ * (1 - frac)
  const ringColor = isHeating ? 'var(--err)' : 'var(--ink-mute)'

  return (
    <div style={{
      position: 'relative', width: 160, height: 160,
      opacity: predicted ? 0.85 : 1,
      transition: 'opacity 0.15s',
    }}>
      <svg width="160" height="160" viewBox="0 0 160 160">
        <circle cx="80" cy="80" r={r} stroke="var(--surface-2)" strokeWidth="6" fill="none" />
        {haveCountdown && isHeating && (
          <circle
            cx="80" cy="80" r={r}
            stroke={ringColor} strokeWidth="6" fill="none"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(-90 80 80)"
            style={{ transition: 'stroke-dashoffset 1s linear' }}
          />
        )}
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 4, color: isHeating ? 'var(--err)' : 'var(--ink-mute)',
      }}>
        <Flame size={26} />
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>
          {isHeating ? i18nT('remote.heatingLabel') : i18nT('remote.heatingOff')}
        </div>
        {haveCountdown && isHeating && (
          <div style={{ fontSize: 13, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
            {formatMmss(remainingMin)}
          </div>
        )}
        {!haveCountdown && remainingMin != null && isHeating && (
          <div style={{ fontSize: 13, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
            {formatMmss(remainingMin)}
          </div>
        )}
      </div>
    </div>
  )
}

export default function BoilerRemote({ entity }) {
  const addToast = useUIStore((s) => s.addToast)
  const [commands, setCommands] = useState([])
  const [busy, setBusy] = useState(null) // null | 'off' | 'on' | <minutes>
  // Optimistic UI — switcher_kis blocks until the device acks (1-3s),
  // so the FE flips locally on tap and clears when the real WS update lands.
  const [predictedHeating, setPredictedHeating] = useState(null)
  useEffect(() => { setPredictedHeating(null) }, [entity?.state])

  // Countdown denominator — minutes the user originally picked. Persisted
  // per-entity so it survives page reloads while the boiler is still
  // counting down.
  const [timerSetMinutes, setTimerSetMinutesState] = useState(() => {
    try {
      const v = localStorage.getItem(timerKey(entity?.entity_id || ''))
      return v ? parseInt(v, 10) : null
    } catch { return null }
  })
  const setTimerSetMinutes = (m) => {
    setTimerSetMinutesState(m)
    try {
      const k = timerKey(entity?.entity_id || '')
      if (m == null) localStorage.removeItem(k)
      else localStorage.setItem(k, String(m))
    } catch {}
  }

  // Wall-clock timestamp (ms) when this timer was started. Drives the local
  // countdown when HA's Switcher integration doesn't expose a remaining-time
  // attribute — without this, the dial sits frozen at "full" forever.
  // Persisted alongside timerSetMinutes so reloading mid-countdown picks up
  // the right elapsed time.
  const [timerStartedAt, setTimerStartedAtState] = useState(() => {
    try {
      const v = localStorage.getItem(timerStartKey(entity?.entity_id || ''))
      return v ? parseInt(v, 10) : null
    } catch { return null }
  })
  const setTimerStartedAt = (ms) => {
    setTimerStartedAtState(ms)
    try {
      const k = timerStartKey(entity?.entity_id || '')
      if (ms == null) localStorage.removeItem(k)
      else localStorage.setItem(k, String(ms))
    } catch {}
  }

  // Capabilities — used to decide whether `turn_on_with_timer` actually exists
  // for this entity (defaults true for Switcher devices).
  useEffect(() => {
    let cancelled = false
    if (!entity?.entity_id) return
    getDeviceCommands(entity.entity_id)
      .then((r) => { if (!cancelled) setCommands(r?.commands || []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [entity?.entity_id])

  const isSwitcher = (entity?.entity_id || '').startsWith('switch.switcher_')
  const timerCmd = isSwitcher || commands.find((c) => c.id === 'switcher_kis.turn_on_with_timer')

  const state = entity?.state || 'unknown'
  const realIsHeating = ['on', 'heat_pump', 'electric', 'gas', 'performance', 'eco'].includes(state)
  const isHeating = predictedHeating != null ? predictedHeating : realIsHeating
  const remaining = parseRemaining(entity?.attributes)

  // Live countdown.
  //
  // The dial used to depend entirely on HA's `time_left` attribute, which the
  // Switcher integration only exposes for some device models — on the ones
  // that don't, `remaining` was permanently null and the dial sat frozen at
  // "full ring" forever. Worse: even on devices that DO expose it, HA emits
  // a state_changed only when the integer minute crosses, so the dial
  // jumped in 60-second steps and looked broken.
  //
  // The new approach is anchor-based. An anchor is `{value (minutes), at (ms)}`
  // — a known-good remaining-time reading at a known wall-clock time. A 1Hz
  // interval interpolates `liveRemaining = value - (now - at) / 60_000`.
  //
  // Two sources can set the anchor (HA wins when both are available):
  //   1. HA push — every state_changed that includes a remaining attribute
  //      re-anchors. This corrects clock drift when the user's timer started
  //      hours ago.
  //   2. Local start — when Ziggy fires `heat_for(N)`, we stamp
  //      `timerStartedAt = Date.now()` and `timerSetMinutes = N`. If HA never
  //      surfaces a remaining attribute, the local anchor is the only signal
  //      — without it, the dial would never animate on those device models.
  //
  // The anchor is React state (not a ref) so its updates trigger a re-render
  // of the tick effect, which keeps the interval reading fresh.
  const [anchor, setAnchor] = useState(null)
  const [liveRemaining, setLiveRemaining] = useState(null)

  // Re-anchor on every HA-provided remaining value.
  useEffect(() => {
    if (remaining != null) {
      setAnchor({ value: remaining, at: Date.now() })
    }
  }, [remaining])

  // Establish a local anchor when heating starts with no HA data yet.
  // Re-runs whenever isHeating or the start fields flip; the `anchor == null`
  // gate prevents this from clobbering a fresher HA-driven anchor.
  useEffect(() => {
    if (!isHeating) {
      setAnchor(null)
      setLiveRemaining(null)
      return
    }
    if (remaining == null && timerSetMinutes != null && timerStartedAt != null) {
      setAnchor({ value: timerSetMinutes, at: timerStartedAt })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHeating, timerSetMinutes, timerStartedAt, remaining])

  // Tick the live value from the current anchor every second.
  useEffect(() => {
    if (anchor == null) return
    const tick = () => {
      const elapsedMin = (Date.now() - anchor.at) / 60_000
      setLiveRemaining(Math.max(0, anchor.value - elapsedMin))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [anchor])

  // Clear the stored timer denominator + start timestamp once the device
  // actually stops heating. Watch realIsHeating (not the predicted/optimistic
  // version) so we don't wipe the timer in the brief optimistic-off window
  // before HA confirms.
  useEffect(() => {
    if (!realIsHeating) {
      if (timerSetMinutes != null) setTimerSetMinutes(null)
      if (timerStartedAt != null) setTimerStartedAt(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realIsHeating])

  async function heatFor(minutes) {
    if (!entity?.entity_id) return
    setBusy(minutes)
    setPredictedHeating(true)
    setTimerSetMinutes(minutes)
    setTimerStartedAt(Date.now())
    try {
      if (timerCmd) {
        const r = await executeDeviceCommand(
          entity.entity_id,
          'switcher_kis.turn_on_with_timer',
          { timer_minutes: minutes },
        )
        if (!r?.ok) throw new Error(r?.message || i18nT('remote.failed'))
      } else {
        await sendDeviceCommand(entity, 'turn_on')
      }
    } catch (e) {
      setPredictedHeating(null)
      setTimerSetMinutes(null)
      setTimerStartedAt(null)
      addToast(e?.message || i18nT('remote.failedHeating'), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function turnOff() {
    setBusy('off')
    setPredictedHeating(false)
    try {
      await sendDeviceCommand(entity, 'turn_off')
    } catch (e) {
      setPredictedHeating(null)
      addToast(e?.message || i18nT('remote.failed'), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function turnOnPlain() {
    setBusy('on')
    setPredictedHeating(true)
    // No timer = no countdown. Clear any stale denominator.
    setTimerSetMinutes(null)
    try {
      await sendDeviceCommand(entity, 'turn_on')
    } catch (e) {
      setPredictedHeating(null)
      addToast(e?.message || i18nT('remote.failed'), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center' }}>
      <CountdownDial
        remainingMin={liveRemaining}
        totalMin={timerSetMinutes}
        isHeating={isHeating}
        predicted={predictedHeating != null}
      />

      {/* ── Primary turn on/off — always visible, optimistic ── */}
      <button
        onClick={isHeating ? turnOff : turnOnPlain}
        disabled={busy != null}
        style={{
          width: '100%', maxWidth: 360, padding: '14px 22px', borderRadius: 14,
          background: isHeating ? 'var(--err)' : 'var(--accent)',
          color: 'white', border: 'none',
          fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          opacity: busy != null && busy !== 'off' && busy !== 'on' ? 0.5 : 1,
        }}
      >
        {(busy === 'off' || busy === 'on')
          ? <Loader2 size={15} className="animate-spin" />
          : <Power size={15} />}
        {isHeating ? i18nT('deviceCard.turnOff') : i18nT('deviceCard.turnOn')}
      </button>

      {/* ── Timer presets — additive ── */}
      {timerCmd && (
        <>
          <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>
            …or heat for a fixed time:
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 8, width: '100%', maxWidth: 360,
          }}>
            {PRESET_MINUTES.map((m) => (
              <button
                key={m}
                onClick={() => heatFor(m)}
                disabled={busy != null}
                style={{
                  padding: '12px 0', borderRadius: 12,
                  background: timerSetMinutes === m && isHeating
                    ? 'color-mix(in srgb, var(--err) 14%, var(--surface))'
                    : 'var(--surface)',
                  border: '0.5px solid '
                    + (timerSetMinutes === m && isHeating ? 'var(--err)' : 'var(--line)'),
                  fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                  color: timerSetMinutes === m && isHeating ? 'var(--err)' : 'var(--ink)',
                  cursor: 'pointer',
                  opacity: busy != null && busy !== m ? 0.4 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                }}
              >
                {busy === m ? <Loader2 size={12} className="animate-spin" /> : null}
                {m}m
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
