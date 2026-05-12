import { useEffect, useState, lazy, Suspense } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Plus, EyeOff, Eye, Trash2, Map, List, Zap, Play, ChevronRight } from 'lucide-react'
import { getMapRoomsSummary, getAutomations, triggerAutomation, getFeaturesSettings } from '../lib/api'

const HomeMapCanvas = lazy(() =>
  import('./HomeMapCanvas').then((m) => ({ default: m.HomeMapCanvas }))
)
import { Card } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Badge } from '../components/ui/Badge'
import { RoomCard } from '../components/ui/RoomCard'
import { DeviceControls, TOGGLEABLE_DOMAINS, IRRemotePanel, isEntityOn } from '../components/ui/DeviceControls'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { EntitySelect } from '../components/ui/EntitySelect'
import { useDeviceStore } from '../stores/deviceStore'
import { useUIStore } from '../stores/uiStore'
import { domainIcon, formatEntityState } from '../lib/utils'
import { controlDevice, createRoom, deleteRoom, renameRoom, assignEntityToArea, callHaService, getVirtualDevices, triggerVirtualDevice, patchVirtualDevice, irSend } from '../lib/api'
import { cn } from '../lib/utils'
import { ROOM_PHOTOS, saveRoomPhoto, PHOTO_OPTIONS, getRoomPhoto, getCustomPhoto, storeCustomDataUrl, removeCustomPhoto, resizeImageToDataUrl } from '../lib/roomPhotos'

const ROOM_DOMAIN_GROUPS = [
  { id: 'lights',   label: 'Lights',   domains: ['light'] },
  { id: 'climate',  label: 'Climate',  domains: ['climate', 'fan', 'humidifier'] },
  { id: 'media',    label: 'Media',    domains: ['media_player'] },
  { id: 'switches', label: 'Switches', domains: ['switch', 'input_boolean'] },
  { id: 'sensors',  label: 'Sensors',  domains: ['sensor', 'binary_sensor'] },
  { id: 'security', label: 'Security', domains: ['lock', 'cover', 'alarm_control_panel', 'camera'] },
  { id: 'other',    label: 'Other',    domains: [] },
]

function roomDomainGroup(entity) {
  for (const g of ROOM_DOMAIN_GROUPS) {
    if (g.domains.includes(entity.domain)) return g.id
  }
  return 'other'
}

