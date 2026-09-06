// Where the app boots, given where the browser landed.
//
// Pure so it can be tested. App.jsx feeds it the real window state once,
// before BrowserRouter mounts, and applies the answer with replaceState.
//
// The rules, in order:
//
//   1. A deep link is left alone. These are pages a person reaches ON
//      PURPOSE by URL — a bookmark to the ops console, a kiosk tablet
//      cold-booting into /wall, a public presence page — and rewriting them
//      to '/' turns a bookmark into "open the app and hunt for it again".
//   2. Just logged in → '/'. The URL at that moment is whatever page had the
//      Logout button, and landing back there reads as "login did nothing".
//   3. Cold start (PWA tap, new tab) on an ordinary page → '/'. A reload
//      (F5) is not a cold start and keeps its page.
//   4. A wall-mode device that would otherwise boot to '/' boots to /wall
//      instead, so a kiosk panel never flashes the phone app on wake.

// Path prefixes that are deep links. Matched on a whole path segment, so
// '/ops' and '/ops/cloud' qualify and '/opsy' does not.
const DEEP_LINK_PREFIXES = ['/ops', '/wall', '/presence']

export function isDeepLink(pathname) {
  if (typeof pathname !== 'string') return false
  return DEEP_LINK_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

/**
 * @param {object} o
 * @param {string}  o.pathname      window.location.pathname at boot
 * @param {string}  o.navType       PerformanceNavigationTiming.type ('navigate' | 'reload' | …)
 * @param {boolean} o.justLoggedIn  authenticated flipped false→true this render
 * @param {boolean} o.wallMode      this device is set to "use as wall dashboard"
 * @returns {string|null} the path to replaceState to, or null to stay put
 */
export function bootPath({ pathname, navType, justLoggedIn, wallMode }) {
  if (isDeepLink(pathname)) return null

  let target = pathname
  if (justLoggedIn && pathname !== '/') target = '/'
  else if (navType !== 'reload' && pathname !== '/') target = '/'

  if (wallMode && target === '/') target = '/wall'

  return target === pathname ? null : target
}
