import logger from './logger'
import { ErrorCode, ZiggyApiError, ziggyErrorFromEnvelope } from './errors'

const BASE = '/api'

// Default per-request timeout. The backend's slowest legitimate operations
// — IR learn (~20s wait for an IR signal), voice transcribe (Whisper warm
// path can land at 10-15s), HA reload — sit well under 30s. Anything past
// that is almost certainly a stuck tunnel / dead backend, not a slow one,
// so we bail out and let the caller surface "Connection is slow".
const DEFAULT_TIMEOUT_MS = 30_000

function getToken() {
  return localStorage.getItem('ziggy_token') || ''
}

// Paths the logger should *not* emit a request line for. Polling-heavy
// endpoints would flood the debug feed and obscure real signal. We always
// still log failures regardless of the path — see apiError below.
const SILENT_PATHS = [
  '/debug/events',
  '/debug/config',
  '/debug/status',
  '/debug/frontend-event',  // the logger's own POST — infinite-loop guard
]

function isSilent(path) {
  return SILENT_PATHS.some(p => path.startsWith(p))
}

/**
 * Race a fetch against an AbortController-driven timeout. The browser fetch
 * API has no built-in timeout, which is what let slow tunnel hangs render
 * the UI frozen for minutes. AbortError surfaces as ZiggyApiError(REQUEST_TIMEOUT)
 * via the caller's normalize step.
 *
 * `existing` lets a caller (e.g. the long-polling debug events endpoint)
 * opt out of the default timeout by passing their own signal.
 */
function fetchWithTimeout(url, opts, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  // If the caller already supplied a signal, honor it without layering a
  // second timer — caller owns abort lifecycle.
  if (opts?.signal) return fetch(url, opts)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  return fetch(url, { ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(timer))
}

/**
 * Normalize any non-2xx HTTP response or network failure to ZiggyApiError.
 * Called from every request path so UI code never sees raw fetch errors,
 * "HTTP 502" strings, or unwrapped {detail: ...} payloads.
 *
 * Handles three backend envelope flavors gracefully:
 *   1. New unified envelope:  { error: { code, message, request_id, ... } }
 *   2. Legacy FastAPI:        { detail: "..." }
 *   3. Anything else:         status code → ZiggyApiError fallback
 */
async function _toZiggyError(res) {
  let body = null
  try { body = await res.json() } catch { /* non-JSON */ }

  // Shape 1 — new envelope.
  if (body && body.error && typeof body.error === 'object') {
    return ziggyErrorFromEnvelope(body, { status: res.status })
  }

  // Shape 2 — legacy {detail: "..."}. Map status → code; detail goes into
  // userMessage ONLY when it looks user-safe (short, no stack/class text).
  // The bad-marker filter mirrors the backend's _detail_looks_user_safe.
  let userMessage = null
  if (body && typeof body.detail === 'string') {
    const d = body.detail
    const looksSafe = d.length <= 200
      && !d.startsWith('HTTP ')
      && !/Traceback|Exception:|Error:|object at 0x|<class '|  File "/.test(d)
    if (looksSafe) userMessage = d
  }

  const code = _statusToCode(res.status, userMessage)
  return new ZiggyApiError({
    code,
    userMessage,
    status: res.status,
    requestId: res.headers.get('x-request-id') || null,
  })
}

// Substring marker the relay's billing-gated 403 response carries (set in
// relay/app/routers/proxy.py). Detected here in addition to the status
// code so the UI can render the subscription-specific banner instead of
// a generic permission-denied message.
const _SUBSCRIPTION_GATED_MARKER = 'Subscription required for remote access'

function _statusToCode(status, userMessage) {
  if (status === 401) return ErrorCode.NOT_AUTHENTICATED
  if (status === 403) {
    if (userMessage && userMessage.includes(_SUBSCRIPTION_GATED_MARKER)) {
      // Notify any subscribers (e.g. the global SubscriptionGateBanner)
      // that we just saw a billing-gated 403. Window event keeps the
      // api.js module decoupled from React component lifecycles.
      if (typeof window !== 'undefined') {
        try {
          window.dispatchEvent(new CustomEvent('ziggy:subscription-gated'))
        } catch { /* SSR or test env without CustomEvent — ignore */ }
      }
      return ErrorCode.SUBSCRIPTION_INACTIVE
    }
    return ErrorCode.INSUFFICIENT_PERMISSIONS
  }
  if (status === 404) return ErrorCode.NOT_FOUND
  if (status === 409) return ErrorCode.CONFLICT
  if (status === 422) return ErrorCode.VALIDATION_ERROR
  if (status === 502) return ErrorCode.UPSTREAM_UNAVAILABLE
  if (status === 503) return ErrorCode.DEVICE_UNAVAILABLE
  if (status === 504) return ErrorCode.UPSTREAM_TIMEOUT
  if (status >= 400 && status < 500) return ErrorCode.VALIDATION_ERROR
  return ErrorCode.INTERNAL_ERROR
}

/**
 * Convert any thrown value (TypeError from fetch, AbortError, anything) into
 * a ZiggyApiError. Used by the catch arm of every request path.
 */
function _normalizeNetworkError(err) {
  if (err?.isZiggyError || err instanceof ZiggyApiError) return err
  if (err?.name === 'AbortError') {
    return new ZiggyApiError({ code: ErrorCode.REQUEST_TIMEOUT })
  }
  // TypeError is what fetch throws for network failures: name lookup failure,
  // DNS, dropped TCP, CORS preflight, etc. The browser doesn't distinguish
  // "offline" from "server unreachable" — both surface here.
  if (err instanceof TypeError) {
    return new ZiggyApiError({
      code: typeof navigator !== 'undefined' && navigator.onLine === false
        ? ErrorCode.NETWORK_OFFLINE
        : ErrorCode.UPSTREAM_UNAVAILABLE,
    })
  }
  return new ZiggyApiError({ code: ErrorCode.INTERNAL_ERROR })
}

// Per-URL ETag cache for GETs. When the server sends an ETag header on a
// 200 response, we remember (etag, body); subsequent GETs send If-None-Match.
// If the server replies 304, we return the cached body without re-parsing
// the JSON. Endpoints with no ETag header are unaffected.
const _etagCache = new Map() // url → { etag, body }


async function request(method, path, body, { timeoutMs } = {}) {
  const token = getToken()
  const reqId = logger.newRequestId()
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      // Threading a request id through to the backend is what makes the
      // Debug page's "trace one click end-to-end" feature actually work:
      // the middleware reuses this id for every event in the chain.
      'X-Request-Id': reqId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)

  // Send If-None-Match on GETs that we have a cached ETag for. The server
  // returns 304 with no body when our cache is still current.
  const _etagKey = method === 'GET' ? path : null
  if (_etagKey) {
    const cached = _etagCache.get(_etagKey)
    if (cached) opts.headers['If-None-Match'] = cached.etag
  }

  const silent = isSilent(path)
  const t0 = performance.now()
  if (!silent) logger.api(method, path, reqId)

  let res
  try {
    res = await fetchWithTimeout(`${BASE}${path}`, opts, { timeoutMs })
  } catch (err) {
    const dur = Math.round(performance.now() - t0)
    logger.apiError(method, path, reqId, err, dur)
    throw _normalizeNetworkError(err)
  }
  const dur = Math.round(performance.now() - t0)

  if (res.status === 401) {
    localStorage.removeItem('ziggy_token')
    localStorage.removeItem('ziggy_role')
    if (!silent) logger.apiResponse(method, path, reqId, 401, dur)
    // Fire event instead of reloading — App.jsx listens and shows LoginPage
    // without a page reload, which prevents the WS reconnect storm.
    window.dispatchEvent(new Event('ziggy:unauthorized'))
    // Throw so awaiting callers fail predictably instead of receiving
    // undefined — the global handler in App.jsx will swap to LoginPage.
    throw new ZiggyApiError({ code: ErrorCode.NOT_AUTHENTICATED, status: 401 })
  }
  if (!res.ok) {
    const zerr = await _toZiggyError(res)
    if (!silent) logger.apiResponse(method, path, reqId, res.status, dur,
                                    { code: zerr.code, request_id: zerr.requestId })
    throw zerr
  }
  if (!silent) logger.apiResponse(method, path, reqId, res.status, dur)
  // Successful response from a relay-proxied path implies the billing
  // gate is now green. Fire a 'cleared' event so the SubscriptionGateBanner
  // hides itself without waiting for a reload. Cheap to dispatch
  // unconditionally; the banner listener no-ops if not currently shown.
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('ziggy:subscription-cleared'))
    } catch { /* ignore */ }
  }
  // 304 Not Modified — server says our cached body is still current.
  // Return the cached JSON without parsing an empty body.
  if (res.status === 304 && _etagKey) {
    const cached = _etagCache.get(_etagKey)
    if (cached) return cached.body
  }
  const parsed = await res.json()
  // Remember ETag-tagged responses so the next GET can short-circuit.
  if (_etagKey) {
    const etag = res.headers.get('ETag')
    if (etag) _etagCache.set(_etagKey, { etag, body: parsed })
  }
  return parsed
}

