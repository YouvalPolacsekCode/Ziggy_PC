// OTA watchdog — drives @capgo/capacitor-updater's manual flow.
//
// Why manual instead of autoUpdate:true:
//   The plugin's at-launch background check fires before the WebView's
//   network stack is bound, which reliably DNS-fails on Android. The plugin
//   only tries once, so the OTA silently never happens. We drive it from
//   JS — after our own /api/health round-trip succeeds, network is provably
//   alive, then we getLatest() → download() → next().
//
// Two responsibilities:
//   1. notifyAppReady() within capacitor.config.ts:appReadyTimeout (10s).
//      Failing to call this would make the plugin revert any just-applied
//      OTA bundle.
//   2. Check for a newer bundle and stage it for the NEXT launch via next().
//      next() (not set()) avoids a mid-session WebView reload.
//
// Plugin accessed via window.Capacitor.Plugins.CapacitorUpdater (the
// runtime bridge) — NOT via `import { CapacitorUpdater } from '@capgo/...'`.
// The package depends on @capacitor/core which isn't in the frontend's
// node_modules (only in ziggy_mobile/), so a direct import breaks the
// Vite build with "Rollup failed to resolve import @capacitor/core".
// The runtime bridge works without the import — when the native APK
// includes the plugin, Capacitor.Plugins.CapacitorUpdater is populated
// by the bridge on init. Same pattern as lib/native.js for other plugins.

import { isNative, plugin } from './native'

const HEALTH_CHECK_TIMEOUT_MS = 5_000

// Prefix every log so they're easy to grep in `adb logcat`.
const TAG = '[ziggy-ota]'
const log = (...args) => console.log(TAG, ...args)
const warn = (...args) => console.warn(TAG, ...args)

export function initOtaWatchdog() {
  if (!isNative()) return

  setTimeout(async () => {
    log('start')

    // Dev-mode escape hatch — when we're iterating locally and pushing
    // APKs by hand, the cloud OTA bundle is stale by definition. Setting
    // localStorage.ZIGGY_OTA_DISABLED = '1' from devtools (or having it
    // present from a previous dev session) skips the entire flow so the
    // freshly-bundled APK assets keep running across reopens.
    try {
      if (localStorage.getItem('ZIGGY_OTA_DISABLED') === '1') {
        log('disabled via localStorage.ZIGGY_OTA_DISABLED — using APK bundle')
        return
      }
    } catch {}

    const updater = plugin('CapacitorUpdater')
    if (!updater) {
      warn('CapacitorUpdater plugin not on bridge — APK likely missing the plugin')
      return
    }
    log('plugin lookup ok')

    // ── Step 1: health-check the backend ──────────────────────────────────
    const healthy = await _healthCheck()
    log('health check:', healthy ? 'OK' : 'FAIL')
    if (!healthy) return

    // ── Step 2: confirm THIS bundle is good ───────────────────────────────
    try {
      await updater.notifyAppReady()
      log('notifyAppReady ok')
    } catch (e) {
      warn('notifyAppReady failed:', String(e))
    }

    // ── Step 3: check for a newer bundle, stage it for next launch ───────
    try {
      const latest = await updater.getLatest()
      log('latest:', latest?.version, '→', latest?.url)
      if (!latest || !latest.url || !latest.version) {
        log('no latest version available')
        return
      }

      const current = await updater.current().catch(() => null)
      const currentVersion = current?.bundle?.version || current?.version || null
      log('current version:', currentVersion)
      if (currentVersion && currentVersion === latest.version) {
        log('already on latest, nothing to do')
        return
      }

      log('downloading bundle...')
      const downloaded = await updater.download({
        url: latest.url,
        version: latest.version,
      })
      log('downloaded:', downloaded?.id, downloaded?.version)
      if (!downloaded || !downloaded.id) return

      await updater.next({ id: downloaded.id })
      log('staged for next launch ✓')
    } catch (e) {
      warn('update flow failed:', String(e))
    }
  }, 0)
}

async function _healthCheck() {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), HEALTH_CHECK_TIMEOUT_MS)
  try {
    // /api/mobile/health (not /api/health): the latter requires an
    // authenticated dashboard session — we're pre-login here, so it
    // 401s and the OTA would refuse to download forever. The /mobile/
    // variant is the purpose-built public liveness ping (see
    // mobile_router.py:health), returns `{ ok: true, ... }`.
    const res = await fetch('/api/mobile/health', { signal: ctrl.signal })
    return res.ok
  } catch (e) {
    warn('health fetch threw:', String(e))
    return false
  } finally {
    clearTimeout(t)
  }
}
