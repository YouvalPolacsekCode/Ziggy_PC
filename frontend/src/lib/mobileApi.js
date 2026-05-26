// Ziggy Mobile API client — wraps the /api/mobile/* endpoints exposed by
// backend/routers/mobile_router.py.
//
// Two distinct auth contexts:
//   - mintPairCode(): called from the PWA by a logged-in user. Uses the existing
//                     ziggy_token (session) auth header.
//   - pair() / register() / postWebhook(): called from inside the native app
//                     after pairing. Uses a device-scoped token stored under
//                     the 'ziggy_device_token' key.
//
// Keep this file self-contained — do NOT import lib/api.js, which is hardwired
// for the PWA session-token auth and would route 401s to LoginPage.

import { storage } from './native'

const DEVICE_TOKEN_KEY = 'ziggy_device_token'
const DEVICE_ID_KEY    = 'ziggy_device_id'
const WEBHOOK_ID_KEY   = 'ziggy_device_webhook_id'

// ── token helpers ────────────────────────────────────────────────────────────

export async function getDeviceToken() { return storage.get(DEVICE_TOKEN_KEY) }
export async function getDeviceId()    { return storage.get(DEVICE_ID_KEY) }
export async function getWebhookId()   { return storage.get(WEBHOOK_ID_KEY) }

async function setDeviceCreds({ auth_token, device_id, webhook_id }) {
  await Promise.all([
    storage.set(DEVICE_TOKEN_KEY, auth_token),
    storage.set(DEVICE_ID_KEY,    device_id),
    storage.set(WEBHOOK_ID_KEY,   webhook_id),
  ])
}

export async function clearDeviceCreds() {
  await Promise.all([
    storage.remove(DEVICE_TOKEN_KEY),
    storage.remove(DEVICE_ID_KEY),
    storage.remove(WEBHOOK_ID_KEY),
  ])
}

// ── PWA → backend: mint a pair code for the user's phone ─────────────────────

export async function mintPairCode() {
  const token = localStorage.getItem('ziggy_token') || ''
  const res = await fetch('/api/mobile/pair-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`pair-code failed: ${res.status}`)
  return res.json()   // { code, expires_at, ttl_seconds }
}

// ── Phone → backend: redeem a pair code, save device creds ───────────────────

export async function pair({ pairCode, device }) {
  const res = await fetch('/api/mobile/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pair_code: pairCode.toUpperCase(), device }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`pair failed (${res.status}): ${detail}`)
  }
  const data = await res.json()
  await setDeviceCreds({
    auth_token: data.auth_token,
    device_id:  data.device_id,
    webhook_id: data.webhook_id,
  })
  if (data.ws_url) await storage.set(WS_URL_KEY, data.ws_url)
  return data
}

// ── Phone → backend: register push token, permissions, person binding ───────

export async function registerDevice(updates) {
  const token = await getDeviceToken()
  if (!token) throw new Error('not paired')
  const res = await fetch('/api/mobile/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(updates),
  })
  if (!res.ok) throw new Error(`register failed: ${res.status}`)
  return res.json()
}

// ── Phone → backend: post a webhook payload (sensors / location / events) ────

export async function postWebhook(payload) {
  const [token, webhookId] = await Promise.all([getDeviceToken(), getWebhookId()])
  if (!token || !webhookId) throw new Error('not paired')
  const res = await fetch(`/api/mobile/webhook/${webhookId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`webhook failed: ${res.status}`)
  return res.json()
}

// Convenience: short type-specific helpers
export const sendLocation = (data)  => postWebhook({ type: 'update_location', data })
export const sendSensors  = (data)  => postWebhook({ type: 'update_sensors',  data })
export const fireEvent    = (event, payload = {}) =>
  postWebhook({ type: 'fire_event', data: { event, payload } })


// ── Paired device management (PWA-facing, user-authed) ──────────────────────

const WS_URL_KEY = 'ziggy_device_ws_url'

export async function listMyMobileDevices() {
  const token = localStorage.getItem('ziggy_token') || ''
  const res = await fetch('/api/mobile/devices', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`devices list failed: ${res.status}`)
  return res.json()   // { devices: [...] }
}

export async function revokeMobileDevice(deviceId) {
  const token = localStorage.getItem('ziggy_token') || ''
  const res = await fetch(`/api/mobile/devices/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`revoke failed: ${res.status}`)
  return res.json()
}

// pair() persists ws_url alongside the rest of the device creds.
// Export a helper for mobileWs.js to read it.
export async function getDeviceWsUrl() {
  return storage.get(WS_URL_KEY)
}
async function setDeviceWsUrl(url) {
  return storage.set(WS_URL_KEY, url)
}

// Extend the original setDeviceCreds via wrapper — pair() in this file calls
// the local setDeviceCreds which we can't easily re-export. Instead, expose a
// post-pair hook that stores ws_url. The pair() function above now also stashes
// it directly via this helper, called from PairResponse handling.
export async function rememberWsUrl(url) { await setDeviceWsUrl(url) }
