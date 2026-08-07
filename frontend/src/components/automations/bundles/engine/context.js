import { useMemo } from 'react'
import { useT, useLangStore } from '../../../../lib/i18n'
import { useDeviceStore } from '../../../../stores/deviceStore'
import { entityDisplayName } from '../../../../lib/utils'

// ── Bundle context ────────────────────────────────────────────────────────────
// One shared "what does this home have" bag handed to every recipe hook
// (derive / steps / save / items fns). Recipes never touch stores directly —
// everything they know about the home comes through here, which is what keeps
// them plain objects.

const NO_ROOM = '__none__'

// Pure resolver (exported for tests): a room's member entity_ids from the Ziggy
// REGISTRY room (`ziggyRooms[].devices`, user truth) — never HA-area membership.
// A device the user placed in a room only in Ziggy has no HA area, so HA-area
// reads (`rooms[].entities` / get_areas) silently drop it — the office-lamp bug.
// Falls back to HA-area entities only when the room isn't a registry room.
export function roomEntityIdsOf(ziggyRooms, rooms, room) {
  if (!room) return []
  const zr = (ziggyRooms || []).find((r) => String(r.id) === String(room.id) || r.name === room.name)
  if (zr) {
    const ids = []
    for (const d of (zr.devices || [])) {
      const id = d.entity_id || d.main_entity_id
      if (id) ids.push(id)
    }
    if (ids.length) return ids
  }
  const area = (rooms || []).find((r) => String(r.id) === String(room.id) || r.name === room.name)
  return (area?.entities || [])
}

export function useBundleCtx({ automations = [], hostActions = {} } = {}) {
  const t = useT()
  const lang = useLangStore((s) => s.lang)
  const entities = useDeviceStore((s) => s.entities)
  const ziggyRooms = useDeviceStore((s) => s.ziggyRooms)
  const rooms = useDeviceStore((s) => s.rooms)
  const occupancySensors = useDeviceStore((s) => s.occupancySensors)

  const entityMap = useMemo(
    () => Object.fromEntries((entities || []).map((e) => [e.entity_id, e])),
    [entities],
  )

  // entity_id → room name. ziggyRooms come from /api/rooms/devices and carry
  // `.devices[]` (objects), NOT `.entities[]` — reading `.entities` here yielded
  // an ALWAYS-EMPTY map, silently breaking roomOf/nameWithRoom and every recipe
  // that groups by room (motionLight pairing, nightWatch exclusion). This is the
  // registry (user-driven) room source — the truth the rest of the app uses.
  const roomMap = useMemo(() => {
    const m = {}
    for (const r of ziggyRooms || [])
      for (const d of (r.devices || [])) {
        const id = d.entity_id || d.main_entity_id
        if (id) m[id] = r.name
      }
    return m
  }, [ziggyRooms])

  return useMemo(() => {
    const roomOf = (eid) => roomMap[eid] || NO_ROOM
    // Canonical "what entity_ids are in this room" — registry room (user truth),
    // never HA-area membership. Every recipe that needs a room's members MUST use
    // this, not ctx.rooms. See roomEntityIdsOf.
    const roomEntityIds = (room) => roomEntityIdsOf(ziggyRooms, rooms, room)
    // Display label with the room appended when it isn't already in the name.
    const nameWithRoom = (e) => {
      const r = roomMap[e.entity_id]
      const n = entityDisplayName(e) || e.entity_id
      return r && !n.toLowerCase().includes(String(r).toLowerCase()) ? `${n} · ${r}` : n
    }
    // Entity → generic picker item.
    const asItem = (e) => ({ id: e.entity_id, label: nameWithRoom(e), _entity: e })
    return {
      t, lang, entities, ziggyRooms, rooms, occupancySensors,
      entityMap, roomOf, roomEntityIds, nameWithRoom, asItem, automations, hostActions,
      NO_ROOM,
    }
  }, [t, lang, entities, ziggyRooms, rooms, occupancySensors, entityMap, roomMap, automations, hostActions])
}

// ── Value helpers shared by recipes ──────────────────────────────────────────

// pickMany values are { mode: 'all' | 'choose', ids: [] }. Resolve to the
// concrete id list against the current item set.
export const pickedIds = (v, items) =>
  v?.mode === 'choose' ? (v.ids || []) : (items || []).map((i) => i.id)

// Build a pickMany value from an installed selection: 'choose' when it's a
// real subset, 'all' otherwise (mirrors every legacy wizard's derive).
export const pickFrom = (ids, totalCount, isUpdate) => ({
  mode: (isUpdate && ids.length && ids.length < totalCount) ? 'choose' : 'all',
  ids: ids || [],
})

export { NO_ROOM }
