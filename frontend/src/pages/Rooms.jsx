import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Plus, Trash2, EyeOff } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Badge } from '../components/ui/Badge'
import { DeviceControls, TOGGLEABLE_DOMAINS } from '../components/ui/DeviceControls'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { EntitySelect } from '../components/ui/EntitySelect'
import { useDeviceStore } from '../stores/deviceStore'
import { useUIStore } from '../stores/uiStore'
import { domainIcon, formatEntityState } from '../lib/utils'
import { sendIntent, createRoom, deleteRoom, assignEntityToArea, callHaService, getVirtualDevices, triggerVirtualDevice, patchVirtualDevice } from '../lib/api'
import { cn } from '../lib/utils'

const ROOM_PHOTOS = {
  living_room: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&q=80',
  bedroom: 'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=400&q=80',
  kitchen: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&q=80',
  bathroom: 'https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?w=400&q=80',
  office: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=400&q=80',
  garage: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=80',
  hallway: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&q=80',
  garden: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=400&q=80',
}
const DEFAULT_PHOTO = 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&q=80'

const PHOTO_OPTIONS = [
  { key: 'living_room', label: 'Living Room' },
  { key: 'bedroom', label: 'Bedroom' },
  { key: 'kitchen', label: 'Kitchen' },
  { key: 'bathroom', label: 'Bathroom' },
  { key: 'office', label: 'Office' },
  { key: 'garage', label: 'Garage' },
  { key: 'hallway', label: 'Hallway' },
  { key: 'garden', label: 'Garden' },
]

function getRoomPhoto(room) {
  try {
    const overrides = JSON.parse(localStorage.getItem('ziggy_room_photos') || '{}')
    const key = overrides[room.id] || room.id
    return ROOM_PHOTOS[key] || DEFAULT_PHOTO
  } catch {
    return ROOM_PHOTOS[room.id] || DEFAULT_PHOTO
  }
}

function saveRoomPhoto(roomId, photoKey) {
  try {
    const overrides = JSON.parse(localStorage.getItem('ziggy_room_photos') || '{}')
    overrides[roomId] = photoKey
    localStorage.setItem('ziggy_room_photos', JSON.stringify(overrides))
  } catch {}
}

function RoomCard({ room, onClick, onDelete, onEditPhoto }) {
  const photo = getRoomPhoto(room)
  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      className="relative overflow-hidden rounded-2xl cursor-pointer aspect-[4/3] shadow-card dark:shadow-card-dark group"
    >
      <img src={photo} alt={room.name} className="absolute inset-0 w-full h-full object-cover" onClick={onClick} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" onClick={onClick} />

      {/* Action buttons */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-150">
        <button
          onClick={(e) => { e.stopPropagation(); onEditPhoto(room) }}
          title="Change photo"
          className="p-1.5 rounded-lg bg-black/40 text-white/70 hover:text-white hover:bg-black/60"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(room) }}
          className="p-1.5 rounded-lg bg-black/40 text-white/60 hover:text-red-400 hover:bg-black/60"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-3" onClick={onClick}>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-white font-semibold text-sm leading-tight">{room.name}</p>
            <p className="text-white/60 text-xs mt-0.5">
              {room.entityCount} device{room.entityCount !== 1 ? 's' : ''}
            </p>
          </div>
          {room.activeCount > 0 && (
            <Badge variant="success" className="text-[10px]">{room.activeCount} on</Badge>
          )}
        </div>
      </div>
    </motion.div>
  )
}

