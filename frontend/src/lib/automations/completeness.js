// Can this automation actually do anything?
//
// An automation with no actions is not a draft, it is a dead rule: Home
// Assistant stores it, fires it on every trigger, records a successful run,
// and nothing happens. A customer rebuilt their balcony motion light in this
// wizard on 2026-09-05, saved it with zero actions, and spent two days
// pressing Run — which reported success every time — while the light stayed
// off. The wizard let it through with nothing louder than a faint
// "No actions added" on the review step.
//
// An action row with no device chosen is exactly as dead, so it doesn't count
// either.
//
// The SAME hole existed on the trigger side until 2026-09-22, and nothing
// guarded it at any layer. `canNext()` was `!!(trigger.type || 'time')` —
// true for every possible input — so the wizard waved through a half-filled
// trigger, and the HA converter turned it into config that can never fire:
//
//     time      with no time    → {'at': ':00'}          (malformed)
//     controller with no id     → []                     (NO triggers at all)
//     state     with no entity  → {'entity_id': '', ...} (matches nothing)
//     webhook   with no id      → {'webhook_id': ''}
//
// Each of those saves clean, shows up in the list, and is silently dead —
// the balcony failure with a different cause. `triggerBlocker` closes it
// here; services/ha_automations.has_valid_trigger closes it server-side,
// because a client-only check is not a guarantee.

/** True when this step would actually reach a device or a person. */
export function isEffectiveAction(action) {
  if (!action || typeof action !== 'object') return false
  const type = action.type || 'call_service'
  // The one shape the wizard can create empty: "add action" seeds a
  // call_service row with no entity, and an empty target reaches nothing.
  if (type === 'call_service') return !!String(action.entity_id || '').trim()
  // Same test for the other shapes that can be added and left blank. The
  // executor already refuses a speak step with no text at run time ("speak
  // step has no text"); refusing it here means the user finds out while
  // they're looking at it, not in a log afterwards.
  if (type === 'speak') return !!String(action.text || action.message || '').trim()
  if (type === 'wait_for_state') return !!String(action.entity_id || '').trim()
  if (type === 'notify') return !!String(action.message || '').trim()
  if (type === 'send_intent') return !!String(action.text || '').trim()
  return true
}

const filled = (v) => !!String(v ?? '').trim()

/**
 * Why this trigger can't fire yet, as an i18n suffix
 * ('triggerEntity' | 'triggerTime' | 'triggerController' | 'triggerRoom' |
 *  'triggerWebhook' | 'triggerPattern'), or null when it is complete.
 *
 * Only shapes the wizard can actually produce are listed. An unknown type
 * (a blueprint body, a recipe, something a future version writes) is left
 * alone rather than blocked on a rule this file doesn't know.
 */
export function triggerBlocker(trigger) {
  const t = trigger || {}
  switch (t.type) {
    case 'state':
    case 'numeric_state':
      return filled(t.entity_id) ? null : 'triggerEntity'
    case 'occupancy':
      // Resolved to a `state` trigger on save, so it needs the same target.
      return filled(t.entity_id) ? null : 'triggerRoom'
    case 'time':
      return filled(t.time) ? null : 'triggerTime'
    case 'time_pattern':
      return (filled(t.minutes) || filled(t.hours) || filled(t.seconds)) ? null : 'triggerPattern'
    case 'controller':
      // Both halves matter: without an action the converter emits [], which
      // is an automation with no trigger at all.
      return (filled(t.controller_id) && filled(t.action)) ? null : 'triggerController'
    case 'webhook':
      return filled(t.webhook_id) ? null : 'triggerWebhook'
    // Complete the moment they are chosen — they carry their own defaults.
    case 'person_arrives':
    case 'person_leaves':
    case 'all_persons_left':
    case 'zone_entered':
    case 'zone_left':
    case 'sunrise':
    case 'sunset':
    case 'manual':
      return null
    default:
      return null
  }
}

/**
 * Why this automation can't be saved yet:
 * 'name' | 'actions' | 'actionTarget' | 'conditions' | a triggerBlocker key,
 * or null when it is good to go.
 */
export function saveBlocker({ name, actions, trigger, conditions } = {}) {
  if (!String(name || '').trim()) return 'name'
  const trig = triggerBlocker(trigger)
  if (trig) return trig
  const list = Array.isArray(actions) ? actions : []
  if (list.length === 0) return 'actions'
  if (!list.some(isEffectiveAction)) return 'actionTarget'
  // A half-filled condition used to be deleted silently on save — the user
  // added it, never finished it, and it was gone with no word. Refusing is
  // the honest option: it is their rule, not ours to discard.
  if (incompleteConditions(conditions).length > 0) return 'conditions'
  return null
}

/** Conditions that carry no usable test, and so would be dropped on save. */
export function incompleteConditions(conditions) {
  const list = Array.isArray(conditions) ? conditions : []
  return list.filter(c => {
    if (!c || typeof c !== 'object') return true
    switch (c.type) {
      case 'time':      return !(filled(c.after) || filled(c.before))
      case 'mode':      return !filled(c.mode)
      case 'sun':       return !(filled(c.after) || filled(c.before))
      case 'presence':  return !filled(c.value)
      case 'or_group':
      case 'and_group': return !Array.isArray(c.conditions) || c.conditions.length === 0
      default:          return !filled(c.entity_id)
    }
  })
}
