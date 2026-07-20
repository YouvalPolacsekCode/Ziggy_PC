import { useEffect, useMemo, useState, useRef, lazy, Suspense } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { motion, Reorder } from 'framer-motion'
import { ArrowLeft, Plus, EyeOff, Eye, Trash2, Zap, Play, Pause, ChevronRight, Pencil, ArrowUpDown, Check, GripVertical } from 'lucide-react'
import { getMapRoomsSummary, getAutomations, triggerAutomation, getFeaturesSettings } from '../lib/api'

const HomeMapCanvas = lazy(() =>
  import('./HomeMapCanvas').then((m) => ({ default: m.HomeMapCanvas }))
)
import { Toggle } from '../components/ui/Toggle'
import { isEntityOn } from '../components/ui/DeviceControls'
import { DeviceCard } from '../components/device/DeviceCard'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { EntitySelect } from '../components/ui/EntitySelect'
import { useDeviceStore, applyRoomsOrder } from '../stores/deviceStore'
import { useUIStore } from '../stores/uiStore'
import { DOMAIN_GROUPS, domainGroup, groupLabel } from '../lib/domainRegistry'
import { controlDevice, createRoom, deleteRoom, renameRoom, assignEntityToArea, callHaService, getVirtualDevices, triggerVirtualDevice, patchVirtualDevice } from '../lib/api'
import { cameraSnapshotUrl } from '../stores/cameraStore'
import { cn, formatEntityState, humanizeSlug } from '../lib/utils'
import { findRoomMetric, averageRoomMetric, inferBinarySensorClass } from '../lib/devices'
import { ROOM_PHOTOS, saveRoomPhoto, PHOTO_OPTIONS, getRoomPhoto, getCustomPhoto, storeCustomDataUrl, removeCustomPhoto, resizeImageToDataUrl } from '../lib/roomPhotos'
import { useT, useTranslatedName } from '../lib/i18n'

// DOMAIN_GROUPS and domainGroup imported from domainRegistry.js
const ROOM_DOMAIN_GROUPS = DOMAIN_GROUPS
const roomDomainGroup = domainGroup

// Tile color mode for room-detail device cards.
//   'inverted' — matches the home page's dramatic var(--ink)/var(--bg) flip
//                when active. Tile reads as a bold status display rather
//                than a pastel control panel. Current default.
//   'tinted'   — the previous per-kind tinted palette (gold for lights,
//                accent for media, info for AC, …). Subtle on/off gradation
//                against --tile-base. Both code paths live in TileCard
//                (DeviceCard.jsx) so flipping this constant cleanly reverts.
const ROOM_TILE_STYLE = 'inverted'

// Resolve a room-device entry (shape from /rooms/devices) to the canonical
// entity from the store. Room devices use _is_ir / _ir_device_id markers and
// nest attributes under ha_attributes; the entities store has the unified
// shape DeviceCard / deviceFacts expects (_ir, _irDevice, attributes spread).
function resolveRoomDeviceToEntity(roomDev, entities) {
  // HA-backed entity
  if (roomDev.entity_id) {
    const hit = entities.find(e => e.entity_id === roomDev.entity_id)
    if (hit) return hit
  }
  // Pure IR device
  if (roomDev._is_ir || roomDev._ir_device_id) {
    const irId = roomDev._ir_device_id || roomDev.id
    const hit = entities.find(e => e._ir && e._irDevice?.id === irId)
    if (hit) return hit
    // Fallback: synthesize a minimal entity from the room device payload so
    // the card renders even if the store hasn't caught up yet.
    return {
      entity_id: `ir.${irId}`,
      state: roomDev.ha_state || roomDev.assumed_state || 'unknown',
      domain: roomDev.domain || 'switch',
      display_name: roomDev.display_name || roomDev.device_type,
      friendly_name: roomDev.display_name || roomDev.device_type,
      _ir: true,
      _irDevice: {
        id: irId,
        name: roomDev.display_name || roomDev.device_type,
        type: roomDev.device_type,
        learned_commands: roomDev.learned_commands || [],
        commands: roomDev.commands || {},
        assumed_state: roomDev.assumed_state,
      },
    }
  }
  // Fallback: treat the room device itself as entity-shaped
  return {
    entity_id: roomDev.entity_id || `unknown.${roomDev.id || Math.random()}`,
    state: roomDev.state || roomDev.ha_state || 'unknown',
    domain: roomDev.domain || 'unknown',
    display_name: roomDev.display_name,
    friendly_name: roomDev.display_name,
    ...(roomDev.ha_attributes || {}),
  }
}