const get = (path) => request('GET', path)
const post = (path, body) => request('POST', path, body)
const put = (path, body) => request('PUT', path, body)
const patch = (path, body) => request('PATCH', path, body)
const del = (path, body) => request('DELETE', path, body)

// Retry helper for the device-fan-out endpoints on the PWA path. Cloudflare
// Tunnel + slow backend handlers (e.g. cold HA registry cache) routinely
// surface as "context canceled" mid-response; one quick retry rides over
// the typical 200-500ms reconnect window without making the user wait long
// on a real outage. Capped at 2 attempts so failures still fall through
// fast to the keep-last-good path in the store.
export async function withRetry(fn, { tries = 2, delayMs = 300 } = {}) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try { return await fn() }
    catch (e) {
      lastErr = e
      if (i < tries - 1) await new Promise(r => setTimeout(r, delayMs))
    }
  }
  throw lastErr
}

// ── UI prefs (server-side persistence of Dashboard pins) ─────────────────────
// localStorage is best-effort; the server is the source of truth so pins
// survive PWA cache evictions and "clear site data".
export const getUiPrefs = () => get('/ui/prefs')
export const putUiPrefs = (patch) => put('/ui/prefs', patch)

// Intent / Voice
export const sendIntent = (text, source = 'web') => post('/intent', { text, source })

// Chat mode — always routes through GPT with session history and autonomous web search
export const sendChat = (text, chatHistory = [], source = 'web') =>
  post('/chat', { text, chat_history: chatHistory, source })

