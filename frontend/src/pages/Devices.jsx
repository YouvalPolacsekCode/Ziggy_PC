import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, MoreVertical, EyeOff, Eye, Home, ChevronDown, Plus, Tv2, Thermometer, Wind, Volume2, Zap, Trash2, MonitorPlay, Pencil } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Button } from '../components/ui/Button'
import { DeviceControls, TOGGLEABLE_DOMAINS } from '../components/ui/DeviceControls'
import { useDeviceStore } from '../stores/deviceStore'
import { useUIStore } from '../stores/uiStore'
import { domainIcon, formatEntityState } from '../lib/utils'
import { sendIntent, assignEntityToArea, callHaService, getIrDevices, deleteIrDevice, patchIrDevice, getRooms, irLearn, irSend } from '../lib/api'
import { cn } from '../lib/utils'
import { useSearchParams } from 'react-router-dom'
import { PairingWizard } from '../components/PairingWizard'
import IRWizard from '../components/IRWizard'

const IR_TYPE_ICONS = {
  tv:        Tv2,
  ac:        Thermometer,
  fan:       Wind,
  soundbar:  Volume2,
  projector: MonitorPlay,
  custom:    Zap,
}

const IR_DEVICE_TYPES = ['tv', 'ac', 'fan', 'soundbar', 'projector', 'custom']

const INPUT_CLS = 'w-full h-10 px-3 rounded-xl text-sm border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500/50'

function CommandEditRow({ cmd, learned, deviceId, onRemove }) {
  const [status, setStatus] = useState(learned ? 'learned' : 'idle')
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef(null)

  const startLearn = async () => {
    if (!cmd) return
    setStatus('learning')
    setCountdown(20)
    timerRef.current = setInterval(() => setCountdown((c) => { if (c <= 1) { clearInterval(timerRef.current); return 0 } return c - 1 }), 1000)
    try {
      await irLearn(deviceId, cmd)
      setStatus('learned')
    } catch { setStatus('error') }
    finally { clearInterval(timerRef.current); setCountdown(0) }
  }

  const test = async () => {
    if (!cmd) return
    try { await irSend(deviceId, cmd); if (status !== 'learned') setStatus('learned') } catch {}
  }

  useEffect(() => () => clearInterval(timerRef.current), [])

  return (
    <div className="flex items-center gap-2 py-1">
      <div className={cn('w-2 h-2 rounded-full shrink-0',
        status === 'learned' ? 'bg-green-400' :
        status === 'error' ? 'bg-red-400' :
        status === 'learning' ? 'bg-yellow-400 animate-pulse' : 'bg-zinc-300 dark:bg-zinc-600'
      )} />
      <span className="flex-1 text-xs text-zinc-700 dark:text-zinc-300 font-mono">{cmd}</span>
      {status === 'learning'
        ? <span className="text-xs text-yellow-500 w-10 text-right font-mono">{countdown}s</span>
        : <button onClick={startLearn} className="text-xs text-violet-500 hover:text-violet-600 w-10 text-right">{status === 'learned' ? '↺' : 'Learn'}</button>
      }
      <button onClick={test} disabled={status === 'learning'} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 w-8 text-right">Test</button>
      <button onClick={onRemove} className="text-zinc-300 dark:text-zinc-600 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
    </div>
  )
}