function RoomTile({ room, onClick, onDelete, onEditPhoto }) {
  const t = useT()
  const roomName = useTranslatedName(room.name)
  const [hovered, setHovered] = useState(false)
  const photo = getRoomPhoto(room)
  const hasActive = room.activeCount > 0
  const hasMotion = false // motion derived from entityMap in parent — show ok dot if active

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', cursor: 'pointer', height: 'var(--rooms-tile-h)' }}
    >
      <button onClick={onClick} style={{
        width: '100%', height: '100%', padding: 0, border: 'none',
        cursor: 'pointer', display: 'block', position: 'relative',
      }}>
        {/* Full-bleed photo */}
        <img src={photo} alt={roomName} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        {/* Gradient */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.55) 100%)' }} />

        {/* Status dot — top right. Hidden while hovered so the action
            cluster (Edit / Delete) can take the same corner without
            stacking on top of the dot. The temp/humidity chips own the
            top-left now that hover actions moved out of there. */}
        {!hovered && (
          <span style={{
            position: 'absolute', top: 10, insetInlineEnd: 10,
            width: 8, height: 8, borderRadius: '50%',
            background: hasActive ? 'var(--ok)' : 'rgba(255,255,255,0.4)',
            boxShadow: hasActive ? '0 0 0 3px rgba(108,191,140,0.35)' : 'none',
          }} />
        )}

        {/* Temp / humidity chips — top left, matches the Dashboard carousel
            chip styling so the two surfaces feel like one design system.
            Temperature is tinted by indoor comfort range:
              < 18 °C  → cold (cool blue)
              18–25 °C → comfortable (neutral dark, unchanged)
              > 25 °C  → hot (warm red)
            HA reports a `unit_of_measurement` attribute (°C / °F); we
            normalize to °C for the threshold comparison so the chip behaves
            sensibly regardless of locale. */}
        {(room.tempSensor || room.humSensor) && (
          <div style={{ position: 'absolute', top: 9, insetInlineStart: 10, display: 'flex', gap: 5 }}>
            {room.tempSensor && (() => {
              const raw = parseFloat(room.tempSensor.state)
              const unit = room.tempSensor.unit_of_measurement
                        || room.tempSensor.attributes?.unit_of_measurement
                        || '°C'
              const tempC = unit.includes('F') ? (raw - 32) * 5 / 9 : raw
              const bg = tempC < 18 ? 'rgba(60, 130, 220, 0.55)'
                       : tempC > 25 ? 'rgba(220, 80, 60, 0.55)'
                       : 'rgba(0, 0, 0, 0.32)'
              return (
                <span style={{ fontSize: 10.5, color: '#fff', fontFamily: '"IBM Plex Mono", monospace', background: bg, backdropFilter: 'blur(8px)', padding: '3px 7px', borderRadius: 999 }}>
                  {raw.toFixed(1)}°
                </span>
              )
            })()}
            {room.humSensor && (
              <span style={{ fontSize: 10.5, color: '#fff', fontFamily: '"IBM Plex Mono", monospace', background: 'rgba(0,0,0,0.32)', backdropFilter: 'blur(8px)', padding: '3px 7px', borderRadius: 999 }}>
                {parseFloat(room.humSensor.state).toFixed(0)}%
              </span>
            )}
          </div>
        )}

        {/* Name + count — bottom. Explicit textAlign overrides the parent
            <button>'s UA-default `text-align: center`, which would otherwise
            cascade to these <p>s and center the room name + count. */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '10px 12px', textAlign: 'start' }}>
          <p dir="auto" style={{ fontSize: 13, fontWeight: 600, color: '#fff', letterSpacing: '-0.01em', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{roomName}</p>
          <p className="z-mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>
            {room.entityCount} · {hasActive ? t('rooms.someOn', { n: room.activeCount }) : t('rooms.idle')}
            {room.offlineCount > 0 && <span style={{ color: 'rgba(252,165,165,0.9)', marginInlineStart: 4 }}>· {t('rooms.nOff', { n: room.offlineCount })}</span>}
          </p>
        </div>
      </button>

      {/* Hover actions — top-right so they never cover the temp/humidity
          chips that live in the top-left corner. Status dot above is
          suppressed while hovered so the cluster owns this corner cleanly. */}
      {hovered && (onEditPhoto || onDelete) && (
        <div style={{ position: 'absolute', top: 8, insetInlineEnd: 8, display: 'flex', gap: 4, zIndex: 1 }}>
          {onEditPhoto && (
            <button onClick={e => { e.stopPropagation(); onEditPhoto(room) }} title={t('rooms.editRoomAria')} aria-label={t('rooms.editRoomAria')} style={{ padding: '5px 6px', borderRadius: 8, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)', border: '0.5px solid rgba(255,255,255,0.2)', cursor: 'pointer', color: '#fff', display: 'flex' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          )}
          {onDelete && (
            <button onClick={e => { e.stopPropagation(); onDelete(room) }} title={t('rooms.deleteRoomAria')} aria-label={t('rooms.deleteRoomAria')} style={{ padding: '5px 6px', borderRadius: 8, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)', border: '0.5px solid rgba(255,255,255,0.2)', cursor: 'pointer', color: '#fca5a5', display: 'flex' }}>
              <Trash2 size={11} />
            </button>
          )}
        </div>
      )}
    </motion.div>
  )
}

// ── Shared Edit-room modal ────────────────────────────────────────────────────
// Used from both the Rooms-list tile hover-menu AND the Room-detail header
// kebab menu, so the rename + photo-picker UX is consistent across surfaces.
export function RoomEditModal({ open, room, onClose, onSaved }) {
  const t = useT()
  const { fetchAll }  = useDeviceStore()
  const { addToast }  = useUIStore()
  const [photoKey,    setPhotoKey]    = useState('living_room')
  const [customPhoto, setCustomPhoto] = useState(null)
  const [roomName,    setRoomName]    = useState('')
  const [saving,      setSaving]      = useState(false)

  // Reset state whenever the target room changes (i.e. modal opens).
  useEffect(() => {
    if (!room) return
    setRoomName(room.name)
    setCustomPhoto(getCustomPhoto(room.id))
    try {
      const overrides = JSON.parse(localStorage.getItem('ziggy_room_photos') || '{}')
      setPhotoKey(overrides[room.id] || room.id)
    } catch { setPhotoKey('living_room') }
  }, [room?.id])

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try { setCustomPhoto(await resizeImageToDataUrl(file)) }
    catch { addToast(t('rooms.couldNotLoadPhoto'), 'error') }
    e.target.value = ''
  }

  const handleSave = async () => {
    if (!room) return
    setSaving(true)
    try {
      const nameChanged = roomName.trim() && roomName.trim() !== room.name
      if (nameChanged) {
        await renameRoom(room.id, roomName.trim())
        await fetchAll()
      }
      if (customPhoto) {
        storeCustomDataUrl(room.id, customPhoto)
      } else {
        removeCustomPhoto(room.id)
        saveRoomPhoto(room.id, photoKey)
      }
      addToast(nameChanged ? t('rooms.roomUpdated') : t('rooms.photoUpdated'), 'success')
      onSaved?.({ ...room, name: nameChanged ? roomName.trim() : room.name })
      onClose()
    } catch (e) {
      addToast(e.message || t('common.failedToSave'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={() => { setCustomPhoto(null); onClose() }} title={t('rooms.editRoomTitle')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Input label={t('rooms.roomNameLabel')} dir="auto" value={roomName} onChange={e => setRoomName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSave()} />
        <div>
          <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 8 }}>{t('rooms.photo')}</p>
          {customPhoto && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ position: 'relative', borderRadius: 11, overflow: 'hidden', height: 120, marginBottom: 6 }}>
                <img src={customPhoto} alt={t('rooms.customAlt')} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                <button onClick={() => setCustomPhoto(null)} style={{ position: 'absolute', top: 8, insetInlineEnd: 8, width: 24, height: 24, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12 }}>✕</button>
              </div>
            </div>
          )}
          <div style={{ height: 252, overflowY: 'scroll', borderRadius: 10, border: '0.5px solid var(--line)', marginBottom: 12 }} className="scrollbar-thin">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, padding: 8 }}>
              {PHOTO_OPTIONS.map(({ key, label }) => {
                const isSelected = !customPhoto && photoKey === key
                return (
                  <button key={key} type="button" onClick={() => { setPhotoKey(key); setCustomPhoto(null) }} style={{
                    position: 'relative', overflow: 'hidden', borderRadius: 9,
                    height: 72,
                    border: isSelected ? '2.5px solid var(--accent)' : '2.5px solid transparent',
                    cursor: 'pointer', padding: 0, background: 'var(--surface-2)',
                    opacity: isSelected ? 1 : 0.7,
                    transition: 'opacity 0.15s, border-color 0.15s',
                    flexShrink: 0,
                  }}>
                    <img src={ROOM_PHOTOS[key]} alt={label} style={{
                      position: 'absolute', inset: 0, width: '100%', height: '100%',
                      objectFit: 'cover', display: 'block',
                    }} />
                  </button>
                )
              })}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 8px', borderRadius: 10, border: '1.5px dashed var(--line-2)', fontSize: 12, fontWeight: 500, color: 'var(--ink-mute)', cursor: 'pointer' }}>
              {t('rooms.takePhoto')}
              <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleUpload} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 8px', borderRadius: 10, border: '1.5px dashed var(--line-2)', fontSize: 12, fontWeight: 500, color: 'var(--ink-mute)', cursor: 'pointer' }}>
              {t('rooms.chooseFile')}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUpload} />
            </label>
          </div>
        </div>
        <button onClick={handleSave} disabled={!roomName.trim() || saving} className="z-btn-primary" style={{ width: '100%' }}>
          {saving ? t('common.saving') : t('rooms.saveChanges')}
        </button>
      </div>
    </Modal>
  )
}

// ── Shared Delete-room confirm modal ──────────────────────────────────────────
export function RoomDeleteConfirm({ room, onClose, onConfirm }) {
  const t = useT()
  return (
    <Modal open={!!room} onClose={onClose} title={t('rooms.deleteRoomTitle')}>
      <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginBottom: 16, lineHeight: 1.5 }}>
        {t('rooms.deleteRoomLong', { name: room?.name || '' })}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onClose} className="z-btn-secondary" style={{ flex: 1 }}>{t('common.cancel')}</button>
        <button onClick={() => onConfirm(room)} style={{ flex: 1, background: `color-mix(in srgb, var(--accent) 10%, var(--surface))`, color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: 10, padding: '10px 16px', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{t('common.delete')}</button>
      </div>
    </Modal>
  )
}