export function RoomsList() {
  const navigate = useNavigate()
  const { loading, fetchAll, ziggyRooms, unclaimedDevices } = useDeviceStore()
  const { addToast } = useUIStore()
  const [showAdd, setShowAdd] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomPhoto, setNewRoomPhoto] = useState('living_room')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [editPhotoRoom, setEditPhotoRoom] = useState(null)
  const [editPhotoKey, setEditPhotoKey] = useState('living_room')

  useEffect(() => { fetchAll() }, [])

  // Enrich ziggyRooms with display counts for RoomCard
  const rooms = ziggyRooms.map((r) => ({
    ...r,
    entityCount: r.devices.length,
    activeCount: r.devices.filter((d) => d.ha_state === 'on').length,
  }))
  const unassigned = unclaimedDevices

  const handleAddRoom = async () => {
    if (!newRoomName.trim()) return
    setSaving(true)
    try {
      await createRoom(newRoomName.trim())
      await fetchAll()
      const newRoom = ziggyRooms.find((r) => r.name.toLowerCase() === newRoomName.trim().toLowerCase())
      if (newRoom) saveRoomPhoto(newRoom.id, newRoomPhoto)
      addToast(`Room "${newRoomName}" created`, 'success')
      setNewRoomName('')
      setNewRoomPhoto('living_room')
      setShowAdd(false)
    } catch (e) {
      addToast(e.message || 'Failed to create room', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleEditPhoto = (room) => {
    setEditPhotoRoom(room)
    try {
      const overrides = JSON.parse(localStorage.getItem('ziggy_room_photos') || '{}')
      setEditPhotoKey(overrides[room.id] || room.id)
    } catch {
      setEditPhotoKey(room.id)
    }
  }

  const handleSavePhoto = () => {
    if (!editPhotoRoom) return
    saveRoomPhoto(editPhotoRoom.id, editPhotoKey)
    setEditPhotoRoom(null)
    addToast('Room photo updated', 'success')
  }

  const handleDeleteRoom = async (room) => {
    try {
      await deleteRoom(room.id)
      await fetchAll()
      addToast(`Room "${room.name}" deleted`, 'success')
      setConfirmDelete(null)
    } catch (e) {
      addToast(e.message || 'Failed to delete room', 'error')
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6">
      <div className="flex items-center justify-between mb-6">
        <motion.h1
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100"
        >
          Rooms
        </motion.h1>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Add room
        </Button>
      </div>

      {loading && (
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-2xl bg-zinc-100 dark:bg-zinc-800 animate-pulse aspect-[4/3]" />
          ))}
        </div>
      )}

      {!loading && rooms.length === 0 && (
        <div className="text-center py-16 text-zinc-400 dark:text-zinc-600">
          <p className="text-4xl mb-3">🏠</p>
          <p className="text-sm font-medium">No rooms yet</p>
          <p className="text-xs mt-1 mb-4">Add a room to start organizing devices</p>
          <Button variant="secondary" size="sm" onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Add first room
          </Button>
        </div>
      )}

      <motion.div
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
        className="grid grid-cols-2 gap-3"
      >
        {rooms.map((room) => (
          <motion.div
            key={room.id}
            variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
          >
            <RoomCard
              room={room}
              onClick={() => navigate(`/rooms/${room.id}`)}
              onDelete={(r) => setConfirmDelete(r)}
              onEditPhoto={handleEditPhoto}
            />
          </motion.div>
        ))}

        {/* Unclaimed devices card */}
        {unassigned.length > 0 && (
          <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}>
            <Link
              to="/devices?filter=unassigned"
              className="relative overflow-hidden rounded-2xl aspect-[4/3] flex flex-col items-center justify-center gap-2 border-2 border-dashed border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
            >
              <span className="text-3xl">📦</span>
              <div className="text-center px-2">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  {unassigned.length} new device{unassigned.length !== 1 ? 's' : ''}
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
                  Tap to assign to rooms
                </p>
              </div>
            </Link>
          </motion.div>
        )}
      </motion.div>

      {/* Add room modal */}
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setNewRoomName(''); setNewRoomPhoto('living_room') }} title="Add Room">
        <div className="flex flex-col gap-4">
          <Input
            label="Room name"
            placeholder="e.g. Living Room, Kitchen, Office"
            value={newRoomName}
            onChange={(e) => setNewRoomName(e.target.value)}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleAddRoom()}
          />
          <div>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Photo</p>
            <div className="grid grid-cols-4 gap-2">
              {PHOTO_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setNewRoomPhoto(key)}
                  className={cn(
                    'relative overflow-hidden rounded-xl aspect-square focus:outline-none transition-all',
                    newRoomPhoto === key
                      ? 'ring-2 ring-violet-500 ring-offset-2 dark:ring-offset-zinc-900'
                      : 'opacity-70 hover:opacity-100'
                  )}
                >
                  <img src={ROOM_PHOTOS[key]} alt={label} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  <span className="absolute bottom-1 left-0 right-0 text-center text-[9px] text-white font-medium leading-tight px-0.5">
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <Button onClick={handleAddRoom} disabled={!newRoomName.trim() || saving} className="w-full">
            {saving ? 'Creating…' : 'Create room'}
          </Button>
        </div>
      </Modal>

      {/* Confirm delete modal */}
      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete room"
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-5">
          Delete <strong className="text-zinc-900 dark:text-zinc-100">{confirmDelete?.name}</strong>?
          This will also remove all devices assigned to this room.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(null)} className="flex-1">Cancel</Button>
          <Button variant="danger" onClick={() => handleDeleteRoom(confirmDelete)} className="flex-1">Delete</Button>
        </div>
      </Modal>

      {/* Edit photo modal */}
      <Modal open={!!editPhotoRoom} onClose={() => setEditPhotoRoom(null)} title={`Change photo — ${editPhotoRoom?.name}`}>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-4 gap-2">
            {PHOTO_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setEditPhotoKey(key)}
                className={cn(
                  'relative overflow-hidden rounded-xl aspect-square focus:outline-none transition-all',
                  editPhotoKey === key
                    ? 'ring-2 ring-violet-500 ring-offset-2 dark:ring-offset-zinc-900'
                    : 'opacity-70 hover:opacity-100'
                )}
              >
                <img src={ROOM_PHOTOS[key]} alt={label} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <span className="absolute bottom-1 left-0 right-0 text-center text-[9px] text-white font-medium leading-tight px-0.5">
                  {label}
                </span>
              </button>
            ))}
          </div>
          <Button onClick={handleSavePhoto} className="w-full">Save photo</Button>
        </div>
      </Modal>
    </div>
  )
}