// Voice upload — Whisper round-trip can be 5-15s on a warm model so the
// timeout is generously above the request layer default. Still bounded so a
// stuck tunnel never lets the UI sit on a phantom "transcribing…" spinner.
async function _voicePost(path, blob) {
  const fd = new FormData()
  fd.append('file', blob, 'recording.webm')
  const token = getToken()
  let res
  try {
    res = await fetchWithTimeout(`${BASE}${path}`, {
      method: 'POST',
      body: fd,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }, { timeoutMs: 45_000 })
  } catch (err) {
    throw _normalizeNetworkError(err)
  }
  if (!res.ok) throw await _toZiggyError(res)
  return res.json()
}

export const sendVoice           = (blob) => _voicePost('/voice', blob)
export const sendVoiceTranscribe = (blob) => _voicePost('/voice/transcribe', blob)

// Devices / HA entities
export const getEntities = (domain) =>
  get(domain ? `/ha/entities?domain=${domain}` : '/ha/entities')
export const getEntityProtocols = () => get('/ha/entity-protocols')
export const getEntityState = (entityId) => get(`/ha/state/${entityId}`)
export const getEntityDetails = (entityId) => get(`/ha/entity/${encodeURIComponent(entityId)}/details`)
export const getDeviceMap = () => get('/devices')
export const getZiggyDevices = () => get('/devices')
// Grouped device view — one entry per physical device (HA device_id),
// with primary entity + sibling entities + metric pills. Flat /api/devices
// is unchanged and remains the source for legacy/external consumers.
export const getDeviceGroups = () => get('/devices/grouped')
export const saveDevice = (data) => post('/devices', data)
export const removeDevice = (room, dtype) => del(`/devices/${room}/${dtype}`)

// Entity ↔ Area assignment (HA areas only)
export const assignEntityToArea = (entityId, areaId) =>
  patch(`/ha/entity/${encodeURIComponent(entityId)}/area`, { area_id: areaId ?? null })

// Rename an entity. The backend persists a local display-name override AND
// best-effort pushes `name_by_user` to HA's entity registry, so HA-side
// surfaces (HA UI, automations referencing friendly_name, etc.) stay in
// sync with Ziggy. Returns { ok, display_name, ha_renamed }.
export const renameHaEntity = (entityId, name) =>
  patch(`/ha/entity/${encodeURIComponent(entityId)}/name`, { name })

// Entity ↔ Ziggy-native room assignment (device registry, no HA sync)
export const assignEntityToZiggyRoom = (entityId, roomKey) =>
  patch(`/registry/entity/${encodeURIComponent(entityId)}/room`, { room: roomKey ?? null })

// Drop a ghost device from the Ziggy registry (the entity was deleted in HA
// but Ziggy still had a row for it). Idempotent — missing entry returns ok.
export const removeRegistryEntity = (entityId) =>
  del(`/registry/entity/${encodeURIComponent(entityId)}`)

// Delete an entity from Home Assistant (and clean up Ziggy's registry too).
// When `deleteDevice` is true and the entity's parent device has no other
// entities left, the parent device's config entry is also removed — i.e.
// the HA equivalent of removing the device from the hub.
export const deleteHaEntity = (entityId, deleteDevice = false) =>
  request('DELETE', `/ha/entity/${encodeURIComponent(entityId)}${deleteDevice ? '?delete_device=true' : ''}`)

// Device ↔ Area assignment (device-level, shows in HA device page)
export const assignDeviceToArea = (deviceId, areaId) =>
  patch(`/ha/devices/${encodeURIComponent(deviceId)}/area`, { area_id: areaId ?? null })

// Rooms — backed by HA Areas
export const getRooms = () => get('/rooms')
export const getAllRooms = () => get('/rooms/all')   // HA areas UNION device-registry rooms
export const getRoomsWithDevices = () => get('/rooms/devices')
export const createRoom = (name) => post('/rooms', { name })
export const deleteRoom = (areaId) => del(`/rooms/${areaId}`)
export const renameRoom = (areaId, name) => patch(`/rooms/${areaId}`, { name })

// Tasks
export const getTasks = () => get('/tasks')
export const createTask = (data) => post('/tasks', data)
export const updateTask = (id, data) => patch(`/tasks/${id}`, data)
export const deleteTask = (id) => del(`/tasks/${id}`)

// Automations — backed by HA
export const getAutomationTemplates  = () => get('/automations/templates')
export const getSuggestedTemplates   = () => get('/automations/templates/suggested')
export const getAutomations = () => get('/automations')
export const getAutomation = (id) => get(`/automations/${id}`)
export const createAutomation = (data) => post('/automations', data)
export const toggleAutomation = (id, enabled) => patch(`/automations/${id}/toggle`, { enabled })
export const triggerAutomation = (id) => post(`/automations/${id}/trigger`)
export const deleteAutomation = (id) => del(`/automations/${id}`)
export const getAutomationHistory = (id, limit = 20) => get(`/automations/${id}/history?limit=${limit}`)
export const snoozeAutomation = (id, minutes) => post(`/automations/${id}/snooze`, { minutes })

// Smart Light Schedule (circadian) — bundle of 4 HA automations created/replaced
// atomically. See services/circadian_builder.py.
export const getCircadianBundle    = () => get('/automations/circadian-bundle')
export const saveCircadianBundle   = ({ lights, bedtime }) => post('/automations/circadian-bundle', { lights, bedtime })
export const deleteCircadianBundle = () => del('/automations/circadian-bundle')