// ── Reorder row — compact draggable list item ─────────────────────────────────
// Rendered only while RoomsList is in reorder mode. Whole row is the drag
// surface; the grip icon on the right is a visual affordance, not an
// interactive button (a separate handle would force users to aim precisely
// on mobile). useDragControls is intentionally NOT used so a press anywhere
// in the row starts the drag — the simplest, most forgiving touch UX.
function RoomReorderRow({ room }) {
  const t = useT()
  const roomName = useTranslatedName(room.name)
  const photo = getRoomPhoto(room)
  const hasActive = room.activeCount > 0
  return (
    <Reorder.Item
      value={room}
      as="div"
      whileDrag={{ scale: 1.02, boxShadow: 'var(--shadow-lg)', cursor: 'grabbing' }}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 12px 8px 8px',
        background: 'var(--surface)',
        border: '0.5px solid var(--line)',
        borderRadius: 14,
        cursor: 'grab',
        // Tells the browser the element captures touch — without this, mobile
        // Safari treats the long-press as a scroll gesture and the drag never
        // starts.
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      <div style={{ width: 44, height: 44, borderRadius: 10, overflow: 'hidden', flexShrink: 0, position: 'relative' }}>
        <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        <span style={{
          position: 'absolute', top: 5, insetInlineEnd: 5,
          width: 6, height: 6, borderRadius: '50%',
          background: hasActive ? 'var(--ok)' : 'rgba(255,255,255,0.5)',
          boxShadow: hasActive ? '0 0 0 2px rgba(108,191,140,0.35)' : 'none',
        }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p dir="auto" style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{roomName}</p>
        <p className="z-mono" style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>
          {room.entityCount === 1 ? t('rooms.deviceCountSingular', { n: room.entityCount }) : t('rooms.deviceCount', { n: room.entityCount })}
          {hasActive && <span style={{ color: 'var(--ok)', marginInlineStart: 6 }}>· {t('rooms.someOn', { n: room.activeCount })}</span>}
        </p>
      </div>
      <GripVertical size={18} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} aria-hidden />
    </Reorder.Item>
  )
}