const LOST_LABEL = { lost: 'Removed from hub', unclaimed: 'Not in Ziggy', unconfigured: 'No entity set' }
const LOST_DOT   = { lost: 'bg-red-400', unclaimed: 'bg-amber-400', unconfigured: 'bg-zinc-300 dark:bg-zinc-600' }

function DeviceRow({ entity, onToggle, onService, onRemove, onHide, ziggyStatus }) {
  const isOn = entity.state === 'on'
  const isUnavailable = entity.state === 'unavailable'
  const isToggleable = TOGGLEABLE_DOMAINS.has(entity.domain) && !isUnavailable
  const isActive = entity.state !== 'off' && entity.state !== 'unavailable' && entity.state !== 'unknown'
  const { primary: stateLabel, secondary: stateSecondary } = formatEntityState(entity)
  const showStatusBadge = ziggyStatus && ziggyStatus !== 'connected' && LOST_LABEL[ziggyStatus]

  return (
    <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0 group">
      <div className="flex items-center gap-3">
        <div className={cn(
          'w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 relative',
          isActive ? 'bg-zinc-900 dark:bg-white' : 'bg-zinc-100 dark:bg-zinc-800'
        )}>
          {domainIcon(entity.domain, entity.device_class)}
          {ziggyStatus && LOST_DOT[ziggyStatus] && (
            <span className={cn('absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-zinc-900', LOST_DOT[ziggyStatus])} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
            {entity.display_name || entity.friendly_name || entity.entity_id}
          </p>
          {showStatusBadge ? (
            <p className="text-xs font-medium text-red-400">{LOST_LABEL[ziggyStatus]}</p>
          ) : (
          <p className={cn(
            'text-xs font-medium',
            entity.state === 'unavailable' ? 'text-zinc-300 dark:text-zinc-600' :
            isActive ? 'text-emerald-500' : 'text-zinc-400 dark:text-zinc-600'
          )}>
            {stateLabel}
            {stateSecondary && <span className="text-zinc-400 dark:text-zinc-600 font-normal ml-1">· {stateSecondary}</span>}
          </p>
          )}
        </div>
        {entity.entity_id && (
          <div className="hidden group-hover:flex items-center gap-1 shrink-0">
            <button
              title="Hide device"
              onClick={() => onHide(entity.entity_id)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <EyeOff size={13} />
            </button>
            <button
              title="Remove from room"
              onClick={() => onRemove(entity.entity_id)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
        {isToggleable && (
          <Toggle checked={isOn} onCheckedChange={(v) => onToggle(entity.entity_id, v)} className="shrink-0" />
        )}
      </div>
      <DeviceControls
        entity={entity}
        onService={(service, data) => onService(entity, service, data)}
      />
    </div>
  )
}

function VirtualDeviceRow({ device, onTrigger, triggering }) {
  return (
    <div className="py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 bg-violet-50 dark:bg-violet-900/20">
        {device.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{device.name}</p>
        <p className="text-xs text-zinc-400 truncate">{device.capability}</p>
      </div>
      <button
        onClick={() => onTrigger(device)}
        disabled={triggering === device.id}
        className={cn(
          'p-2 rounded-xl transition-colors text-sm font-medium',
          triggering === device.id
            ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed'
            : 'bg-violet-50 dark:bg-violet-900/20 text-violet-600 hover:bg-violet-100 dark:hover:bg-violet-900/40'
        )}
        title="Run"
      >
        ▶
      </button>
    </div>
  )
}

export function RoomDetail() {
  const { roomId } = useParams()
  const navigate = useNavigate()
  const { fetchAll, ziggyRooms, hideEntity, updateEntityState } = useDeviceStore()
  const { addToast } = useUIStore()
  const [showAdd, setShowAdd] = useState(false)
  const [addEntityId, setAddEntityId] = useState('')
  const [saving, setSaving] = useState(false)
  const [vDevices, setVDevices] = useState([])
  const [triggering, setTriggering] = useState(null)

  useEffect(() => { fetchAll() }, [])

  useEffect(() => {
    if (!roomId) return
    getVirtualDevices(roomId).then((d) => setVDevices(d.devices || [])).catch(() => {})
  }, [roomId])

  const room = ziggyRooms.find((r) => r.id === roomId)

  // Adapt DeviceRegistry enriched format to the shape DeviceRow expects
  const roomDevices = (room?.devices || []).map((d) => ({
    entity_id: d.entity_id || null,
    state: d.ha_state ?? 'unknown',
    domain: d.domain || (d.entity_id ? d.entity_id.split('.')[0] : 'unknown'),
    display_name: d.display_name || d.entity_id || d.device_type,
    attributes: d.ha_attributes || {},
    ...(d.ha_attributes || {}),
    ziggyStatus: d.status,
  }))
  const entityCount = roomDevices.length
  const activeCount = roomDevices.filter((d) => d.state === 'on').length

  const handleToggle = async (entityId, on) => {
    if (!entityId) return
    const entity = room?.devices?.find((d) => d.entity_id === entityId)
    if (entity?.ha_state === 'unavailable') {
      addToast('Device is unavailable', 'error')
      return
    }
    updateEntityState(entityId, on ? 'on' : 'off')
    try {
      await sendIntent(`turn ${on ? 'on' : 'off'} ${entityId}`)
      addToast(`${on ? 'On' : 'Off'}`, 'success')
      setTimeout(() => fetchAll(), 1500)
    } catch {
      updateEntityState(entityId, on ? 'off' : 'on')
      addToast('Failed', 'error')
    }
  }

  const handleService = async (entity, service, data) => {
    try {
      await callHaService(entity.domain, service, { entity_id: entity.entity_id, ...data })
    } catch {
      addToast('Control failed', 'error')
    }
  }

  const handleRemove = async (entityId) => {
    try {
      await assignEntityToArea(entityId, null)
      await fetchAll()
      addToast('Removed from room', 'success')
    } catch (e) {
      addToast(e.message || 'Failed', 'error')
    }
  }

  const handleHide = (entityId) => {
    hideEntity(entityId)
    addToast('Device hidden', 'success')
  }

  const handleAddDevice = async () => {
    if (!addEntityId) return
    setSaving(true)
    try {
      await assignEntityToArea(addEntityId, roomId)
      await fetchAll()
      addToast('Device added to room', 'success')
      setAddEntityId('')
      setShowAdd(false)
    } catch (e) {
      addToast(e.message || 'Failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleTriggerVDevice = async (device) => {
    setTriggering(device.id)
    try {
      const result = await triggerVirtualDevice(device.id)
      addToast(
        result.ok ? `✓ ${device.name}: ${result.message || 'Done'}` : `✗ ${result.message || 'Failed'}`,
        result.ok ? 'success' : 'error',
      )
      getVirtualDevices(roomId).then((d) => setVDevices(d.devices || [])).catch(() => {})
    } catch (e) {
      addToast(e.message || 'Trigger failed', 'error')
    } finally {
      setTriggering(null)
    }
  }

  if (!room) {
    return <div className="flex items-center justify-center h-64 text-zinc-400">Room not found</div>
  }

  const photo = getRoomPhoto(room)

  return (
    <div className="max-w-2xl mx-auto">
      <div className="relative h-48 overflow-hidden">
        <img src={photo} alt={room.name} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
        <button
          onClick={() => navigate('/rooms')}
          className="absolute top-4 left-4 p-2 rounded-xl bg-black/30 backdrop-blur-sm text-white"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="absolute bottom-4 left-4">
          <h1 className="text-white text-xl font-semibold">{room.name}</h1>
          <p className="text-white/70 text-sm">
            {entityCount} device{entityCount !== 1 ? 's' : ''}
            {vDevices.length > 0 && ` · ${vDevices.length} capability${vDevices.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      <div className="px-4 pt-4 flex flex-col gap-4">
        {/* Devices */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Devices</p>
            <div className="flex items-center gap-2">
              {activeCount > 0 && <Badge variant="success">{activeCount} active</Badge>}
              <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)}>
                <Plus size={13} /> Assign device
              </Button>
            </div>
          </div>
          <Card>
            {roomDevices.length === 0 && (
              <p className="text-sm text-zinc-400 dark:text-zinc-600 py-6 text-center">No devices in this room</p>
            )}
            {roomDevices.map((entity, i) => (
              <DeviceRow
                key={entity.entity_id || i}
                entity={entity}
                onToggle={handleToggle}
                onService={handleService}
                onRemove={handleRemove}
                onHide={handleHide}
                ziggyStatus={entity.ziggyStatus}
              />
            ))}
          </Card>
        </div>

        {/* Virtual / Capability Devices */}
        {vDevices.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Capabilities</p>
            <Card>
              {vDevices.map((device) => (
                <VirtualDeviceRow
                  key={device.id}
                  device={device}
                  onTrigger={handleTriggerVDevice}
                  triggering={triggering}
                />
              ))}
            </Card>
          </div>
        )}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Assign device to room">
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3 -mt-1">
          Pick an existing HA entity to assign to this room. To add brand-new hardware, pair it in Home Assistant first — it will then appear here.
        </p>
        <div className="flex flex-col gap-4">
          <EntitySelect
            label="Device"
            placeholder="Search entities…"
            value={addEntityId}
            onChange={setAddEntityId}
          />
          <Button onClick={handleAddDevice} disabled={!addEntityId || saving} className="w-full">
            {saving ? 'Assigning…' : 'Assign to room'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
