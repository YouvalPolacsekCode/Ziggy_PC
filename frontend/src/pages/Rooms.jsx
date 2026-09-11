import { useEffect, useMemo, useState, useRef, lazy, Suspense } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { motion, Reorder } from 'framer-motion'
import { ArrowLeft, Plus, EyeOff, Eye, Trash2, Zap, Play, Pause, ChevronRight, Pencil, ArrowUpDown, Check, GripVertical, MoreHorizontal, Home, User, Package, Search, Lightbulb, Thermometer, Radar, Loader2, X } from 'lucide-react'
import { getMapRoomsSummary, getAutomations, triggerAutomation, getFeaturesSettings } from '../lib/api'
import { T_ENTER, T_STATE, T_PRESS } from '../lib/motion'

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
import OccupancySensorForm from '../components/automations/OccupancySensorForm'
import { useDeviceStore, applyRoomsOrder } from '../stores/deviceStore'
import { useUIStore } from '../stores/uiStore'
import { DOMAIN_GROUPS, domainGroup, groupLabel } from '../lib/domainRegistry'
import { controlDevice, createRoom, deleteRoom, resetAllRooms, renameRoom, assignEntityToArea, callHaService, getVirtualDevices, triggerVirtualDevice, patchVirtualDevice } from '../lib/api'
import { cameraSnapshotUrl } from '../stores/cameraStore'
import { cn, formatEntityState, humanizeSlug } from '../lib/utils'
import { findRoomMetric, averageRoomMetric, roomOccupancy, fusedOccupancyIdSet, inferBinarySensorClass } from '../lib/devices'
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
// binary_sensor device_classes that can be fused into a room presence sensor.
const FUSABLE_PRESENCE_DC = new Set(['motion', 'presence', 'occupancy', 'door', 'opening'])

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

// Hover-capable pointer (mouse / trackpad). The tile's edit/delete cluster is
// a desktop-hover affordance only; on touch those actions live in the room
// detail kebab, so nothing is lost by not showing the cluster there.
const canHover = () => {
  try { return window.matchMedia('(hover: hover)').matches } catch { return false }
}