export function RoomsList() {
  const t = useT()
  const navigate = useNavigate()
  // Per-field selectors so this page doesn't re-render on every WS push,
  // and the expensive grouping derivations only run when their inputs change.
  const fetchAll        = useDeviceStore(s => s.fetchAll)
  const loading         = useDeviceStore(s => s.loading)
  const rawZiggyRooms   = useDeviceStore(s => s.ziggyRooms)
  const rawEntities     = useDeviceStore(s => s.entities)
  const getUnassigned   = useDeviceStore(s => s.getUnassigned)
  const getNoRoom       = useDeviceStore(s => s.getNoRoom)
  const roomsOrder      = useDeviceStore(s => s.roomsOrder)
  const setRoomsOrder   = useDeviceStore(s => s.setRoomsOrder)
  const roomShowAvgTemp = useDeviceStore(s => s.roomShowAvgTemp)
  const deviceGroups    = useDeviceStore(s => s.deviceGroups)
  const groupByEntityId = useDeviceStore(s => s.groupByEntityId)
  const groupById       = useDeviceStore(s => s.groupById)
  // Use the physical-device-grouped views so a Switcher's 4 entities (or a
  // multi-sensor Zigbee node's 4 sub-entities) collapse to one room card.
  // Falls back to raw lists when /api/devices/grouped returned empty.
  // Memoized — getGrouped* allocate fresh arrays/objects, which broke
  // downstream useMemo deps and triggered a render storm on every WS push.
  const ziggyRooms = useMemo(
    () => useDeviceStore.getState().getGroupedZiggyRooms(),
    [rawZiggyRooms, deviceGroups, groupByEntityId, groupById],
  )
  const entities = useMemo(
    () => useDeviceStore.getState().getGroupedEntities(),
    [rawEntities, deviceGroups, groupByEntityId, groupById],
  )
  const addToast = useUIStore(s => s.addToast)
  const [showAdd, setShowAdd] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomPhoto, setNewRoomPhoto] = useState('living_room')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [editPhotoRoom, setEditPhotoRoom] = useState(null)
  const [search, setSearch] = useState('')
  // Reorder mode: tap the [↕] in the header to enter; tap Done to commit, X
  // to cancel. While editing we work on `draftOrder` (a snapshot of the
  // current rooms in their saved order) so the live store isn't mutated until
  // the user confirms — and the saved order isn't disturbed if they bail.
  const [reorderMode, setReorderMode] = useState(false)
  const [draftOrder, setDraftOrder] = useState([])

  useEffect(() => { fetchAll({ maxAge: 120_000 }) }, [])

  // Enrich ziggyRooms with display counts and temp/humidity sensors for RoomTile.
  // entityMap lets us look up full HA entity objects (with device_class) from the
  // device list — the device entries themselves only carry ha_state, not the
  // attributes the sensor chips need.
  const entityMap = Object.fromEntries(entities.map(e => [e.entity_id, e]))
  const rooms = ziggyRooms.map((r) => ({
    ...r,
    entityCount:  r.devices.length,
    activeCount:  r.devices.filter((d) => isEntityOn({ state: d.ha_state, entity_id: d.entity_id })).length,
    offlineCount: r.devices.filter((d) => d.ha_state === 'unavailable' || d.ha_state === 'unknown').length,
    // findRoomMetric also looks at _group.metrics, so a multi-sensor device
    // (Roni Room Sensor) keeps surfacing humidity as a room chip even though
    // grouping absorbed humidity into the temperature primary's siblings.
    // When the user turned on "average" for this room, the tile shows the mean
    // of ALL its temp sensors instead of the first one.
    tempSensor:   (roomShowAvgTemp?.[String(r.id)]
                    ? averageRoomMetric(r.devices, 'temperature', entityMap)
                    : null) || findRoomMetric(r.devices, 'temperature', entityMap),
    humSensor:    findRoomMetric(r.devices, 'humidity',    entityMap),
  }))
  // Apply user-defined room order: saved IDs first in saved order, unsaved
  // rooms appended in their natural (server) order. Used for both the grid
  // and the reorder list.
  const orderedRooms = applyRoomsOrder(rooms, roomsOrder)
  const unassigned = getUnassigned()
  const noRoomDevices = getNoRoom()

  const startReorder = () => {
    setDraftOrder(orderedRooms)
    setSearch('')
    setReorderMode(true)
  }
  const cancelReorder = () => {
    setReorderMode(false)
    setDraftOrder([])
  }
  const saveReorder = () => {
    setRoomsOrder(draftOrder.map(r => r.id))
    setReorderMode(false)
    setDraftOrder([])
    // Deliberately no toast — the visible grid reorder is its own
    // confirmation, and firing a ToastContainer AnimatePresence enter/exit
    // alongside any subsequent page-transition AnimatePresence was a known
    // contributing factor to the page-transition deadlock.
  }

  const handleAddRoom = async () => {
    if (!newRoomName.trim()) return
    setSaving(true)
    try {
      await createRoom(newRoomName.trim())
      await fetchAll()
      const newRoom = ziggyRooms.find((r) => r.name.toLowerCase() === newRoomName.trim().toLowerCase())
      if (newRoom) saveRoomPhoto(newRoom.id, newRoomPhoto)
      addToast(t('rooms.roomCreated', { name: newRoomName }), 'success')
      setNewRoomName('')
      setNewRoomPhoto('living_room')
      setShowAdd(false)
    } catch (e) {
      addToast(e.message || t('rooms.failedToCreate'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteRoom = async (room) => {
    try {
      await deleteRoom(room.id)
      await fetchAll()
      addToast(t('rooms.roomDeleted', { name: room.name }), 'success')
      setConfirmDelete(null)
    } catch (e) {
      addToast(e.message || t('rooms.failedToDelete'), 'error')
    }
  }

  const filteredRooms = orderedRooms.filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{ maxWidth: 'var(--page-max-w)', margin: '0 auto', padding: '24px 20px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>{reorderMode ? t('rooms.editOrder') : t('rooms.yourHome')}</p>
          <h1 className="z-display" style={{ fontSize: 26, margin: 0 }}>{t('rooms.title')}</h1>
          <p className="z-mono" style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>
            {reorderMode
              ? t('rooms.dragToReorder')
              : <>
                  {rooms.length === 1 ? t('rooms.roomsCountSingular', { n: rooms.length }) : t('rooms.roomsCount', { n: rooms.length })}
                  {unassigned.length > 0 && <span style={{ color: 'var(--warn)', marginInlineStart: 4 }}>· {t('rooms.unassignedCount', { n: unassigned.length })}</span>}
                </>}
          </p>
        </div>
        {/* Header actions — reorder mode replaces Add room with Cancel/Done so
            the destructive paths (creating, deleting) aren't reachable while
            the user is in the middle of reordering. */}
        {reorderMode ? (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              onClick={cancelReorder}
              className="z-btn-secondary"
              style={{ padding: '8px 12px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 5, fontSize: 13 }}
              aria-label={t('rooms.cancelReorderAria')}
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={saveReorder}
              className="z-btn-primary"
              style={{ padding: '8px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            >
              <Check size={14} /> {t('common.done')}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {/* Labeled "Reorder" button — was previously an icon-only 38×38
                square, which read as a generic chrome control on mobile and
                users couldn't tell it was the sort affordance. Labeled
                secondary button matches "+ Add room" in visual weight without
                competing for primary CTA. */}
            {rooms.length > 1 && (
              <button
                onClick={startReorder}
                aria-label={t('rooms.reorderAria')}
                className="z-btn-secondary"
                style={{ padding: '8px 12px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 5, fontSize: 13 }}
              >
                <ArrowUpDown size={13} /> {t('rooms.reorder')}
              </button>
            )}
            <button onClick={() => setShowAdd(true)} className="z-btn-primary" style={{ padding: '8px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <Plus size={13} /> {t('rooms.add')}
            </button>
          </div>
        )}
      </div>

      {/* Search bar — hidden in reorder mode (search filtering would hide the
          very rows the user is trying to drag, and the address-bar input
          steals focus from drag gestures on mobile). */}
      {!reorderMode && (
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <svg style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('rooms.searchPlaceholder')}
            dir="auto"
            style={{ width: '100%', boxSizing: 'border-box', paddingInlineStart: 36, height: 40, background: 'var(--surface)', border: '0.5px solid var(--line)', borderRadius: 12, color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none' }}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--line)' }}
          />
        </div>
      )}

      {/* Empty state — only when truly empty, not during a background refresh */}
      {rooms.length === 0 && unassigned.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>{t('rooms.empty')}</p>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 16 }}>{t('rooms.emptyHint')}</p>
          <button onClick={() => setShowAdd(true)} className="z-btn-secondary" style={{ padding: '8px 14px', borderRadius: 9, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Plus size={13} /> {t('rooms.addFirstRoom')}
          </button>
        </div>
      )}

      {/* Room photo-tile grid — `.z-rooms-grid` sets responsive cols/gap
          (2 on phones, 3 on tablet+) and bumps `--rooms-tile-h` on desktop
          so the tiles read as big anchor cards there rather than mobile-
          sized thumbnails stretched wide.

          In reorder mode we swap to a single-column list with a thumbnail +
          drag handle per row. Reasons:
            1. framer-motion Reorder.Item hit-testing assumes 1D ordering;
               on a 2-col grid axis="y" jumps multiple positions per swap
               because rows wrap. A list is the natural fit.
            2. The mode-switch visually separates "browsing" from "editing"
               — fewer accidental drags on the high-traffic Rooms page.
            3. Drag handle is an explicit affordance for mouse + touch. */}
      {!reorderMode && (
        <div className="z-rooms-grid">
          {/* Stale-while-revalidate: only show skeleton on a true cold start
              (no rooms cached at all). On a back-nav refresh, show the
              cached tiles immediately — they update in place when the new
              data arrives. */}
          {loading && filteredRooms.length === 0 && [1, 2, 3, 4].map(i => (
            <div key={i} style={{ height: 'var(--rooms-tile-h)', borderRadius: 16, background: 'var(--surface-2)', opacity: 0.6 }} />
          ))}
          {filteredRooms.map(room => (
            <RoomTile
              key={room.id}
              room={room}
              onClick={() => navigate(`/rooms/${room.id}`)}
              onDelete={r => setConfirmDelete(r)}
              onEditPhoto={(r) => setEditPhotoRoom(r)}
            />
          ))}
        </div>
      )}
      {reorderMode && (
        <Reorder.Group
          as="div"
          axis="y"
          values={draftOrder}
          onReorder={setDraftOrder}
          style={{ display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none', padding: 0, margin: 0 }}
        >
          {draftOrder.map(room => (
            <RoomReorderRow key={room.id} room={room} />
          ))}
        </Reorder.Group>
      )}

      {/* Unassigned / no-room chips — hidden in reorder mode (they're not
          reorderable rooms; leaving them visible would invite a futile drag). */}
      {!reorderMode && !loading && (unassigned.length > 0 || noRoomDevices.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {unassigned.length > 0 && (
            <Link to="/devices?filter=unassigned" style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
              borderRadius: 14, textDecoration: 'none',
              border: `1.5px dashed color-mix(in srgb, var(--warn) 50%, var(--line))`,
              background: `color-mix(in srgb, var(--warn) 6%, var(--surface))`,
            }}>
              <span style={{ fontSize: 20 }}>📦</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--warn)', marginBottom: 2 }}>{unassigned.length === 1 ? t('rooms.unassignedDeviceCountSingular', { n: unassigned.length }) : t('rooms.unassignedDevicesCount', { n: unassigned.length })}</p>
                <p className="z-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{t('rooms.tapToAssign')}</p>
              </div>
              <ChevronRight size={14} className="icon-flip-rtl" style={{ color: 'var(--warn)', flexShrink: 0 }} />
            </Link>
          )}
          {noRoomDevices.length > 0 && (
            <Link to="/devices?filter=noroom" style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
              borderRadius: 14, textDecoration: 'none',
              border: '0.5px solid var(--line)', background: 'var(--surface)',
            }}>
              <span style={{ fontSize: 20 }}>🏠</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{noRoomDevices.length === 1 ? t('rooms.noRoomDeviceCountSingular', { n: noRoomDevices.length }) : t('rooms.noRoomDevicesCount', { n: noRoomDevices.length })}</p>
                <p className="z-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{t('rooms.intentionalNoRoom')}</p>
              </div>
              <ChevronRight size={14} className="icon-flip-rtl" style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
            </Link>
          )}
        </div>
      )}

      {/* Add room modal */}
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setNewRoomName(''); setNewRoomPhoto('living_room') }} title={t('rooms.addRoomTitle')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input label={t('rooms.roomNameLabel')} placeholder={t('rooms.namePlaceholderExamples')} dir="auto" value={newRoomName} onChange={e => setNewRoomName(e.target.value)} autoFocus onKeyDown={e => e.key === 'Enter' && handleAddRoom()} />
          <div>
            <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 8 }}>{t('rooms.photo')}</p>
            <div style={{ height: 252, overflowY: 'scroll', borderRadius: 10, border: '0.5px solid var(--line)' }} className="scrollbar-thin">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, padding: 8 }}>
                {PHOTO_OPTIONS.map(({ key, label }) => {
                  const isSelected = newRoomPhoto === key
                  return (
                    <button key={key} type="button" onClick={() => setNewRoomPhoto(key)} style={{
                      position: 'relative', overflow: 'hidden', borderRadius: 9,
                      height: 72,
                      border: isSelected ? '2.5px solid var(--accent)' : '2.5px solid transparent',
                      cursor: 'pointer', padding: 0, background: 'var(--surface-2)',
                      opacity: isSelected ? 1 : 0.7, transition: 'opacity 0.15s, border-color 0.15s',
                      flexShrink: 0,
                    }}>
                      <img src={ROOM_PHOTOS[key]} alt={label} style={{
                        position: 'absolute', inset: 0, width: '100%', height: '100%',
                        objectFit: 'cover', display: 'block',
                      }} />
                      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%)' }} />
                      <span style={{ position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center', fontSize: 9, color: '#fff', fontWeight: 600 }}>{label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
          <button onClick={handleAddRoom} disabled={!newRoomName.trim() || saving} className="z-btn-primary" style={{ width: '100%' }}>
            {saving ? t('rooms.creating') : t('rooms.createRoom')}
          </button>
        </div>
      </Modal>

      <RoomDeleteConfirm
        room={confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDeleteRoom}
      />

      <RoomEditModal
        open={!!editPhotoRoom}
        room={editPhotoRoom}
        onClose={() => setEditPhotoRoom(null)}
      />
    </div>
  )
}

// Note: LOST_LABEL keys are used as translation keys; resolved via t() at use sites.
const LOST_LABEL = { lost: 'rooms.removedFromHub', unclaimed: 'rooms.notInZiggy', unconfigured: 'rooms.noEntitySet' }
const LOST_DOT   = { lost: 'bg-err', unclaimed: 'bg-warn', unconfigured: 'bg-line' }

function CameraPreview({ entityId }) {
  const t = useT()
  const navigate = useNavigate()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 15_000)
    return () => clearInterval(id)
  }, [])
  return (
    <div
      onClick={() => navigate('/cameras')}
      style={{
        marginTop: 8, borderRadius: 9, overflow: 'hidden',
        aspectRatio: '16 / 9', background: 'var(--bg-2)',
        cursor: 'pointer', position: 'relative',
      }}
      title={t('rooms.viewLiveSecurity')}
    >
      <img
        key={tick}
        src={`${cameraSnapshotUrl(entityId)}?t=${tick}`}
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        onError={e => { e.target.style.opacity = 0 }}
      />
      <div style={{
        position: 'absolute', bottom: 5, insetInlineEnd: 5,
        padding: '2px 7px', borderRadius: 6,
        background: 'rgba(0,0,0,0.45)', color: '#fff',
        fontSize: 9, fontWeight: 600, letterSpacing: '0.04em',
      }}>
        {t('rooms.live')}
      </div>
    </div>
  )
}

// Legacy IRRowControls + DeviceRow removed — both replaced by the unified
// DeviceCard variant="row" rendered via renderDomainSection.
// _LegacyDeviceRow_unused removed (lines 485-591) — superseded by DeviceCard variant="row".

function VirtualDeviceRow({ device, onTrigger, triggering }) {
  const t = useT()
  const isTriggering = triggering === device.id
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '0.5px solid var(--line)' }}
      className="last:border-b-0">
      <div style={{ width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, background: `color-mix(in srgb, var(--info) 10%, var(--surface))`, flexShrink: 0 }}>
        {device.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p dir="auto" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{device.name}</p>
        <p dir="auto" style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2, fontFamily: '"IBM Plex Mono", monospace' }}>{device.capability}</p>
      </div>
      <button onClick={() => onTrigger(device)} disabled={isTriggering} title={t('rooms.runShort')}
        style={{ padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: isTriggering ? 'default' : 'pointer', fontFamily: 'inherit', background: `color-mix(in srgb, var(--ok) 10%, var(--surface))`, color: 'var(--ok)', border: '0.5px solid var(--line)', opacity: isTriggering ? 0.5 : 1 }}>
        {isTriggering ? '…' : t('rooms.run')}
      </button>
    </div>
  )
}

