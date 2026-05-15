import { useEffect, useState, lazy, Suspense } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Plus, EyeOff, Eye, Trash2, Map, List, Zap, Play, ChevronRight } from 'lucide-react'
import { getMapRoomsSummary, getAutomations, triggerAutomation, getFeaturesSettings } from '../lib/api'

const HomeMapCanvas = lazy(() =>
  import('./HomeMapCanvas').then((m) => ({ default: m.HomeMapCanvas }))
)
import { Toggle } from '../components/ui/Toggle'
import { DeviceControls, TOGGLEABLE_DOMAINS, IRRemoteButton, isEntityOn } from '../components/ui/DeviceControls'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { EntitySelect } from '../components/ui/EntitySelect'
import { useDeviceStore } from '../stores/deviceStore'
import { useUIStore } from '../stores/uiStore'
import { domainIcon, formatEntityState } from '../lib/utils'
import { DOMAIN_GROUPS, domainGroup } from '../lib/domainRegistry'
import { controlDevice, createRoom, deleteRoom, renameRoom, assignEntityToArea, callHaService, getVirtualDevices, triggerVirtualDevice, patchVirtualDevice, irSend } from '../lib/api'
import { cameraSnapshotUrl } from '../stores/cameraStore'
import { cn } from '../lib/utils'
import { ROOM_PHOTOS, saveRoomPhoto, PHOTO_OPTIONS, getRoomPhoto, getCustomPhoto, storeCustomDataUrl, removeCustomPhoto, resizeImageToDataUrl } from '../lib/roomPhotos'

// DOMAIN_GROUPS and domainGroup imported from domainRegistry.js
const ROOM_DOMAIN_GROUPS = DOMAIN_GROUPS
const roomDomainGroup = domainGroup

