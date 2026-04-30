const BASE = '/api'

async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

const get = (path) => request('GET', path)
const post = (path, body) => request('POST', path, body)
const patch = (path, body) => request('PATCH', path, body)
const del = (path) => request('DELETE', path)

// Intent / Voice
export const sendIntent = (text, source = 'web') => post('/intent', { text, source })

export async function sendVoice(blob) {
  const fd = new FormData()
  fd.append('file', blob, 'recording.webm')
  const res = await fetch(`${BASE}/voice`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// Devices / HA entities
export const getEntities = (domain) =>
  get(domain ? `/ha/entities?domain=${domain}` : '/ha/entities')
export const getEntityState = (entityId) => get(`/ha/state/${entityId}`)
export const getDeviceMap = () => get('/devices')
export const getZiggyDevices = () => get('/devices')
export const saveDevice = (data) => post('/devices', data)
export const removeDevice = (room, dtype) => del(`/devices/${room}/${dtype}`)

// Entity ↔ Area assignment
export const assignEntityToArea = (entityId, areaId) =>
  patch(`/ha/entity/${encodeURIComponent(entityId)}/area`, { area_id: areaId ?? null })

// Device ↔ Area assignment (device-level, shows in HA device page)
export const assignDeviceToArea = (deviceId, areaId) =>
  patch(`/ha/devices/${encodeURIComponent(deviceId)}/area`, { area_id: areaId ?? null })

// Rooms — backed by HA Areas
export const getRooms = () => get('/rooms')
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
export const getAutomations = () => get('/automations')
export const getAutomation = (id) => get(`/automations/${id}`)
export const createAutomation = (data) => post('/automations', data)
export const toggleAutomation = (id, enabled) => patch(`/automations/${id}/toggle`, { enabled })
export const triggerAutomation = (id) => post(`/automations/${id}/trigger`)
export const deleteAutomation = (id) => del(`/automations/${id}`)

// Routines — backed by HA Scripts
export const getRoutines = () => get('/routines')
export const getRoutine = (id) => get(`/routines/${id}`)
export const createRoutine = (data) => post('/routines', data)
export const runRoutine = (id) => post(`/routines/${id}/run`)
export const deleteRoutine = (id) => del(`/routines/${id}`)

// ZHA pairing
export const zhaPermit = (duration = 60) => post('/ha/zha/permit', { duration })
export const getHaDevices = () => get('/ha/devices')
export const getDeviceEntities = (deviceId) => get(`/ha/devices/${encodeURIComponent(deviceId)}/entities`)
export const renameHaDevice = (deviceId, name) => patch(`/ha/devices/${encodeURIComponent(deviceId)}/rename`, { name })

// Multi-protocol pairing
export const zwaveInclude = () => post('/ha/zwave/include')
export const zwaveStop = () => post('/ha/zwave/stop')
export const matterCommission = (code) => post('/ha/matter/commission', { code })
export const getConfigFlows = (protocol) =>
  get(protocol ? `/ha/config_flows?protocol=${protocol}` : '/ha/config_flows')

// Scenes — HA scenes
export const getScenes = () => get('/ha/scenes')
export const activateScene = (entityId) => post('/ha/scenes/activate', { entity_id: entityId })

// Settings
export const getStatus = () => get('/status')
export const getVoiceSettings = () => get('/settings/voice')
export const patchVoiceSettings = (data) => patch('/settings/voice', data)
export const getAlertSettings = () => get('/settings/alerts')

// Memory
export const getMemory = () => get('/memory')

// Direct HA service call — use only for advanced controls (brightness, climate, media)
export const callHaService = (domain, service, data) =>
  post('/ha/service', { domain, service, data })

// UI device toggle — deterministic on/off path with WS broadcast + pattern logging
export const controlDevice = (entityId, action, source = 'web') =>
  post('/ha/control', { entity_id: entityId, action, source })

// Capabilities catalog
export const getCapabilities = () => get('/capabilities')

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
export const getIrBlasters = () => get('/ir/blasters').then((r) => r.blasters ?? r)
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