// ── ZIcon for RoomDetail ──────────────────────────────────────────────────────
function RoomZIcon({ name, size = 16, stroke = 1.6, color = 'currentColor' }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (name) {
    case 'light':   return <svg {...p}><path d="M9 18h6M10 22h4"/><path d="M12 2a6 6 0 0 0-4 10.5c.7.7 1 1.6 1 2.5v1h6v-1c0-.9.3-1.8 1-2.5A6 6 0 0 0 12 2z"/></svg>
    case 'climate': return <svg {...p}><path d="M14 14.76V4a2 2 0 1 0-4 0v10.76a4 4 0 1 0 4 0z"/></svg>
    case 'media':   return <svg {...p}><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/></svg>
    case 'lock':    return <svg {...p}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/></svg>
    case 'tv':      return <svg {...p}><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8"/></svg>
    case 'temp':    return <svg {...p}><path d="M14 14.76V4a2 2 0 1 0-4 0v10.76a4 4 0 1 0 4 0z"/></svg>
    case 'humid':   return <svg {...p}><path d="M12 2.5s6 7 6 11.5a6 6 0 0 1-12 0c0-4.5 6-11.5 6-11.5z"/></svg>
    case 'motion':  return <svg {...p}><circle cx="12" cy="5" r="2"/><path d="M8 22l2-6 2 2 2-2 2 6M9 12l3 3 3-3"/></svg>
    case 'back':    return <svg {...p}><path d="M15 18l-6-6 6-6"/></svg>
    case 'fwd':     return <svg {...p}><path d="M9 6l6 6-6 6"/></svg>
    case 'bolt':    return <svg {...p}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>
    case 'sparkle': return <svg {...p}><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M5.6 18.4L18.4 5.6"/></svg>
    case 'remote':  return <svg {...p}><rect x="7" y="2" width="10" height="20" rx="3"/><circle cx="12" cy="8" r="1.5"/><path d="M10 14h4M10 17h4"/></svg>
    case 'fan':     return <svg {...p}><path d="M12 12a4 4 0 0 0-4-4 4 4 0 0 0 4 4zM12 12a4 4 0 0 1 4 4 4 4 0 0 1-4-4zM12 12a4 4 0 0 0 4-4 4 4 0 0 0-4 4zM12 12a4 4 0 0 1-4 4 4 4 0 0 1 4-4z"/></svg>
    case 'cover':   return <svg {...p}><rect x="2" y="4" width="20" height="2" rx="1"/><rect x="4" y="8" width="16" height="12" rx="1"/></svg>
    case 'switch':  return <svg {...p}><path d="M18 8A6 6 0 0 1 6 8M12 8v8M8 16h8"/></svg>
    default:        return <svg {...p}><circle cx="12" cy="12" r="9"/></svg>
  }
}