function IREditModal({ device, onClose, onSaved }) {
  const [tab, setTab] = useState('details')
  const [form, setForm] = useState({
    name: device.name || '',
    device_type: device.device_type || device.type || 'tv',
    room: device.room || '',
    brand: device.brand || '',
  })
  const [rooms, setRooms] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [commands, setCommands] = useState(Object.keys(device.commands || {}))
  const [newCmd, setNewCmd] = useState('')
  const learned = new Set(device.learned_commands || [])

  useEffect(() => {
    getRooms().then((r) => setRooms(Array.isArray(r) ? r : r.areas ?? r.rooms ?? [])).catch(() => {})
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const commandMap = {}
      commands.forEach((c) => { commandMap[c] = c })
      await patchIrDevice(device.id, {
        name: form.name.trim(),
        device_type: form.device_type,
        room: form.room || null,
        brand: form.brand.trim() || null,
        commands: commandMap,
      })
      onSaved()
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const addCmd = () => {
    const c = newCmd.trim().toLowerCase().replace(/\s+/g, '_')
    if (c && !commands.includes(c)) { setCommands([...commands, c]); setNewCmd('') }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-100 dark:border-zinc-800 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{device.name}</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-lg leading-none">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pb-3 shrink-0">
          {['details', 'commands'].map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors',
                tab === t ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              )}
            >{t}</button>
          ))}
        </div>

        {/* Body */}
        <div className="px-5 pb-2 overflow-y-auto flex-1">
          {tab === 'details' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Type</label>
                <div className="flex flex-wrap gap-1.5">
                  {IR_DEVICE_TYPES.map((t) => (
                    <button key={t} onClick={() => setForm({ ...form, device_type: t })}
                      className={cn('px-3 py-1 rounded-lg text-xs border transition-all capitalize',
                        form.device_type === t ? 'border-violet-500 bg-violet-500/15 text-violet-600 dark:text-violet-300' : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                      )}
                    >{t}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Room</label>
                <select value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} className={INPUT_CLS}>
                  <option value="">— no room —</option>
                  {rooms.map((r) => <option key={r.id ?? r.name} value={r.id ?? r.area_id ?? r.name}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Brand</label>
                <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="Samsung, LG…" className={INPUT_CLS + ' placeholder:text-zinc-400'} />
              </div>
            </div>
          )}

          {tab === 'commands' && (
            <div>
              <p className="text-xs text-zinc-400 mb-3">
                Green = learned in HA. Click <strong className="text-zinc-600 dark:text-zinc-300">Learn</strong> to (re)teach, <strong className="text-zinc-600 dark:text-zinc-300">Test</strong> to fire it.
              </p>
              <div className="space-y-0.5 mb-3">
                {commands.map((cmd) => (
                  <CommandEditRow
                    key={cmd}
                    cmd={cmd}
                    learned={learned.has(cmd)}
                    deviceId={device.id}
                    onRemove={() => setCommands(commands.filter((c) => c !== cmd))}
                  />
                ))}
                {commands.length === 0 && <p className="text-xs text-zinc-400 py-2">No commands yet.</p>}
              </div>
              <div className="flex gap-2">
                <input
                  value={newCmd}
                  onChange={(e) => setNewCmd(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCmd()}
                  placeholder="new_command"
                  className="flex-1 h-8 px-3 rounded-lg text-xs border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                />
                <button onClick={addCmd} className="px-3 h-8 text-xs rounded-lg bg-violet-500 text-white hover:bg-violet-600 transition-colors">
                  Add
                </button>
              </div>
            </div>
          )}
        </div>

        {error && <p className="px-5 pb-1 text-xs text-red-500">{error}</p>}

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-zinc-100 dark:border-zinc-800 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving || !form.name.trim()}
            className="px-4 py-2 text-sm font-medium rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 disabled:opacity-50 transition-opacity"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function IRDeviceCard({ device, onDelete, onEdit }) {
  const Icon = IR_TYPE_ICONS[device.device_type ?? device.type] || Zap
  const learnedCount = (device.learned_commands || []).length
  const totalCount = Object.keys(device.commands || {}).length
  const room = (device.room || '').replace(/_/g, ' ')

  return (
    <Card className="p-4 flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-violet-500/15 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-violet-400" />
        </div>
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 leading-tight">{device.name}</p>
          {room && <p className="text-xs text-zinc-400 mt-0.5 capitalize">{room}</p>}
          <p className="text-xs text-zinc-400 mt-0.5">
            {learnedCount}/{totalCount} commands learned
            {device.assumed_state && device.assumed_state !== 'unknown' && (
              <span className={cn('ml-2 font-medium', device.assumed_state === 'on' ? 'text-emerald-500' : 'text-zinc-500')}>
                · {device.assumed_state}
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 mt-0.5">
        <button
          onClick={() => onEdit(device)}
          className="text-zinc-300 dark:text-zinc-600 hover:text-violet-500 transition-colors"
          title="Edit device"
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          onClick={() => onDelete(device.id)}
          className="text-zinc-300 dark:text-zinc-600 hover:text-red-400 transition-colors"
          title="Remove IR device"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </Card>
  )
}

const DOMAIN_FILTER = [
  { id: 'all', label: 'All' },
  { id: 'unassigned', label: '📦 Unassigned' },
  { id: 'active', label: '🟢 Active' },
  { id: 'connected', label: '🔗 Connected' },
  { id: 'light', label: 'Lights' },
  { id: 'switch', label: 'Switches' },
  { id: 'climate', label: 'Climate' },
  { id: 'media_player', label: 'Media' },
  { id: 'sensor', label: 'Sensors' },
]

// ── Assign-to-room inline dropdown ──────────────────────────────────────────
function AssignRoomDropdown({ entityId, rooms, onAssign }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div ref={ref} className="relative mt-3">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        className={cn(
          'w-full flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
          'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300',
          'hover:bg-violet-100 dark:hover:bg-violet-900/40'
        )}
      >
        <span>Assign to room</span>
        <ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden"
          >
            <div className="py-1 max-h-48 overflow-y-auto">
              {rooms.map((r) => (
                <button
                  key={r.id}
                  onClick={() => { onAssign(entityId, r.id); setOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  <span className="w-2 h-2 rounded-full bg-violet-400 shrink-0" />
                  {r.name}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Per-card "…" context menu ─────────────────────────────────────────────────
function DeviceMenu({ entity, rooms, onHide, onAssign }) {
  const [open, setOpen] = useState(false)
  const [alignLeft, setAlignLeft] = useState(false)
  const ref = useRef(null)

  const currentRoom = rooms.find((r) => (r.entities || []).includes(entity.entity_id))

  useEffect(() => {
    if (!open) return
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setAlignLeft(rect.left < window.innerWidth / 2)
    }
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
      >
        <MoreVertical size={14} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12 }}
            className={cn('absolute top-7 z-50 w-48 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden', alignLeft ? 'left-0' : 'right-0')}
          >
            <div className="py-1">
              {currentRoom && (
                <div className="px-3 pt-2 pb-1.5 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    In <span className="font-semibold text-zinc-700 dark:text-zinc-200">{currentRoom.name}</span>
                  </span>
                </div>
              )}
              <p className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Assign to room
              </p>
              <button
                onClick={() => { onAssign(entity.entity_id, null); setOpen(false) }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors',
                  !currentRoom ? 'text-violet-600 dark:text-violet-400 font-medium' : 'text-zinc-500'
                )}
              >
                <Home size={12} /> No room
              </button>
              {rooms.map((r) => (
                <button
                  key={r.id}
                  onClick={() => { onAssign(entity.entity_id, r.id); setOpen(false) }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors',
                    currentRoom?.id === r.id
                      ? 'text-violet-600 dark:text-violet-400 font-semibold'
                      : 'text-zinc-700 dark:text-zinc-300'
                  )}
                >
                  <span className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    currentRoom?.id === r.id ? 'bg-violet-500' : 'bg-zinc-300 dark:bg-zinc-600'
                  )} />
                  {r.name}
                  {currentRoom?.id === r.id && <span className="ml-auto text-[10px] text-violet-400">✓</span>}
                </button>
              ))}
              <div className="border-t border-zinc-100 dark:border-zinc-800 mt-1 pt-1">
                <button
                  onClick={() => { onHide(entity.entity_id); setOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  <EyeOff size={12} /> Hide device
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Device card ───────────────────────────────────────────────────────────────
const STATUS_DOT = {
  lost:         'bg-red-400',
  unclaimed:    'bg-amber-400',
  unconfigured: 'bg-zinc-300 dark:bg-zinc-600',
  connected:    'bg-emerald-400',
}
const STATUS_LABEL = {
  lost:         'Removed from hub',
  unclaimed:    'Not assigned to Ziggy',
  unconfigured: 'No entity set',
}

function DeviceCard({ entity, rooms, onToggle, onService, onHide, onAssign, isHidden, showAssign, ziggyStatus }) {
  const isOn = entity.state === 'on'
  const isToggleable = TOGGLEABLE_DOMAINS.has(entity.domain) && entity.state !== 'unavailable'
  const { primary: stateLabel, secondary: stateSecondary } = isHidden
    ? { primary: 'Hidden', secondary: null }
    : formatEntityState(entity)

  const isActive = entity.state !== 'off' && entity.state !== 'unavailable' && entity.state !== 'unknown'
  const showStatusBadge = ziggyStatus && ziggyStatus !== 'connected' && STATUS_LABEL[ziggyStatus]

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: isHidden ? 0.45 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.15 }}
    >
      <Card className={cn('p-4 transition-all duration-200', isActive && !isHidden && 'shadow-card-hover')}>
        <div className="flex items-start justify-between mb-3">
          <div className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center text-xl relative',
            isActive ? 'bg-zinc-900 dark:bg-white' : 'bg-zinc-100 dark:bg-zinc-800'
          )}>
            {domainIcon(entity.domain, entity.device_class)}
            {ziggyStatus && STATUS_DOT[ziggyStatus] && (
              <span className={cn('absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-zinc-900', STATUS_DOT[ziggyStatus])} />
            )}
          </div>
          <div className="flex items-center gap-1">
            {isToggleable && (
              <Toggle checked={isOn} onCheckedChange={(v) => onToggle(entity.entity_id, v)} />
            )}
            <DeviceMenu entity={entity} rooms={rooms} onHide={onHide} onAssign={onAssign} />
          </div>
        </div>

        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 leading-tight mb-0.5 truncate">
          {entity.display_name || entity.friendly_name || entity.entity_id.split('.')[1]}
        </p>
        {showStatusBadge ? (
          <p className="text-xs font-medium text-red-400">{STATUS_LABEL[ziggyStatus]}</p>
        ) : (
        <p className={cn(
          'text-xs font-medium',
          isHidden ? 'text-zinc-300 dark:text-zinc-700' :
          entity.state === 'unavailable' ? 'text-zinc-300 dark:text-zinc-600' :
          isActive ? 'text-emerald-500' : 'text-zinc-400 dark:text-zinc-600'
        )}>
          {stateLabel}
        </p>
        )}
        {stateSecondary && !isHidden && (
          <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-0.5">{stateSecondary}</p>
        )}

        {!isHidden && (
          <DeviceControls
            entity={entity}
            onService={(service, data) => onService(entity, service, data)}
          />
        )}

        {showAssign && (
          <AssignRoomDropdown entityId={entity.entity_id} rooms={rooms} onAssign={onAssign} />
        )}
      </Card>
    </motion.div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Devices() {
  const { entities, rooms, deviceStatusMap, loading, fetchAll, hiddenEntities, showHidden, hideEntity, toggleShowHidden, getUnassigned, ziggyRooms, unclaimedDevices } = useDeviceStore()
  const { addToast } = useUIStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [domain, setDomain] = useState(searchParams.get('filter') || 'all')

  useEffect(() => { fetchAll() }, [])

  // Sync filter from URL param (used by Rooms page "Unassigned" card)
  useEffect(() => {
    const f = searchParams.get('filter')
    if (f) setDomain(f)
  }, [searchParams])

  const allRooms = rooms.map((r) => ({ id: r.id, name: r.name, entities: r.entities || [] }))
  const unassigned = getUnassigned()

  const filtered = (() => {
    if (domain === 'unassigned') return unassigned
    return entities.filter((e) => {
      const isHidden = hiddenEntities.has(e.entity_id)
      if (isHidden && !showHidden) return false
      let matchDomain = true
      if (domain === 'active') matchDomain = e.state === 'on'
      else if (domain === 'connected') matchDomain = e.state !== 'unavailable' && e.state !== 'unknown'
      else if (domain !== 'all') matchDomain = e.domain === domain
      const matchSearch = !search ||
        (e.display_name || e.friendly_name || '').toLowerCase().includes(search.toLowerCase()) ||
        e.entity_id.toLowerCase().includes(search.toLowerCase())
      return matchDomain && matchSearch
    })
  })()

  const handleToggle = async (entityId, on) => {
    const entity = entities.find((e) => e.entity_id === entityId)
    if (entity?.state === 'unavailable') {
      addToast('Device is unavailable', 'error')
      return
    }
    try {
      await sendIntent(`turn ${on ? 'on' : 'off'} ${entityId}`)
      addToast(`${on ? 'Turned on' : 'Turned off'}`, 'success')
    } catch { addToast('Failed', 'error') }
  }

  const handleService = async (entity, service, data) => {
    try {
      await callHaService(entity.domain, service, { entity_id: entity.entity_id, ...data })
    } catch {
      addToast('Control failed', 'error')
    }
  }

  const handleAssign = async (entityId, areaId) => {
    try {
      await assignEntityToArea(entityId, areaId)
      await fetchAll()
      addToast(areaId ? 'Assigned to room' : 'Removed from room', 'success')
    } catch (e) { addToast(e.message || 'Failed', 'error') }
  }

  const [showPairing, setShowPairing]     = useState(false)
  const [showIRWizard, setShowIRWizard]   = useState(false)
  const [irDevices, setIrDevices]         = useState([])
  const [editingIrDevice, setEditingIrDevice] = useState(null)

  const fetchIrDevices = () => getIrDevices().then(setIrDevices).catch(() => {})
  useEffect(() => { fetchIrDevices() }, [])

  const handleDeleteIrDevice = async (id) => {
    try {
      await deleteIrDevice(id)
      await fetchIrDevices()
      addToast('IR device removed', 'success')
    } catch { addToast('Failed to remove', 'error') }
  }

  const activeCount = entities.filter((e) => e.state === 'on').length
  const hiddenCount = hiddenEntities.size

  // Devices in DeviceRegistry with status needing attention (lost/unconfigured) — not visible in HA entity list
  const allZiggyDevices = [
    ...ziggyRooms.flatMap((r) => (r.devices || []).map((d) => ({ ...d, roomName: r.name }))),
    ...(unclaimedDevices || []).map((d) => ({ ...d, roomName: null })),
  ]
  const attentionDevices = allZiggyDevices.filter((d) => d.status === 'lost' || d.status === 'unconfigured')

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Devices</h1>
          <p className="text-sm text-zinc-400 dark:text-zinc-600 mt-0.5">
            {activeCount} active · {entities.length} total
            {hiddenCount > 0 && ` · ${hiddenCount} hidden`}
            {unassigned.length > 0 && (
              <span className="ml-1 text-amber-500 font-medium">· {unassigned.length} unassigned</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setShowPairing(true)}>
            <Plus size={13} /> Pair device
          </Button>
          {hiddenCount > 0 && (
            <button
              onClick={toggleShowHidden}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                showHidden
                  ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              )}
            >
              {showHidden ? <Eye size={12} /> : <EyeOff size={12} />}
              {showHidden ? 'Showing hidden' : 'Show hidden'}
            </button>
          )}
        </div>
      </div>

      {/* Unassigned banner */}
      {unassigned.length > 0 && domain !== 'unassigned' && (
        <motion.button
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => setDomain('unassigned')}
          className="w-full mb-4 flex items-center justify-between px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-left transition-colors hover:bg-amber-100 dark:hover:bg-amber-900/30"
        >
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              {unassigned.length} device{unassigned.length !== 1 ? 's' : ''} not assigned to any room
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
              Tap to review and assign them
            </p>
          </div>
          <span className="text-amber-500 text-xs font-medium">Review →</span>
        </motion.button>
      )}

      {/* Needs attention — lost / unconfigured devices */}
      {attentionDevices.length > 0 && domain !== 'attention' && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-medium text-red-800 dark:text-red-300">
                {attentionDevices.length} device{attentionDevices.length !== 1 ? 's' : ''} need attention
              </p>
              <p className="text-xs text-red-600 dark:text-red-500 mt-0.5">
                Lost from hub or missing HA entity configuration
              </p>
            </div>
          </div>
          <div className="border-t border-red-200 dark:border-red-800 divide-y divide-red-100 dark:divide-red-900">
            {attentionDevices.map((d, i) => (
              <div key={d.entity_id || i} className="flex items-center gap-3 px-4 py-2.5">
                <span className={cn(
                  'w-2 h-2 rounded-full shrink-0',
                  d.status === 'lost' ? 'bg-red-400' : 'bg-zinc-300 dark:bg-zinc-600'
                )} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {d.display_name || d.entity_id || d.device_type}
                  </p>
                  <p className="text-xs text-zinc-400 truncate">
                    {d.roomName ? `${d.roomName} · ` : ''}{STATUS_LABEL[d.status] || d.status}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Search (hidden in unassigned view) */}
      {domain !== 'unassigned' && (
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search devices…"
            className={cn(
              'w-full h-10 pl-9 pr-4 rounded-xl text-sm',
              'bg-zinc-100 dark:bg-zinc-800',
              'text-zinc-900 dark:text-zinc-100',
              'placeholder:text-zinc-400 dark:placeholder:text-zinc-600',
              'border-0 focus:outline-none focus:ring-2 focus:ring-violet-500/50'
            )}
          />
        </div>
      )}

      {/* Domain filter */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-5 scrollbar-thin">
        {DOMAIN_FILTER.map((f) => (
          <button
            key={f.id}
            onClick={() => setDomain(f.id)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors',
              domain === f.id
                ? f.id === 'unassigned'
                  ? 'bg-amber-500 text-white'
                  : 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                : f.id === 'unassigned' && unassigned.length > 0
                  ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700'
            )}
          >
            {f.label}
            {f.id === 'unassigned' && unassigned.length > 0 && (
              <span className="ml-1 bg-amber-500 text-white text-[9px] rounded-full px-1.5 py-0.5">
                {unassigned.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Unassigned section header */}
      {domain === 'unassigned' && (
        <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            Devices not assigned to any room
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
            These are in your HA setup but haven't been placed in a room yet. Use "Assign to room" on each card.
          </p>
        </div>
      )}

      {/* Grid */}
      {loading && (
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 text-zinc-400 dark:text-zinc-600">
          <p className="text-4xl mb-3">{domain === 'unassigned' ? '✅' : '🔌'}</p>
          <p className="text-sm">
            {domain === 'unassigned' ? 'All devices are assigned to rooms' : 'No devices found'}
          </p>
        </div>
      )}

      <motion.div layout className="grid grid-cols-2 gap-3">
        <AnimatePresence mode="popLayout">
          {filtered.map((entity) => (
            <DeviceCard
              key={entity.entity_id}
              entity={entity}
              rooms={allRooms}
              onToggle={handleToggle}
              onService={handleService}
              onHide={hideEntity}
              onAssign={handleAssign}
              isHidden={hiddenEntities.has(entity.entity_id)}
              showAssign={domain === 'unassigned'}
              ziggyStatus={deviceStatusMap[entity.entity_id]}
            />
          ))}
        </AnimatePresence>
      </motion.div>

      {/* IR Devices section */}
      <div className="mt-8 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">IR Devices</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Broadlink blaster — TV, AC, fan, soundbar</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setShowIRWizard(true)}>
            <Plus size={13} /> Add IR device
          </Button>
        </div>

        {irDevices.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 py-8 text-center text-zinc-400 dark:text-zinc-600 text-sm">
            No IR devices yet — add one to control TV, AC, or other IR gear via your Broadlink blaster.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {irDevices.map((d) => (
              <IRDeviceCard key={d.id} device={d} onDelete={handleDeleteIrDevice} onEdit={setEditingIrDevice} />
            ))}
          </div>
        )}
      </div>

      <PairingWizard open={showPairing} onClose={() => setShowPairing(false)} />

      {showIRWizard && (
        <IRWizard
          onClose={() => setShowIRWizard(false)}
          onCreated={() => { fetchIrDevices(); setShowIRWizard(false) }}
        />
      )}

      {editingIrDevice && (
        <IREditModal
          device={editingIrDevice}
          onClose={() => setEditingIrDevice(null)}
          onSaved={() => { fetchIrDevices(); setEditingIrDevice(null) }}
        />
      )}
    </div>
  )
}