// Manual overrides
export const getOverrides = () => get('/overrides')
export const clearOverride = (entityId) => del(`/overrides/${encodeURIComponent(entityId)}`)

// Routines — backed by HA Scripts
export const getRoutines = () => get('/routines')
export const getRoutine = (id) => get(`/routines/${id}`)
export const getSuggestedRoutines = () => get('/routines/suggested')
export const createRoutine = (data) => post('/routines', data)
export const runRoutine = (id) => post(`/routines/${id}/run`)
export const deleteRoutine = (id) => del(`/routines/${id}`)

// Zigbee pairing (stack-agnostic: backend dispatches to ZHA or Z2M)
export const zigbeePermit = (duration = 60) => post('/ha/zigbee/permit', { duration })
export const getHaDevices = () => get('/ha/devices')
export const getDeviceEntities = (deviceId) => get(`/ha/devices/${encodeURIComponent(deviceId)}/entities`)
export const renameHaDevice = (deviceId, name) => patch(`/ha/devices/${encodeURIComponent(deviceId)}/rename`, { name })

// Multi-protocol pairing
export const zwaveInclude = () => post('/ha/zwave/include')
export const zwaveStop = () => post('/ha/zwave/stop')
export const matterCommission = (code) => post('/ha/matter/commission', { code })

// Switcher native pairing — drives HA's switcher_kis config flow through the
// Ziggy UI step-by-step; HA does the LAN protocol work invisibly.
export const switcherPairingStart = () => post('/pairing/switcher/start')
export const switcherPairingStep = (flowId, userInput) =>
  post(`/pairing/switcher/${encodeURIComponent(flowId)}/step`, { user_input: userInput || {} })
export const switcherPairingCancel = (flowId) =>
  post(`/pairing/switcher/${encodeURIComponent(flowId)}/cancel`)
export const switcherPairingRecover = () => post('/pairing/switcher/recover')

// Switcher account — one-time credential collection. Email + token come
// from the Switcher mobile app (Settings → My account → request token).
// Ziggy validates + caches them so every device pairing thereafter is one-tap.
export const switcherAccountStatus    = ()                => get('/pairing/switcher/account')
export const switcherAccountConnect   = (email, token)    => post('/pairing/switcher/account', { email, token })
export const switcherAccountDisconnect= ()                => del('/pairing/switcher/account')
export const getConfigFlows = (protocol) =>
  get(protocol ? `/ha/config_flows?protocol=${protocol}` : '/ha/config_flows')

// Activity log
export const getActivity = (limit = 20) => get(`/activity?limit=${limit}`)

// Settings
export const getStatus = () => get('/status')
export const getVoiceSettings = () => get('/settings/voice')
export const patchVoiceSettings = (data) => patch('/settings/voice', data)
// Runtime listening state (mic_enabled, wake state, voice thread running)
export const getVoiceRuntimeStatus = () => get('/voice/status')
export const getGeneralSettings = () => get('/settings/general')
export const patchGeneralSettings = (data) => patch('/settings/general', data)

// Auth management
export const getAuthStatus    = ()           => get('/auth/status')
export const changePassword   = (data)       => post('/auth/change-password', data)

// User management (super_admin only)
export const getUsers         = ()           => get('/auth/users')
export const createUser       = (data)       => post('/auth/users', data)
export const updateUser       = (username, data) => request('PATCH', `/auth/users/${encodeURIComponent(username)}`, data)
export const deleteUser       = (username)   => del(`/auth/users/${encodeURIComponent(username)}`)

// Invite flow (super_admin for create/list/revoke; public for get/accept)
export const createInvite     = (data)       => post('/auth/invites', data)
export const listInvites      = ()           => get('/auth/invites')
export const revokeInvite     = (token)      => del(`/auth/invites/${token}`)
// Public — called from the AcceptInvite page (no Bearer token sent)
// Public invite endpoints — no Bearer token, so they can't go through the
// authenticated `request()` helper. Use the same normalization helpers so
// AcceptInvite still gets a ZiggyApiError it can describe with describeError.
async function _publicGet(url) {
  let res
  try { res = await fetchWithTimeout(url, { method: 'GET' }) }
  catch (err) { throw _normalizeNetworkError(err) }
  if (!res.ok) throw await _toZiggyError(res)
  return res.json()
}
async function _publicPost(url, body) {
  let res
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) { throw _normalizeNetworkError(err) }
  if (!res.ok) throw await _toZiggyError(res)
  return res.json()
}
export const getInvite        = (token)      => _publicGet(`/api/auth/invite/${token}`)
export const acceptInvite     = (token, data) => _publicPost(`/api/auth/invite/${token}/accept`, data)