// ── Domain-specific group renderers ──────────────────────────────────────────
// Hold-and-drag thresholds for the LightTile brightness gesture
// Dead legacy components removed (LightTile, LightsGroup, ExpandableCard, ClimateRowCard, MediaRowCard, TVRowCard, and tile-hold constants).
// All superseded by DeviceCard variant="tile" / variant="row" rendered via renderDomainSection.

// Compact metric label — keeps the strip tile small while still surfacing
// "humidity + battery" alongside the primary "temperature" reading.
function _fmtStripMetric(m) {
  if (m == null) return null
  const v = m.state
  if (v == null || v === 'unavailable' || v === 'unknown') return null
  const n = Number(v)
  const num = Number.isFinite(n) ? (Math.abs(n) >= 10 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(2).replace(/\.?0+$/, '')) : String(v)
  const unit = m.unit
    || ({ humidity: '%', battery: '%', signal_strength: 'dBm', illuminance: 'lx', power: 'W', energy: 'kWh', voltage: 'V', current: 'A' }[m.device_class] || '')
  return `${num}${unit ? (unit === '°' ? '°' : unit) : ''}`
}

function SensorsStrip({ devices }) {
  const renderSensor = (entity) => {
    const domain = entity.domain
    const dcRaw = entity.ha_attributes?.device_class || entity.device_class
    const name = entity._group?.name || entity.display_name || humanizeSlug(entity.entity_id) || ''
    const rawState = entity.ha_state || entity.state || '—'
    const unit = entity.ha_attributes?.unit_of_measurement || ''
    // For binary_sensors, route through formatEntityState so we get the
    // semantic "Open / Closed", "Motion / Clear" labels — including the
    // device-class fallback that handles sensors whose integration shipped
    // device_class=null (Sonoff SNZB-04 Pro). Without this, the strip
    // dumped raw "on" / "off" no matter what kind of sensor it was.
    let val = rawState
    if (domain === 'binary_sensor') {
      val = formatEntityState({
        domain, state: rawState, device_class: dcRaw,
        entity_id: entity.entity_id,
        friendly_name: entity.friendly_name || entity.display_name,
        attributes: entity.ha_attributes || entity.attributes,
      }).primary
    }
    const dc = dcRaw || inferBinarySensorClass({
      domain, device_class: dcRaw, entity_id: entity.entity_id,
      friendly_name: entity.friendly_name || entity.display_name,
    })
    let icon = 'motion'
    if (dc === 'temperature') icon = 'temp'
    else if (dc === 'humidity') icon = 'humid'
    else if (dc === 'motion' || dc === 'occupancy') icon = 'motion'
    // Pull the group's metric pills so a multi-reading sensor (Roni Room
    // Sensor: temp + humidity + battery) doesn't lose its sibling readings
    // just because grouping collapsed them to one card.
    const metrics = (entity._group?.metrics || [])
      .map(_fmtStripMetric)
      .filter(Boolean)
      .slice(0, 2)
    return { icon, val: val + unit, name, metrics }
  }
  const items = devices.map(renderSensor)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      {items.map(({ icon, val, name, metrics }, i) => (
        <div key={i} style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)' }}>
          <div style={{ color: 'var(--ink-faint)', marginBottom: 6 }}><RoomZIcon name={icon} size={13} /></div>
          <div className="z-mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{val}</div>
          {metrics.length > 0 && (
            <div className="z-mono" style={{
              fontSize: 9.5, color: 'var(--ink-faint)', marginTop: 3, letterSpacing: '0.03em',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {metrics.join(' · ')}
            </div>
          )}
          <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 2 }}>{name}</div>
        </div>
      ))}
    </div>
  )
}

// StandardDeviceRow removed — superseded by DeviceCard variant="row".

function renderDomainSection(group, devices, t) {
  const visibleDevices = devices
  if (!visibleDevices.length) return null

  // Lights → 3-col grid of tile-variant DeviceCards (keeps the dashboard rhythm)
  if (group.id === 'lights') {
    const onCount = visibleDevices.filter(e => isEntityOn(e)).length
    return (
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t ? t('rooms.lightsHeader', { label: groupLabel(group.id), on: onCount, total: visibleDevices.length }) : `${groupLabel(group.id)} · ${onCount} of ${visibleDevices.length} on`}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          {visibleDevices.map((e, i) => <DeviceCard key={e.entity_id || i} entity={e} variant="tile" tileStyle={ROOM_TILE_STYLE} />)}
        </div>
      </div>
    )
  }

  // Sensors → 3-col chip strip (compact tiles, read-only)
  if (group.id === 'sensors') {
    return (
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{groupLabel(group.id)}</p>
        <SensorsStrip devices={visibleDevices} />
      </div>
    )
  }

  // Everything else → vertical list of row-variant DeviceCards
  return (
    <div>
      <p className="z-eyebrow" style={{ marginBottom: 8 }}>{groupLabel(group.id)}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visibleDevices.map((e, i) => <DeviceCard key={e.entity_id || i} entity={e} variant="row" />)}
      </div>
    </div>
  )
}

