import { create } from 'zustand'
import { getEntities, getRooms, getZiggyDevices, getRoomsWithDevices, getIrDevices, getUiPrefs, putUiPrefs, getDeviceGroups, withRetry } from '../lib/api'
import { CONTROLLABLE_DOMAINS, TOGGLEABLE_DOMAINS, DOMAIN_REGISTRY } from '../lib/domainRegistry'
import { entityDisplayName } from '../lib/utils'

export { CONTROLLABLE_DOMAINS }

// IR device type → HA-compatible domain (mirrors backend _IR_TYPE_TO_DOMAIN).
// Kept as a static map here because IR types are a fixed Ziggy concept,
// not tied to the HA domain registry.
const IR_TYPE_TO_DOMAIN = {
  tv:        'media_player',
  soundbar:  'media_player',
  receiver:  'media_player',
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

// User-chosen Dashboard quick controls — array of up to 4 entity_ids.
// Empty array = "auto-pick" (the legacy first-light/climate/media/lock logic).
const QUICK_KEY = 'ziggy_quick_controls'
const QUICK_MAX = 4
const loadQuick = () => {
  try {
    const arr = JSON.parse(localStorage.getItem(QUICK_KEY) || '[]')
    return Array.isArray(arr) ? arr.slice(0, QUICK_MAX).filter(Boolean) : []
  } catch { return [] }
}
const saveQuick = (ids) => localStorage.setItem(QUICK_KEY, JSON.stringify(ids))

// Dashboard "Shortcuts" — merged Routines + Quick Asks, up to 8 (2 rows × 4).
// Stored as [{type: 'routine' | 'ask', id: string}, ...] in pin order.
const SHORTCUTS_KEY = 'ziggy_dashboard_shortcuts'
const SHORTCUTS_MAX = 8
const loadShortcuts = () => {
  try {
    const arr = JSON.parse(localStorage.getItem(SHORTCUTS_KEY) || '[]')
    return Array.isArray(arr)
      ? arr.slice(0, SHORTCUTS_MAX).filter(s => s && (s.type === 'routine' || s.type === 'ask') && s.id)
      : []
  } catch { return [] }
}
const saveShortcuts = (arr) => localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(arr))
export const SHORTCUTS_MAX_COUNT = SHORTCUTS_MAX
export const QUICK_CONTROLS_MAX = QUICK_MAX

// User-defined room display order — array of room IDs. Rooms not in the list
// fall to the end in their natural (server) order. Empty = no preference.
// Cap mirrors the backend (_MAX_ROOMS_ORDER) so a single user can't store a
// pathological array.
const ROOMS_ORDER_KEY = 'ziggy_rooms_order'
const ROOMS_ORDER_MAX = 64
const cleanRoomsOrder = (arr) => {
  if (!Array.isArray(arr)) return []
  const seen = new Set()
  const out = []
  for (const x of arr) {
    if (!x) continue
    const s = String(x)
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= ROOMS_ORDER_MAX) break
  }
  return out
}
const loadRoomsOrder = () => {
  try { return cleanRoomsOrder(JSON.parse(localStorage.getItem(ROOMS_ORDER_KEY) || '[]')) }
  catch { return [] }
}
const saveRoomsOrder = (ids) => localStorage.setItem(ROOMS_ORDER_KEY, JSON.stringify(ids))

// Returns `entity` enriched with `_group` metadata when it's the primary of a
// real multi-entity group; returns `null` when the entity is a non-primary
// sibling that should drop out of the visible list; returns the entity
// unchanged when no grouping info is available (solo or HA registry empty).
function _attachGroup(entity, groupByEntityId, groupById) {
  if (!entity || !entity.entity_id) return entity
  const g = groupById[groupByEntityId[entity.entity_id]]
  if (!g) return entity
  if (entity.entity_id !== g.primary_entity_id) return null
  return {
    ...entity,
    _group: {
      group_id:     g.group_id,
      kind:         g.kind,
      name:         g.name,
      room:         g.room,
      ha_device_id: g.ha_device_id,
      ir_device_id: g.ir_device_id,
      entities:     g.entities || [],
      metrics:      g.metrics || [],
      // Phase 1: backend-projected capability map. Frontend remotes (TVRemote,
      // MediaTransportRemote, etc.) read this instead of re-deriving from
      // supported_features / source_list / paired-remote heuristics.
      capabilities: g.capabilities || null,
      hasMultiple:  (g.entities || []).length > 1,
    },
  }
}