// Relay API — these call the relay service (configured via RELAY_URL setting)
// relay_url is stored in settings and prepended by the relay helper below
function relayUrl() {
  return window.__RELAY_URL__ || localStorage.getItem('ziggy_relay_url') || ''
}
function relayToken() {
  return localStorage.getItem('ziggy_relay_token') || getToken()
}
async function relayRequest(method, path, body) {
  const base = relayUrl()
  if (!base) {
    throw new ZiggyApiError({ code: ErrorCode.NOT_CONFIGURED })
  }
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${relayToken()}` },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  let res
  try {
    res = await fetchWithTimeout(`${base}${path}`, opts)
  } catch (err) {
    throw _normalizeNetworkError(err)
  }
  if (!res.ok) throw await _toZiggyError(res)
  return res.json()
}
export const relayLogin       = (data)       => fetch(`${relayUrl()}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json())
export const relayListHomes   = ()           => relayRequest('GET', '/api/homes/')
export const relayGetHome     = (id)         => relayRequest('GET', `/api/homes/${id}`)
export const relayHealthHome  = (id)         => relayRequest('GET', `/api/homes/${id}/health`)
export const relayProvision   = (data)       => relayRequest('POST', '/api/provision/home', data)
export const relayDeprovision = (id)         => relayRequest('DELETE', `/api/provision/home/${id}`)
export const relayProvStatus  = (id)         => relayRequest('GET', `/api/provision/home/${id}/status`)
export const relayListInvites = ()           => relayRequest('GET', '/api/invites/')
export const relayCreateInvite= (data)       => relayRequest('POST', '/api/invites/', data)
export const relayRevokeInvite= (token)      => relayRequest('DELETE', `/api/invites/${token}`)
export const relayGetInvite   = (token)      => _publicGet(`${relayUrl()}/api/invites/${token}/info`)
export const relayRegister    = (token, data) => _publicPost(`${relayUrl()}/api/auth/register`, { ...data, invite_token: token })

// Telemetry (Prompt 2 §C). Latest raw rows for a home + daily aggregates.
// Backing endpoints: relay/app/routers/telemetry.py.
export const relayHomeTelemetry      = (id, limit = 50)  => relayRequest('GET', `/api/admin/homes/${id}/telemetry?limit=${limit}`)
export const relayHomeTelemetryDays  = (id, limit = 90)  => relayRequest('GET', `/api/admin/homes/${id}/telemetry/days?limit=${limit}`)

// OTA release catalog + per-home pin + cohorts (Prompt 2 §B / Prompt 4 chunk 2.H).
// Backing endpoints: relay/app/routers/ota.py.
export const relayOtaReleases        = ()                => relayRequest('GET', '/api/admin/ota/releases')
export const relayOtaCreateRelease   = (data)            => relayRequest('POST', '/api/admin/ota/releases', data)
export const relayHomeOtaPin         = (id)              => relayRequest('GET', `/api/admin/homes/${id}/ota-pin`)
export const relaySetHomeOtaPin      = (id, release_id)  => relayRequest('PUT', `/api/admin/homes/${id}/ota-pin`, { release_id })
export const relayOtaCohorts         = ()                => relayRequest('GET', '/api/admin/ota/cohorts')
export const relayOtaUpsertCohort    = (data)            => relayRequest('POST', '/api/admin/ota/cohorts', data)
export const relaySetHomeCohort      = (id, cohort_name) => relayRequest('PUT', `/api/admin/homes/${id}/cohort`, { cohort_name })

// Backup status + restore events (Prompt 8).
// Backing endpoint: relay/app/routers/backup_keys.py.
export const relayHomeBackupStatus   = (id)              => relayRequest('GET', `/api/homes/${id}/backup-status`)

// Founder pricing slots (Prompt 9 §F). The remaining counter is a public
// endpoint — no auth required — because the landing page also reads it.
export const relayFounderSlotsRemaining = () => _publicGet(`${relayUrl()}/api/billing/founder-slots/remaining`)

// Audit log reader (Prompt 10 chunk 3). Filters object may contain:
//   event, home_id, ok (bool), since, until, limit, offset
// Empty/undefined fields are stripped server-side; the helper just
// forwards what the caller sends.
export const relayAuditLog = (filters = {}) => {
  const q = new URLSearchParams()
  Object.entries(filters).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return
    q.append(k, String(v))
  })
  const qs = q.toString()
  return relayRequest('GET', `/api/admin/audit-log${qs ? '?' + qs : ''}`)
}

// Founder support session (Prompt 10 chunk 3, option 1). Writes audit
// row, returns the templated SSH command for the founder to run.
export const relayOpenSupportSession = (homeId, reason) =>
  relayRequest('POST', `/api/admin/homes/${homeId}/support-session`, { reason: reason || undefined })

// Per-home paired mobile devices (Prompt 10 chunk 3). Proxies into the
// home backend with X-Relay-Role=relay_admin so the full device list
// comes back rather than the caller's own.
export const relayHomeMobileDevices = (homeId) =>
  relayRequest('GET', `/api/admin/homes/${homeId}/mobile-devices`)

export function setRelayUrl(url) { localStorage.setItem('ziggy_relay_url', url) }
export function setRelayToken(token) { localStorage.setItem('ziggy_relay_token', token) }
export function getRelayUrl() { return relayUrl() }
export function isRelayConfigured() { return !!relayUrl() }

// Admin settings
export const getHaSettings = () => get('/settings/ha')
export const patchHaSettings = (data) => patch('/settings/ha', data)
// Web push
export const getPushVapidKey       = ()       => get('/push/vapid-public-key')
export const subscribePush         = (sub)    => post('/push/subscribe', sub)
export const unsubscribePush       = (ep)     => del('/push/subscribe', { endpoint: ep })
export const testPushNotification  = ()       => post('/push/test', {})
export const getPushPreferences    = ()       => get('/push/preferences')
export const patchPushPreferences  = (data)   => patch('/push/preferences', data)
export const getPushDevices        = ()       => get('/push/devices')
export const revokePushDevice      = (ep)     => del('/push/subscribe', { endpoint: ep })
export const getIntegrationsSettings = () => get('/settings/integrations')
export const patchIntegrationsSettings = (data) => patch('/settings/integrations', data)
export const getEntityHistory = (entityId, hours = 24) =>
  get(`/devices/${encodeURIComponent(entityId)}/history?hours=${hours}`)