export function RoomDetail() {
  const t = useT()
  const { roomId } = useParams()
  const navigate = useNavigate()
  // Per-field selectors — destructuring the whole store re-rendered this
  // page on every WS push, which combined with the per-render
  // getGroupedEntities() / getGroupedZiggyRooms() walks below burned the
  // main thread and made device-card taps feel laggy.
  const fetchAll          = useDeviceStore(s => s.fetchAll)
  const rawZiggyRooms     = useDeviceStore(s => s.ziggyRooms)
  const rawEntities       = useDeviceStore(s => s.entities)
  const hideEntity        = useDeviceStore(s => s.hideEntity)
  const unhideEntity      = useDeviceStore(s => s.unhideEntity)
  const hiddenEntities    = useDeviceStore(s => s.hiddenEntities)
  const updateEntityState = useDeviceStore(s => s.updateEntityState)
  const loading           = useDeviceStore(s => s.loading)
  // Group lookups depend only on entities/deviceGroups — read those raw
  // and memoize so we don't rebuild a fresh array each render.
  const deviceGroups      = useDeviceStore(s => s.deviceGroups)
  const groupByEntityId   = useDeviceStore(s => s.groupByEntityId)
  const groupById         = useDeviceStore(s => s.groupById)
  const roomShowAvgTemp   = useDeviceStore(s => s.roomShowAvgTemp)
  const setRoomShowAvgTemp = useDeviceStore(s => s.setRoomShowAvgTemp)
  const ziggyRooms = useMemo(
    () => useDeviceStore.getState().getGroupedZiggyRooms(),
    [rawZiggyRooms, deviceGroups, groupByEntityId, groupById],
  )
  const entities = useMemo(
    () => useDeviceStore.getState().getGroupedEntities(),
    [rawEntities, deviceGroups, groupByEntityId, groupById],
  )
  const addToast = useUIStore(s => s.addToast)
  const [showAdd, setShowAdd] = useState(false)
  const [addEntityId, setAddEntityId] = useState('')
  const [saving, setSaving] = useState(false)
  const [vDevices, setVDevices] = useState([])
  const [triggering, setTriggering] = useState(null)
  const [roomAutomations, setRoomAutomations] = useState([])
  const [showHiddenDevices, setShowHiddenDevices] = useState(false)
  // Header kebab menu — popover with Edit / Delete actions.
  const [menuOpen,    setMenuOpen]    = useState(false)
  const [editRoom,    setEditRoom]    = useState(null)
  const [deleteRoom_, setDeleteRoom]  = useState(null)
  const menuRef = useRef(null)

  // Click-outside / Escape to close the kebab popover.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false) }
    const onKey  = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    // Need touchstart for mobile — mousedown is unreliably dispatched on
    // mobile browsers, so the desktop-only handler never closes the menu.
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown, { passive: true })
    document.addEventListener('keydown',   onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  useEffect(() => { fetchAll({ maxAge: 120_000 }) }, [])

  useEffect(() => {
    if (!roomId) return
    getVirtualDevices(roomId).then((d) => setVDevices(d.devices || [])).catch(() => {})
    getAutomations().then((res) => {
      const all = res.automations || []
      setRoomAutomations(all.filter((a) => (a.rooms || []).includes(roomId)))
    }).catch(() => {})
  }, [roomId])

  const room = ziggyRooms.find((r) => r.id === roomId)
  const roomName = useTranslatedName(room?.name)

  // Memoize the per-device adapter + derived counts. Without this, every
  // render of RoomDetail (and on a busy install there are many — every WS
  // push to an entity outside this room still re-renders the page) would
  // rebuild fresh object references for every device. That defeats
  // DeviceCard.memo entirely (its `entity` prop was always "new"), turning
  // a single light flicker into N reconciliations and stretching the
  // click→navigate latency on big rooms.
  const roomDevices = useMemo(() => {
    const raw = (room?.devices || []).map((d) => ({
      ...d,
      entity_id: d.entity_id || null,
      state: d.ha_state ?? 'unknown',
      domain: d.domain || (d.entity_id ? d.entity_id.split('.')[0] : 'unknown'),
      display_name: d.display_name || d.entity_id || d.device_type,
      attributes: d.ha_attributes || {},
      ...(d.ha_attributes || {}),
      ziggyStatus: d.status,
    }))
    // Dedupe: when an HA entity already advertises a paired IR device via
    // _linkedIr, hide the standalone IR row that points at the same physical
    // IR device.
    const haPairedIrIds = new Set(
      raw.filter((d) => d._linkedIr?.id).map((d) => d._linkedIr.id)
    )
    return raw.filter((d) => !(d._is_ir && d._ir_device_id && haPairedIrIds.has(d._ir_device_id)))
  }, [room?.devices])

  const avgOn = !!roomShowAvgTemp?.[String(roomId)]
  const { entityCount, activeCount, offlineCount, tempSensor, humSensor, tempSensorCount } = useMemo(() => {
    // Walk the room's primary devices AND each device's grouped siblings, so
    // a multi-sensor node's humidity/temperature surfaces in the room hero
    // even when grouping made it a metric pill rather than its own card.
    const avgMetric = averageRoomMetric(roomDevices, 'temperature')
    const single    = findRoomMetric(roomDevices, 'temperature')
    return {
      entityCount:  roomDevices.length,
      activeCount:  roomDevices.filter((d) => isEntityOn(d)).length,
      offlineCount: roomDevices.filter((d) => d.state === 'unavailable' || d.state === 'unknown').length,
      tempSensor:   (avgOn ? avgMetric : null) || single,
      humSensor:    findRoomMetric(roomDevices, 'humidity'),
      tempSensorCount: avgMetric?.count || (single ? 1 : 0),
    }
  }, [roomDevices, avgOn])

  const handleToggle = async (entityId, on) => {
    if (!entityId) return
    const entity = room?.devices?.find((d) => d.entity_id === entityId)
    if (entity?.ha_state === 'unavailable') {
      addToast(t('rooms.deviceUnavailable'), 'error')
      return
    }
    updateEntityState(entityId, on ? 'on' : 'off')
    try {
      await controlDevice(entityId, on ? 'turn_on' : 'turn_off')
      addToast(on ? t('rooms.onToast') : t('rooms.offToast'), 'success')
      // No post-toggle fetchAll: controlDevice is fire-and-forget +
      // already broadcasts an optimistic state_changed; the real
      // state_changed from ha_subscriber lands within ~50 ms of HA's
      // ack and overwrites the optimistic value through the normal
      // updateEntityState path. A delayed full refetch (5 backend
      // calls including two HA WS round-trips) was a redundant
      // safety net for a problem ha_subscriber already solves.
    } catch {
      updateEntityState(entityId, on ? 'off' : 'on')
      addToast(t('rooms.failedShort'), 'error')
    }
  }

  const handleService = async (entity, service, data) => {
    try {
      await callHaService(entity.domain, service, { entity_id: entity.entity_id, ...data })
    } catch {
      addToast(t('rooms.controlFailed'), 'error')
    }
  }

  const handleRemove = async (entityId) => {
    try {
      await assignEntityToArea(entityId, null)
      await fetchAll()
      addToast(t('rooms.removedFromRoom'), 'success')
    } catch (e) {
      addToast(e.message || t('rooms.failedShort'), 'error')
    }
  }

  const handleHide = (entityId) => {
    hideEntity(entityId)
    addToast(t('rooms.deviceHidden'), 'success')
  }

  const handleUnhide = (entityId) => {
    unhideEntity(entityId)
    addToast(t('rooms.deviceVisibleAgain'), 'success')
  }

  const handleAddDevice = async () => {
    if (!addEntityId) return
    setSaving(true)
    try {
      await assignEntityToArea(addEntityId, roomId)
      await fetchAll()
      addToast(t('rooms.deviceAddedToRoom'), 'success')
      setAddEntityId('')
      setShowAdd(false)
    } catch (e) {
      addToast(e.message || t('rooms.failedShort'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleTriggerVDevice = async (device) => {
    setTriggering(device.id)
    try {
      const result = await triggerVirtualDevice(device.id)
      addToast(
        result.ok
          ? t('rooms.vDeviceSuccess', { name: device.name, msg: result.message || t('rooms.vDeviceDone') })
          : t('rooms.vDeviceFailed', { msg: result.message || t('rooms.failedShort') }),
        result.ok ? 'success' : 'error',
      )
      getVirtualDevices(roomId).then((d) => setVDevices(d.devices || [])).catch(() => {})
    } catch (e) {
      addToast(e.message || t('rooms.triggerFailed'), 'error')
    } finally {
      setTriggering(null)
    }
  }

  if (!room) {
    if (loading) {
      return (
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <div style={{ height: 200, background: 'var(--bg-2)', opacity: 0.6 }} />
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1,2,3].map(i => <div key={i} style={{ height: 50, borderRadius: 11, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
          </div>
        </div>
      )
    }
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: 'var(--ink-faint)', fontSize: 13 }}>{t('rooms.notFound')}</div>
  }

  const photo = getRoomPhoto(room)

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* Hero photo — 220px, rounded bottom */}
      <div style={{ position: 'relative', height: 220, overflow: 'hidden', borderRadius: '0 0 22px 22px' }}>
        <img src={photo} alt={roomName} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.12) 35%, rgba(0,0,0,0.72) 100%)' }} />

        {/* Back + more buttons */}
        <div style={{ position: 'absolute', top: 12, left: 16, right: 16, display: 'flex', justifyContent: 'space-between' }}>
          <button onClick={() => navigate('/rooms')} style={{
            width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.16)', backdropFilter: 'blur(20px)',
            border: 'none', color: '#fff', cursor: 'pointer',
          }}>
            <ArrowLeft size={16} className="icon-flip-rtl" />
          </button>
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setMenuOpen(v => !v)}
              aria-label={t('rooms.roomOptions')}
              aria-expanded={menuOpen}
              style={{
                width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(255,255,255,0.16)', backdropFilter: 'blur(20px)',
                border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16, letterSpacing: 1,
              }}
            >···</button>

            {menuOpen && (
              <div
                role="menu"
                style={{
                  position: 'absolute', top: 'calc(100% + 6px)', insetInlineEnd: 0,
                  background: 'var(--surface)', border: '0.5px solid var(--line)',
                  borderRadius: 12, boxShadow: 'var(--shadow-lg)',
                  padding: 4, minWidth: 160, zIndex: 10,
                  display: 'flex', flexDirection: 'column',
                }}
              >
                <button
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); setEditRoom(room) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 12px', borderRadius: 8,
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 13, color: 'var(--ink)', textAlign: 'start',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <Pencil size={14} style={{ color: 'var(--ink-mute)' }} />
                  {t('rooms.editRoom')}
                </button>
                <button
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); setDeleteRoom(room) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 12px', borderRadius: 8,
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 13, color: 'var(--accent)', textAlign: 'start',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = `color-mix(in srgb, var(--accent) 8%, var(--surface))`}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <Trash2 size={14} />
                  {t('rooms.deleteRoom')}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Title bottom */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
            <h1 dir="auto" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em', margin: 0, lineHeight: 1.1 }}>{roomName}</h1>
            {(tempSensor || humSensor) && (
              <span className="z-mono" style={{ fontSize: 11, opacity: 0.85 }}>
                {tempSensor && `${parseFloat(tempSensor.state).toFixed(1)}°`}
                {tempSensor && humSensor && ' · '}
                {humSensor && `${parseFloat(humSensor.state).toFixed(0)}%`}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, opacity: 0.85 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: activeCount > 0 ? '#6CBF8C' : 'rgba(255,255,255,0.4)', flexShrink: 0 }} />
              {activeCount === 1 ? t('rooms.deviceOn', { n: activeCount }) : t('rooms.devicesOn', { n: activeCount })}
            </span>
            <span>·</span>
            <span>{t('rooms.totalCount', { n: entityCount })}</span>
            {offlineCount > 0 && <><span>·</span><span style={{ color: 'rgba(252,165,165,0.9)' }}>{t('rooms.offlineCount', { n: offlineCount })}</span></>}
          </div>
        </div>
      </div>

      <div style={{ padding: '16px 20px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        {/* Average-temperature toggle — only meaningful with 2+ temp sensors.
            When on, the room tile + hero show the mean instead of one sensor. */}
        {tempSensorCount >= 2 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)' }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: 0 }} dir="auto">{t('rooms.avgTemp.title')}</p>
              <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', margin: '2px 0 0' }} dir="auto">{t('rooms.avgTemp.hint', { n: tempSensorCount })}</p>
            </div>
            <Toggle checked={avgOn} onCheckedChange={(v) => setRoomShowAvgTemp(roomId, v)} />
          </div>
        )}
        {/* Devices — grouped by domain type */}
        {(() => {
          const hiddenCount = roomDevices.filter(e => e.entity_id && hiddenEntities.has(e.entity_id)).length
          const visibleDevices = roomDevices.filter(e => showHiddenDevices || !e.entity_id || !hiddenEntities.has(e.entity_id))
          const deviceGroups = ROOM_DOMAIN_GROUPS.map(g => ({ ...g, devices: visibleDevices.filter(e => roomDomainGroup(e) === g.id) })).filter(g => g.devices.length > 0)

          return (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <p className="z-eyebrow">{t('rooms.devices')}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {hiddenCount > 0 && (
                    <button onClick={() => setShowHiddenDevices(v => !v)} style={{ fontSize: 11, color: 'var(--ink-faint)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                      {showHiddenDevices ? t('rooms.hideHidden', { n: hiddenCount }) : t('rooms.hiddenCount', { n: hiddenCount })}
                    </button>
                  )}
                  <button onClick={() => setShowAdd(true)} className="z-btn-secondary" style={{ padding: '5px 10px', borderRadius: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Plus size={11} /> {t('rooms.assign')}
                  </button>
                </div>
              </div>

              {deviceGroups.length === 0 && (
                <div style={{ padding: '20px 16px', borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
                  {roomDevices.length === 0 ? t('rooms.noDevicesInRoom') : t('rooms.allDevicesHidden')}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {deviceGroups.map(group => {
                  // Resolve each room device to its canonical entity shape from
                  // the store (proper _ir / _linkedIr markers, full attributes).
                  const resolved = group.devices.map(d => resolveRoomDeviceToEntity(d, entities))
                  const section = renderDomainSection(group, resolved, t)
                  return section ? <div key={group.id}>{section}</div> : null
                })}
              </div>
            </div>
          )
        })()}

        {/* Virtual / Capability Devices */}
        {vDevices.length > 0 && (
          <div>
            <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('rooms.capabilities')}</p>
            <div style={{ borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', overflow: 'hidden' }}>
              {vDevices.map(device => (
                <VirtualDeviceRow key={device.id} device={device} onTrigger={handleTriggerVDevice} triggering={triggering} />
              ))}
            </div>
          </div>
        )}

        {/* Room automations */}
        {roomAutomations.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <p className="z-eyebrow">{t('rooms.automations')}</p>
              <button onClick={() => navigate('/actions')} style={{ fontSize: 11, color: 'var(--ink-faint)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>{t('rooms.viewAll')}</button>
            </div>
            <div style={{ borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', overflow: 'hidden' }}>
              {roomAutomations.map((a, i) => (
                <div key={a.id} style={{ borderBottom: i < roomAutomations.length - 1 ? '0.5px solid var(--line)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
                    <button onClick={() => navigate('/actions')} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit', padding: 0 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: a.enabled ? `color-mix(in srgb, var(--info) 12%, var(--surface))` : 'var(--bg-2)' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={a.enabled ? 'var(--info)' : 'var(--ink-faint)'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p dir="auto" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</p>
                        {a.description && <p dir="auto" style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.description}</p>}
                      </div>
                    </button>
                    <button onClick={async e => { e.stopPropagation(); try { await triggerAutomation(a.id); addToast(t('rooms.triggered', { name: a.name }), 'success') } catch { addToast(t('rooms.failedShort'), 'error') } }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ok)', padding: 6 }} title={t('rooms.runNow')}>
                      <Play size={13} />
                    </button>
                    <span style={{ color: 'var(--ink-faint)' }}><ChevronRight size={12} className="icon-flip-rtl" /></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t('rooms.assignDevice')}>
        <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 14, lineHeight: 1.5 }}>
          {t('rooms.pickEntity')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <EntitySelect label={t('rooms.deviceLabel')} placeholder={t('rooms.searchEntities')} value={addEntityId} onChange={setAddEntityId} />
          <button onClick={handleAddDevice} disabled={!addEntityId || saving} className="z-btn-primary" style={{ width: '100%' }}>
            {saving ? t('rooms.assigning') : t('rooms.assignToRoomBtn')}
          </button>
        </div>
      </Modal>

      {/* Header kebab-menu modals — same Edit / Delete UX as the Rooms-list tiles. */}
      <RoomEditModal
        open={!!editRoom}
        room={editRoom}
        onClose={() => setEditRoom(null)}
      />

      <RoomDeleteConfirm
        room={deleteRoom_}
        onClose={() => setDeleteRoom(null)}
        onConfirm={async (r) => {
          try {
            await deleteRoom(r.id)
            await fetchAll()
            addToast(t('rooms.roomDeleted', { name: r.name }), 'success')
            setDeleteRoom(null)
            navigate('/rooms')
          } catch (e) {
            addToast(e.message || t('rooms.failedToDeleteShort'), 'error')
          }
        }}
      />
    </div>
  )
}
