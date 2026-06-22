// OTA watchdog — drives @capgo/capacitor-updater's manual flow.
//
// Why manual instead of autoUpdate:true:
//   The plugin's at-launch background check fires before the WebView's
//   network stack is fully bound, which reliably DNS-fails on Android
//   ("Unable to resolve host"). The plugin only tries once, so the OTA
//   silently never happens. We drive it from JS instead — after our own
//   /api/health round-trip succeeds, network is provably alive, then we
//   call getLatest() → download() → next().
//
// Two responsibilities here:
//   1. notifyAppReady() within capacitor.config.ts:appReadyTimeout (10s).
//      Failing to call this would make the plugin revert any just-applied
//      OTA bundle. Order: do this FIRST so the current bundle is confirmed
//      good before we go fetching a new one.
//   2. Check for a newer bundle and stage it for the NEXT launch via next().
//      We use next(), not set(), because set() reloads the WebView mid-
//      session — jarring UX. Letting the user finish what they're doing
//      and hot-swap on next cold start is the right default.
//
// All plugin access via window.Capacitor.Plugins.CapacitorUpdater (the
// runtime bridge) — @capgo/capacitor-updater lives in ziggy_mobile/, not
// frontend/, so a direct import wouldn't resolve at build time.

import { isNative, plugin } from './native'

const HEALTH_CHECK_TIMEOUT_MS = 5_000

export function initOtaWatchdog() {
  if (!isNative()) return

  // setTimeout(..., 0) defers past the current microtask so React's first
  // render commits before we touch the network. Avoids racing the bundle's
  // own boot-time fetches.
  setTimeout(async () => {
    const updater = plugin('CapacitorUpdater')
    if (!updater) return

    // ── Step 1: health-check the backend ──────────────────────────────────
    const healthy = await _healthCheck()
    if (!healthy) {
      // Backend unreachable from this bundle. Don't notifyAppReady — if
      // this WAS a freshly-applied OTA bundle, the 10s timer will fire
      // and the plugin rolls it back. (If it's the originally bundled
      // www/, rollback is a no-op — the plugin only reverts OTA-applied
      // bundles.) Either outcome is correct: we never confirm a bundle
      // we can't prove works.
      return
    }

    // ── Step 2: confirm THIS bundle is good ───────────────────────────────
    try {
      await updater.notifyAppReady()
    } catch {
      // Plugin internal failure — leave it; worst case is one rollback.
    }

    // ── Step 3: check for a newer bundle, stage it for next launch ───────
    try {
      const latest = await updater.getLatest()   // { version, url, ... }
      if (!latest || !latest.url || !latest.version) return

      const current = await updater.current().catch(() => null)
      const currentVersion = current?.bundle?.version || current?.version || null
      if (currentVersion && currentVersion === latest.version) {
        // Already on latest — no work to do.
        return
      }

      // Download the bundle. The plugin extracts and stores it; the returned
      // BundleInfo includes an `id` we need for next().
      const downloaded = await updater.download({
        url: latest.url,
        version: latest.version,
      })
      if (!downloaded || !downloaded.id) return

      // Stage for next launch. Using next() (not set()) avoids reloading
      // the WebView in the middle of the user's session.
      await updater.next({ id: downloaded.id })
    } catch {
      // Any failure here is silent — the user keeps using the current
      // bundle, and we try again on the next cold start.
    }
  }, 0)
}

async function _healthCheck() {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), HEALTH_CHECK_TIMEOUT_MS)
  try {
    const res = await fetch('/api/health', { signal: ctrl.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}
