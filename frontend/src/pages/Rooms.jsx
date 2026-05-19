import { useEffect, useState, lazy, Suspense } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Plus, EyeOff, Eye, Trash2, Zap, Play, Pause, ChevronRight } from 'lucide-react'
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

function RoomTile({ room, onClick, onDelete, onEditPhoto }) {
  const [hovered, setHovered] = useState(false)
  const photo = getRoomPhoto(room)
  const hasActive = room.activeCount > 0
  const hasMotion = false // motion derived from entityMap in parent — show ok dot if active

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', cursor: 'pointer', height: 156 }}
    >
      <button onClick={onClick} style={{
        width: '100%', height: '100%', padding: 0, border: 'none',
        cursor: 'pointer', display: 'block', position: 'relative',
      }}>
        {/* Full-bleed photo */}
        <img src={photo} alt={room.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        {/* Gradient */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.55) 100%)' }} />

        {/* Status dot — top right */}
        <span style={{
          position: 'absolute', top: 10, right: 10,
          width: 8, height: 8, borderRadius: '50%',
          background: hasActive ? 'var(--ok)' : 'rgba(255,255,255,0.4)',
          boxShadow: hasActive ? '0 0 0 3px rgba(108,191,140,0.35)' : 'none',
        }} />

        {/* Name + count — bottom */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '10px 12px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#fff', letterSpacing: '-0.01em', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{room.name}</p>
          <p className="z-mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>
            {room.entityCount} · {hasActive ? `${room.activeCount} on` : 'idle'}
            {room.offlineCount > 0 && <span style={{ color: 'rgba(252,165,165,0.9)', marginLeft: 4 }}>· {room.offlineCount} off</span>}
          </p>
        </div>
      </button>

      {/* Hover actions */}
      {hovered && (onEditPhoto || onDelete) && (
        <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 4, zIndex: 1 }}>
          {onEditPhoto && (
            <button onClick={e => { e.stopPropagation(); onEditPhoto(room) }} title="Edit room" style={{ padding: '5px 6px', borderRadius: 8, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)', border: '0.5px solid rgba(255,255,255,0.2)', cursor: 'pointer', color: '#fff', display: 'flex' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          )}
          {onDelete && (
            <button onClick={e => { e.stopPropagation(); onDelete(room) }} title="Delete room" style={{ padding: '5px 6px', borderRadius: 8, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)', border: '0.5px solid rgba(255,255,255,0.2)', cursor: 'pointer', color: '#fca5a5', display: 'flex' }}>
              <Trash2 size={11} />
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
  const [editCustomPhoto, setEditCustomPhoto] = useState(null)
  const [editRoomName, setEditRoomName] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => { fetchAll() }, [])

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

  const filteredRooms = rooms.filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 20px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>Your home</p>
          <h1 className="z-display" style={{ fontSize: 26, margin: 0 }}>Rooms</h1>
          <p className="z-mono" style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>
            {rooms.length} room{rooms.length !== 1 ? 's' : ''}
            {unassigned.length > 0 && <span style={{ color: 'var(--warn)', marginLeft: 4 }}>· {unassigned.length} unassigned</span>}
          </p>
        </div>
        <button onClick={() => setShowAdd(true)} className="z-btn-primary" style={{ padding: '8px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, flexShrink: 0 }}>
          <Plus size={13} /> Add room
        </button>
      </div>

      {/* Search bar */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
        </svg>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search rooms…"
          style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 36, height: 40, background: 'var(--surface)', border: '0.5px solid var(--line)', borderRadius: 12, color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none' }}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
          onBlur={e => { e.currentTarget.style.borderColor = 'var(--line)' }}
        />
      </div>

      {/* Empty state */}
      {!loading && rooms.length === 0 && unassigned.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>No rooms yet</p>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 16 }}>Add a room to start organizing devices</p>
          <button onClick={() => setShowAdd(true)} className="z-btn-secondary" style={{ padding: '8px 14px', borderRadius: 9, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Plus size={13} /> Add first room
          </button>
        </div>
      )}

      {/* Room photo-tile grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {loading && [1, 2, 3, 4].map(i => (
          <div key={i} style={{ height: 156, borderRadius: 16, background: 'var(--surface-2)', opacity: 0.6 }} />
        ))}
        {!loading && filteredRooms.map(room => (
          <RoomTile
            key={room.id}
            room={room}
            onClick={() => navigate(`/rooms/${room.id}`)}
            onDelete={r => setConfirmDelete(r)}
            onEditPhoto={handleEditPhoto}
          />
        ))}
      </div>

      {/* Unassigned / no-room chips */}
      {!loading && (unassigned.length > 0 || noRoomDevices.length > 0) && (
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
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--warn)', marginBottom: 2 }}>{unassigned.length} unassigned device{unassigned.length !== 1 ? 's' : ''}</p>
                <p className="z-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>Tap to assign to rooms</p>
              </div>
              <ChevronRight size={14} style={{ color: 'var(--warn)', flexShrink: 0 }} />
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
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{noRoomDevices.length} device{noRoomDevices.length !== 1 ? 's' : ''} — no room</p>
                <p className="z-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>Intentionally left without a room</p>
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
function LightsGroup({ devices, onToggle, onService, eyebrow }) {
  const onCount = devices.filter(d => isEntityOn(d)).length
  const [expandedId, setExpandedId] = useState(null)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <p className="z-eyebrow">{eyebrow} · {onCount} of {devices.length} on</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(devices.length, 3)}, 1fr)`, gap: 8 }}>
        {devices.map((entity, i) => {
          const on = isEntityOn(entity)
          const name = entity.display_name || entity.entity_id?.split('.')[1]?.replace(/_/g, ' ') || 'Light'
          const bri = entity.ha_attributes?.brightness ? Math.round(entity.ha_attributes.brightness / 2.55) + '%' : null
          const val = on ? (bri || 'on') : 'off'
          const isExpanded = expandedId === entity.entity_id
          return (
            <div key={entity.entity_id || i} style={{ display: 'flex', flexDirection: 'column', borderRadius: 14, border: '0.5px solid var(--line)', overflow: 'hidden', background: on ? 'var(--ink)' : 'var(--surface)' }}>
              <button
                onClick={() => onToggle(entity.entity_id, !on)}
                style={{
                  padding: 12, aspectRatio: '1',
                  color: on ? 'var(--bg)' : 'var(--ink-2)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                  cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.15s',
                  background: 'none', border: 'none',
                }}
              >
                <RoomZIcon name="light" size={20} stroke={1.6} color={on ? 'var(--gold)' : 'var(--ink-faint)'} />
                <div style={{ fontSize: 11, fontWeight: 600, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{name}</div>
                <div className="z-mono" style={{ fontSize: 10, opacity: 0.75 }}>{val}</div>
              </button>
              {/* Expand button for full light controls */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : entity.entity_id)}
                style={{
                  borderTop: `0.5px solid ${on ? 'rgba(255,255,255,0.12)' : 'var(--line)'}`,
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '6px 0', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: on ? 'rgba(255,255,255,0.5)' : 'var(--ink-faint)',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
              {isExpanded && (
                <div style={{ padding: '12px', borderTop: `0.5px solid ${on ? 'rgba(255,255,255,0.12)' : 'var(--line)'}`, background: 'var(--surface)' }}>
                  <DeviceControls entity={entity} onService={(service, data) => onService(entity, service, data)} onToggle={(v) => onToggle(entity.entity_id, v)} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Expandable device card — shows full DeviceControls when expanded ──────────
function ExpandableCard({ entity, header, onService, onToggle }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div style={{ borderRadius: 14, background: 'var(--surface)', border: '0.5px solid var(--line)', overflow: 'hidden' }}>
      {/* Row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        <div style={{ flex: 1 }}>{header}</div>
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            width: 44, height: '100%', minHeight: 60, flexShrink: 0, background: 'none', border: 'none',
            borderLeft: '0.5px solid var(--line)', cursor: 'pointer', color: 'var(--ink-faint)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title={expanded ? 'Collapse controls' : 'Show controls'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>
      </div>
      {/* Full controls */}
      {expanded && (
        <div style={{ padding: '0 16px 20px', borderTop: '0.5px solid var(--line)' }}>
          <DeviceControls entity={entity} onService={(service, data) => onService(entity, service, data)} onToggle={onToggle ? (v) => onToggle(entity.entity_id, v) : undefined} />
        </div>
      )}
    </div>
  )
}

function ClimateRowCard({ entity, onService }) {
  const name = entity.display_name || entity.entity_id?.split('.')[1]?.replace(/_/g, ' ') || 'Climate'
  const temp = entity.ha_attributes?.temperature
  const currentTemp = entity.ha_attributes?.current_temperature
  const hvacMode = entity.ha_state
  const [localTemp, setLocalTemp] = useState(temp ?? 22)
  useEffect(() => { if (temp != null) setLocalTemp(temp) }, [temp])
  const adj = (delta) => {
    const next = Math.max(16, Math.min(30, localTemp + delta))
    setLocalTemp(next)
    onService(entity, 'set_temperature', { temperature: next })
  }

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14 }}>
      <div style={{ width: 42, height: 42, borderRadius: 12, background: 'color-mix(in srgb, var(--info) 12%, var(--surface-2))', color: 'var(--info)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <RoomZIcon name="climate" size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 2 }}>
          {hvacMode}{currentTemp ? ` · ${currentTemp}° now` : ''}
        </div>
      </div>
      {temp != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button onClick={() => adj(-1)} style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--surface-2)', border: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <RoomZIcon name="back" size={14} color="var(--ink-2)" />
          </button>
          <span className="z-mono" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', minWidth: 30, textAlign: 'center' }}>{localTemp}°</span>
          <button onClick={() => adj(1)} style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--surface-2)', border: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <RoomZIcon name="fwd" size={14} color="var(--ink-2)" />
          </button>
        </div>
      )}
    </div>
  )
  return <ExpandableCard entity={entity} header={header} onService={onService} />
}

function MediaRowCard({ entity, onService }) {
  const name = entity.display_name || entity.entity_id?.split('.')[1]?.replace(/_/g, ' ') || 'Media'
  const title = entity.ha_attributes?.media_title
  const artist = entity.ha_attributes?.media_artist
  const source = entity.ha_attributes?.source || entity.ha_attributes?.app_name
  const isPlaying = entity.ha_state === 'playing'
  const sub = title ? `${title}${artist ? ' · ' + artist : ''}` : (source || entity.ha_state)
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14 }}>
      <div style={{ width: 42, height: 42, borderRadius: 12, background: 'color-mix(in srgb, var(--accent) 12%, var(--surface-2))', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <RoomZIcon name="media" size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>
      </div>
      <button
        onClick={e => { e.stopPropagation(); onService(entity, isPlaying ? 'media_pause' : 'media_play', {}) }}
        style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--ink)', color: 'var(--bg)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
      >
        {isPlaying ? <Pause size={14} fill="var(--bg)" stroke="none" /> : <Play size={14} fill="var(--bg)" stroke="none" />}
      </button>
    </div>
  )
  return <ExpandableCard entity={entity} header={header} onService={onService} />
}

function TVRowCard({ entity }) {
  const [showRemote, setShowRemote] = useState(false)
  const name = entity.display_name || entity.entity_id?.split('.')[1]?.replace(/_/g, ' ') || 'TV'
  const isIr = entity._is_ir === true || entity.domain === 'remote'
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14, background: 'var(--surface)', border: '0.5px solid var(--line)' }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--surface-2)', color: 'var(--ink-mute)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <RoomZIcon name="tv" size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{name}</div>
          <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 2 }}>Off · IR</div>
        </div>
        <button
          onClick={() => setShowRemote(true)}
          style={{ padding: '6px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '0.5px solid var(--line)', fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', cursor: 'pointer', flexShrink: 0 }}
        >
          Remote
        </button>
      </div>
      {showRemote && <IRRemoteButton entity={entity} onClose={() => setShowRemote(false)} />}
    </>
  )
}

function SensorsStrip({ devices }) {
  const renderSensor = (entity) => {
    const domain = entity.domain
    const dc = entity.ha_attributes?.device_class || entity.device_class
    const name = entity.display_name || entity.entity_id?.split('.')[1]?.replace(/_/g, ' ') || ''
    const val = entity.ha_state || entity.state || '—'
    const unit = entity.ha_attributes?.unit_of_measurement || ''
    let icon = 'motion'
    if (dc === 'temperature') icon = 'temp'
    else if (dc === 'humidity') icon = 'humid'
    else if (dc === 'motion' || dc === 'occupancy') icon = 'motion'
    return { icon, val: val + unit, name, entity }
  }
  const items = devices.map(renderSensor)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      {items.map(({ icon, val, name }, i) => (
        <div key={i} style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)' }}>
          <div style={{ color: 'var(--ink-faint)', marginBottom: 6 }}><RoomZIcon name={icon} size={13} /></div>
          <div className="z-mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{val}</div>
          <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 2 }}>{name}</div>
        </div>
      ))}
    </div>
  )
}

function StandardDeviceRow({ entity, onToggle, onService }) {
  const [expanded, setExpanded] = useState(false)
  const isOn = isEntityOn(entity)
  const name = entity.display_name || entity.entity_id?.split('.')[1]?.replace(/_/g, ' ') || 'Device'
  const state = entity.ha_state || entity.state || '—'
  const isToggleable = TOGGLEABLE_DOMAINS.has(entity.domain) && entity.state !== 'unavailable'
  const hasFullControls = ['light', 'climate', 'media_player', 'cover', 'fan', 'lock', 'vacuum'].includes(entity.domain)
  return (
    <div style={{ borderBottom: '0.5px solid var(--line)' }} className="last:border-b-0">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: isOn ? 'var(--ink)' : 'var(--surface-2)',
          color: isOn ? 'var(--bg)' : 'var(--ink-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
        }}>
          {domainIcon(entity.domain, entity.device_class)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
          <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 1 }}>{state}</div>
        </div>
        {isToggleable && <Toggle checked={isOn} onCheckedChange={(v) => onToggle(entity.entity_id, v)} />}
        {hasFullControls && (
          <button onClick={() => setExpanded(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: '4px 2px', marginLeft: 4 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
        )}
      </div>
      {expanded && hasFullControls && (
        <div style={{ padding: '0 14px 16px', borderTop: '0.5px solid var(--line)' }}>
          <DeviceControls entity={entity} onService={(service, data) => onService(entity, service, data)} onToggle={(v) => onToggle(entity.entity_id, v)} />
        </div>
      )}
    </div>
  )
}

function renderDomainSection(group, devices, handlers) {
  const { onToggle, onService } = handlers
  const visibleDevices = devices.filter(e => e.state !== 'unavailable' || group.id === 'sensors')

  if (group.id === 'lights') {
    const lights = visibleDevices.filter(e => e.domain === 'light')
    if (!lights.length) return null
    return <LightsGroup devices={lights} onToggle={onToggle} onService={onService} eyebrow={group.label} />
  }

  if (group.id === 'climate') {
    const climateDev = visibleDevices.filter(e => e.domain === 'climate')
    const fans = visibleDevices.filter(e => e.domain === 'fan')
    return (
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{group.label}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {climateDev.map((e, i) => <ClimateRowCard key={e.entity_id || i} entity={e} onService={onService} />)}
          {fans.map((e, i) => <StandardDeviceRow key={e.entity_id || i} entity={e} onToggle={onToggle} onService={onService} />)}
        </div>
      </div>
    )
  }

  if (group.id === 'media') {
    const tvIr = visibleDevices.filter(e => e.domain === 'tv' || e._is_ir || ['tv', 'projector'].includes(e.ha_attributes?.device_class))
    const mediaPlayers = visibleDevices.filter(e => e.domain === 'media_player' && !tvIr.includes(e))
    return (
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{group.label}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mediaPlayers.map((e, i) => <MediaRowCard key={e.entity_id || i} entity={e} onService={onService} />)}
          {tvIr.map((e, i) => <TVRowCard key={e.entity_id || i} entity={e} />)}
        </div>
      </div>
    )
  }

  if (group.id === 'sensors') {
    if (!visibleDevices.length) return null
    return (
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{group.label}</p>
        <SensorsStrip devices={visibleDevices} />
      </div>
    )
  }

  // Standard row cards for everything else
  return (
    <div>
      <p className="z-eyebrow" style={{ marginBottom: 8 }}>{group.label}</p>
      <div style={{ borderRadius: 14, background: 'var(--surface)', border: '0.5px solid var(--line)', overflow: 'hidden' }}>
        {visibleDevices.map((e, i) => <StandardDeviceRow key={e.entity_id || i} entity={e} onToggle={onToggle} onService={onService} />)}
      </div>
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
      {/* Hero photo — 220px, rounded bottom */}
      <div style={{ position: 'relative', height: 220, overflow: 'hidden', borderRadius: '0 0 22px 22px' }}>
        <img src={photo} alt={room.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.2) 0%, transparent 35%, rgba(0,0,0,0.6) 100%)' }} />

        {/* Back button */}
        <button onClick={() => navigate('/rooms')} style={{
          position: 'absolute', top: 16, left: 16,
          width: 34, height: 34, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(10px)',
          border: '0.5px solid rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer',
        }}>
          <ArrowLeft size={16} />
        </button>

        {/* Title bottom */}
        <div style={{ position: 'absolute', bottom: 16, left: 20 }}>
          <h1 style={{ color: '#fff', fontSize: 24, fontWeight: 700, letterSpacing: '-0.025em', margin: 0, lineHeight: 1.1 }}>{room.name}</h1>
          <p className="z-mono" style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 3 }}>
            {entityCount} device{entityCount !== 1 ? 's' : ''}
            {activeCount  > 0 && <span style={{ color: 'rgba(255,255,255,0.95)', marginLeft: 6 }}>· {activeCount} active</span>}
            {offlineCount > 0 && <span style={{ color: 'rgba(252,165,165,0.9)', marginLeft: 6 }}>· {offlineCount} offline</span>}
            {vDevices.length > 0 && <span style={{ marginLeft: 6 }}>· {vDevices.length} capability{vDevices.length !== 1 ? 's' : ''}</span>}
          </p>
        </div>
      </div>

      {/* Everything off + sparkle row */}
      <div style={{ padding: '14px 20px 0', display: 'flex', gap: 8 }}>
        <button
          onClick={async () => {
            for (const d of roomDevices.filter(d => isEntityOn(d) && d.entity_id)) {
              try { await controlDevice(d.entity_id, 'turn_off') } catch {}
            }
            addToast('Everything off', 'success')
            setTimeout(() => fetchAll(), 1500)
          }}
          style={{
            flex: 1, padding: '12px 14px', borderRadius: 14,
            background: 'var(--ink)', color: 'var(--bg)', border: 'none',
            fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <RoomZIcon name="bolt" size={14} color="var(--bg)" />
          Everything off
        </button>
        <button style={{ width: 48, padding: 12, borderRadius: 14, background: 'var(--surface)', border: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <RoomZIcon name="sparkle" size={16} color="var(--ink-2)" />
        </button>
      </div>

      <div style={{ padding: '16px 20px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>
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

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {deviceGroups.map(group => {
                  const section = renderDomainSection(group, group.devices, { onToggle: handleToggle, onService: handleService })
                  return section ? <div key={group.id}>{section}</div> : null
                })}
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
