import { create } from 'zustand'
import { getEntities, getRooms, getZiggyDevices, getRoomsWithDevices, getIrDevices } from '../lib/api'
import { CONTROLLABLE_DOMAINS, TOGGLEABLE_DOMAINS, DOMAIN_REGISTRY } from '../lib/domainRegistry'

export { CONTROLLABLE_DOMAINS }

// IR device type → HA-compatible domain (mirrors backend _IR_TYPE_TO_DOMAIN).
// Kept as a static map here because IR types are a fixed Ziggy concept,
// not tied to the HA domain registry.
const IR_TYPE_TO_DOMAIN = {
  tv:        'media_player',
  soundbar:  'media_player',
  projector: 'media_player',
  ac:        'climate',
  fan:       'fan',
  custom:    'switch',
}

// Transform a raw IR device object into an entity-shaped object so it can live
// in the same entities array as HA entities and respond to the same filters.
function irToEntity(ir) {
  return {
    entity_id:    `ir.${ir.id}`,
    state:        ir.assumed_state || 'unknown',
    domain:       IR_TYPE_TO_DOMAIN[ir.type] || 'switch',
    display_name: ir.name,
    friendly_name: ir.name,
    // IR-specific fields — used by IRDeviceCard / IRQuickControls
    _ir:             true,
    _irDevice:       ir,
    // Mirror the attributes that DeviceControls might read
    commands:        ir.commands || {},
    learned_commands: ir.learned_commands || [],
    assumed_state:   ir.assumed_state,
    ac_memory:       ir.ac_memory,
    capabilities:    ir.capabilities || [],
  }
}

const HIDDEN_KEY = 'ziggy_hidden_entities'
const loadHidden = () => { try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')) } catch { return new Set() } }
const saveHidden = (s) => localStorage.setItem(HIDDEN_KEY, JSON.stringify([...s]))

export const useDeviceStore = create((set, get) => ({
  // Unified entity list — HA entities + IR-shaped entities
  entities: [],
  // HA areas (used by Devices page for room assignment UI)
  rooms: [],
  // DeviceRegistry status overlay (entity_id → status)
  deviceStatusMap: {},
  // DeviceRegistry rooms with enriched devices (Rooms page)
  ziggyRooms: [],
  // Unclaimed devices (status=UNCLAIMED — new HA entities not yet placed)
  unclaimedDevices: [],
  // Devices intentionally left without a room (room=null, non-UNCLAIMED)
  noRoomDevices: [],

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
      const [entRes, roomsRes, roomsDevRes, irRaw] = await Promise.all([
        getEntities(),
        getRooms(),
        getRoomsWithDevices().catch(() => ({ rooms: [], unclaimed: [] })),
        getIrDevices().catch(() => []),
      ])

      // Build status map from device registry
      const statusMap = {}
      for (const room of (roomsDevRes.rooms || [])) {
        for (const d of (room.devices || [])) {
          if (d.entity_id) statusMap[d.entity_id] = d.status
          if (d.ir_device_id && !d.entity_id) {
            statusMap[`ir.${d.ir_device_id}`] = d.status
          }
        }
      }
      for (const d of (roomsDevRes.unclaimed || [])) {
        if (d.entity_id) statusMap[d.entity_id] = d.status
      }
      for (const d of (roomsDevRes.no_room || [])) {
        if (d.entity_id) statusMap[d.entity_id] = d.status
        if (d.ir_device_id && !d.entity_id) statusMap[`ir.${d.ir_device_id}`] = d.status
      }

      // ── IR ↔ HA entity linking ────────────────────────────────────────────
      const irList = Array.isArray(irRaw) ? irRaw : []
      const haEntityIdSet = new Set((entRes.entities || []).map((e) => e.entity_id))

      // Index IR devices by their linked HA entity — but ONLY when that HA entity
      // actually exists in the current entity list. If the HA entity is unavailable
      // or deleted, the IR device falls back to appearing as a standalone card.
      const irByHaEntityId = {}
      for (const ir of irList) {
        if (ir.ha_entity_id && haEntityIdSet.has(ir.ha_entity_id)) {
          irByHaEntityId[ir.ha_entity_id] = ir
        }
      }
      const linkedIrIds = new Set(Object.values(irByHaEntityId).map((ir) => ir.id))

      // Attach linked IR to each HA entity (null if no link)
      const haEntities = (entRes.entities || []).map((e) => ({
        ...e,
        _linkedIr: irByHaEntityId[e.entity_id] || null,
      }))

      // Standalone IR entities: those NOT currently merged into an HA entity card
      const irEntities = irList.filter((ir) => !linkedIrIds.has(ir.id)).map(irToEntity)

      const allEntities = [...haEntities, ...irEntities]

      set({
        entities: allEntities,
        rooms: roomsRes.rooms || [],
        deviceStatusMap: statusMap,
        ziggyRooms: roomsDevRes.rooms || [],
        unclaimedDevices: roomsDevRes.unclaimed || [],
        noRoomDevices: roomsDevRes.no_room || [],
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

  // Update IR device assumed state optimistically in the entity list
  updateIrAssumedState: (irId, newState) => {
    set((s) => ({
      entities: s.entities.map((e) =>
        e._ir && e._irDevice?.id === irId
          ? { ...e, state: newState, assumed_state: newState, _irDevice: { ...e._irDevice, assumed_state: newState } }
          : e
      ),
    }))
  },

  // Unassigned: status=UNCLAIMED entities — new HA devices not yet placed in Ziggy.
  // Distinct from "No Room" (intentionally left without a room).
  getUnassigned: () => {
    const { unclaimedDevices, entities } = get()
    const unclaimedIds = new Set(unclaimedDevices.map((d) => d.entity_id).filter(Boolean))
    return entities.filter((e) => !e._ir && unclaimedIds.has(e.entity_id))
  },

  // No Room: room=null, non-UNCLAIMED — intentionally left without a room assignment.
  getNoRoom: () => {
    const { noRoomDevices, entities } = get()
    const noRoomIds = new Set(noRoomDevices.map((d) => d.entity_id).filter(Boolean))
    return entities.filter((e) => !e._ir && noRoomIds.has(e.entity_id))
  },

  getActiveCount: () =>
    get().entities.filter((e) => {
      if (!CONTROLLABLE_DOMAINS.has(e.domain)) return false
      const meta = DOMAIN_REGISTRY[e.domain]
      if (meta?.activeStates?.length) return meta.activeStates.includes(e.state)
      return e.state === 'on'
    }).length,

  getTotalControllable: () =>
    get().entities.filter((e) => CONTROLLABLE_DOMAINS.has(e.domain)).length,

  getUnavailableCount: () =>
    get().entities.filter((e) => !e._ir && e.state === 'unavailable').length,

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
    // Deduplicate — multiple sensors in the same room can produce identical strings
    return [...new Set(results)]
  },

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