// Pure helper — apply a saved roomsOrder to any rooms-like array. Saved IDs
// move to the front in saved order; unsaved IDs keep their input order at the
// end. ALWAYS returns a fresh array, never the input ref — so callers that
// follow up with .sort() can safely sort in-place without mutating the
// upstream store. Used by Rooms page for the visible grid and by Dashboard
// as the tiebreaker beneath the activity-first sort.
export function applyRoomsOrder(rooms, roomsOrder) {
  if (!Array.isArray(rooms)) return []
  if (rooms.length === 0) return []
  if (!Array.isArray(roomsOrder) || roomsOrder.length === 0) return rooms.slice()
  const idx = new Map()
  roomsOrder.forEach((id, i) => { if (id != null) idx.set(String(id), i) })
  const TAIL = Number.MAX_SAFE_INTEGER
  // Pair with original index so unsaved rooms keep their natural order — plain
  // Array.sort would not preserve insertion order across V8's TimSort tiebreaks
  // for items returning the same key (it's stable per spec, but we still need
  // a deterministic key for the saved+unsaved split).
  return rooms
    .map((r, i) => {
      const id = r && r.id != null ? String(r.id) : null
      return [id != null && idx.has(id) ? idx.get(id) : TAIL, i, r]
    })
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
    .map((t) => t[2])
}

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
  // Physical-device grouping (one entry per HA device_id / IR codeset / solo
  // entity). Source: /api/devices/grouped. Pages consume this via the
  // `groupedEntities` / `groupedZiggyRooms` derived views, NOT directly — the
  // raw groups stay around for advanced/debug use and for store-side lookups.
  deviceGroups: [],
  // entity_id → group_id, for quick membership checks (e.g. "is this entity
  // a non-primary sibling that should be hidden from the main card list?").
  groupByEntityId: {},
  // group_id → group object, for DeviceDetail "primary marker" + sibling list.
  groupById: {},

  loading: false,
  error: null,
  lastUpdated: null,
  hiddenEntities: loadHidden(),
  showHidden: false,
  // Dashboard quick controls — ordered list of up to 4 entity_ids the user
  // pinned. Empty means "use the legacy auto-pick fallback".
  quickControlIds: loadQuick(),

  setQuickControlIds: (ids) => {
    const clean = (Array.isArray(ids) ? ids : []).slice(0, QUICK_MAX).filter(Boolean)
    saveQuick(clean)
    set({ quickControlIds: clean })
    // Fire-and-forget server sync. localStorage is the cache for instant first
    // paint; the server is source of truth so the pins survive a PWA cache wipe.
    putUiPrefs({ quickControlIds: clean }).catch(() => {})
  },

  // Merged Routines + Quick Asks pinned on the Dashboard.
  pinnedShortcuts: loadShortcuts(),

  setPinnedShortcuts: (arr) => {
    const clean = (Array.isArray(arr) ? arr : [])
      .slice(0, SHORTCUTS_MAX)
      .filter(s => s && (s.type === 'routine' || s.type === 'ask') && s.id)
    saveShortcuts(clean)
    set({ pinnedShortcuts: clean })
    putUiPrefs({ pinnedShortcuts: clean }).catch(() => {})
  },

  // User-defined room order — used by both the Rooms page (display order) and
  // the Dashboard carousel (as a tiebreaker beneath the activity-first sort).
  // Empty array = no preference; rooms render in their natural server order.
  roomsOrder: loadRoomsOrder(),

  setRoomsOrder: (ids) => {
    const clean = cleanRoomsOrder(ids)
    saveRoomsOrder(clean)
    set({ roomsOrder: clean })
    putUiPrefs({ roomsOrder: clean }).catch(() => {})
  },

  togglePinnedShortcut: (type, id) => {
    const current = get().pinnedShortcuts
    const idx = current.findIndex(s => s.type === type && s.id === id)
    let next
    if (idx >= 0)               next = current.filter((_, i) => i !== idx)
    else if (current.length >= SHORTCUTS_MAX) return  // at max, no-op
    else                        next = [...current, { type, id }]
    saveShortcuts(next)
    set({ pinnedShortcuts: next })
    putUiPrefs({ pinnedShortcuts: next }).catch(() => {})
  },

  // One-shot reconciliation on app load. Server is source of truth: if the
  // server has data, it overrides the localStorage cache. If the server is
  // empty (first-ever request after the upgrade), the cache wins and we push
  // it up so the next device sees it. Either way, the user never has to
  // re-pin / re-upload after a PWA cache eviction.
  syncUiPrefsFromServer: async () => {
    try {
      const remote = await getUiPrefs()
      if (!remote) return
      const remoteHasShortcuts = Array.isArray(remote.pinnedShortcuts) && remote.pinnedShortcuts.length > 0
      const remoteHasQuick     = Array.isArray(remote.quickControlIds) && remote.quickControlIds.length > 0
      const remoteHasPhotos    = remote.roomPhotos && Object.keys(remote.roomPhotos).length > 0
      const remoteHasCustom    = remote.roomCustomPhotos && Object.keys(remote.roomCustomPhotos).length > 0
      const remoteHasRoomsOrd  = Array.isArray(remote.roomsOrder) && remote.roomsOrder.length > 0
      const remoteTheme        = remote.theme === 'light' || remote.theme === 'dark' ? remote.theme : null

      // Theme: server value wins so a re-installed PWA respects the user's
      // most recent choice. If server is empty, push the local theme up so
      // other devices pick it up. Updating uiStore via setTheme would loop
      // back through the server sync; importing the store directly and
      // calling setState avoids the round-trip.
      if (remoteTheme) {
        try {
          const { useUIStore } = await import('./uiStore.js')
          if (useUIStore.getState().theme !== remoteTheme) {
            useUIStore.setState({ theme: remoteTheme })
            // Mirror to the html element immediately so the new theme paints
            // without waiting for an App re-render to fire the existing effect.
            document.documentElement.setAttribute('data-palette', remoteTheme)
          }
        } catch {}
      } else {
        try {
          const { useUIStore } = await import('./uiStore.js')
          const localTheme = useUIStore.getState().theme
          if (localTheme === 'light' || localTheme === 'dark') {
            putUiPrefs({ theme: localTheme }).catch(() => {})
          }
        } catch {}
      }

      if (remoteHasShortcuts) {
        const clean = remote.pinnedShortcuts
          .slice(0, SHORTCUTS_MAX)
          .filter(s => s && (s.type === 'routine' || s.type === 'ask') && s.id)
        saveShortcuts(clean)
        set({ pinnedShortcuts: clean })
      } else if (get().pinnedShortcuts.length > 0) {
        // Local has pins but server is empty — push the cache up so this user's
        // other devices pick them up, and future PWA reinstalls survive.
        putUiPrefs({ pinnedShortcuts: get().pinnedShortcuts }).catch(() => {})
      }

      if (remoteHasQuick) {
        const clean = remote.quickControlIds.slice(0, QUICK_MAX).filter(Boolean)
        saveQuick(clean)
        set({ quickControlIds: clean })
      } else if (get().quickControlIds.length > 0) {
        putUiPrefs({ quickControlIds: get().quickControlIds }).catch(() => {})
      }

      // Room photos live in localStorage directly (no store state) — sync the
      // localStorage cache so getRoomPhoto() reflects the server immediately.
      // Server wins if non-empty; otherwise push the local cache so reinstalls
      // and other devices pick it up.
      if (remoteHasPhotos) {
        try { localStorage.setItem('ziggy_room_photos', JSON.stringify(remote.roomPhotos)) } catch {}
      } else {
        try {
          const local = JSON.parse(localStorage.getItem('ziggy_room_photos') || '{}')
          if (Object.keys(local).length > 0) putUiPrefs({ roomPhotos: local }).catch(() => {})
        } catch {}
      }

      if (remoteHasCustom) {
        try { localStorage.setItem('ziggy_room_custom_photos', JSON.stringify(remote.roomCustomPhotos)) } catch {}
      } else {
        try {
          const local = JSON.parse(localStorage.getItem('ziggy_room_custom_photos') || '{}')
          if (Object.keys(local).length > 0) putUiPrefs({ roomCustomPhotos: local }).catch(() => {})
        } catch {}
      }

      if (remoteHasRoomsOrd) {
        const clean = cleanRoomsOrder(remote.roomsOrder)
        saveRoomsOrder(clean)
        set({ roomsOrder: clean })
      } else if (get().roomsOrder.length > 0) {
        putUiPrefs({ roomsOrder: get().roomsOrder }).catch(() => {})
      }
    } catch {
      // Network down / not authenticated yet — local cache is fine to use.
    }
  },

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

  // Internal: in-flight fetch promise. Multiple components mounting at the
  // same time (Dashboard + Devices + Rooms via tab swap) all called fetchAll
  // concurrently, each kicking off its own backend fan-out. Deduping here
  // collapses the burst to a single network round-trip.
  _inflightFetch: null,

  // fetchAll(options?)
  //   maxAge:  if data is younger than this many ms, return cached without
  //            re-fetching. Default 0 means "always refetch" — pass a value
  //            from page-mount effects so back-navigation doesn't refire the
  //            entire backend fan-out for stale-but-fresh-enough data.
  //   force:   bypass both maxAge and in-flight dedupe. Use after a mutating
  //            action (assign room, learn IR, etc.) where we *need* fresh data.
  fetchAll: async ({ maxAge = 0, force = false } = {}) => {
    const state = get()
    if (!force) {
      // Cache-hit path: data is fresh enough — skip the network entirely.
      if (maxAge > 0 && state.lastUpdated && state.entities.length > 0 &&
          (Date.now() - state.lastUpdated) < maxAge) {
        return
      }
      // Dedupe concurrent calls — second caller awaits the first's promise.
      if (state._inflightFetch) return state._inflightFetch
    }

    const promise = (async () => {
    const prevState = get()
    set({ loading: true, error: null })
    try {
      // Each endpoint is wrapped in withRetry (1 retry, 300ms) and falls back
      // to `null` to signal "use last-good from the store". This is the
      // PWA/Cloudflare-Tunnel survival kit — when a single handler times out
      // or the tunnel cancels the request mid-response, we must NOT replace
      // good in-store data with an empty array (doing so was disabling Source
      // chips / D-pad on the PWA because _linkedIr got cleared on every flaky
      // fan-out). Only entities + rooms throw if both attempts fail — those
      // are existential.
      const [entRes, roomsRes, roomsDevRes, irRaw, groupsRes] = await Promise.all([
        withRetry(() => getEntities()),
        withRetry(() => getRooms()),
        withRetry(() => getRoomsWithDevices()).catch(() => null),
        withRetry(() => getIrDevices()).catch(() => null),
        withRetry(() => getDeviceGroups()).catch(() => null),
      ])

      // Substitute last-good for any endpoint that failed both tries. The
      // store's previous values stay authoritative until a successful refetch.
      const roomsDev = roomsDevRes != null ? roomsDevRes : {
        rooms:    prevState.ziggyRooms,
        unclaimed:prevState.unclaimedDevices,
        no_room:  prevState.noRoomDevices,
      }
      const irList = Array.isArray(irRaw) ? irRaw : (
        // Recover the IR list from the previous entities[] when the endpoint
        // failed. _linkedIr objects are full IR snapshots, and standalone IR
        // entities round-trip via irToEntity — invert both here.
        irRaw == null
          ? [
              ...prevState.entities
                .map(e => e._linkedIr).filter(Boolean),
              ...prevState.entities
                .filter(e => e._ir && e._irDevice).map(e => e._irDevice),
            ]
          : []
      )
      const groupsList = (groupsRes != null && Array.isArray(groupsRes?.groups))
        ? groupsRes.groups
        : (groupsRes == null ? prevState.deviceGroups : [])

      // Build status map from device registry
      const statusMap = {}
      for (const room of (roomsDev.rooms || [])) {
        for (const d of (room.devices || [])) {
          if (d.entity_id) statusMap[d.entity_id] = d.status
          if (d.ir_device_id && !d.entity_id) {
            statusMap[`ir.${d.ir_device_id}`] = d.status
          }
        }
      }
      for (const d of (roomsDev.unclaimed || [])) {
        if (d.entity_id) statusMap[d.entity_id] = d.status
      }
      for (const d of (roomsDev.no_room || [])) {
        if (d.entity_id) statusMap[d.entity_id] = d.status
        if (d.ir_device_id && !d.entity_id) statusMap[`ir.${d.ir_device_id}`] = d.status
      }

      // ── IR ↔ HA entity linking ────────────────────────────────────────────
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

      // Build group indexes once per fetch so lookups stay O(1) in render.
      const groupByEntityId = {}
      const groupById = {}
      for (const g of groupsList) {
        groupById[g.group_id] = g
        for (const e of (g.entities || [])) {
          if (e.entity_id) groupByEntityId[e.entity_id] = g.group_id
        }
      }

      set({
        entities: allEntities,
        rooms: roomsRes.rooms || [],
        deviceStatusMap: statusMap,
        ziggyRooms: roomsDev.rooms || [],
        unclaimedDevices: roomsDev.unclaimed || [],
        noRoomDevices: roomsDev.no_room || [],
        deviceGroups: groupsList,
        groupByEntityId,
        groupById,
        loading: false,
        lastUpdated: Date.now(),
      })
    } catch (e) {
      // Preserve the full error so consumers can describe it via describeError.
      set({ loading: false, error: e })
    } finally {
      set({ _inflightFetch: null })
    }
    })()
    set({ _inflightFetch: promise })
    return promise
  },

  updateEntityState: (entityId, state, attributes = {}) => {
    set((s) => {
      // Fast path: skip the work entirely when nothing actually changed.
      // HA emits state_changed for attribute-only updates too (volume_level
      // creeping by 0.01 on a media_player, lqi tick on a Zigbee sensor),
      // and the no-change rebuild was the largest source of background
      // re-render work in the app. With 200+ entities, even a few events
      // per second meant constantly invalidating every store subscriber.
      const prev = s.entities.find((e) => e.entity_id === entityId)
      if (!prev) return s   // unknown entity — nothing to update
      const sameState = prev.state === state
      const attrKeys = Object.keys(attributes)
      const sameAttrs = attrKeys.every((k) => prev[k] === attributes[k])
      if (sameState && sameAttrs) return s

      // Patch entities. Only the matched object gets a new reference; the
      // .map returns a new array but every other reference is preserved.
      const nextEntities = s.entities.map((e) =>
        e.entity_id === entityId ? { ...e, state, ...attributes } : e
      )

      // Patch ziggyRooms ONLY when the entity actually lives in a room.
      // The previous unconditional double-map rebuilt every room object on
      // every event, invalidating every Rooms / RoomDetail subscriber.
      let roomIdxWithEntity = -1
      for (let i = 0; i < s.ziggyRooms.length; i++) {
        if ((s.ziggyRooms[i].devices || []).some((d) => d.entity_id === entityId)) {
          roomIdxWithEntity = i
          break
        }
      }
      let nextRooms = s.ziggyRooms
      if (roomIdxWithEntity !== -1) {
        const r = s.ziggyRooms[roomIdxWithEntity]
        const newRoom = {
          ...r,
          devices: r.devices.map((d) =>
            d.entity_id === entityId
              ? { ...d, ha_state: state, ha_attributes: { ...(d.ha_attributes || {}), ...attributes } }
              : d
          ),
        }
        nextRooms = [...s.ziggyRooms]
        nextRooms[roomIdxWithEntity] = newRoom
      }

      return { entities: nextEntities, ziggyRooms: nextRooms }
    })
  },

  // Optimistic rename — patches every store surface that carries this
  // entity's name so the UI reflects the new label immediately, before
  // the next fetchAll round-trip completes. Without this, the Devices
  // page (which reads from `entities`) kept showing the old name until
  // the next full refresh, while the device detail page (which calls
  // load() inline) showed the new name — making each rename appear to
  // land one cycle late. Covers:
  //   - entities[]            (display_name + friendly_name)
  //   - groupById[id].name    (when this entity is the group's primary)
  //   - ziggyRooms[].devices  (the per-room device row's ha_attributes)
  // Backend's `entity_renamed` WS broadcast routes other tabs/devices
  // through this same path.
  renameEntity: (entityId, newName) => {
    if (!entityId || !newName) return
    set((s) => {
      const idx = s.entities.findIndex((e) => e.entity_id === entityId)
      if (idx === -1) return s
      const prev = s.entities[idx]
      if (prev.display_name === newName && prev.friendly_name === newName) return s

      const nextEntities = [...s.entities]
      nextEntities[idx] = { ...prev, display_name: newName, friendly_name: newName }

      // Update group name when this entity is the group's primary. Tile/card
      // surfaces render group.name when it exists, so missing this would
      // leave the room/devices grid showing the old name even after the
      // entity itself was patched above.
      const groupId = s.groupByEntityId[entityId]
      let nextGroupById = s.groupById
      if (groupId) {
        const group = s.groupById[groupId]
        if (group && group.primary_entity_id === entityId && group.name !== newName) {
          nextGroupById = { ...s.groupById, [groupId]: { ...group, name: newName } }
        }
      }

      // Patch ziggyRooms only when the entity actually lives in a room.
      let nextRooms = s.ziggyRooms
      const roomIdx = s.ziggyRooms.findIndex(
        (r) => (r.devices || []).some((d) => d.entity_id === entityId),
      )
      if (roomIdx !== -1) {
        const r = s.ziggyRooms[roomIdx]
        nextRooms = [...s.ziggyRooms]
        nextRooms[roomIdx] = {
          ...r,
          devices: r.devices.map((d) =>
            d.entity_id === entityId
              ? { ...d, ha_attributes: { ...(d.ha_attributes || {}), friendly_name: newName } }
              : d
          ),
        }
      }

      return {
        entities: nextEntities,
        groupById: nextGroupById,
        ziggyRooms: nextRooms,
      }
    })
  },

  // Drop an entity from the in-memory store after the backend confirmed it
  // was removed from HA. Called by App.jsx on the `entity_removed` broadcast
  // and by DeviceDetail right after a successful delete — so the Devices page
  // shows the change instantly without waiting for the next fetchAll.
  // Also clears every dependent index (status map, group lookups, ziggyRooms
  // device row) so stale references don't keep the ghost alive in
  // group-aware code paths.
  removeEntity: (entityId) => {
    set((s) => {
      const hadEntity = s.entities.some((e) => e.entity_id === entityId)
      const hadStatus = entityId in s.deviceStatusMap
      if (!hadEntity && !hadStatus) return s

      const nextStatusMap = { ...s.deviceStatusMap }
      delete nextStatusMap[entityId]

      const groupId = s.groupByEntityId[entityId]
      let nextGroupByEntityId = s.groupByEntityId
      let nextGroupById = s.groupById
      if (groupId) {
        nextGroupByEntityId = { ...s.groupByEntityId }
        delete nextGroupByEntityId[entityId]
        const group = s.groupById[groupId]
        if (group) {
          const filtered = (group.entities || []).filter((e) => e.entity_id !== entityId)
          nextGroupById = { ...s.groupById }
          if (filtered.length === 0) {
            delete nextGroupById[groupId]
          } else {
            nextGroupById[groupId] = { ...group, entities: filtered }
          }
        }
      }

      let nextZiggyRooms = s.ziggyRooms
      const roomIdx = s.ziggyRooms.findIndex(
        (r) => (r.devices || []).some((d) => d.entity_id === entityId),
      )
      if (roomIdx !== -1) {
        const r = s.ziggyRooms[roomIdx]
        nextZiggyRooms = [...s.ziggyRooms]
        nextZiggyRooms[roomIdx] = {
          ...r,
          devices: r.devices.filter((d) => d.entity_id !== entityId),
        }
      }

      return {
        entities: s.entities.filter((e) => e.entity_id !== entityId),
        unclaimedDevices: s.unclaimedDevices.filter((d) => d.entity_id !== entityId),
        noRoomDevices: s.noRoomDevices.filter((d) => d.entity_id !== entityId),
        deviceStatusMap: nextStatusMap,
        groupByEntityId: nextGroupByEntityId,
        groupById: nextGroupById,
        ziggyRooms: nextZiggyRooms,
      }
    })
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

  // Merge decoded AC state (from a physical-remote IR packet) into an IR
  // device's ac_memory + assumed_state. Called by App.jsx when an
  // ir_command_detected event arrives carrying an `ac_state` field — so
  // the card chip shows the fresh temp/mode/fan without waiting for the
  // next fetchAll() refresh. Fields that come in as null are preserved
  // from the previous ac_memory (e.g. Tadiran decoder doesn't extract
  // mode/fan yet — we don't want to wipe known values).
  updateIrDeviceFromAcPacket: (irId, acState, newAssumedState) => {
    if (!acState && !newAssumedState) return
    set((s) => {
      const idx = s.entities.findIndex((e) => e._ir && e._irDevice?.id === irId)
      if (idx === -1) return s
      const prev = s.entities[idx]
      const prevMem = prev._irDevice?.ac_memory || {}
      const newMem = { ...prevMem }
      if (acState) {
        if (acState.temp != null) newMem.temp = acState.temp
        if (acState.mode) newMem.mode = acState.mode
        if (acState.fan) newMem.fan = acState.fan
      }
      const nextEntity = {
        ...prev,
        state: newAssumedState || prev.state,
        assumed_state: newAssumedState || prev.assumed_state,
        ac_memory: newMem,
        _irDevice: {
          ...prev._irDevice,
          ac_memory: newMem,
          assumed_state: newAssumedState || prev._irDevice?.assumed_state,
        },
      }
      const next = [...s.entities]
      next[idx] = nextEntity
      return { entities: next }
    })
  },

  // Unassigned: status=UNCLAIMED entities — new HA devices not yet placed in Ziggy.
  // Distinct from "No Room" (intentionally left without a room).
  // Group-aware: when an unclaimed entity is a non-primary sibling of a
  // physical device, drop it — the user only needs to handle the device once.
  // Returned primaries carry `_group` so the card shows the device's name +
  // metric pills, matching how Devices.jsx renders the rest of the list.
  getUnassigned: () => {
    const { unclaimedDevices, entities, groupByEntityId, groupById } = get()
    const unclaimedIds = new Set(unclaimedDevices.map((d) => d.entity_id).filter(Boolean))
    return entities
      .filter((e) => !e._ir && unclaimedIds.has(e.entity_id))
      .map((e) => _attachGroup(e, groupByEntityId, groupById))
      .filter(Boolean)
  },

  // No Room: room=null, non-UNCLAIMED — intentionally left without a room assignment.
  getNoRoom: () => {
    const { noRoomDevices, entities, groupByEntityId, groupById } = get()
    const noRoomIds = new Set(noRoomDevices.map((d) => d.entity_id).filter(Boolean))
    return entities
      .filter((e) => !e._ir && noRoomIds.has(e.entity_id))
      .map((e) => _attachGroup(e, groupByEntityId, groupById))
      .filter(Boolean)
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
    // All three loops resolve names via display_name first so a Ziggy
    // rename takes effect in the spoken/written summary immediately
    // instead of after HA propagates the registry update.
    for (const e of entities) {
      if (e.domain === 'person' && e.state === 'home') {
        const name = entityDisplayName(e)
        results.push(`${name} is home`)
      }
    }
    for (const e of entities) {
      if (e.domain !== 'binary_sensor') continue
      if (!['occupancy', 'presence', 'motion'].includes(e.device_class)) continue
      if (e.state !== 'on') continue
      const raw = entityDisplayName(e)
      const room = raw.replace(/\s+(Motion Occupancy|Occupancy|Motion|Presence|Sensor)$/i, '').trim()
      results.push(`Someone is in the ${room}`)
    }
    for (const e of entities) {
      if (e.domain !== 'sensor') continue
      const id = e.entity_id.toLowerCase()
      if (!id.includes('presence') && !id.includes('occupancy')) continue
      if (e.state === 'occupied') {
        const room = entityDisplayName(e)
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

  // ── Grouping-aware derived views ──────────────────────────────────────────
  // These are the lookups pages should prefer over raw `entities` /
  // `ziggyRooms` whenever they want "one card per physical device" semantics.
  // When the backend returned an empty group list (HA registry unavailable),
  // these fall back to the flat per-entity behaviour automatically.

  // Look up the group object containing this entity, or null when:
  //   - groups are unavailable
  //   - the entity is solo (no HA siblings)
  //   - the entity is an unmatched ir.* or virtual device
  getGroupForEntity: (entityId) => {
    if (!entityId) return null
    const { groupByEntityId, groupById } = get()
    const gid = groupByEntityId[entityId]
    return gid ? (groupById[gid] || null) : null
  },

  // Return the "primary entity" objects — one per group — with a `_group`
  // attachment carrying metric pills, sibling entity_ids, and the friendly
  // group name. Solo / non-grouped entities (no HA sibling info) pass
  // through unchanged, so callers always get a complete entity list.
  //
  // Non-primary siblings are EXCLUDED — that's the whole point: a Switcher's
  // power/current/time_left sensors stop appearing as separate cards.
  // DeviceDetail still resolves them via `entities` directly.
  getGroupedEntities: () => {
    const { entities, deviceGroups, groupByEntityId, groupById } = get()
    if (!deviceGroups || deviceGroups.length === 0) return entities
    const result = []
    for (const e of entities) {
      const decorated = _attachGroup(e, groupByEntityId, groupById)
      if (decorated) result.push(decorated)
    }
    return result
  },

  // Like ziggyRooms, but each room's `devices` array contains only the
  // primary-entity rows (siblings absorbed into the primary's group metadata).
  // The shape stays compatible with the existing Rooms.jsx render path —
  // callers don't need to re-learn fields.
  getGroupedZiggyRooms: () => {
    const { ziggyRooms, deviceGroups, groupByEntityId, groupById } = get()
    if (!deviceGroups || deviceGroups.length === 0) return ziggyRooms

    const filterRoomDevices = (devices) => {
      const out = []
      const seenGroups = new Set()
      for (const d of (devices || [])) {
        const eid = d.entity_id
        const gid = eid ? groupByEntityId[eid] : null
        const g = gid ? groupById[gid] : null
        if (!g) {
          out.push(d)
          continue
        }
        // Skip non-primary siblings.
        if (eid !== g.primary_entity_id) continue
        // De-dupe in case the same group appeared twice (shouldn't, but
        // defensive — group identity is the source of truth).
        if (seenGroups.has(g.group_id)) continue
        seenGroups.add(g.group_id)
        out.push({
          ...d,
          _group: {
            group_id:     g.group_id,
            name:         g.name,
            metrics:      g.metrics || [],
            entities:     g.entities || [],
            capabilities: g.capabilities || null,
            hasMultiple:  (g.entities || []).length > 1,
          },
        })
      }
      return out
    }

    return ziggyRooms.map((r) => ({ ...r, devices: filterRoomDevices(r.devices) }))
  },
}))