export const getFeaturesSettings = () => get('/settings/features')
export const patchFeaturesSettings = (data) => patch('/settings/features', data)
export const getDebugSettings = () => get('/settings/debug')
export const patchDebugSettings = (data) => patch('/settings/debug', data)
export const getOllamaSettings = () => get('/settings/ollama')
export const patchOllamaSettings = (data) => patch('/settings/ollama', data)
export const getPatternLearningSettings = () => get('/settings/pattern-learning')
export const patchPatternLearningSettings = (data) => patch('/settings/pattern-learning', data)
export const getRoomAliases = () => get('/settings/room-aliases')
export const patchRoomAliases = (data) => patch('/settings/room-aliases', data)

// Email (SMTP)
export const getEmailSettings  = ()     => get('/settings/email')
export const patchEmailSettings = (data) => patch('/settings/email', data)
export const testEmail          = ()     => post('/settings/email/test')

// System health — HA connectivity, offline devices, battery warnings
export const getHealth  = () => get('/health')
export const reloadZigbee = () => post('/health/reload-zigbee')
// Layered system_health (services/ha_health.py) — user-tapped Retry runs one
// reload attempt ignoring the auto-recovery cooldown. acknowledgeOfflineDevices
// records "It's OK, I know these are off"; the server invalidates the ack when
// new devices go offline or share crosses 80%.
export const recoverHealth          = ()            => post('/health/recover')
export const acknowledgeOffline     = (offlineIds)  => post('/health/acknowledge-offline', { offline_ids: offlineIds || [] })

// Debug mode
export const getDebugConfig   = ()       => get('/debug/config')
export const setDebugConfig   = (data)   => post('/debug/config', data)
export const getDebugEvents   = (params) => {
  const qs = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  return get(`/debug/events${qs ? '?' + qs : ''}`)
}
export const clearDebugEvents  = ()       => request('DELETE', '/debug/events')
export const exportDebugReport = ()       => get('/debug/export')
export const getDebugStatus    = ()       => get('/debug/status')
export const simulateIntent    = (data)   => post('/debug/simulate', data)
export const getRequestTrace   = (reqId)  => get(`/debug/request/${encodeURIComponent(reqId)}`)
export const debugSelfTest     = ()       => post('/debug/self-test')

// Memory
export const getMemory = () => get('/memory')

// Presence — Ziggy-native person tracking
export const getPresencePersons       = ()             => get('/presence/persons')
export const createPresencePerson     = (name)         => post('/presence/persons', { name })
export const deletePresencePerson     = (id)           => del(`/presence/persons/${id}`)
export const overridePresenceState    = (id, state)    => patch(`/presence/persons/${id}/state`, { state })
export const getPresenceZone          = ()             => get('/presence/zone')
export const savePresenceZone         = (data)         => patch('/presence/zone', data)
export const getMyPresencePerson      = ()             => get('/presence/my-person')
export const getPresenceDebug         = ()             => get('/presence/debug')
export const setPresenceLanHost       = (id, host)     => patch(`/presence/persons/${id}/lan-host`, { lan_host: host })
export const pingMePresence           = (lat, lon, accuracy, ts) => post('/presence/me/ping', { lat, lon, accuracy, ts })

// Extra geofence zones (beyond the primary "Home" zone, which lives in /presence/zone)
export const listPresenceZones        = ()          => get('/presence/zones')
export const createPresenceZone       = (data)      => post('/presence/zones', data)
export const updatePresenceZone       = (id, data)  => patch(`/presence/zones/${id}`, data)
export const deletePresenceZone       = (id)        => del(`/presence/zones/${id}`)

// Sensor alert conditions
export const getSensorAlertsSettings  = ()     => get('/settings/sensor-alerts')
export const patchSensorAlertsSettings= (data) => patch('/settings/sensor-alerts', data)

// Push categories (dynamic)
export const getPushCategories = () => get('/push/categories')

// Anomaly rules
export const getAnomalyRules   = ()     => get('/settings/anomaly-rules')
export const patchAnomalyRules = (data) => patch('/settings/anomaly-rules', data)

// Direct HA service call — use only for advanced controls (brightness, climate, media)
export const callHaService = (domain, service, data) =>
  post('/ha/service', { domain, service, data })

// UI device toggle — deterministic on/off path with WS broadcast + pattern logging
export const controlDevice = (entityId, action, source = 'web') =>
  post('/ha/control', { entity_id: entityId, action, source })

// Capabilities catalog
export const getCapabilities = () => get('/capabilities')

// Dynamic per-device command catalog — every HA service the entity supports,
// merged with linked IR commands. Used by the "More Commands" panel and the
// automation/routine builder.
export const getDeviceCommands = (entityId) =>
  get(`/devices/${encodeURIComponent(entityId)}/commands`)
export const executeDeviceCommand = (entityId, commandId, params, preferSource) =>
  post(`/devices/${encodeURIComponent(entityId)}/commands`, {
    command_id: commandId,
    params: params || {},
    prefer_source: preferSource || null,
  })

// Virtual devices
export const getVirtualDevices = (room) =>
  get(room ? `/virtual-devices?room=${encodeURIComponent(room)}` : '/virtual-devices')