export function RoomsList() {
  const navigate = useNavigate()
  const { loading, fetchAll, ziggyRooms, getUnassigned } = useDeviceStore()
  const { addToast } = useUIStore()
  const [showAdd, setShowAdd] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomPhoto, setNewRoomPhoto] = useState('living_room')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [editPhotoRoom, setEditPhotoRoom] = useState(null)
  const [editPhotoKey, setEditPhotoKey] = useState('living_room')
  const [editCustomPhoto, setEditCustomPhoto] = useState(null) // data URL of uploaded photo
  const [editRoomName, setEditRoomName] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [view, setView] = useState('rooms')     // 'rooms' | 'map'
  const [mapMode, setMapMode] = useState('view') // 'view' | 'build'
  const [mapRooms, setMapRooms] = useState([])
  const [mapLoading, setMapLoading] = useState(false)
  const [mapEnabled, setMapEnabled] = useState(false)

  useEffect(() => { fetchAll() }, [])

  const checkMapFlag = () => {
    getFeaturesSettings()
      .then(f => setMapEnabled(!!f.home_map))
      .catch(() => {})
  }

  useEffect(() => {
    checkMapFlag()
    // Re-check whenever the tab regains focus (e.g. user toggled flag in Admin then came back)
    window.addEventListener('focus', checkMapFlag)
    return () => window.removeEventListener('focus', checkMapFlag)
  }, [])

  useEffect(() => {
    if (view !== 'map') { setMapMode('view'); return }
    setMapLoading(true)
    getMapRoomsSummary()
      .then(d => setMapRooms(d.rooms ?? []))
      .catch(() => {})
      .finally(() => setMapLoading(false))
  }, [view])

  // Enrich ziggyRooms with display counts for RoomCard
  const rooms = ziggyRooms.map((r) => ({
    ...r,
    entityCount: r.devices.length,
    activeCount: r.devices.filter((d) => isEntityOn({ state: d.ha_state, entity_id: d.entity_id })).length,
  }))
  const unassigned = getUnassigned()

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
    setEditRoomName(room.name)
    setEditCustomPhoto(getCustomPhoto(room.id))
    try {
      const overrides = JSON.parse(localStorage.getItem('ziggy_room_photos') || '{}')
      setEditPhotoKey(overrides[room.id] || room.id)
    } catch {
      setEditPhotoKey('living_room')
    }
  }

  const handleUploadEditPhoto = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const dataUrl = await resizeImageToDataUrl(file)
      setEditCustomPhoto(dataUrl)
    } catch {
      addToast('Could not load photo', 'error')
    }
    e.target.value = ''
  }

  const handleSaveRoomEdit = async () => {
    if (!editPhotoRoom) return
    setEditSaving(true)
    try {
      const nameChanged = editRoomName.trim() && editRoomName.trim() !== editPhotoRoom.name
      if (nameChanged) {
        await renameRoom(editPhotoRoom.id, editRoomName.trim())
        await fetchAll()
      }
      if (editCustomPhoto) {
        storeCustomDataUrl(editPhotoRoom.id, editCustomPhoto)
      } else {
        removeCustomPhoto(editPhotoRoom.id)
        saveRoomPhoto(editPhotoRoom.id, editPhotoKey)
      }
      setEditPhotoRoom(null)
      setEditCustomPhoto(null)
      addToast(nameChanged ? 'Room updated' : 'Photo updated', 'success')
    } catch (e) {
      addToast(e.message || 'Failed to save', 'error')
    } finally {
      setEditSaving(false)
    }
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
      <div className="flex items-center justify-between mb-4">
        <motion.h1
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100"
        >
          Rooms
        </motion.h1>
        <div className="flex items-center gap-2">
          {/* Map tab toggle — only shown when home_map feature flag is on */}
          {mapEnabled && (
            <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl p-1">
              <button
                onClick={() => setView('rooms')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  view === 'rooms'
                    ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
              >
                <List size={13} /> Rooms
              </button>
              <button
                onClick={() => setView('map')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  view === 'map'
                    ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
              >
                <Map size={13} /> Map
              </button>
            </div>
          )}
          {view === 'rooms' && (
            <Button size="sm" onClick={() => setShowAdd(true)}>
              <Plus size={14} /> Add room
            </Button>
          )}
          {mapEnabled && view === 'map' && mapMode === 'view' && (
            <Button size="sm" variant="secondary" onClick={() => setMapMode('build')}>
              Edit Layout
            </Button>
          )}
          {mapEnabled && view === 'map' && mapMode === 'build' && (
            <Button size="sm" onClick={() => setMapMode('view')}>
              Done
            </Button>
          )}
        </div>
      </div>

      {/* Map canvas — only rendered when feature flag is on */}
      {mapEnabled && view === 'map' && (
        <div className="mb-4">
          {mapLoading ? (
            <div className="rounded-2xl bg-zinc-100 dark:bg-zinc-800 animate-pulse" style={{ height: 420 }} />
          ) : (
            <Suspense fallback={
              <div className="flex items-center justify-center h-48 text-zinc-400 text-sm">Loading map…</div>
            }>
              <HomeMapCanvas rooms={mapRooms} viewOnly={mapMode === 'view'} />
            </Suspense>
          )}
        </div>
      )}

      {view === 'rooms' && !loading && rooms.length === 0 && unassigned.length === 0 && (
        <div className="text-center py-16 text-zinc-400 dark:text-zinc-600">
          <p className="text-4xl mb-3">🏠</p>
          <p className="text-sm font-medium">No rooms yet</p>
          <p className="text-xs mt-1 mb-4">Add a room to start organizing devices</p>
          <Button variant="secondary" size="sm" onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Add first room
          </Button>
        </div>
      )}

      {view === 'rooms' && <div className="grid grid-cols-2 gap-3">
        {loading && [1, 2, 3, 4].map((i) => (
          <div key={`skel-${i}`} className="rounded-2xl bg-zinc-100 dark:bg-zinc-800 animate-pulse aspect-[4/3]" />
        ))}

        {!loading && rooms.map((room) => (
          <motion.div
            key={room.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
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
        {!loading && unassigned.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
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
      </div>}

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
            <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto scrollbar-thin pr-0.5">
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

      {/* Edit room modal (name + photo + upload) */}
      <Modal open={!!editPhotoRoom} onClose={() => { setEditPhotoRoom(null); setEditCustomPhoto(null) }} title="Edit Room">
        <div className="flex flex-col gap-4">
          <Input
            label="Room name"
            value={editRoomName}
            onChange={(e) => setEditRoomName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveRoomEdit()}
          />
          <div>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Photo</p>

            {/* Custom uploaded photo preview */}
            {editCustomPhoto ? (
              <div className="mb-3">
                <div className="relative rounded-xl overflow-hidden mb-2" style={{ aspectRatio: '16/9' }}>
                  <img src={editCustomPhoto} alt="Custom" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                  <span className="absolute bottom-2 left-2 text-xs text-white font-medium">Custom photo</span>
                  <button
                    onClick={() => setEditCustomPhoto(null)}
                    className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/50 text-white flex items-center justify-center text-xs hover:bg-black/70 transition-colors"
                  >
                    ✕
                  </button>
                </div>
                <p className="text-xs text-zinc-400 dark:text-zinc-600 text-center">
                  Or pick a preset below to replace it
                </p>
              </div>
            ) : null}

            {/* Preset grid */}
            <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto scrollbar-thin pr-0.5 mb-3">
              {PHOTO_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setEditPhotoKey(key); setEditCustomPhoto(null) }}
                  className={cn(
                    'relative overflow-hidden rounded-xl aspect-square focus:outline-none transition-all',
                    !editCustomPhoto && editPhotoKey === key
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

            {/* Upload button */}
            <label className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 text-sm text-zinc-500 dark:text-zinc-400 hover:border-violet-400 hover:text-violet-500 transition-colors cursor-pointer">
              <span>📷</span>
              <span>Upload a photo of this room</span>
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={handleUploadEditPhoto} />
            </label>
          </div>
          <Button onClick={handleSaveRoomEdit} disabled={!editRoomName.trim() || editSaving} className="w-full">
            {editSaving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}

const LOST_LABEL = { lost: 'Removed from hub', unclaimed: 'Not in Ziggy', unconfigured: 'No entity set' }
const LOST_DOT   = { lost: 'bg-red-400', unclaimed: 'bg-amber-400', unconfigured: 'bg-zinc-300 dark:bg-zinc-600' }

// Minimal IR quick-fire buttons for the room list view
function IRRowControls({ entity }) {
  const irId = entity._ir_device_id
  const learned = new Set(entity.learned_commands || [])
  const cmds = entity.commands || {}
  const canDo = (cmd) => cmd in cmds && learned.has(cmd)

  const buttons = []
  if (canDo('power'))       buttons.push({ cmd: 'power',       label: '⏻ Power' })
  if (canDo('volume_up'))   buttons.push({ cmd: 'volume_up',   label: '🔊+' })
  if (canDo('volume_down')) buttons.push({ cmd: 'volume_down', label: '🔊−' })
  if (canDo('mute'))        buttons.push({ cmd: 'mute',        label: '🔇' })
  if (canDo('mode_cool'))   buttons.push({ cmd: 'mode_cool',   label: '❄ Cool' })
  if (canDo('mode_heat'))   buttons.push({ cmd: 'mode_heat',   label: '🔥 Heat' })

  if (!irId || buttons.length === 0) return null

  return (
    <div className="flex gap-1.5 flex-wrap mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
      {buttons.map(({ cmd, label }) => (
        <button
          key={cmd}
          onClick={() => irSend(irId, cmd)}
          className="px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-[10px] font-medium"
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function DeviceRow({ entity, onToggle, onService, onRemove, onHide, onUnhide, isHidden, ziggyStatus }) {
  const isIr = entity._is_ir === true
  const linkedIr = entity._linkedIr || null
  const isOn = isEntityOn(entity)
  const isOff = entity.state === 'off' || entity.state === 'unavailable' || entity.state === 'unknown'
  const isUnavailable = entity.state === 'unavailable'
  const isToggleable = !isIr && TOGGLEABLE_DOMAINS.has(entity.domain) && !isUnavailable
  const isActive = !isOff
  const { primary: stateLabel, secondary: stateSecondary } = !isIr ? formatEntityState(entity) : { primary: '', secondary: null }
  const showStatusBadge = !isIr && ziggyStatus && ziggyStatus !== 'connected' && LOST_LABEL[ziggyStatus]
  const assumedState = entity.assumed_state && entity.assumed_state !== 'unknown' ? entity.assumed_state : null

  return (
    <div className={cn(
      'px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0 group transition-opacity',
      isHidden && 'opacity-40'
    )}>
      <div className="flex items-center gap-3">
        <div className={cn(
          'w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 relative',
          isActive && !isHidden ? 'bg-zinc-900 dark:bg-white' : 'bg-zinc-100 dark:bg-zinc-800',
        )}>
          {domainIcon(entity.domain, entity.device_class)}
          {(isIr || linkedIr) && (
            <span className="absolute -bottom-1 -right-1 bg-violet-500 text-white text-[7px] font-bold px-1 py-px rounded-sm leading-none">IR</span>
          )}
          {!isIr && !linkedIr && ziggyStatus && LOST_DOT[ziggyStatus] && (
            <span className={cn('absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-zinc-900', LOST_DOT[ziggyStatus])} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
            {entity.display_name || entity.friendly_name || entity.entity_id}
          </p>
          {isHidden ? (
            <p className="text-xs text-zinc-300 dark:text-zinc-600 font-medium">Hidden</p>
          ) : isIr ? (
            <p className={cn('text-xs font-medium', assumedState === 'on' ? 'text-emerald-500' : 'text-zinc-400 dark:text-zinc-600')}>
              {assumedState ? `${assumedState} (assumed)` : 'state unknown'}
            </p>
          ) : showStatusBadge ? (
            <p className="text-xs font-medium text-red-400">{LOST_LABEL[ziggyStatus]}</p>
          ) : (
            <p className={cn('text-xs font-medium', entity.state === 'unavailable' ? 'text-zinc-300 dark:text-zinc-600' : isActive ? 'text-emerald-500' : 'text-zinc-400 dark:text-zinc-600')}>
              {stateLabel}
              {stateSecondary && <span className="text-zinc-400 font-normal ml-1">· {stateSecondary}</span>}
            </p>
          )}
        </div>
        {!isIr && entity.entity_id && (
          // Always visible on mobile; hidden on desktop until hover
          <div className={cn(
            'items-center gap-1 shrink-0',
            isHidden ? 'flex' : 'flex md:hidden md:group-hover:flex'
          )}>
            {isHidden ? (
              <button title="Unhide device" onClick={() => onUnhide?.(entity.entity_id)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                <Eye size={13} />
              </button>
            ) : (
              <button title="Hide device" onClick={() => onHide(entity.entity_id)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                <EyeOff size={13} />
              </button>
            )}
            <button title="Remove from room" onClick={() => onRemove(entity.entity_id)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              <Trash2 size={13} />
            </button>
          </div>
        )}
        {isToggleable && !isHidden && (
          <Toggle checked={isOn} onCheckedChange={(v) => onToggle(entity.entity_id, v)} className="shrink-0" />
        )}
      </div>

      {/* Controls — suppressed when device is hidden */}
      {!isHidden && (isIr ? (
        <IRRowControls entity={entity} />
      ) : linkedIr ? (
        <>
          {isOff && linkedIr.learned_commands?.includes('power') && linkedIr.commands?.power && (
            <button
              onClick={() => irSend(linkedIr.id, 'power')}
              className="w-full mt-2 flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 text-xs font-semibold hover:bg-violet-100 transition-colors border border-violet-200 dark:border-violet-800/50"
            >
              ⏻ Turn On via IR
            </button>
          )}
          <DeviceControls entity={entity} onService={(service, data) => onService(entity, service, data)} />
          <IRRemotePanel irDevice={linkedIr} onCommand={(id, cmd) => irSend(id, cmd)} />
        </>
      ) : (
        <DeviceControls entity={entity} onService={(service, data) => onService(entity, service, data)} />
      ))}
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
  const { fetchAll, ziggyRooms, hideEntity, unhideEntity, hiddenEntities, updateEntityState, loading } = useDeviceStore()
  const { addToast } = useUIStore()
  const [showAdd, setShowAdd] = useState(false)
  const [addEntityId, setAddEntityId] = useState('')
  const [saving, setSaving] = useState(false)
  const [vDevices, setVDevices] = useState([])
  const [triggering, setTriggering] = useState(null)
  const [roomAutomations, setRoomAutomations] = useState([])
  const [showHiddenDevices, setShowHiddenDevices] = useState(false)

  useEffect(() => { fetchAll() }, [])

  useEffect(() => {
    if (!roomId) return
    getVirtualDevices(roomId).then((d) => setVDevices(d.devices || [])).catch(() => {})
    getAutomations().then((res) => {
      const all = res.automations || []
      setRoomAutomations(all.filter((a) => (a.rooms || []).includes(roomId)))
    }).catch(() => {})
  }, [roomId])

  const room = ziggyRooms.find((r) => r.id === roomId)

  // Adapt DeviceRegistry enriched format to the shape DeviceRow expects.
  // Spread d first so IR markers (_is_ir, _ir_device_id, commands, etc.) are preserved.
  const roomDevices = (room?.devices || []).map((d) => ({
    ...d,
    entity_id: d.entity_id || null,
    state: d.ha_state ?? 'unknown',
    domain: d.domain || (d.entity_id ? d.entity_id.split('.')[0] : 'unknown'),
    display_name: d.display_name || d.entity_id || d.device_type,
    attributes: d.ha_attributes || {},
    ...(d.ha_attributes || {}),
    ziggyStatus: d.status,
  }))
  const entityCount = roomDevices.length
  const activeCount = roomDevices.filter((d) => isEntityOn(d)).length

  const handleToggle = async (entityId, on) => {
    if (!entityId) return
    const entity = room?.devices?.find((d) => d.entity_id === entityId)
    if (entity?.ha_state === 'unavailable') {
      addToast('Device is unavailable', 'error')
      return
    }
    updateEntityState(entityId, on ? 'on' : 'off')
    try {
      await controlDevice(entityId, on ? 'turn_on' : 'turn_off')
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

  const handleUnhide = (entityId) => {
    unhideEntity(entityId)
    addToast('Device visible again', 'success')
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
    if (loading) {
      return (
        <div className="max-w-2xl mx-auto animate-pulse">
          <div className="h-48 bg-zinc-200 dark:bg-zinc-800" />
          <div className="px-4 pt-4 space-y-3">
            <div className="h-5 bg-zinc-100 dark:bg-zinc-800 rounded-lg w-1/3" />
            <div className="h-32 bg-zinc-100 dark:bg-zinc-800/60 rounded-2xl" />
          </div>
        </div>
      )
    }
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

      <div className="px-4 pt-4 pb-8 flex flex-col gap-4">
        {/* Devices — grouped by domain type */}
        {(() => {
          const hiddenCount = roomDevices.filter(e => e.entity_id && hiddenEntities.has(e.entity_id)).length
          const visibleDevices = roomDevices.filter(e =>
            showHiddenDevices || !e.entity_id || !hiddenEntities.has(e.entity_id)
          )
          const deviceGroups = ROOM_DOMAIN_GROUPS.map(g => ({
            ...g,
            devices: visibleDevices.filter(e => roomDomainGroup(e) === g.id),
          })).filter(g => g.devices.length > 0)

          return (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Devices</p>
                <div className="flex items-center gap-2">
                  {activeCount > 0 && <Badge variant="success">{activeCount} active</Badge>}
                  {hiddenCount > 0 && (
                    <button
                      onClick={() => setShowHiddenDevices(v => !v)}
                      className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                    >
                      {showHiddenDevices ? `Hide ${hiddenCount} hidden` : `${hiddenCount} hidden`}
                    </button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)}>
                    <Plus size={13} /> Assign
                  </Button>
                </div>
              </div>

              {deviceGroups.length === 0 && roomDevices.length === 0 && (
                <Card>
                  <p className="text-sm text-zinc-400 dark:text-zinc-600 py-6 text-center">No devices in this room</p>
                </Card>
              )}
              {deviceGroups.length === 0 && roomDevices.length > 0 && !showHiddenDevices && (
                <Card>
                  <p className="text-sm text-zinc-400 dark:text-zinc-600 py-6 text-center">All devices are hidden</p>
                </Card>
              )}

              {deviceGroups.map((group) => (
                <div key={group.id} className="mb-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 mb-1.5 px-0.5">
                    {group.label}
                  </p>
                  <Card>
                    {group.devices.map((entity, i) => (
                      <DeviceRow
                        key={entity.entity_id || i}
                        entity={entity}
                        onToggle={handleToggle}
                        onService={handleService}
                        onRemove={handleRemove}
                        onHide={handleHide}
                        onUnhide={handleUnhide}
                        isHidden={!!(entity.entity_id && hiddenEntities.has(entity.entity_id))}
                        ziggyStatus={entity.ziggyStatus}
                      />
                    ))}
                  </Card>
                </div>
              ))}
            </div>
          )
        })()}

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

        {/* Room automations */}
        {roomAutomations.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Automations</p>
              <button
                onClick={() => navigate('/automations')}
                className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              >
                View all
              </button>
            </div>
            <Card>
              {roomAutomations.map((a) => (
                <div key={a.id} className="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                  <div className="flex items-center gap-3 px-4 py-3">
                    {/* Tapping the row navigates to the Automations page */}
                    <button
                      onClick={() => navigate('/automations')}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center shrink-0', a.enabled ? 'bg-violet-50 dark:bg-violet-900/20' : 'bg-zinc-100 dark:bg-zinc-800')}>
                        <Zap size={14} className={a.enabled ? 'text-violet-500' : 'text-zinc-400'} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{a.name}</p>
                        {a.description && <p className="text-xs text-zinc-400 truncate mt-0.5">{a.description}</p>}
                      </div>
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        try { await triggerAutomation(a.id); addToast(`Triggered: ${a.name}`, 'success') }
                        catch { addToast('Failed to trigger', 'error') }
                      }}
                      className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors shrink-0"
                      title="Run now"
                    >
                      <Play size={13} />
                    </button>
                    <ChevronRight size={13} className="text-zinc-300 dark:text-zinc-700 shrink-0 pointer-events-none" />
                  </div>
                </div>
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
