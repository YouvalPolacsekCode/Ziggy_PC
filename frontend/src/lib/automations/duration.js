// "Turn it on for 20 minutes" — the frontend half of services/timed_actions.py.
//
// A timed step is ONE stored step with `for_minutes`; the hub expands it to
// on → wait → off. These rules must match the backend's undo_service(): only a
// step with an obvious "off" can take a duration.

const UNDO = { turn_on: 'turn_off', open_cover: 'close_cover', open_valve: 'close_valve' }
const NO_DURATION_DOMAINS = new Set(['script', 'scene', 'automation', 'button', 'input_button'])
export const MAX_DURATION_MINUTES = 24 * 60

export function canHaveDuration(action) {
  if (!action || (action.type || 'call_service') !== 'call_service') return false
  const eid = String(action.entity_id || '')
  if (!eid.includes('.') || NO_DURATION_DOMAINS.has(eid.split('.')[0])) return false
  const svc = String(action.service || '').split('.').pop()
  return Object.prototype.hasOwnProperty.call(UNDO, svc)
}

// Keep `for_minutes` only where it means something, so switching a step from
// "turn on" to "turn off" never leaves a hidden timer behind.
export function withDurationRule(action) {
  if (!action || action.for_minutes == null || canHaveDuration(action)) return action
  const { for_minutes: _drop, ...rest } = action
  return rest
}

export function durationBlocker(actions) {
  for (const a of actions || []) {
    if (!a || a.for_minutes == null || a.for_minutes === '') continue
    const n = Number(a.for_minutes)
    if (!Number.isFinite(n) || n <= 0 || n > MAX_DURATION_MINUTES) return 'actionDuration'
  }
  return null
}

// { h, m, s } parts of a number of seconds.
export function splitSeconds(total) {
  const t = Math.max(0, Math.round(Number(total) || 0))
  return { h: Math.floor(t / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 }
}