export const getVirtualDevice = (id) => get(`/virtual-devices/${id}`)
export const createVirtualDevice = (data) => post('/virtual-devices', data)
export const patchVirtualDevice = (id, data) => patch(`/virtual-devices/${id}`, data)
export const deleteVirtualDevice = (id) => del(`/virtual-devices/${id}`)
export const triggerVirtualDevice = (id, params) => post(`/virtual-devices/${id}/trigger`, { params: params || null })

// Events
export const getEvents = () => get('/events')
export const createEvent = (data) => post('/events', data)
export const deleteEvent = (name) => del(`/events/${encodeURIComponent(name)}`)

// IR Blaster / IR Devices
// Blaster registry CRUD — first-class hardware records (id, name, room,
// mac, ip, status). Used by the Blasters admin UI and the IR Wizard's
// pick-and-name flow. Backed by user_files/ir_blasters.json.
export const listIrBlasters     = ()      => get('/ir/blasters').then((r) => r.blasters ?? [])
export const getIrBlaster       = (id)    => get(`/ir/blasters/${encodeURIComponent(id)}`)
export const createIrBlaster    = (data)  => post('/ir/blasters', data)
export const patchIrBlaster     = (id, d) => patch(`/ir/blasters/${encodeURIComponent(id)}`, d)
export const deleteIrBlaster    = (id, cascade = false) =>
  del(`/ir/blasters/${encodeURIComponent(id)}${cascade ? '?cascade=true' : ''}`)

// Legacy: HA `remote.*` entity list. Kept for the rare flow that needs to
// link a registry blaster to its HA-side integration entity. Most callers
// should use `listIrBlasters()` above.
export const getHaRemoteEntities = () => get('/ir/ha-remotes').then((r) => r.blasters ?? r)
// Back-compat alias — original name some callers may still import.
export const getIrBlasters = listIrBlasters
// Scan local network for Broadlink devices (takes ~6s)
export const discoverIrBlasters = () => get('/ir/discover').then((r) => r.devices ?? r)
export const getIrDevices = (room) =>
  get(room ? `/ir/devices?room=${encodeURIComponent(room)}` : '/ir/devices').then((r) => r.devices ?? r)
export const getIrDevice = (id) => get(`/ir/devices/${id}`)
export const createIrDevice = (data) => post('/ir/devices', data)
export const patchIrDevice = (id, data) => patch(`/ir/devices/${id}`, data)
export const deleteIrDevice = (id) => del(`/ir/devices/${id}`)
export const irLearn = (deviceId, commandName) =>
  post('/ir/learn', { device_id: deviceId, command_name: commandName })
export const irSend = (deviceId, command) =>
  post('/ir/send', { device_id: deviceId, command })
export const irSendChannel = (deviceId, channel) =>
  post(`/ir/devices/${deviceId}/channel`, { channel })
export const irSetAcTemperature = (deviceId, temperature, mode) =>
  post(`/ir/devices/${deviceId}/ac/temperature`, mode ? { temperature, mode } : { temperature })
export const getIrListenerStatus = () => get('/ir/listener/status')

// Command catalog — per-type groups + commands + core/optional flags.
// Used by the learn UI to render the slot list and by remotes to label
// custom-command chips correctly.
export const getIrCatalog = (deviceType) =>
  get(deviceType ? `/ir/catalog?device_type=${encodeURIComponent(deviceType)}` : '/ir/catalog').then((r) => r.catalog ?? r)

// User-defined commands (free-form). `id` is a slug; `label` is the
// display name (defaults to a Title Case of the id if omitted).
export const irAddCustomCommand = (deviceId, id, label) =>
  post(`/ir/devices/${deviceId}/custom-command`, label ? { id, label } : { id })
export const irRemoveCustomCommand = (deviceId, commandId) =>
  del(`/ir/devices/${deviceId}/custom-command/${encodeURIComponent(commandId)}`)

// Sequences (macros). `steps` is a list of { command, delay_after_ms }.
export const irSaveSequence = (deviceId, name, steps) =>
  post(`/ir/devices/${deviceId}/sequences`, { name, steps })
export const irDeleteSequence = (deviceId, name) =>
  del(`/ir/devices/${deviceId}/sequences/${encodeURIComponent(name)}`)
export const irRunSequence = (deviceId, name) =>
  post(`/ir/devices/${deviceId}/sequences/${encodeURIComponent(name)}/run`)

// IR Unassigned Signals — physical-remote presses that didn't match any device.
// The Devices page lists these and lets the user bind each to (device, command).
export const getIrUnassignedSignals = () => get('/ir/unassigned-signals').then((r) => r.signals ?? r)
export const assignIrUnassignedSignal = (signalId, deviceId, commandName) =>
  post(`/ir/unassigned-signals/${signalId}/assign`, { device_id: deviceId, command_name: commandName })
export const dismissIrUnassignedSignal = (signalId) => del(`/ir/unassigned-signals/${signalId}`)
export const clearIrUnassignedSignals = () => del('/ir/unassigned-signals')

// IR device state + confidence (live)
export const getIrDeviceState = (deviceId) => get(`/ir/devices/${deviceId}/state`)

// Quick Asks
export const getQuickAsks = () => get('/quick-asks')
export const createQuickAsk = (data) => post('/quick-asks', data)
export const updateQuickAsk = (id, data) => patch(`/quick-asks/${id}`, data)
export const deleteQuickAsk = (id) => del(`/quick-asks/${id}`)
export const sendDirectIntent = (intent, params = {}, source = 'web') =>
  post('/direct-intent', { intent, params, source })

