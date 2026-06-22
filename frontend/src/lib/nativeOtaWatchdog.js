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
// Importing @capgo/capacitor-updater (rather than going through
// window.Capacitor.Plugins) is the canonical Capacitor 7 pattern — the
// package's web shim auto-registers the JS-side proxy that bridges to the
// native plugin. On PWA / non-native the web shim no-ops cleanly.

import { CapacitorUpdater } from '@capgo/capacitor-updater'

import { isNative } from './native'

const HEALTH_CHECK_TIMEOUT_MS = 5_000

// Prefix every log so they're easy to grep in `adb logcat`.
const TAG = '[ziggy-ota]'
const log = (...args) => console.log(TAG, ...args)
const warn = (...args) => console.warn(TAG, ...args)

export function initOtaWatchdog() {
  if (!isNative()) return

  setTimeout(async () => {
    log('start')

    // ── Step 1: health-check the backend ──────────────────────────────────
    const healthy = await _healthCheck()
    log('health check:', healthy ? 'OK' : 'FAIL')
    if (!healthy) return

    // ── Step 2: confirm THIS bundle is good ───────────────────────────────
    try {
      await CapacitorUpdater.notifyAppReady()
      log('notifyAppReady ok')
    } catch (e) {
      warn('notifyAppReady failed:', String(e))
    }

    // ── Step 3: check for a newer bundle, stage it for next launch ───────
    try {
      const latest = await CapacitorUpdater.getLatest()
      log('latest:', latest?.version, '→', latest?.url)
      if (!latest || !latest.url || !latest.version) {
        log('no latest version available')
        return
      }

      const current = await CapacitorUpdater.current().catch(() => null)
      const currentVersion = current?.bundle?.version || current?.version || null
      log('current version:', currentVersion)
      if (currentVersion && currentVersion === latest.version) {
        log('already on latest, nothing to do')
        return
      }

      log('downloading bundle...')
      const downloaded = await CapacitorUpdater.download({
        url: latest.url,
        version: latest.version,
      })
      log('downloaded:', downloaded?.id, downloaded?.version)
      if (!downloaded || !downloaded.id) return

      await CapacitorUpdater.next({ id: downloaded.id })
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
    const res = await fetch('/api/health', { signal: ctrl.signal })
    return res.ok
  } catch (e) {
    warn('health fetch threw:', String(e))
    return false
  } finally {
    clearTimeout(t)
  }
}
