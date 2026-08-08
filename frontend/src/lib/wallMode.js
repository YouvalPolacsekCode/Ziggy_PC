// "Use this device as a wall dashboard".
//
// Device-local by design: it describes what THIS screen is for, not something
// about the home or the account. The tablet on the kitchen wall is in wall
// mode; the same person's phone is not, and neither should learn it from the
// other. That is why it lives in localStorage rather than in server-side
// prefs.
//
// Turning it on makes the app boot straight into /wall. It is the difference
// between a tablet that shows the wall dashboard and one that shows a phone
// app on a wall — and it means the same store build serves both, rather than
// shipping a second listing for a second screen.

const KEY = 'ziggy_wall_mode'

export function isWallMode() {
  try { return localStorage.getItem(KEY) === '1' }
  catch { return false }
}

export function setWallMode(on) {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else    localStorage.removeItem(KEY)
  } catch { /* private mode / storage disabled — mode just won't persist */ }
}