function RoomRow({ room, onClick, onDelete, onEditPhoto }) {
  const [hovered, setHovered] = useState(false)
  const photo = getRoomPhoto(room)
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ position: 'relative' }}
    >
      <button onClick={onClick} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 12px', borderRadius: 12,
        background: 'var(--surface)', border: '0.5px solid var(--line)',
        cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
        transition: 'border-color 0.12s',
        borderColor: hovered ? 'var(--line-2)' : 'var(--line)',
      }}>
        <div style={{ width: 52, height: 52, borderRadius: 9, overflow: 'hidden', flexShrink: 0, background: 'var(--surface-2)' }}>
          <img src={photo} alt={room.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{room.name}</p>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
            {room.entityCount} device{room.entityCount !== 1 ? 's' : ''}
            {room.activeCount  > 0 && <span style={{ color: 'var(--ok)',    marginLeft: 6 }}>{room.activeCount} on</span>}
            {room.offlineCount > 0 && <span style={{ color: '#ef4444',      marginLeft: 6 }}>{room.offlineCount} offline</span>}
          </p>
        </div>
        <ChevronRight size={14} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
      </button>
      {hovered && (onEditPhoto || onDelete) && (
        <div style={{ position: 'absolute', right: 40, top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: 4, zIndex: 1 }}>
          {onEditPhoto && (
            <button onClick={e => { e.stopPropagation(); onEditPhoto(room) }} title="Edit room" style={{ padding: '5px 6px', borderRadius: 7, background: 'var(--surface)', border: '0.5px solid var(--line)', cursor: 'pointer', color: 'var(--ink-2)', display: 'flex' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          )}
          {onDelete && (
            <button onClick={e => { e.stopPropagation(); onDelete(room) }} title="Delete room" style={{ padding: '5px 6px', borderRadius: 7, background: 'var(--surface)', border: '0.5px solid var(--line)', cursor: 'pointer', color: 'var(--accent)', display: 'flex' }}>
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}
    </motion.div>
  )
}

export function RoomsList() {
  const navigate = useNavigate()
  const { loading, fetchAll, ziggyRooms, getUnassigned, getNoRoom } = useDeviceStore()
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

  // Enrich ziggyRooms with display counts for RoomRow
  const rooms = ziggyRooms.map((r) => ({
    ...r,
    entityCount:  r.devices.length,
    activeCount:  r.devices.filter((d) => isEntityOn({ state: d.ha_state, entity_id: d.entity_id })).length,
    offlineCount: r.devices.filter((d) => d.ha_state === 'unavailable' || d.ha_state === 'unknown').length,
  }))
  const unassigned = getUnassigned()
  const noRoomDevices = getNoRoom()

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
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 20px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>Your home</p>
          <motion.h1 initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}>
            Rooms
          </motion.h1>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4, fontFamily: '"IBM Plex Mono", monospace' }}>
            {rooms.length} room{rooms.length !== 1 ? 's' : ''}
            {unassigned.length > 0 && <span style={{ color: 'var(--warn)', marginLeft: 4 }}>· {unassigned.length} unassigned</span>}
            {noRoomDevices.length > 0 && <span style={{ color: 'var(--ink-faint)', marginLeft: 4 }}>· {noRoomDevices.length} no room</span>}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {mapEnabled && (
            <div style={{ display: 'flex', gap: 3, background: 'var(--bg-2)', borderRadius: 11, padding: 3 }}>
              {[{ id: 'rooms', icon: 'list', label: 'Rooms' }, { id: 'map', icon: 'map', label: 'Map' }].map(v => (
                <button key={v.id} onClick={() => setView(v.id)} style={{
                  padding: '5px 10px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  background: view === v.id ? 'var(--surface)' : 'transparent',
                  color: view === v.id ? 'var(--ink)' : 'var(--ink-mute)',
                  border: 'none', fontFamily: 'inherit',
                }}>{v.label}</button>
              ))}
            </div>
          )}
          {view === 'rooms' && (
            <button onClick={() => setShowAdd(true)} className="z-btn-primary" style={{ padding: '8px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, flexShrink: 0 }}>
              <Plus size={13} /> Add room
            </button>
          )}
          {mapEnabled && view === 'map' && (
            <button onClick={() => setMapMode(m => m === 'view' ? 'build' : 'view')} className="z-btn-secondary" style={{ padding: '7px 12px', borderRadius: 9, fontSize: 12, fontFamily: 'inherit' }}>
              {mapMode === 'view' ? 'Edit Layout' : 'Done'}
            </button>
          )}
        </div>
      </div>

      {/* Map canvas */}
      {mapEnabled && view === 'map' && (
        <div style={{ marginBottom: 16 }}>
          {mapLoading ? (
            <div style={{ height: 420, borderRadius: 14, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />
          ) : (
            <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 192, color: 'var(--ink-faint)', fontSize: 13 }}>Loading map…</div>}>
              <HomeMapCanvas rooms={mapRooms} viewOnly={mapMode === 'view'} />
            </Suspense>
          )}
        </div>
      )}

      {/* Empty state */}
      {view === 'rooms' && !loading && rooms.length === 0 && unassigned.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>No rooms yet</p>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 16 }}>Add a room to start organizing devices</p>
          <button onClick={() => setShowAdd(true)} className="z-btn-secondary" style={{ padding: '8px 14px', borderRadius: 9, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Plus size={13} /> Add first room
          </button>
        </div>
      )}

      {/* Room list */}
      {view === 'rooms' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loading && [1, 2, 3, 4].map(i => (
            <div key={i} style={{ height: 72, borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />
          ))}
          {!loading && rooms.map(room => (
            <RoomRow
              key={room.id}
              room={room}
              onClick={() => navigate(`/rooms/${room.id}`)}
              onDelete={r => setConfirmDelete(r)}
              onEditPhoto={handleEditPhoto}
            />
          ))}
          {!loading && unassigned.length > 0 && (
            <Link to="/devices?filter=unassigned" style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 12px', borderRadius: 12, textDecoration: 'none',
              border: `1.5px dashed color-mix(in srgb, var(--warn) 50%, var(--line))`,
              background: `color-mix(in srgb, var(--warn) 6%, var(--surface))`,
            }}>
              <div style={{ width: 52, height: 52, borderRadius: 9, background: `color-mix(in srgb, var(--warn) 15%, var(--surface))`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
                📦
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--warn)', marginBottom: 2 }}>{unassigned.length} unassigned device{unassigned.length !== 1 ? 's' : ''}</p>
                <p style={{ fontSize: 11, color: 'var(--ink-mute)', fontFamily: '"IBM Plex Mono", monospace' }}>Tap to assign to rooms</p>
              </div>
              <ChevronRight size={14} style={{ color: 'var(--warn)', flexShrink: 0 }} />
            </Link>
          )}
          {!loading && noRoomDevices.length > 0 && (
            <Link to="/devices?filter=noroom" style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 12px', borderRadius: 12, textDecoration: 'none',
              border: '0.5px solid var(--line)',
              background: 'var(--surface)',
            }}>
              <div style={{ width: 52, height: 52, borderRadius: 9, background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
                🏠
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{noRoomDevices.length} device{noRoomDevices.length !== 1 ? 's' : ''} — no room</p>
                <p style={{ fontSize: 11, color: 'var(--ink-mute)', fontFamily: '"IBM Plex Mono", monospace' }}>Intentionally left without a room</p>
              </div>
              <ChevronRight size={14} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
            </Link>
          )}
        </div>
      )}

      {/* Add room modal */}
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setNewRoomName(''); setNewRoomPhoto('living_room') }} title="Add Room">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input label="Room name" placeholder="e.g. Living Room, Kitchen, Office" value={newRoomName} onChange={e => setNewRoomName(e.target.value)} autoFocus onKeyDown={e => e.key === 'Enter' && handleAddRoom()} />
          <div>
            <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 8 }}>Photo</p>
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
            {saving ? 'Creating…' : 'Create room'}
          </button>
        </div>
      </Modal>

      {/* Confirm delete modal */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete room">
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginBottom: 16, lineHeight: 1.5 }}>
          Delete <strong style={{ color: 'var(--ink)' }}>{confirmDelete?.name}</strong>? This will also remove all devices assigned to this room.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setConfirmDelete(null)} className="z-btn-secondary" style={{ flex: 1 }}>Cancel</button>
          <button onClick={() => handleDeleteRoom(confirmDelete)} style={{ flex: 1, background: `color-mix(in srgb, var(--accent) 10%, var(--surface))`, color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: 10, padding: '10px 16px', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Delete</button>
        </div>
      </Modal>

      {/* Edit room modal */}
      <Modal open={!!editPhotoRoom} onClose={() => { setEditPhotoRoom(null); setEditCustomPhoto(null) }} title="Edit Room">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input label="Room name" value={editRoomName} onChange={e => setEditRoomName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSaveRoomEdit()} />
          <div>
            <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 8 }}>Photo</p>
            {editCustomPhoto && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ position: 'relative', borderRadius: 11, overflow: 'hidden', height: 120, marginBottom: 6 }}>
                  <img src={editCustomPhoto} alt="Custom" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <button onClick={() => setEditCustomPhoto(null)} style={{ position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12 }}>✕</button>
                </div>
              </div>
            )}
            {/* Scrollable photo picker — fixed-height cells so images never squish */}
            <div style={{ height: 252, overflowY: 'scroll', borderRadius: 10, border: '0.5px solid var(--line)', marginBottom: 12 }} className="scrollbar-thin">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, padding: 8 }}>
                {PHOTO_OPTIONS.map(({ key, label }) => {
                  const isSelected = !editCustomPhoto && editPhotoKey === key
                  return (
                    <button key={key} type="button" onClick={() => { setEditPhotoKey(key); setEditCustomPhoto(null) }} style={{
                      position: 'relative', overflow: 'hidden', borderRadius: 9,
                      height: 72,                           /* fixed height — grid cannot compress this */
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

            {/* Two distinct upload options — no forced camera on mobile */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 8px', borderRadius: 10, border: '1.5px dashed var(--line-2)', fontSize: 12, fontWeight: 500, color: 'var(--ink-mute)', cursor: 'pointer' }}>
                📷 Take photo
                <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleUploadEditPhoto} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 8px', borderRadius: 10, border: '1.5px dashed var(--line-2)', fontSize: 12, fontWeight: 500, color: 'var(--ink-mute)', cursor: 'pointer' }}>
                🖼 Choose file
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUploadEditPhoto} />
              </label>
            </div>
          </div>
          <button onClick={handleSaveRoomEdit} disabled={!editRoomName.trim() || editSaving} className="z-btn-primary" style={{ width: '100%' }}>
            {editSaving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

const LOST_LABEL = { lost: 'Removed from hub', unclaimed: 'Not in Ziggy', unconfigured: 'No entity set' }
const LOST_DOT   = { lost: 'bg-red-400', unclaimed: 'bg-amber-400', unconfigured: 'bg-zinc-300 dark:bg-zinc-600' }

function CameraPreview({ entityId }) {
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
      title="View live in Security"
    >
      <img
        key={tick}
        src={`${cameraSnapshotUrl(entityId)}?t=${tick}`}
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        onError={e => { e.target.style.opacity = 0 }}
      />
      <div style={{
        position: 'absolute', bottom: 5, right: 5,
        padding: '2px 7px', borderRadius: 6,
        background: 'rgba(0,0,0,0.45)', color: '#fff',
        fontSize: 9, fontWeight: 600, letterSpacing: '0.04em',
      }}>
        LIVE ▶
      </div>
    </div>
  )
}

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
          {!isIr && !linkedIr && (
            isUnavailable
              ? <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-zinc-900 bg-red-400" />
              : (ziggyStatus && LOST_DOT[ziggyStatus] &&
                  <span className={cn('absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-zinc-900', LOST_DOT[ziggyStatus])} />
                )
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
          ) : isUnavailable ? (
            <p className="text-xs font-medium text-red-400">Offline</p>
          ) : showStatusBadge ? (
            <p className="text-xs font-medium text-red-400">{LOST_LABEL[ziggyStatus]}</p>
          ) : (
            <p className={cn('text-xs font-medium', isActive ? 'text-emerald-500' : 'text-zinc-400 dark:text-zinc-600')}>
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
          <IRRemoteButton irDevice={linkedIr} onCommand={(id, cmd) => irSend(id, cmd)} />
        </>
      ) : entity.domain === 'camera' && entity.entity_id ? (
        <CameraPreview entityId={entity.entity_id} />
      ) : (
        <DeviceControls entity={entity} onService={(service, data) => onService(entity, service, data)} />
      ))}
    </div>
  )
}

function VirtualDeviceRow({ device, onTrigger, triggering }) {
  const isTriggering = triggering === device.id
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '0.5px solid var(--line)' }}
      className="last:border-b-0">
      <div style={{ width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, background: `color-mix(in srgb, var(--info) 10%, var(--surface))`, flexShrink: 0 }}>
        {device.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{device.name}</p>
        <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2, fontFamily: '"IBM Plex Mono", monospace' }}>{device.capability}</p>
      </div>
      <button onClick={() => onTrigger(device)} disabled={isTriggering} title="Run"
        style={{ padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: isTriggering ? 'default' : 'pointer', fontFamily: 'inherit', background: `color-mix(in srgb, var(--ok) 10%, var(--surface))`, color: 'var(--ok)', border: '0.5px solid var(--line)', opacity: isTriggering ? 0.5 : 1 }}>
        {isTriggering ? '…' : '▶ Run'}
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
  const entityCount  = roomDevices.length
  const activeCount  = roomDevices.filter((d) => isEntityOn(d)).length
  const offlineCount = roomDevices.filter((d) => d.state === 'unavailable' || d.state === 'unknown').length

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
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <div style={{ height: 200, background: 'var(--bg-2)', opacity: 0.6 }} />
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1,2,3].map(i => <div key={i} style={{ height: 50, borderRadius: 11, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
          </div>
        </div>
      )
    }
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: 'var(--ink-faint)', fontSize: 13 }}>Room not found</div>
  }

  const photo = getRoomPhoto(room)

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* Hero photo */}
      <div style={{ position: 'relative', height: 200, overflow: 'hidden' }}>
        <img src={photo} alt={room.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.55), transparent)' }} />
        <button onClick={() => navigate('/rooms')} style={{
          position: 'absolute', top: 16, left: 16, padding: 8, borderRadius: 10,
          background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(8px)', color: '#fff', border: 'none', cursor: 'pointer',
        }}>
          <ArrowLeft size={18} />
        </button>
        <div style={{ position: 'absolute', bottom: 16, left: 20 }}>
          <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', margin: 0 }}>{room.name}</h1>
          <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 2, fontFamily: '"IBM Plex Mono", monospace' }}>
            {entityCount} device{entityCount !== 1 ? 's' : ''}
            {activeCount  > 0 && <span style={{ color: 'rgba(255,255,255,0.9)',  marginLeft: 6 }}>· {activeCount} active</span>}
            {offlineCount > 0 && <span style={{ color: 'rgba(252,165,165,0.95)', marginLeft: 6 }}>· {offlineCount} offline</span>}
            {vDevices.length > 0 && ` · ${vDevices.length} capability${vDevices.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      <div style={{ padding: '20px 20px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        {/* Devices — grouped by domain type */}
        {(() => {
          const hiddenCount = roomDevices.filter(e => e.entity_id && hiddenEntities.has(e.entity_id)).length
          const visibleDevices = roomDevices.filter(e => showHiddenDevices || !e.entity_id || !hiddenEntities.has(e.entity_id))
          const deviceGroups = ROOM_DOMAIN_GROUPS.map(g => ({ ...g, devices: visibleDevices.filter(e => roomDomainGroup(e) === g.id) })).filter(g => g.devices.length > 0)

          return (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <p className="z-eyebrow">Devices</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {hiddenCount > 0 && (
                    <button onClick={() => setShowHiddenDevices(v => !v)} style={{ fontSize: 11, color: 'var(--ink-faint)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                      {showHiddenDevices ? `Hide ${hiddenCount} hidden` : `${hiddenCount} hidden`}
                    </button>
                  )}
                  <button onClick={() => setShowAdd(true)} className="z-btn-secondary" style={{ padding: '5px 10px', borderRadius: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Plus size={11} /> Assign
                  </button>
                </div>
              </div>

              {deviceGroups.length === 0 && (
                <div style={{ padding: '20px 16px', borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
                  {roomDevices.length === 0 ? 'No devices in this room' : 'All devices are hidden'}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {deviceGroups.map(group => (
                  <div key={group.id}>
                    <p className="z-eyebrow" style={{ marginBottom: 6 }}>{group.label}</p>
                    <div style={{ borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', overflow: 'hidden' }}>
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
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

        {/* Virtual / Capability Devices */}
        {vDevices.length > 0 && (
          <div>
            <p className="z-eyebrow" style={{ marginBottom: 8 }}>Capabilities</p>
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
              <p className="z-eyebrow">Automations</p>
              <button onClick={() => navigate('/automations')} style={{ fontSize: 11, color: 'var(--ink-faint)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>View all</button>
            </div>
            <div style={{ borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', overflow: 'hidden' }}>
              {roomAutomations.map((a, i) => (
                <div key={a.id} style={{ borderBottom: i < roomAutomations.length - 1 ? '0.5px solid var(--line)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
                    <button onClick={() => navigate('/automations')} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', padding: 0 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: a.enabled ? `color-mix(in srgb, var(--info) 12%, var(--surface))` : 'var(--bg-2)' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={a.enabled ? 'var(--info)' : 'var(--ink-faint)'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</p>
                        {a.description && <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.description}</p>}
                      </div>
                    </button>
                    <button onClick={async e => { e.stopPropagation(); try { await triggerAutomation(a.id); addToast(`Triggered: ${a.name}`, 'success') } catch { addToast('Failed', 'error') } }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ok)', padding: 6 }} title="Run now">
                      <Play size={13} />
                    </button>
                    <span style={{ color: 'var(--ink-faint)' }}><ChevronRight size={12} /></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Assign device to room">
        <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 14, lineHeight: 1.5 }}>
          Pick an existing HA entity to assign to this room. To add brand-new hardware, pair it in Home Assistant first.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <EntitySelect label="Device" placeholder="Search entities…" value={addEntityId} onChange={setAddEntityId} />
          <button onClick={handleAddDevice} disabled={!addEntityId || saving} className="z-btn-primary" style={{ width: '100%' }}>
            {saving ? 'Assigning…' : 'Assign to room'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