function RoomTile({ room, onClick, onDelete, onEditPhoto }) {
  const t = useT()
  const roomName = useTranslatedName(room.name)
  const [hovered, setHovered] = useState(false)
  const photo = getRoomPhoto(room)
  const hasActive = room.activeCount > 0

  // Chips read white-on-glass over a photo; on a plain tile they sit on
  // surface-2, so they become ink-on-surface with a hairline instead.
  const chipBase = photo
    ? { fontSize: 13, lineHeight: '16px', color: '#fff', backdropFilter: 'blur(8px)', padding: '4px 8px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 4 }
    : { fontSize: 13, lineHeight: '16px', color: 'var(--ink)', background: 'var(--surface)', border: '0.5px solid var(--line)', padding: '4px 8px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 4 }

  const countLine = (
    <>
      {room.entityCount} · {hasActive ? t('rooms.someOn', { n: room.activeCount }) : t('rooms.idle')}
      {room.offlineCount > 0 && <> · {t('rooms.nOff', { n: room.offlineCount })}</>}
    </>
  )

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={T_ENTER}
      onMouseEnter={() => canHover() && setHovered(true)} onMouseLeave={() => setHovered(false)}
      className={photo ? undefined : 'z-room-plain'}
      style={{ position: 'relative', borderRadius: 'var(--r-card)', overflow: 'hidden', cursor: 'pointer', height: 'var(--rooms-tile-h)' }}
    >
      <button onClick={onClick} style={{
        width: '100%', height: '100%', padding: 0, border: 'none', background: 'transparent',
        cursor: 'pointer', display: 'block', position: 'relative', color: 'inherit',
      }}>
        {photo ? (
          <>
            {/* Full-bleed photo + scrim so the name stays legible on any image */}
            <img src={photo} alt={roomName} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.72) 100%)' }} />
          </>
        ) : (
          /* Plain tile: the room's line glyph top-left, name in ink below */
          <div style={{ position: 'absolute', top: 12, insetInlineStart: 12, color: 'var(--ink-mute)', display: 'flex' }}>
            <Home size={28} strokeWidth={1.75} aria-hidden />
          </div>
        )}

        {/* Status dot — top right. Hidden while hovered so the action
            cluster (Edit / Delete) can take the same corner without
            stacking on top of the dot. */}
        {!hovered && (
          <span style={{
            position: 'absolute', top: 12, insetInlineEnd: 12,
            width: 8, height: 8, borderRadius: '50%',
            background: hasActive ? 'var(--ok)' : (photo ? 'rgba(255,255,255,0.4)' : 'var(--line-2)'),
            boxShadow: hasActive ? '0 0 0 3px color-mix(in srgb, var(--ok) 35%, transparent)' : 'none',
          }} />
        )}

        {/* Temp / humidity / occupied chips. On a plain tile they sit under
            the glyph so the corner isn't crowded. Temperature is tinted by
            indoor comfort range (< 18 °C cold, > 25 °C hot); HA's
            unit_of_measurement is normalised to °C for the comparison. */}
        {(room.tempSensor || room.humSensor || room.occupied) && (
          <div style={{ position: 'absolute', top: photo ? 12 : 48, insetInlineStart: 12, display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
            {room.occupied && (
              <span title={t('rooms.occupied')} aria-label={t('rooms.occupied')}
                style={{ ...chipBase, background: photo ? 'color-mix(in srgb, var(--ok) 55%, transparent)' : 'color-mix(in srgb, var(--ok) 14%, var(--surface))', color: photo ? '#fff' : 'var(--ok-text)', padding: 4 }}>
                <User size={14} strokeWidth={2} aria-hidden />
              </span>
            )}
            {room.tempSensor && (() => {
              const raw = parseFloat(room.tempSensor.state)
              const unit = room.tempSensor.unit_of_measurement
                        || room.tempSensor.attributes?.unit_of_measurement
                        || '°C'
              const tempC = unit.includes('F') ? (raw - 32) * 5 / 9 : raw
              const bg = photo
                ? (tempC < 18 ? 'color-mix(in srgb, var(--info) 55%, transparent)'
                  : tempC > 25 ? 'color-mix(in srgb, var(--err) 55%, transparent)'
                  : 'rgba(0, 0, 0, 0.32)')
                : (tempC < 18 ? 'color-mix(in srgb, var(--info) 14%, var(--surface))'
                  : tempC > 25 ? 'color-mix(in srgb, var(--err) 14%, var(--surface))'
                  : 'var(--surface)')
              return (
                <span style={{ ...chipBase, fontVariantNumeric: 'tabular-nums', background: bg }}>
                  {raw.toFixed(1)}°
                </span>
              )
            })()}
            {room.humSensor && (
              <span style={{ ...chipBase, fontVariantNumeric: 'tabular-nums', background: photo ? 'rgba(0,0,0,0.32)' : 'var(--surface)' }}>
                {parseFloat(room.humSensor.state).toFixed(0)}%
              </span>
            )}
          </div>
        )}

        {/* Name + count — bottom. Explicit textAlign overrides the parent
            <button>'s UA-default `text-align: center`. */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12, textAlign: 'start' }}>
          <p dir="auto" style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: photo ? '#fff' : 'var(--ink)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{roomName}</p>
          <p className="z-mono" style={{ fontSize: 13, lineHeight: '18px', color: photo ? 'rgba(255,255,255,0.85)' : 'var(--ink-mute)' }}>
            {countLine}
          </p>
        </div>
      </button>

      {/* Hover actions (desktop only) — top-right so they never cover the
          chips. The status dot is suppressed while hovered so the cluster
          owns this corner cleanly. */}
      {hovered && (onEditPhoto || onDelete) && (
        <div style={{ position: 'absolute', top: 8, insetInlineEnd: 8, display: 'flex', gap: 4, zIndex: 1 }}>
          {onEditPhoto && (
            <button onClick={e => { e.stopPropagation(); onEditPhoto(room) }} title={t('rooms.editRoomAria')} aria-label={t('rooms.editRoomAria')}
              className={photo ? undefined : 'z-icon-btn'}
              style={photo
                ? { width: 36, height: 36, borderRadius: 'var(--r-ctl)', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)', border: '0.5px solid rgba(255,255,255,0.2)', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }
                : { width: 36, height: 36, color: 'var(--ink)' }}>
              <Pencil size={16} strokeWidth={1.75} />
            </button>
          )}
          {onDelete && (
            <button onClick={e => { e.stopPropagation(); onDelete(room) }} title={t('rooms.deleteRoomAria')} aria-label={t('rooms.deleteRoomAria')}
              className={photo ? undefined : 'z-icon-btn'}
              style={photo
                ? { width: 36, height: 36, borderRadius: 'var(--r-ctl)', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)', border: '0.5px solid rgba(255,255,255,0.2)', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }
                : { width: 36, height: 36, color: 'var(--err-text)' }}>
              <Trash2 size={16} strokeWidth={1.75} />
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Input label={t('rooms.roomNameLabel')} dir="auto" value={roomName} onChange={e => setRoomName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSave()} />
        <div>
          <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 8 }}>{t('rooms.photo')}</p>
          {customPhoto && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ position: 'relative', borderRadius: 'var(--r-ctl)', overflow: 'hidden', height: 120, marginBottom: 8 }}>
                <img src={customPhoto} alt={t('rooms.customAlt')} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                <button type="button" onClick={() => setCustomPhoto(null)} aria-label={t('common.remove')} style={{ position: 'absolute', top: 8, insetInlineEnd: 8, width: 44, height: 44, borderRadius: 'var(--r-ctl)', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                  <X size={18} strokeWidth={1.75} />
                </button>
              </div>
            </div>
          )}
          <div style={{ height: 252, overflowY: 'scroll', borderRadius: 'var(--r-ctl)', border: '0.5px solid var(--line)', marginBottom: 12 }} className="scrollbar-thin">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, padding: 8 }}>
              {PHOTO_OPTIONS.map(({ key, label }) => {
                const isSelected = !customPhoto && photoKey === key
                return (
                  <button key={key} type="button" onClick={() => { setPhotoKey(key); setCustomPhoto(null) }} aria-pressed={isSelected} style={{
                    position: 'relative', overflow: 'hidden', borderRadius: 'var(--r-ctl)',
                    height: 72,
                    border: isSelected ? '2px solid var(--ink)' : '2px solid transparent',
                    cursor: 'pointer', padding: 0, background: 'var(--surface-2)',
                    opacity: isSelected ? 1 : 0.7,
                    transition: 'opacity var(--dur-press) var(--ease-standard), border-color var(--dur-press) var(--ease-standard)',
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
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44, padding: '8px 12px', borderRadius: 'var(--r-ctl)', border: '1px dashed var(--line-2)', fontSize: 15, fontWeight: 500, color: 'var(--ink-mute)', cursor: 'pointer' }}>
              {t('rooms.takePhoto')}
              <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleUpload} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44, padding: '8px 12px', borderRadius: 'var(--r-ctl)', border: '1px dashed var(--line-2)', fontSize: 15, fontWeight: 500, color: 'var(--ink-mute)', cursor: 'pointer' }}>
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

// Destructive confirm button — the --err family, never the brand accent.
// Same geometry as .z-btn-secondary (17px, 12/20, min-height 44).
const DESTRUCTIVE_BTN = {
  background: 'color-mix(in srgb, var(--err) 10%, var(--surface))',
  color: 'var(--err-text)',
  border: '0.5px solid color-mix(in srgb, var(--err) 40%, var(--line))',
  borderRadius: 'var(--r-ctl)', padding: '12px 20px', minHeight: 44,
  fontFamily: 'inherit', fontSize: 17, fontWeight: 600, cursor: 'pointer',
}

// Popover menu item — 44px rows, 17px text, 18px glyph. Hover is a CSS
// transition on background; the JS handlers only flip the colour.
const MENU_ITEM = {
  display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, padding: '8px 12px',
  borderRadius: 'var(--r-ctl)', background: 'transparent', border: 'none', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 17, color: 'var(--ink)', textAlign: 'start', width: '100%',
  transition: 'background var(--dur-press) var(--ease-standard)',
}
const menuHover = (bg) => ({
  onMouseEnter: (e) => { e.currentTarget.style.background = bg },
  onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent' },
})
const MENU_POPOVER = {
  position: 'absolute', top: 'calc(100% + 4px)', insetInlineEnd: 0,
  background: 'var(--surface)', border: '0.5px solid var(--line)',
  borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-lg)',
  padding: 4, minWidth: 200, zIndex: 10, whiteSpace: 'nowrap',
  display: 'flex', flexDirection: 'column',
}

// ── Shared Delete-room confirm modal ──────────────────────────────────────────
export function RoomDeleteConfirm({ room, onClose, onConfirm }) {
  const t = useT()
  return (
    <Modal open={!!room} onClose={onClose} title={t('rooms.deleteRoomTitle')}>
      <p className="z-subhead" style={{ marginBottom: 16, lineHeight: 1.5 }}>
        {t('rooms.deleteRoomLong', { name: room?.name || '' })}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onClose} className="z-btn-secondary" style={{ flex: 1 }}>{t('common.cancel')}</button>
        <button onClick={() => onConfirm(room)} style={{ flex: 1, ...DESTRUCTIVE_BTN }}>{t('common.delete')}</button>
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
      transition={T_STATE}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 12px 8px 8px', minHeight: 56,
        background: 'var(--surface)',
        border: '0.5px solid var(--line)',
        borderRadius: 'var(--r-card)',
        cursor: 'grab',
        // Tells the browser the element captures touch — without this, mobile
        // Safari treats the long-press as a scroll gesture and the drag never
        // starts.
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      <div className={photo ? undefined : 'z-room-plain'} style={{ width: 44, height: 44, borderRadius: 'var(--r-ctl)', overflow: 'hidden', flexShrink: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-mute)' }}>
        {photo
          ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <Home size={20} strokeWidth={1.75} aria-hidden />}
        <span style={{
          position: 'absolute', top: 4, insetInlineEnd: 4,
          width: 8, height: 8, borderRadius: '50%',
          background: hasActive ? 'var(--ok)' : (photo ? 'rgba(255,255,255,0.5)' : 'var(--line-2)'),
        }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p dir="auto" style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{roomName}</p>
        <p className="z-subhead z-mono" style={{ marginTop: 2 }}>
          {room.entityCount === 1 ? t('rooms.deviceCountSingular', { n: room.entityCount }) : t('rooms.deviceCount', { n: room.entityCount })}
          {hasActive && <span style={{ color: 'var(--ok-text)', marginInlineStart: 4 }}>· {t('rooms.someOn', { n: room.activeCount })}</span>}
        </p>
      </div>
      <GripVertical size={20} strokeWidth={1.75} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} aria-hidden />
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
  const occupancySensors = useDeviceStore(s => s.occupancySensors)
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
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [editPhotoRoom, setEditPhotoRoom] = useState(null)
  const [search, setSearch] = useState('')
  // Reorder mode: tap the [↕] in the header to enter; tap Done to commit, X
  // to cancel. While editing we work on `draftOrder` (a snapshot of the
  // current rooms in their saved order) so the live store isn't mutated until
  // the user confirms — and the saved order isn't disturbed if they bail.
  const [reorderMode, setReorderMode] = useState(false)
  const [draftOrder, setDraftOrder] = useState([])
  // Header overflow (⋮) menu: folds the low-frequency Reorder + Reset actions
  // into one compact control so the header reads [search] … [⋮] [+ Add].
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const headerMenuRef = useRef(null)
  useEffect(() => {
    if (!headerMenuOpen) return
    const onDown = (e) => { if (headerMenuRef.current && !headerMenuRef.current.contains(e.target)) setHeaderMenuOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setHeaderMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [headerMenuOpen])

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
    occupied:     roomOccupancy(r, entityMap, occupancySensors),
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

  // Reset home: delete every room + clear all placements (devices stay paired).
  // Backend enforces super_admin. Used to blank a home from a clean slate.
  const handleResetAll = async () => {
    setResetting(true)
    try {
      await resetAllRooms()
      await fetchAll()
      addToast(t('rooms.resetAllDone'), 'success')
      setConfirmReset(false)
    } catch (e) {
      addToast(e.message || t('rooms.resetAllFailed'), 'error')
    } finally {
      setResetting(false)
    }
  }

  const filteredRooms = orderedRooms.filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{ maxWidth: 'var(--page-max-w)', margin: '0 auto', padding: '24px 20px 24px' }}>
      {/* Header — eyebrow, Large Title, one trailing action cluster. The
          "N rooms" footnote is gone: the grid is the count. */}
      <div className="z-page-head">
        <div>
          <p className="z-eyebrow">{reorderMode ? t('rooms.editOrder') : t('rooms.yourHome')}</p>
          <h1 className="z-display" style={{ margin: 0 }}>{t('rooms.title')}</h1>
          {reorderMode && <p className="z-footnote">{t('rooms.dragToReorder')}</p>}
        </div>
        {/* Reorder mode replaces the icon buttons with Cancel / Done so the
            destructive paths (creating, deleting) aren't reachable while the
            user is mid-reorder. Done is the one primary action in that mode. */}
        {reorderMode ? (
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={cancelReorder} className="z-btn-secondary" aria-label={t('rooms.cancelReorderAria')}>
              {t('common.cancel')}
            </button>
            <button onClick={saveReorder} className="z-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Check size={18} strokeWidth={2} /> {t('common.done')}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {/* Reorder + Reset are low-frequency — one overflow button. */}
            {rooms.length > 0 && (
              <div ref={headerMenuRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setHeaderMenuOpen((o) => !o)}
                  aria-label={t('rooms.moreActions')}
                  aria-haspopup="menu"
                  aria-expanded={headerMenuOpen}
                  className="z-icon-btn"
                >
                  <MoreHorizontal size={20} strokeWidth={1.75} />
                </button>
                {headerMenuOpen && (
                  <div role="menu" style={MENU_POPOVER}>
                    {rooms.length > 1 && (
                      <button role="menuitem" onClick={() => { setHeaderMenuOpen(false); startReorder() }}
                        style={MENU_ITEM} {...menuHover('var(--surface-2)')}>
                        <ArrowUpDown size={18} strokeWidth={1.75} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
                        <span style={{ flex: 1 }}>{t('rooms.reorder')}</span>
                      </button>
                    )}
                    <button role="menuitem" onClick={() => { setHeaderMenuOpen(false); setConfirmReset(true) }}
                      style={{ ...MENU_ITEM, color: 'var(--err-text)' }} {...menuHover('color-mix(in srgb, var(--err) 8%, var(--surface))')}>
                      <Trash2 size={18} strokeWidth={1.75} style={{ flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>{t('rooms.resetAll')}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
            <button onClick={() => setShowAdd(true)} className="z-icon-btn" aria-label={t('rooms.add')} title={t('rooms.add')}>
              <Plus size={20} strokeWidth={1.75} />
            </button>
          </div>
        )}
      </div>

      {/* Search bar — hidden in reorder mode (search filtering would hide the
          very rows the user is trying to drag, and the address-bar input
          steals focus from drag gestures on mobile). */}
      {!reorderMode && (
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <Search size={18} strokeWidth={1.75} aria-hidden style={{ position: 'absolute', insetInlineStart: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--ink-faint)' }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('rooms.searchPlaceholder')}
            dir="auto"
            type="search"
            className="z-input"
            style={{ paddingInlineStart: 44, height: 44, boxSizing: 'border-box' }}
          />
        </div>
      )}

      {/* Empty state — only when truly empty, not during a background refresh */}
      {rooms.length === 0 && unassigned.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <p style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{t('rooms.empty')}</p>
          <p className="z-subhead" style={{ marginBottom: 16 }}>{t('rooms.emptyHint')}</p>
          <button onClick={() => setShowAdd(true)} className="z-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Plus size={18} strokeWidth={1.75} /> {t('rooms.addFirstRoom')}
          </button>
        </div>
      )}

      {/* Search with no matches — one line, nothing else */}
      {!reorderMode && !loading && search && rooms.length > 0 && filteredRooms.length === 0 && (
        <p style={{ fontSize: 17, color: 'var(--ink-mute)', textAlign: 'center', padding: 32, margin: 0 }} dir="auto">
          {t('rooms.noMatches')}
        </p>
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
            <div key={i} style={{ height: 'var(--rooms-tile-h)', borderRadius: 'var(--r-card)', background: 'var(--surface-2)', opacity: 0.6 }} />
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
          {unassigned.length > 0 && (
            <Link to="/devices?filter=unassigned" style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: 16, minHeight: 56,
              borderRadius: 'var(--r-card)', textDecoration: 'none',
              border: '1px dashed color-mix(in srgb, var(--warn) 50%, var(--line))',
              background: 'color-mix(in srgb, var(--warn) 6%, var(--surface))',
            }}>
              <Package size={22} strokeWidth={1.75} aria-hidden style={{ color: 'var(--warn)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--warn-text)', marginBottom: 2 }}>{unassigned.length === 1 ? t('rooms.unassignedDeviceCountSingular', { n: unassigned.length }) : t('rooms.unassignedDevicesCount', { n: unassigned.length })}</p>
                <p className="z-subhead">{t('rooms.tapToAssign')}</p>
              </div>
              <ChevronRight size={16} strokeWidth={1.75} className="icon-flip-rtl" style={{ color: 'var(--warn)', flexShrink: 0 }} />
            </Link>
          )}
          {noRoomDevices.length > 0 && (
            <Link to="/devices?filter=noroom" style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: 16, minHeight: 56,
              borderRadius: 'var(--r-card)', textDecoration: 'none',
              border: '0.5px solid var(--line)', background: 'var(--surface)',
            }}>
              <Home size={22} strokeWidth={1.75} aria-hidden style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{noRoomDevices.length === 1 ? t('rooms.noRoomDeviceCountSingular', { n: noRoomDevices.length }) : t('rooms.noRoomDevicesCount', { n: noRoomDevices.length })}</p>
                <p className="z-subhead">{t('rooms.intentionalNoRoom')}</p>
              </div>
              <ChevronRight size={16} strokeWidth={1.75} className="icon-flip-rtl" style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
            </Link>
          )}
        </div>
      )}

      {/* Add room modal */}
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setNewRoomName(''); setNewRoomPhoto('living_room') }} title={t('rooms.addRoomTitle')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Input label={t('rooms.roomNameLabel')} placeholder={t('rooms.namePlaceholderExamples')} dir="auto" value={newRoomName} onChange={e => setNewRoomName(e.target.value)} autoFocus onKeyDown={e => e.key === 'Enter' && handleAddRoom()} />
          <div>
            <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 8 }}>{t('rooms.photo')}</p>
            <div style={{ height: 252, overflowY: 'scroll', borderRadius: 'var(--r-ctl)', border: '0.5px solid var(--line)' }} className="scrollbar-thin">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, padding: 8 }}>
                {PHOTO_OPTIONS.map(({ key, label }) => {
                  const isSelected = newRoomPhoto === key
                  return (
                    <button key={key} type="button" onClick={() => setNewRoomPhoto(key)} aria-pressed={isSelected} style={{
                      position: 'relative', overflow: 'hidden', borderRadius: 'var(--r-ctl)',
                      height: 72,
                      border: isSelected ? '2px solid var(--ink)' : '2px solid transparent',
                      cursor: 'pointer', padding: 0, background: 'var(--surface-2)',
                      opacity: isSelected ? 1 : 0.7,
                      transition: 'opacity var(--dur-press) var(--ease-standard), border-color var(--dur-press) var(--ease-standard)',
                      flexShrink: 0,
                    }}>
                      <img src={ROOM_PHOTOS[key]} alt={label} style={{
                        position: 'absolute', inset: 0, width: '100%', height: '100%',
                        objectFit: 'cover', display: 'block',
                      }} />
                      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, transparent 50%)' }} />
                      <span style={{ position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center', fontSize: 13, color: '#fff', fontWeight: 600 }}>{label}</span>
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

      <Modal open={confirmReset} onClose={() => !resetting && setConfirmReset(false)} title={t('rooms.resetAllTitle')}>
        <p className="z-subhead" style={{ marginBottom: 16, lineHeight: 1.5 }}>
          {t('rooms.resetAllLong')}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setConfirmReset(false)} disabled={resetting} className="z-btn-secondary" style={{ flex: 1 }}>{t('common.cancel')}</button>
          <button onClick={handleResetAll} disabled={resetting} style={{ flex: 1, ...DESTRUCTIVE_BTN, cursor: resetting ? 'wait' : 'pointer' }}>
            {resetting ? t('rooms.resetting') : t('rooms.resetAllConfirm')}
          </button>
        </div>
      </Modal>

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
        marginTop: 8, borderRadius: 'var(--r-ctl)', overflow: 'hidden',
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
        padding: '2px 8px', borderRadius: 'var(--r-chip)',
        background: 'rgba(0,0,0,0.45)', color: '#fff',
        fontSize: 11, fontWeight: 500, letterSpacing: '0.04em',
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', minHeight: 56, borderBottom: '0.5px solid var(--line)' }}
      className="last:border-b-0">
      <div style={{ width: 44, height: 44, borderRadius: 'var(--r-ctl)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--info)', background: 'color-mix(in srgb, var(--info) 10%, var(--surface))', flexShrink: 0 }}>
        <Zap size={20} strokeWidth={1.75} aria-hidden />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p dir="auto" style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{device.name}</p>
        <p dir="auto" className="z-subhead" style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{device.capability}</p>
      </div>
      <button onClick={() => onTrigger(device)} disabled={isTriggering} title={t('rooms.run')} aria-label={t('rooms.run')}
        className="z-icon-btn" style={{ color: isTriggering ? 'var(--ink-faint)' : 'var(--ok-text)', cursor: isTriggering ? 'default' : 'pointer' }}>
        {isTriggering ? <Loader2 size={18} strokeWidth={1.75} className="z-spin" /> : <Play size={18} strokeWidth={1.75} />}
      </button>
    </div>
  )
}

// ── ZIcon for RoomDetail ──────────────────────────────────────────────────────
function RoomZIcon({ name, size = 16, stroke = 1.75, color = 'currentColor' }) {
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

function SensorsStrip({ devices }) {
  const navigate = useNavigate()
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
    // Sibling readings (humidity / battery on a multi-sensor node) are not
    // rendered here any more — the tile is value + name; the device page
    // carries the rest.
    return { icon, val: val + unit, name, entityId: entity.entity_id }
  }
  const items = devices.map(renderSensor)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
      {items.map(({ icon, val, name, entityId }, i) => (
        // Whole tile is the tap target → the entity's device page, matching how
        // the light tiles / device cards open. IR-less sensors get no controls,
        // so the readings themselves are the affordance.
        <button
          key={entityId || i}
          type="button"
          onClick={() => entityId && navigate(`/devices/${encodeURIComponent(entityId)}`)}
          style={{
            textAlign: 'start', font: 'inherit', cursor: entityId ? 'pointer' : 'default',
            padding: 12, minHeight: 44, borderRadius: 'var(--r-card)', background: 'var(--surface)',
            border: '0.5px solid var(--line)', minWidth: 0,
            transition: 'background var(--dur-press) var(--ease-standard)',
          }}
          onMouseEnter={(e) => { if (entityId) e.currentTarget.style.background = 'var(--surface-2)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface)' }}
        >
          <div style={{ color: 'var(--ink-faint)', marginBottom: 8, display: 'flex' }}><RoomZIcon name={icon} size={18} /></div>
          <div className="z-mono" style={{ fontSize: 22, lineHeight: '28px', fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</div>
          <div dir="auto" className="z-footnote" style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        </button>
      ))}
    </div>
  )
}

// StandardDeviceRow removed — superseded by DeviceCard variant="row".

// The room page shows at most five group headers: Lights · Climate · Media ·
// Other · Sensors. Switches / covers / security / water fold into Other so a
// busy room doesn't stack eight eyebrows.
const ROOM_SECTION_IDS = ['lights', 'climate', 'media', 'other', 'sensors']
const roomSectionId = (groupId) => ROOM_SECTION_IDS.includes(groupId) ? groupId : 'other'

function renderDomainSection(group, devices, t) {
  const visibleDevices = devices
  if (!visibleDevices.length) return null

  // Lights → 3-col grid of tile-variant DeviceCards (keeps the dashboard
  // rhythm). No "N of M on" in the eyebrow — the hero line and the Lights
  // row already carry that number.
  if (group.id === 'lights') {
    return (
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{groupLabel(group.id)}</p>
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
  const occupancySensors  = useDeviceStore(s => s.occupancySensors)
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
  const fusedOccIds = useMemo(() => fusedOccupancyIdSet(occupancySensors), [occupancySensors])
  const roomDevices = useMemo(() => {
    const raw = (room?.devices || [])
      // Fused presence sensors are Ziggy plumbing (they drive Smart Room + the
      // room's "occupied" chip) — never surface them as a device tile.
      .filter((d) => !(d.entity_id && fusedOccIds.has(d.entity_id)))
      .map((d) => ({
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
  }, [room?.devices, fusedOccIds])

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

  const entityMapRD = useMemo(() => Object.fromEntries(entities.map((e) => [e.entity_id, e])), [entities])
  const occupied = useMemo(() => roomOccupancy(room, entityMapRD, occupancySensors), [room, entityMapRD, occupancySensors])
  const [showCombineSensors, setShowCombineSensors] = useState(false)
  const [showPresences, setShowPresences] = useState(false)
  // Smart Presences that belong to THIS room (its main presence + any zones,
  // e.g. an en-suite). Each is a 1:1 candidate to drive its own Smart Room.
  const roomPresences = useMemo(() => {
    const rn = String(room?.name || '').toLowerCase()
    const rid = String(roomId).toLowerCase()
    return (occupancySensors || []).filter((s) => {
      const sr = String(s.room || '').toLowerCase()
      return sr === rid || sr === rn || sr.replace(/_/g, ' ') === rn
    })
  }, [occupancySensors, room, roomId])

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

  // Room-level light switch. Every visible, reachable light in the room, in
  // one optimistic sweep: flip the store first, fire one controlDevice per
  // light, roll back only the ones that failed. One toast at most.
  const roomLights = useMemo(
    () => roomDevices.filter((d) =>
      d.entity_id && roomDomainGroup(d) === 'lights' && !hiddenEntities.has(d.entity_id)
      && d.state !== 'unavailable'),
    [roomDevices, hiddenEntities],
  )
  const lightsOnCount = roomLights.filter((d) => isEntityOn(d)).length
  const handleAllLights = async (on) => {
    const targets = roomLights.filter((d) => isEntityOn(d) !== on)
    if (!targets.length) return
    for (const d of targets) updateEntityState(d.entity_id, on ? 'on' : 'off')
    const results = await Promise.allSettled(
      targets.map((d) => controlDevice(d.entity_id, on ? 'turn_on' : 'turn_off')),
    )
    const failed = targets.filter((_, i) => results[i].status === 'rejected')
    for (const d of failed) updateEntityState(d.entity_id, on ? 'off' : 'on')
    if (failed.length) addToast(t('rooms.failedShort'), 'error')
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
        <div style={{ maxWidth: 'var(--page-max-w-narrow)', margin: '0 auto' }}>
          <div style={{ height: 160, background: 'var(--surface-2)', opacity: 0.6, borderRadius: '0 0 24px 24px' }} />
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1,2,3].map(i => <div key={i} style={{ height: 56, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
          </div>
        </div>
      )
    }
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, color: 'var(--ink-mute)', fontSize: 17 }}>{t('rooms.notFound')}</div>
  }

  const photo = getRoomPhoto(room)
  // Over a photo the hero text is white on a scrim; on a plain hero it is ink.
  const heroInk  = photo ? '#fff' : 'var(--ink)'
  const heroMute = photo ? 'rgba(255,255,255,0.85)' : 'var(--ink-mute)'
  const heroBtn  = photo
    ? { width: 44, height: 44, borderRadius: 'var(--r-ctl)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.16)', backdropFilter: 'blur(20px)', border: 'none', color: '#fff', cursor: 'pointer', padding: 0 }
    : undefined
  // One 15px line: occupied · temp · humidity · N on · M total · N offline
  const heroFacts = [
    occupied ? t('rooms.occupied') : null,
    tempSensor ? `${parseFloat(tempSensor.state).toFixed(1)}°` : null,
    humSensor ? `${parseFloat(humSensor.state).toFixed(0)}%` : null,
    t('rooms.someOn', { n: activeCount }),
    t('rooms.totalCount', { n: entityCount }),
    offlineCount > 0 ? t('rooms.offlineCount', { n: offlineCount }) : null,
  ].filter(Boolean)

  return (
    <div style={{ maxWidth: 'var(--page-max-w-narrow)', margin: '0 auto' }}>
      {/* Hero — 160px, rounded bottom. Photo + scrim, or a plain surface. */}
      <div className={photo ? undefined : 'z-room-plain'} style={{ position: 'relative', height: 160, overflow: 'hidden', borderRadius: '0 0 24px 24px' }}>
        {photo && (
          <>
            <img src={photo} alt={roomName} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.32) 0%, transparent 30%, transparent 40%, rgba(0,0,0,0.72) 100%)' }} />
          </>
        )}

        {/* Back + more buttons */}
        <div style={{ position: 'absolute', top: 12, insetInline: 16, display: 'flex', justifyContent: 'space-between' }}>
          <button onClick={() => navigate('/rooms')} aria-label={t('common.back')} className={photo ? undefined : 'z-icon-btn'} style={heroBtn}>
            <ArrowLeft size={20} strokeWidth={1.75} className="icon-flip-rtl" />
          </button>
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setMenuOpen(v => !v)}
              aria-label={t('rooms.roomOptions')}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={photo ? undefined : 'z-icon-btn'}
              style={heroBtn}
            >
              <MoreHorizontal size={20} strokeWidth={1.75} />
            </button>

            {menuOpen && (
              <div role="menu" style={MENU_POPOVER}>
                {/* Average temperature — only when the room has 2+ temp sensors.
                    Tap toggles it; ✓ shows the current state. */}
                {tempSensorCount >= 2 && (
                  <button
                    role="menuitemcheckbox"
                    aria-checked={avgOn}
                    onClick={() => { setMenuOpen(false); setRoomShowAvgTemp(roomId, !avgOn) }}
                    style={MENU_ITEM} {...menuHover('var(--surface-2)')}
                  >
                    <Thermometer size={18} strokeWidth={1.75} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} aria-hidden />
                    <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('rooms.avgTemp.title')}</span>
                    {avgOn && <Check size={18} strokeWidth={2} style={{ color: 'var(--ok-text)', flexShrink: 0 }} />}
                  </button>
                )}
                {/* Smart Presence — view this room's fused presence sensors
                    (main + zones) and create a new one. Room-scoped, and each
                    presence can drive its own Smart Room. */}
                <button
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); setShowPresences(true) }}
                  style={MENU_ITEM} {...menuHover('var(--surface-2)')}
                >
                  <Radar size={18} strokeWidth={1.75} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} aria-hidden />
                  <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('rooms.smartPresence.menu')}</span>
                  {roomPresences.length > 0 && (
                    <span className="z-mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-mute)', flexShrink: 0 }}>{roomPresences.length}</span>
                  )}
                </button>
                <button
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); setEditRoom(room) }}
                  style={MENU_ITEM} {...menuHover('var(--surface-2)')}
                >
                  <Pencil size={18} strokeWidth={1.75} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} aria-hidden />
                  <span style={{ flex: 1 }}>{t('rooms.editRoom')}</span>
                </button>
                <button
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); setDeleteRoom(room) }}
                  style={{ ...MENU_ITEM, color: 'var(--err-text)' }} {...menuHover('color-mix(in srgb, var(--err) 8%, var(--surface))')}
                >
                  <Trash2 size={18} strokeWidth={1.75} style={{ flexShrink: 0 }} aria-hidden />
                  <span style={{ flex: 1 }}>{t('rooms.deleteRoom')}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Title block — name, then one line of facts */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0 20px 16px', color: heroInk }}>
          <h1 dir="auto" className="z-display" style={{ margin: 0, color: heroInk, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{roomName}</h1>
          <p className="z-mono" style={{ fontSize: 15, lineHeight: '20px', color: heroMute, margin: '4px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {heroFacts.join(' · ')}
          </p>
        </div>
      </div>

      <div style={{ padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Room-level control: every light in the room, one switch. Skipped
            when the room has no reachable lights. */}
        {roomLights.length > 0 && (
          <div className="z-card" style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '8px 16px' }}>
            <Lightbulb size={20} strokeWidth={1.75} aria-hidden style={{ color: lightsOnCount > 0 ? 'var(--ink)' : 'var(--ink-mute)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)', margin: 0 }}>{t('rooms.lights')}</p>
              <p className="z-subhead z-mono" style={{ margin: 0 }}>
                {lightsOnCount > 0 ? t('rooms.someOn', { n: lightsOnCount }) : t('rooms.nOff', { n: roomLights.length })}
              </p>
            </div>
            <Toggle
              checked={lightsOnCount > 0}
              onCheckedChange={(v) => handleAllLights(!!v)}
              aria-label={t('rooms.lights')}
            />
          </div>
        )}

        {/* Devices — grouped by domain type */}
        {(() => {
          const hiddenCount = roomDevices.filter(e => e.entity_id && hiddenEntities.has(e.entity_id)).length
          const visibleDevices = roomDevices.filter(e => showHiddenDevices || !e.entity_id || !hiddenEntities.has(e.entity_id))
          // Collapse the registry's nine groups to the five room sections;
          // the registry order is kept, so Sensors still lands last.
          const deviceGroups = ROOM_SECTION_IDS
            .map(id => ({ id, label: groupLabel(id), devices: visibleDevices.filter(e => roomSectionId(roomDomainGroup(e)) === id) }))
            .filter(g => g.devices.length > 0)

          return (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
                <p className="z-eyebrow">{t('rooms.devices')}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {hiddenCount > 0 && (
                    <button onClick={() => setShowHiddenDevices(v => !v)} style={{ fontSize: 15, color: 'var(--ink-mute)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', minHeight: 44, padding: '0 12px' }}>
                      {showHiddenDevices ? t('rooms.hideHidden', { n: hiddenCount }) : t('rooms.hiddenCount', { n: hiddenCount })}
                    </button>
                  )}
                  <button onClick={() => setShowAdd(true)} className="z-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Plus size={18} strokeWidth={1.75} /> {t('rooms.assign')}
                  </button>
                </div>
              </div>

              {deviceGroups.length === 0 && (
                <div className="z-card" style={{ padding: 32, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 17 }}>
                  {roomDevices.length === 0 ? t('rooms.noDevicesInRoom') : t('rooms.allDevicesHidden')}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
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
            <div className="z-card" style={{ overflow: 'hidden' }}>
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
              <button onClick={() => navigate('/actions')} style={{ fontSize: 15, color: 'var(--ink-mute)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', minHeight: 44, padding: '0 12px' }}>{t('rooms.viewAll')}</button>
            </div>
            <div className="z-card" style={{ overflow: 'hidden' }}>
              {roomAutomations.map((a, i) => (
                <div key={a.id} style={{ borderBottom: i < roomAutomations.length - 1 ? '0.5px solid var(--line)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 8px 16px', minHeight: 56 }}>
                    <button onClick={() => navigate('/actions')} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, minHeight: 44, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit', padding: 0, color: 'inherit' }}>
                      <div style={{ width: 44, height: 44, borderRadius: 'var(--r-ctl)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: a.enabled ? 'var(--info)' : 'var(--ink-faint)', background: a.enabled ? 'color-mix(in srgb, var(--info) 12%, var(--surface))' : 'var(--surface-2)' }}>
                        <Zap size={20} strokeWidth={1.75} aria-hidden />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p dir="auto" style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</p>
                        {a.description && <p dir="auto" className="z-subhead" style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.description}</p>}
                      </div>
                    </button>
                    <button onClick={async e => { e.stopPropagation(); try { await triggerAutomation(a.id); addToast(t('rooms.triggered', { name: a.name }), 'success') } catch (err) { addToast(err?.userMessage || t('rooms.failedShort'), 'error') } }}
                      className="z-icon-btn" style={{ color: 'var(--ok-text)' }} title={t('rooms.runNow')} aria-label={t('rooms.runNow')}>
                      <Play size={18} strokeWidth={1.75} />
                    </button>
                    <ChevronRight size={16} strokeWidth={1.75} className="icon-flip-rtl" aria-hidden style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t('rooms.assignDevice')}>
        <p className="z-subhead" style={{ marginBottom: 16, lineHeight: 1.5 }}>
          {t('rooms.pickEntity')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <EntitySelect label={t('rooms.deviceLabel')} placeholder={t('rooms.searchEntities')} value={addEntityId} onChange={setAddEntityId} />
          <button onClick={handleAddDevice} disabled={!addEntityId || saving} className="z-btn-primary" style={{ width: '100%' }}>
            {saving ? t('rooms.assigning') : t('rooms.assignToRoomBtn')}
          </button>
        </div>
      </Modal>

      {/* Smart Presence: see this room's fused presences + create a new one. */}
      <Modal open={showPresences} onClose={() => setShowPresences(false)} title={t('rooms.smartPresence.menu')}>
        <p className="z-subhead" style={{ marginBottom: 16, lineHeight: 1.5 }}>
          {t('rooms.smartPresence.hint')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {roomPresences.length === 0 ? (
            <p style={{ fontSize: 17, color: 'var(--ink-mute)', textAlign: 'center', padding: '16px 0', margin: 0 }}>
              {t('rooms.smartPresence.none')}
            </p>
          ) : roomPresences.map((s) => {
            const isZone = (s.key || s.room) !== s.room
            return (
              <div key={s.entity_id} className="z-card-soft" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', minHeight: 56 }}>
                <Radar size={20} strokeWidth={1.75} aria-hidden style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{s.name || t('automations.smartRoom.wiz.mergedSensor')}</div>
                  <div className="z-subhead">
                    {t('rooms.smartPresence.sources', { n: (s.sensors || []).length })}{isZone ? ` · ${t('rooms.smartPresence.zone')}` : ''}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <button className="z-btn-primary" style={{ width: '100%' }}
          onClick={() => { setShowPresences(false); setShowCombineSensors(true) }}>
          {t('rooms.smartPresence.create')}
        </button>
      </Modal>

      {/* Combine this room's sensors into one presence signal (gated to 2+). */}
      <Modal open={showCombineSensors} onClose={() => setShowCombineSensors(false)} title={t('automations.smartSensor.title')}>
        {showCombineSensors && (
          <OccupancySensorForm
            initialRoom={roomId}
            onCreated={async () => {
              setShowCombineSensors(false)
              addToast(t('automations.smartSensor.created'), 'success')
              try { await fetchAll({ force: true }) } catch {}
            }}
            onClose={() => setShowCombineSensors(false)}
          />
        )}
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
