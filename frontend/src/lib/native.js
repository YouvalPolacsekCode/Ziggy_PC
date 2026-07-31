// Capacitor bridge — runtime-only access to native APIs.
//
// We access the Capacitor JS API via the global injected by the Capacitor
// runtime (window.Capacitor) rather than importing @capacitor/* packages.
// That keeps the existing frontend package.json untouched and makes the PWA
// build identical to today — these helpers cleanly no-op (or fall back to
// browser APIs) when running outside the native shell.

const C = typeof window !== 'undefined' ? window.Capacitor : null

export function isNative() {
  return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform())
}

export function platform() {
  if (!C) return 'web'
  try { return C.getPlatform?.() ?? 'web' } catch { return 'web' }
}

// Returns a Capacitor plugin object if loaded in the native shell, else null.
// All callers must check the return value before using it.
export function plugin(name) {
  if (!isNative()) return null
  try { return C.Plugins?.[name] ?? null } catch { return null }
}

// Convenience: device info (model, OS version) — used during /api/mobile/pair.
export async function getDeviceInfo() {
  const Device = plugin('Device')
  const App    = plugin('App')
  if (!Device) {
    return {
      platform: platform(),
      model: navigator.userAgent.slice(0, 64),
      os_version: '',
      app_version: '',
    }
  }
  try {
    const info = await Device.getInfo()
    let appVersion = ''
    try { appVersion = (await App?.getInfo?.())?.version ?? '' } catch {}
    return {
      platform: info.platform,                 // "ios" | "android" | "web"
      model: info.model || info.manufacturer || '',
      os_version: info.osVersion || '',
      app_version: appVersion,
    }
  } catch {
    return { platform: platform(), model: '', os_version: '', app_version: '' }
  }
}

// Native geolocation (high-accuracy single fix). Falls back to browser on web.
export async function getCurrentPosition() {
  const Geo = plugin('Geolocation')
  if (Geo) {
    return Geo.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 })
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 60000,
    })
  })
}

// Request notification permission. Returns 'granted' | 'denied' | 'prompt'.
export async function requestNotificationPermission() {
  const Push = plugin('PushNotifications')
  if (Push) {
    try {
      const res = await Push.requestPermissions()
      return res?.receive === 'granted' ? 'granted' : 'denied'
    } catch { return 'denied' }
  }
  if (typeof Notification === 'undefined') return 'denied'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  const result = await Notification.requestPermission()
  return result
}

// Register for NATIVE push (FCM on Android, APNs on iOS) and hand the device
// token back via onToken(token, provider). No-op on web / when the plugin is
// absent or permission is denied. Android webviews can't do web-push, so this
// is the only way phones receive server notifications. Listeners are attached
// once per session to avoid stacking on re-invocation.
let _pushListenersAdded = false
export async function registerForPush(onToken) {
  const Push = plugin('PushNotifications')
  if (!Push) return false
  const provider = platform() === 'ios' ? 'apns' : 'fcm'
  try {
    let recv = (await Push.checkPermissions())?.receive
    if (recv !== 'granted') recv = (await Push.requestPermissions())?.receive
    if (recv !== 'granted') return false
    if (!_pushListenersAdded) {
      _pushListenersAdded = true
      Push.addListener('registration', (t) => {
        const tok = t?.value || t?.token || ''
        if (tok) { try { onToken?.(tok, provider) } catch {} }
      })
      Push.addListener('registrationError', (e) => {
        try { console.warn('[push] registrationError', e) } catch {}
      })
    }
    await Push.register()   // fires 'registration' with the token
    return true
  } catch (e) {
    try { console.warn('[push] register failed', e) } catch {}
    return false
  }
}

// Persistent storage (uses Capacitor Preferences on native, localStorage on web).
export const storage = {
  async get(key) {
    const P = plugin('Preferences')
    if (P) { const v = await P.get({ key }); return v?.value ?? null }
    return localStorage.getItem(key)
  },
  async set(key, value) {
    const P = plugin('Preferences')
    if (P) return P.set({ key, value: String(value) })
    localStorage.setItem(key, String(value))
  },
  async remove(key) {
    const P = plugin('Preferences')
    if (P) return P.remove({ key })
    localStorage.removeItem(key)
  },
}
