// Wall control layer — live state in, optimistic commands out.
//
// This is where the wall dashboard's central promise lives: what you see is
// what the hub says, and what you tap either happens or visibly un-happens.
//
// Three responsibilities:
//   1. Read device truth from `deviceStore` (which the app-wide WebSocket
//      already keeps current). We never hold a private copy of device state.
//   2. Paint a tap immediately, then reconcile: the hub's confirming
//      `state_changed` broadcast ratifies it, or a failure rolls it back and
//      says why.
//   3. Gate every action through the tablet's capability policy, prompting
//      for a PIN when the policy demands one.
//
// Nothing here mutates deviceStore's shape — it calls the store's own
// `updateEntityState`, the exact method the WebSocket handler uses.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDeviceStore } from '../stores/deviceStore'
import { useWallStore } from '../stores/wallStore'
import { deviceFacts } from '../lib/devices'
import { controlDevice, callHaService } from '../lib/api'
import { useT } from '../lib/i18n'

// How long an optimistic paint waits for the hub to confirm before we assume
// the command was swallowed and snap back. Generous: a Zigbee round-trip
// through HA can legitimately take a second, and IR blasters longer.
const CONFIRM_TIMEOUT_MS = 6000

// ─── capability gating ──────────────────────────────────────────────────────

/**
 * Returns a `guard(capability, fn)` that runs `fn` only if this tablet may.
 * Denied outright → toast. Allowed but PIN-required → prompt, then run.
 *
 * `policy` comes from the server; a tablet with no policy is unrestricted
 * (a home that never configured one shouldn't find its wall bricked).
 */
export function useCapabilityGuard(policy, toast) {
  const t = useT()
  const isElevated    = useWallStore((s) => s.isElevated)
  const requestPin    = useWallStore((s) => s.requestPin)

  return useCallback(async (capability, fn) => {
    if (!capability || !policy) return fn()

    const caps = policy.capabilities || {}
    if (caps[capability] === false) {
      toast?.(t('wall.pin.denied'), 'err')
      return undefined
    }

    const needsPin = Array.isArray(policy.pin_required) && policy.pin_required.includes(capability)
    if (!needsPin || isElevated(capability)) return fn()

    const ok = await requestPin(capability)
    if (!ok) return undefined
    return fn()
  }, [policy, toast, t, isElevated, requestPin])
}

// ─── entity lookup ──────────────────────────────────────────────────────────

/** Live facts for one entity, or null when it isn't in the store. */
export function useEntityFacts(entityId) {
  const entity = useDeviceStore(
    useCallback((s) => s.entities.find((e) => e.entity_id === entityId), [entityId]),
  )
  return useMemo(() => (entity ? deviceFacts(entity) : null), [entity])
}

// ─── optimistic command runner ──────────────────────────────────────────────

/**
 * Wraps a device command in optimistic paint + rollback.
 *
 * Usage:
 *   const { run, pending } = useOptimistic(toast)
 *   run({
 *     entityId,
 *     optimistic: { state: 'on', attrs: { brightness: 200 } },
 *     commit: () => controlDevice(entityId, 'turn_on'),
 *   })
 *
 * Why not just await the command and re-render? Because a tap that takes
 * 600ms to visibly land reads as broken on a wall panel. And why roll back
 * rather than leave the optimistic value? Because a wall display that
 * confidently shows a light as on when it failed to turn on is the exact
 * failure mode this dashboard exists to avoid.
 */
