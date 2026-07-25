import motionLight from './motionLight'
import nightWatch from './nightWatch'
import windowAc from './windowAc'
import leaveHome from './leaveHome'
import precool from './precool'
import circadian from './circadian'
import climate from './climate'
import smartRoom from './smartRoom'

// ── Recipe registry ──────────────────────────────────────────────────────────
// Every OOTB bundle, keyed by its `wizard_prefill.bundle` id from the Library
// templates. Adding bundle #9 = writing one recipe file + one line here.

export const RECIPES = {
  [motionLight.id]: motionLight,
  [nightWatch.id]: nightWatch,
  [windowAc.id]: windowAc,
  [leaveHome.id]: leaveHome,
  [precool.id]: precool,
  [circadian.id]: circadian,
  [climate.id]: climate,
  [smartRoom.id]: smartRoom,
}

// Installed-automation id → recipe id, for routing an existing automation's
// open/edit to its bundle editor (replaces the per-bundle isLeaveHome/… sniffers).
export function recipeForAutomation(a) {
  const id = a?.id || ''
  const name = (a?.name || '').toLowerCase()
  if (id === 'ziggy_leave_home' || id === 'leave_home' || name === 'leave home') return 'leave_home'
  if (id === 'ziggy_precool_arrival' || id === 'precool_on_arrival' || name.replace(/[^a-z]/g, '').includes('precool')) return 'precool'
  if (id === 'ziggy_window_ac_off' || id === 'ac_window_interlock' || name.includes('window')) return 'window_ac'
  if (id === 'ziggy_motion_light' || id === 'motion_night_light' || name === 'motion light') return 'motion_light'
  if (id === 'ziggy_night_watch' || id === 'night_watch' || name === 'night watch') return 'night_watch'
  return null
}
