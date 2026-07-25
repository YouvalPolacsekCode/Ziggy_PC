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

  // entity_id → room name (ziggyRooms carry entity_id strings).
  const roomMap = useMemo(() => {
    const m = {}
    for (const r of ziggyRooms || []) for (const eid of (r.entities || [])) m[eid] = r.name
    return m
  }, [ziggyRooms])

  return useMemo(() => {
    const roomOf = (eid) => roomMap[eid] || NO_ROOM
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
      entityMap, roomOf, nameWithRoom, asItem, automations, hostActions,
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
