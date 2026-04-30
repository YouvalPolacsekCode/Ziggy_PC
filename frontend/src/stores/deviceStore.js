import { create } from 'zustand'
import { getEntities, getRooms, getZiggyDevices, getRoomsWithDevices } from '../lib/api'

export const CONTROLLABLE_DOMAINS = new Set([
  'light', 'switch', 'climate', 'cover', 'media_player', 'fan', 'lock', 'vacuum',
])

const HIDDEN_KEY = 'ziggy_hidden_entities'
const loadHidden = () => { try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')) } catch { return new Set() } }
const saveHidden = (s) => localStorage.setItem(HIDDEN_KEY, JSON.stringify([...s]))

export const useDeviceStore = create((set, get) => ({
  // HA entity browser (Devices page)
  entities: [],
  // HA areas (used by Devices page for room assignment UI)
  rooms: [],
  // DeviceRegistry status overlay (entity_id → status)
  deviceStatusMap: {},
  // DeviceRegistry rooms with enriched devices (Rooms page)
  ziggyRooms: [],
  // Unclaimed devices (no room assigned in Ziggy)
  unclaimedDevices: [],

  loading: false,
  error: null,
  lastUpdated: null,
  hiddenEntities: loadHidden(),
  showHidden: false,

  hideEntity: (entityId) => {
    const next = new Set(get().hiddenEntities)
    next.add(entityId)
    saveHidden(next)
    set({ hiddenEntities: next })
  },

  unhideEntity: (entityId) => {
    const next = new Set(get().hiddenEntities)
    next.delete(entityId)
    saveHidden(next)
    set({ hiddenEntities: next })
  },

  toggleShowHidden: () => set((s) => ({ showHidden: !s.showHidden })),

  fetchAll: async () => {
    set({ loading: true, error: null })
    try {
      const [entRes, roomsRes, roomsDevRes] = await Promise.all([
        getEntities(),
        getRooms(),
        getRoomsWithDevices().catch(() => ({ rooms: [], unclaimed: [] })),
      ])
      const statusMap = {}
      for (const room of (roomsDevRes.rooms || [])) {
        for (const d of (room.devices || [])) {
          if (d.entity_id) statusMap[d.entity_id] = d.status
        }
      }
      for (const d of (roomsDevRes.unclaimed || [])) {
        if (d.entity_id) statusMap[d.entity_id] = d.status
      }
      set({
        entities: entRes.entities || [],
        rooms: roomsRes.rooms || [],
        deviceStatusMap: statusMap,
        ziggyRooms: roomsDevRes.rooms || [],
        unclaimedDevices: roomsDevRes.unclaimed || [],
        loading: false,
        lastUpdated: Date.now(),
      })
    } catch (e) {
      set({ loading: false, error: e.message })
    }
  },

  updateEntityState: (entityId, state, attributes = {}) => {
    set((s) => ({
      entities: s.entities.map((e) =>
        e.entity_id === entityId ? { ...e, state, ...attributes } : e
      ),
      ziggyRooms: s.ziggyRooms.map((r) => ({
        ...r,
        devices: r.devices.map((d) =>
          d.entity_id === entityId ? { ...d, ha_state: state, ...attributes } : d
        ),
      })),
    }))
  },

  // For Devices page: HA entities not in any HA area
  getUnassigned: () => {
    const DEVICE_DOMAINS = new Set([
      'light', 'switch', 'climate', 'cover', 'media_player',
      'fan', 'lock', 'sensor', 'binary_sensor', 'camera',
      'vacuum', 'input_boolean',
    ])
    const { rooms, entities } = get()
    const assigned = new Set(rooms.flatMap((r) => r.entities || []))
    return entities.filter(
      (e) => DEVICE_DOMAINS.has(e.domain) && !assigned.has(e.entity_id)
    )
  },

  getActiveCount: () =>
    get().entities.filter((e) => CONTROLLABLE_DOMAINS.has(e.domain) && e.state === 'on').length,

  getTotalControllable: () =>
    get().entities.filter((e) => CONTROLLABLE_DOMAINS.has(e.domain)).length,

  getUnavailableCount: () =>
    get().entities.filter((e) => e.state === 'unavailable').length,

  getPresenceSummary: () => {
    const { entities } = get()
    const results = []
    for (const e of entities) {
      if (e.domain === 'person' && e.state === 'home') {
        const name = (e.friendly_name || e.entity_id.split('.')[1]).replace(/_/g, ' ')
        results.push(`${name} is home`)
      }
    }
    for (const e of entities) {
      if (e.domain !== 'binary_sensor') continue
      if (!['occupancy', 'presence', 'motion'].includes(e.device_class)) continue
      if (e.state !== 'on') continue
      const raw = (e.friendly_name || e.entity_id.split('.')[1]).replace(/_/g, ' ')
      const room = raw.replace(/\s+(Motion Occupancy|Occupancy|Motion|Presence|Sensor)$/i, '').trim()
      results.push(`Someone is in the ${room}`)
    }
    for (const e of entities) {
      if (e.domain !== 'sensor') continue
      const id = e.entity_id.toLowerCase()
      if (!id.includes('presence') && !id.includes('occupancy')) continue
      if (e.state === 'occupied') {
        const room = (e.friendly_name || id.split('.')[1]).replace(/_/g, ' ')
        results.push(`${room} is occupied`)
      }
    }
    return results
  },

  // For Devices page: HA entity objects enriched with room data (legacy join, kept for entity browser)
  getRooms: () => {
    const { rooms, entities } = get()
    const entityMap = Object.fromEntries(entities.map((e) => [e.entity_id, e]))
    return rooms.map((area) => {
      const entityIds = (area.entities || []).filter(Boolean)
      const roomEntities = entityIds
        .filter((eid) => entityMap[eid])
        .map((eid) => entityMap[eid])
      const activeCount = roomEntities.filter((e) => e.state === 'on').length
      return {
        id: area.id,
        name: area.name,
        entityCount: roomEntities.length,
        activeCount,
        entities: roomEntities,
      }
    })
  },
}))
