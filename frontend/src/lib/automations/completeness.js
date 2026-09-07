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

/** True when this step would actually reach a device or a person. */
export function isEffectiveAction(action) {
  if (!action || typeof action !== 'object') return false
  const type = action.type || 'call_service'
  // The one shape the wizard can create empty: "add action" seeds a
  // call_service row with no entity, and an empty target reaches nothing.
  if (type === 'call_service') return !!String(action.entity_id || '').trim()
  return true
}

/**
 * Why this automation can't be saved yet: 'name' | 'actions' | 'actionTarget',
 * or null when it is good to go.
 */
export function saveBlocker({ name, actions } = {}) {
  if (!String(name || '').trim()) return 'name'
  const list = Array.isArray(actions) ? actions : []
  if (list.length === 0) return 'actions'
  if (!list.some(isEffectiveAction)) return 'actionTarget'
  return null
}