// Pattern Learning — Suggestions
export const getSuggestions = () => get('/suggestions')
export const getPendingSuggestions = () => get('/suggestions/pending')
export const acceptSuggestion = (id) => post(`/suggestions/${id}/accept`)
export const rejectSuggestion = (id) => post(`/suggestions/${id}/reject`)
export const snoozeSuggestion = (id, days = 3) => post(`/suggestions/${id}/snooze`, { days })
export const runPatternAnalysis = () => post('/suggestions/analyze')
// Unified Suggested-tab feed (habits + device templates). Single fetch;
// items are discriminated by `source: 'habit' | 'template'`. Both legacy
// endpoints above keep working as a fallback.
export const getSuggestionsFeed = () => get('/suggestions/feed')

// Home Map (visualizer)
export const getMapRoomsSummary = () => get('/map/rooms/summary')
export const getMapCanvas = () => get('/map/canvas')
export const putMapCanvasPosition = (roomId, position) => request('PUT', `/map/canvas/${encodeURIComponent(roomId)}`, position)
export const getActiveAnomalies = () => get('/map/anomalies/active')
export const getAnomalyHistory  = (limit = 50) => get(`/map/anomalies/history?limit=${limit}`)
export const getMapRender = () => get('/map/render')
export const triggerMapRender = (rooms) => post('/map/render/generate', { rooms })
export const snoozeMapAnomaly = (roomId, ruleId, durationMinutes = 60) =>
  post(`/map/anomalies/snooze/${encodeURIComponent(roomId)}/${encodeURIComponent(ruleId)}`, { duration_minutes: durationMinutes })
export const executeAnomalyAction = (roomId, ruleId) =>
  post(`/map/anomalies/action/${encodeURIComponent(roomId)}/${encodeURIComponent(ruleId)}`, {})

// HA Update Checker
export const getUpdateStatus   = ()        => get('/update/status')
export const forceUpdateCheck  = ()        => post('/update/check', {})
export const dismissUpdate     = (version) => post('/update/dismiss', { version })
export const getUpdateHistory  = ()        => get('/update/history')

// Cameras
export const getCameras = () => get('/cameras')
export const getCameraMotionEvents = (hours = 24) => get(`/cameras/motion?hours=${hours}`)
export const cameraSnapshotUrl = (entityId) => `/api/cameras/${encodeURIComponent(entityId)}/snapshot`
export const cameraStreamUrl   = (entityId) => `/api/cameras/${encodeURIComponent(entityId)}/stream`

// ---------------------------------------------------------------------------
// Media / music (v2) — automation-only playback + tablet hub widget.
// Every endpoint flag-gated server-side. 404 → feature disabled.
// ---------------------------------------------------------------------------
export const getMediaCapabilities  = () => get('/media/capabilities')

// Speakers
export const listSpeakers          = () => get('/media/speakers')
export const patchSpeaker          = (entityId, body) => patch(`/media/speakers/${encodeURIComponent(entityId)}`, body)
export const deleteSpeaker         = (entityId) => del(`/media/speakers/${encodeURIComponent(entityId)}`)

// Profiles
export const listMusicProfiles     = () => get('/media/profiles')

// Spotify
export const spotifyStatus         = (member) => get(`/media/spotify/status?member=${encodeURIComponent(member)}`)
export const spotifyConnectStart   = (member) => post('/media/spotify/connect/start', { member })
export const spotifyDisconnect     = (member) => post('/media/spotify/disconnect', { member })
export const spotifySearch         = (member, q, kind = 'track,playlist,album', limit = 8) =>
  get(`/media/spotify/search?member=${encodeURIComponent(member)}&q=${encodeURIComponent(q)}&kind=${encodeURIComponent(kind)}&limit=${limit}`)
export const spotifyPlaylists      = (member) => get(`/media/spotify/playlists?member=${encodeURIComponent(member)}`)

// YouTube Music
export const ytmusicStatus         = (member) => get(`/media/ytmusic/status?member=${encodeURIComponent(member)}`)
export const ytmusicConnect        = (member, headersJson) => post('/media/ytmusic/connect', { member, headers_json: headersJson })
export const ytmusicDisconnect     = (member) => post('/media/ytmusic/disconnect', { member })
export const ytmusicSearch         = (member, q, limit = 8) =>
  get(`/media/ytmusic/search?member=${encodeURIComponent(member)}&q=${encodeURIComponent(q)}&limit=${limit}`)
export const ytmusicPlaylists      = (member) => get(`/media/ytmusic/playlists?member=${encodeURIComponent(member)}`)

// Play / transport (used by automation "test play", hub widget transport)
export const playMedia             = (body) => post('/media/play', body)
export const pauseMedia            = (speakerEntity) => post('/media/pause',   { speaker_entity: speakerEntity })
export const resumeMedia           = (speakerEntity) => post('/media/resume',  { speaker_entity: speakerEntity })
export const nextMedia             = (speakerEntity) => post('/media/next',    { speaker_entity: speakerEntity })
export const prevMedia             = (speakerEntity) => post('/media/previous',{ speaker_entity: speakerEntity })
export const setMediaVolume        = (speakerEntity, level) => post('/media/volume', { speaker_entity: speakerEntity, level })
export const getMediaState         = () => get('/media/state')

export const mediaDiagnostics      = () => get('/media/diagnostics')
