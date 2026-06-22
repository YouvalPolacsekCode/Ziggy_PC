// OTA watchdog — calls CapacitorUpdater.notifyAppReady() once we've
// confirmed the new bundle actually works.
//
// The flow:
//   1. capacitor-updater downloaded a new bundle on the previous launch
//      and applied it on this cold start.
//   2. The plugin started a 10s timer (appReadyTimeout in capacitor.config).
//      If we don't call notifyAppReady() before it fires, the plugin reverts
//      the bundle as "broken" and the next launch uses the previous bundle.
//   3. We do a quick smoke test (one /api/health request inside 5s) to make
//      sure the new bundle can talk to its backend. If yes, call
//      notifyAppReady() and the new bundle becomes the "current" one. If no,
//      let the plugin's 10s timer expire → automatic rollback.
//
// Accessed via window.Capacitor.Plugins.CapacitorUpdater (the runtime bridge)
// rather than `import` because @capgo/capacitor-updater lives in the
// ziggy_mobile node_modules, not the frontend's. Same pattern as lib/native.js.
//
// Importable freely from anywhere — does nothing on PWA / non-native context.

import { isNative, plugin } from './native'

const HEALTH_CHECK_TIMEOUT_MS = 5_000

export function initOtaWatchdog() {
  if (!isNative()) return

  // Run after a micro-tick so React's first render has committed. The point
  // of notifyAppReady is "the JS booted and rendered something" — calling
  // it before render commits would be a lie and could mask a real failure
  // that surfaces during render.
  setTimeout(async () => {
    const updater = plugin('CapacitorUpdater')
    if (!updater) {
      // Plugin not installed in this build (e.g. old APK that pre-dates
      // Phase 2). Nothing to notify; the host plugin no-ops anyway.
      return
    }

    let healthy = false
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), HEALTH_CHECK_TIMEOUT_MS)
      try {
        // /api/health is the public liveness endpoint (see backend
        // health_router). No auth needed → no entanglement with the
        // session-token rotation logic that runs later in App.jsx.
        const res = await fetch('/api/health', { signal: ctrl.signal })
        healthy = res.ok
      } finally {
        clearTimeout(t)
      }
    } catch {
      healthy = false
    }

    if (!healthy) {
      // Leave notifyAppReady uncalled — the plugin's appReadyTimeout will
      // fire and the bundle gets reverted automatically. No further action
      // needed from us.
      return
    }

    try {
      await updater.notifyAppReady()
    } catch {
      // notifyAppReady() throwing is rare and isn't catastrophic — the
      // plugin treats no-call-within-timeout the same as a failed call,
      // so the worst outcome is a single rollback. Swallow the error.
    }
  }, 0)
}