export function useOptimistic(toast) {
  const t = useT()
  const updateEntityState = useDeviceStore((s) => s.updateEntityState)
  const [pending, setPending] = useState({})   // entityId -> true
  // Timers keyed by entity so a second tap supersedes the first cleanly.
  const timers = useRef({})

  useEffect(() => () => {
    Object.values(timers.current).forEach(clearTimeout)
    timers.current = {}
  }, [])

  const clearPending = useCallback((entityId) => {
    clearTimeout(timers.current[entityId])
    delete timers.current[entityId]
    setPending((p) => {
      if (!p[entityId]) return p
      const next = { ...p }
      delete next[entityId]
      return next
    })
  }, [])

  const run = useCallback(async ({ entityId, optimistic, commit, prev }) => {
    // Snapshot for rollback. Read from the store at call time rather than
    // trusting a captured prop — a WS update may have landed since render.
    const before = prev ?? (() => {
      const e = useDeviceStore.getState().entities.find((x) => x.entity_id === entityId)
      return e ? { state: e.state, attrs: {} } : null
    })()

    if (optimistic) {
      updateEntityState(entityId, optimistic.state, optimistic.attrs || {})
      setPending((p) => ({ ...p, [entityId]: true }))
      clearTimeout(timers.current[entityId])
      // Safety net: if no confirming broadcast arrives, stop pulsing. We do
      // NOT roll back here — the command may well have worked and the
      // broadcast been dropped; snapping back would be its own lie. The
      // next state_changed or fetchAll reconciles for real.
      timers.current[entityId] = setTimeout(() => clearPending(entityId), CONFIRM_TIMEOUT_MS)
    }

    try {
      await commit()
      // Success: leave the optimistic paint. The confirming broadcast will
      // overwrite it with the hub's truth momentarily.
      clearPending(entityId)
      return true
    } catch (err) {
      // Failure: undo the paint and say what actually went wrong.
      if (optimistic && before) updateEntityState(entityId, before.state, before.attrs || {})
      clearPending(entityId)
      toast?.(err?.userMessage || t('wall.err.command'), 'err')
      return false
    }
  }, [updateEntityState, clearPending, toast, t])

  return { run, pending }
}

// ─── high-level device actions ──────────────────────────────────────────────

/**
 * The command set the rail and the device modules share.
 *
 * Every action is expressed as "what the user meant", not "which HA service
 * to call" — the wall never speaks Home Assistant, matching the product rule
 * that Ziggy is the only surface the customer sees.
 */
export function useDeviceActions({ toast, guard }) {
  const { run, pending } = useOptimistic(toast)
  const t = useT()

  const toggle = useCallback((facts) => {
    if (!facts) return
    if (!facts.isAvailable && !facts.hasIr) { toast?.(t('wall.err.offline'), 'err'); return }
    const next = facts.isOn ? 'off' : 'on'
    return guard(capabilityFor(facts), () => run({
      entityId: facts.id,
      optimistic: { state: next },
      prev: { state: facts.state },
      commit: () => controlDevice(facts.id, facts.isOn ? 'turn_off' : 'turn_on'),
    }))
  }, [run, guard, toast, t])

  const setBrightness = useCallback((facts, pct) => {
    if (!facts) return
    const clamped = Math.max(1, Math.min(100, Math.round(pct)))
    return guard('lights', () => run({
      entityId: facts.id,
      optimistic: { state: 'on', attrs: { brightness: Math.round(clamped * 2.55) } },
      prev: { state: facts.state, attrs: { brightness: facts.entity?.brightness } },
      commit: () => callHaService('light', 'turn_on', {
        entity_id: facts.id,
        brightness_pct: clamped,
      }),
    }))
  }, [run, guard])

  const setTemperature = useCallback((facts, temp) => {
    if (!facts) return
    const clamped = Math.max(facts.minTemp ?? 16, Math.min(facts.maxTemp ?? 30, Math.round(temp)))
    return guard('climate', () => run({
      entityId: facts.id,
      optimistic: { state: facts.state, attrs: { temperature: clamped } },
      prev: { state: facts.state, attrs: { temperature: facts.targetTemp } },
      commit: () => callHaService('climate', 'set_temperature', {
        entity_id: facts.id,
        temperature: clamped,
      }),
    }))
  }, [run, guard])

  const setLock = useCallback((facts, locked) => {
    if (!facts) return
    return guard('locks', () => run({
      entityId: facts.id,
      optimistic: { state: locked ? 'locked' : 'unlocked' },
      prev: { state: facts.state },
      commit: () => callHaService('lock', locked ? 'lock' : 'unlock', { entity_id: facts.id }),
    }))
  }, [run, guard])

  return { toggle, setBrightness, setTemperature, setLock, pending }
}

/** Which capability a device's controls fall under. */
export function capabilityFor(facts) {
  const d = facts?.domain
  if (d === 'lock') return 'locks'
  if (d === 'climate' || d === 'water_heater') return 'climate'
  if (d === 'media_player') return 'media'
  if (d === 'camera') return 'cameras'
  if (d === 'light') return 'lights'
  return 'lights'
}
