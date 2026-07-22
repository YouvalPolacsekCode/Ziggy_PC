// Emoji identity for Library out-of-the-box automations, mirroring the backend
// template registry (`services/automation_templates.py` → each template's
// `icon`). Keyed by NORMALIZED id so an installed automation shows the SAME
// face as its Library tile — that's what makes every Library automation "talk
// the same language" on the card.
//
// Add new Library automations here (id → emoji) so their installed card matches
// the Library tile. Custom / user-built automations fall through to null and
// keep the generic trigger-type glyph.
const LIBRARY_EMOJI = {
  leave_home:          '🚪',
  welcome_home:        '🏠',
  precool_on_arrival:  '🏡',
  precool_arrival:     '🏡',
  sleep_mode:          '🌙',
  morning_routine:     '☀️',
  smart_climate:       '🌡️',
  child_room_monitor:  '👶',
  motion_night_light:  '👣',
  night_watch:         '🌃',
  circadian_lighting:  '🌅',
  smart_room:          '🪄',
  ac_window_interlock: '🪟',
  window_ac_off:       '🪟',
  tv_off_when_empty:   '📺',
  fake_occupancy:      '🌙',
  good_night:          '🌙',
}

// Normalize an automation id to its Library key: drop the `ziggy_` prefix and
// any trailing suffix (e.g. `ziggy_leave_home_alert` → `leave_home`).
export function libraryEmoji(automation) {
  if (!automation) return null
  const id = String(automation.id || '').replace(/^ziggy_/, '').toLowerCase()
  if (LIBRARY_EMOJI[id]) return LIBRARY_EMOJI[id]
  // Longest-prefix match so `leave_home_alert`, `smart_room_office`, etc. resolve.
  let best = null
  for (const key of Object.keys(LIBRARY_EMOJI)) {
    if (id.startsWith(key) && (!best || key.length > best.length)) best = key
  }
  return best ? LIBRARY_EMOJI[best] : null
}
