import { useEffect, useState, useRef, forwardRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, MoreVertical, EyeOff, Eye, Home, ChevronDown, Plus, Tv2, Thermometer, Wind, Volume2, Zap, Trash2, MonitorPlay, Pencil, ChevronRight } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Button } from '../components/ui/Button'
import { DeviceControls, TOGGLEABLE_DOMAINS, IRRemoteButton, isEntityOn } from '../components/ui/DeviceControls'
import { EntitySelect } from '../components/ui/EntitySelect'
import { Modal } from '../components/ui/Modal'
import { useDeviceStore } from '../stores/deviceStore'
import { useUIStore } from '../stores/uiStore'
import { domainIcon, formatEntityState } from '../lib/utils'
import { DOMAIN_GROUPS, domainGroup } from '../lib/domainRegistry'
import { controlDevice, assignEntityToArea, callHaService, getIrDevices, deleteIrDevice, patchIrDevice, irLearn, irSend, irSendChannel, getAllRooms } from '../lib/api'
import { cn } from '../lib/utils'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { PairingWizard } from '../components/PairingWizard'
import IRWizard from '../components/IRWizard'

function _fmtAgo(isoOrDateStr) {
  if (!isoOrDateStr) return ''
  const d = new Date(isoOrDateStr.replace(' ', 'T'))
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffMin < 1440) return `${Math.round(diffMin / 60)}h ago`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

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
  // Store as [logicalName, haCommandName] pairs to preserve custom HA command mappings
  const [commands, setCommands] = useState(Object.entries(device.commands || {}))
  const [newCmd, setNewCmd] = useState('')
  const learned = new Set(device.learned_commands || [])

  useEffect(() => {
    getAllRooms().then((r) => setRooms(Array.isArray(r) ? r : r.rooms ?? [])).catch(() => {})
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const commandMap = {}
      commands.forEach(([k, v]) => { commandMap[k] = v })
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
    if (c && !commands.some(([k]) => k === c)) { setCommands([...commands, [c, c]]); setNewCmd('') }
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
                {commands.map(([cmd]) => (
                  <CommandEditRow
                    key={cmd}
                    cmd={cmd}
                    learned={learned.has(cmd)}
                    deviceId={device.id}
                    onRemove={() => setCommands(commands.filter(([k]) => k !== cmd))}
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

const IR_STATE_OPTIONS = {
  default:  ['on', 'off'],
  ac:       ['cool', 'heat', 'fan_only', 'off'],
  fan:      ['on', 'off'],
  tv:       ['on', 'off'],
  soundbar: ['on', 'off'],
  projector:['on', 'off'],
}

// Quick-fire button definitions per device type.
// Each entry: { cmd, icon, label }  — only shown when command is learned.
const IR_QUICK_BUTTONS = {
  tv: [
    { cmd: 'power',       icon: '⏻', label: 'Power' },
    { cmd: 'volume_up',   icon: '🔊', label: 'Vol+' },
    { cmd: 'volume_down', icon: '🔉', label: 'Vol−' },
    { cmd: 'mute',        icon: '🔇', label: 'Mute' },
  ],
  soundbar: [
    { cmd: 'power',       icon: '⏻', label: 'Power' },
    { cmd: 'volume_up',   icon: '🔊', label: 'Vol+' },
    { cmd: 'volume_down', icon: '🔉', label: 'Vol−' },
    { cmd: 'mute',        icon: '🔇', label: 'Mute' },
  ],
  projector: [
    { cmd: 'power',       icon: '⏻', label: 'Power' },
  ],
  fan: [
    { cmd: 'power',        icon: '⏻', label: 'Power' },
    { cmd: 'speed_low',    icon: '〜', label: 'Low' },
    { cmd: 'speed_medium', icon: '≈', label: 'Med' },
    { cmd: 'speed_high',   icon: '≋', label: 'High' },
  ],
  ac: [
    { cmd: 'power',     icon: '⏻', label: 'Power' },
    { cmd: 'mode_cool', icon: '❄', label: 'Cool' },
    { cmd: 'mode_heat', icon: '🔥', label: 'Heat' },
    { cmd: 'mode_fan',  icon: '💨', label: 'Fan' },
  ],
}
const IR_DEFAULT_QUICK = [{ cmd: 'power', icon: '⏻', label: 'Power' }]

function IRQuickControls({ device, onCommand }) {
  const dtype   = device.device_type || device.type || ''
  const learned = new Set(device.learned_commands || [])
  const cmds    = device.commands || {}

  const canDo = (cmd) => cmd in cmds && learned.has(cmd)

  const buttons = (IR_QUICK_BUTTONS[dtype] || IR_DEFAULT_QUICK).filter((b) => canDo(b.cmd))
  if (buttons.length === 0) return null

  return (
    <div className="mt-2.5 pt-2.5 border-t border-zinc-100 dark:border-zinc-800 flex gap-1.5 flex-wrap">
      {buttons.map(({ cmd, icon, label }) => (
        <button
          key={cmd}
          onClick={() => onCommand(device.id, cmd)}
          title={label}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-xs font-medium"
        >
          <span className="text-[11px]">{icon}</span>
          <span className="text-[10px]">{label}</span>
        </button>
      ))}
    </div>
  )
}

function IRDeviceCard({ device, onDelete, onEdit, onStateChange, onCommand }) {
  const Icon = IR_TYPE_ICONS[device.device_type ?? device.type] || Zap
  const learnedCount = (device.learned_commands || []).length
  const totalCount = Object.keys(device.commands || {}).length
  const room = (device.room || '').replace(/_/g, ' ')
  const [showStatePicker, setShowStatePicker] = useState(false)
  const assumedState = device.assumed_state && device.assumed_state !== 'unknown'
    ? device.assumed_state : null
  const stateOptions = IR_STATE_OPTIONS[device.device_type ?? device.type] || IR_STATE_OPTIONS.default

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-violet-500/15 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-violet-400" />
        </div>
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 leading-tight">{device.name}</p>
          {room && <p className="text-xs text-zinc-400 mt-0.5 capitalize">{room}</p>}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs text-zinc-400">{learnedCount}/{totalCount} commands</span>
            {/* Interactive assumed-state chip */}
            <div className="relative">
              <button
                onClick={() => setShowStatePicker((v) => !v)}
                title="IR state is estimated — tap to correct manually"
                className={cn(
                  'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors',
                  assumedState === 'on' || (assumedState && assumedState !== 'off')
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                    : assumedState === 'off'
                    ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500'
                    : 'bg-zinc-50 dark:bg-zinc-800/50 border-dashed border-zinc-200 dark:border-zinc-700 text-zinc-400'
                )}
              >
                <span>{assumedState ?? 'unknown'}</span>
                <span className="text-[9px] opacity-60 ml-0.5">assumed ▾</span>
              </button>
              <AnimatePresence>
                {showStatePicker && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -4 }}
                    transition={{ duration: 0.1 }}
                    className="absolute bottom-full left-0 mb-1 z-50 bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-zinc-100 dark:border-zinc-800 overflow-hidden min-w-[100px]"
                  >
                    <p className="px-3 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-400">Set assumed state</p>
                    {stateOptions.map((s) => (
                      <button
                        key={s}
                        onClick={() => { onStateChange(device.id, s); setShowStatePicker(false) }}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors capitalize',
                          assumedState === s ? 'text-violet-600 dark:text-violet-400 font-semibold' : 'text-zinc-700 dark:text-zinc-300'
                        )}
                      >
                        {assumedState === s && <span className="text-violet-400 text-[10px]">✓</span>}
                        {s}
                      </button>
                    ))}
                    <div className="border-t border-zinc-100 dark:border-zinc-800 mt-1 pt-1 pb-1">
                      <button
                        onClick={() => { onStateChange(device.id, 'unknown'); setShowStatePicker(false) }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                      >
                        Clear assumption
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
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
      </div>
      <IRQuickControls device={device} onCommand={onCommand} />
    </Card>
  )
}

// Status-based filter chips — always visible regardless of device inventory.
const _STATUS_FILTERS = [
  { id: 'all',        label: 'All' },
  { id: 'unassigned', label: '📦 Unassigned' },
  { id: 'noroom',     label: '🏠 No Room' },
  { id: 'offline',    label: '🔴 Offline' },
  { id: 'active',     label: '🟢 Active' },
  { id: 'connected',  label: '🔗 Connected' },
  { id: 'ir',         label: '📡 IR Remotes' },
]

// Build domain-group chips from the live entity list — only include groups that have
// at least one entity present. Called inside the component so it reacts to store updates.
function buildGroupFilters(entities, irEntities) {
  const occupiedGroups = new Set()
  for (const e of entities) {
    const g = domainGroup(e)
    if (g && g !== 'other') occupiedGroups.add(g)
  }
  if (irEntities?.length) occupiedGroups.add('ir')
  return DOMAIN_GROUPS
    .filter((g) => g.id !== 'other' && occupiedGroups.has(g.id))
    .map((g) => ({ id: g.id, label: g.label, isGroup: true }))
}

// DOMAIN_GROUPS and domainGroup are now imported from domainRegistry.js.
// Adding a new HA domain there automatically updates grouping here.
// (DOMAIN_GROUPS and domainGroup imported at top of file)

// ── Collapsible group header ───────────────────────────────────────────────────
function CollapsibleGroup({ label, count, open, onToggle, children, action }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em' }}>{label}</span>
          {count != null && <span style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{count}</span>}
          <span style={{ marginLeft: 'auto', color: 'var(--ink-faint)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
          </span>
        </button>
        {action && <div style={{ flexShrink: 0 }}>{action}</div>}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} style={{ overflow: 'hidden' }}>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

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
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '6px 10px', borderRadius: 8, fontSize: 11.5, fontWeight: 500, cursor: 'pointer', background: `color-mix(in srgb, var(--info) 10%, var(--surface))`, color: 'var(--info)', border: `0.5px solid color-mix(in srgb, var(--info) 30%, var(--line))`, fontFamily: 'inherit' }}
      >
        <span>Assign to room</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.12s' }}><path d="M6 9l6 6 6-6"/></svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }} transition={{ duration: 0.12 }}
            style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 4, zIndex: 50, background: 'var(--surface)', borderRadius: 11, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', border: '0.5px solid var(--line)', overflow: 'hidden' }}
          >
            <div style={{ padding: '4px 0', maxHeight: 192, overflowY: 'auto' }}>
              <button onClick={() => { onAssign(entityId, null); setOpen(false) }}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'none', border: 'none', borderBottom: '0.5px solid var(--line)', cursor: 'pointer', textAlign: 'left', fontSize: 12, color: 'var(--ink-faint)', fontFamily: 'inherit' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <Home size={11} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
                No room
              </button>
              {rooms.map(r => (
                <button key={r.id} onClick={() => { onAssign(entityId, r.id); setOpen(false) }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 12, color: 'var(--ink-2)', fontFamily: 'inherit' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--info)', flexShrink: 0 }} />
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
function DeviceMenu({ entity, rooms, onHide, onUnhide, isHidden, onAssign, extraItems = [] }) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: undefined, right: 0 })
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  const currentRoom = rooms.find((r) => (r.entities || []).includes(entity.entity_id))

  const NAV_HEIGHT = 64

  const handleOpen = (e) => {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const menuW = 192  // w-48
      // Subtract navbar height so menu never hides behind it
      const spaceBelow = window.innerHeight - rect.bottom - NAV_HEIGHT
      const wouldClipLeft = rect.right - menuW < 0
      setMenuPos({
        top:    spaceBelow >= 260 ? rect.bottom + 4 : undefined,
        bottom: spaceBelow  < 260 ? window.innerHeight - rect.top + 4 : undefined,
        left:  wouldClipLeft ? rect.left : undefined,
        right: wouldClipLeft ? undefined : window.innerWidth - rect.right,
      })
    }
    setOpen((v) => !v)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const h = (e) => {
      if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) close()
    }
    document.addEventListener('mousedown', h)
    // Close on any scroll so the fixed menu doesn't drift from its trigger
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('scroll', close, true)
    }
  }, [open])

  return (
    <div>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
      >
        <MoreVertical size={14} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            style={{ position: 'fixed', top: menuPos.top, bottom: menuPos.bottom, left: menuPos.left, right: menuPos.right, zIndex: 9999 }}
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12 }}
            className="w-48 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden"
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
                  onClick={() => {
                    isHidden ? onUnhide(entity.entity_id) : onHide(entity.entity_id)
                    setOpen(false)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  {isHidden
                    ? <><Eye size={12} /> Show device</>
                    : <><EyeOff size={12} /> Hide device</>
                  }
                </button>
                {extraItems.map((item, i) => (
                  <button key={i} onClick={() => { item.onClick(); setOpen(false) }}
                    className={cn('w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors', item.className || 'text-zinc-700 dark:text-zinc-300')}
                  >
                    {item.icon} {item.label}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Link IR device to a Wi-Fi/HA entity ──────────────────────────────────────
// Maps IR device type → HA domain for the entity picker filter
const IR_TYPE_TO_DOMAIN_FE = {
  tv: 'media_player', soundbar: 'media_player', projector: 'media_player',
  ac: 'climate', fan: 'fan', custom: 'switch',
}

function LinkIrModal({ irDevice, open, onClose, onLink }) {
  const [entityId, setEntityId] = useState('')
  const domain = IR_TYPE_TO_DOMAIN_FE[irDevice?.type] || 'media_player'

  return (
    <Modal open={open} onClose={() => { setEntityId(''); onClose() }} title={`Link "${irDevice?.name}" to Wi-Fi device`}>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4 -mt-1 leading-relaxed">
        Select the Wi-Fi / Zigbee entity that controls the <strong>same physical device</strong>.
        Once linked, both control paths appear on one unified card. The IR remote is used for power-on
        and IR-specific commands; Wi-Fi handles live state and smart controls.
      </p>
      <EntitySelect
        domain={domain}
        value={entityId}
        onChange={setEntityId}
        placeholder={`Search ${domain.replace('_', ' ')} entities…`}
        label="Wi-Fi / smart entity"
      />
      <div className="flex gap-2 mt-4">
        <Button variant="secondary" onClick={() => { setEntityId(''); onClose() }} className="flex-1">Cancel</Button>
        <Button onClick={() => { onLink(entityId); setEntityId('') }} disabled={!entityId} className="flex-1">
          Link devices
        </Button>
      </div>
    </Modal>
  )
}

// ── Shared status constants ───────────────────────────────────────────────────
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

// Normalize a room display name to the slug IR manager uses (matches backend _norm_room_key)
function normRoomSlug(name) {
  return name.toLowerCase().replace(/[''`]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

// ── IR card context menu ──────────────────────────────────────────────────────
// Uses fixed positioning so it never gets clipped by card/grid overflow.
function IRCardMenu({ irDevice, rooms, onEdit, onDelete, onAssign, onLinkToWifi, onUnlinkFromWifi }) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  const NAV_HEIGHT_IR = 64

  const handleOpen = (e) => {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const menuW = 208 // w-52
      const spaceBelow = window.innerHeight - rect.bottom - NAV_HEIGHT_IR
      const wouldClipLeft = rect.right - menuW < 0
      setMenuPos({
        top:    spaceBelow >= 300 ? rect.bottom + 4 : undefined,
        bottom: spaceBelow  < 300 ? window.innerHeight - rect.top + 4 : undefined,
        left:  wouldClipLeft ? rect.left : undefined,
        right: wouldClipLeft ? undefined : window.innerWidth - rect.right,
      })
    }
    setOpen((v) => !v)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const h = (e) => {
      if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) close()
    }
    document.addEventListener('mousedown', h)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('scroll', close, true)
    }
  }, [open])

  const currentRoomSlug = irDevice?.room || ''
  const currentRoom = rooms.find((r) => normRoomSlug(r.name) === currentRoomSlug)

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
      >
        <MoreVertical size={14} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            style={{ position: 'fixed', top: menuPos.top, bottom: menuPos.bottom, left: menuPos.left, right: menuPos.right, zIndex: 9999 }}
            initial={{ opacity: 0, scale: 0.95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }} transition={{ duration: 0.12 }}
            className="w-52 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden"
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
              <p className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Assign to room</p>
              <button onClick={() => { onAssign(null); setOpen(false) }}
                className={cn('w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800', !currentRoom ? 'text-violet-600 font-medium' : 'text-zinc-500')}
              >
                <Home size={12} /> No room
              </button>
              {rooms.map((r) => (
                <button key={r.id} onClick={() => { onAssign(r.id); setOpen(false) }}
                  className={cn('w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800', currentRoom?.id === r.id ? 'text-violet-600 font-semibold' : 'text-zinc-700 dark:text-zinc-300')}
                >
                  <span className={cn('w-2 h-2 rounded-full shrink-0', currentRoom?.id === r.id ? 'bg-violet-500' : 'bg-zinc-300 dark:bg-zinc-600')} />
                  {r.name}
                  {currentRoom?.id === r.id && <span className="ml-auto text-[10px] text-violet-400">✓</span>}
                </button>
              ))}
              <div className="border-t border-zinc-100 dark:border-zinc-800 mt-1 pt-1">
                <button onClick={() => { onEdit(); setOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  <Pencil size={12} /> Edit IR device
                </button>
                {irDevice?.ha_entity_id ? (
                  <button onClick={() => { onUnlinkFromWifi?.(); setOpen(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-violet-600 dark:text-violet-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    ⬡ Unlink from Wi-Fi device
                  </button>
                ) : (
                  <button onClick={() => { onLinkToWifi?.(); setOpen(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-violet-600 dark:text-violet-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    ⬡ Link to Wi-Fi device
                  </button>
                )}
                <button onClick={() => { onDelete(); setOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  <Trash2 size={12} /> Remove
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
const IR_STATE_OPTIONS_MAP = {
  ac:      ['cool', 'heat', 'fan_only', 'off'],
  default: ['on', 'off'],
}

const DeviceCard = forwardRef(function DeviceCard({
  entity, rooms, onToggle, onService, onHide, onUnhide, onAssign,
  onIrCommand, onIrChannel, onIrStateChange, onEditIr, onDeleteIr,
  onLinkIr, onUnlinkIr,
  isHidden, showAssign, ziggyStatus,
}, ref) {
  const navigate = useNavigate()
  const isIr = entity._ir === true
  const irDevice = entity._irDevice
  const linkedIr = entity._linkedIr || null  // IR device linked to this HA entity

  const isOn = isEntityOn(entity)
  const isOff = entity.state === 'off' || entity.state === 'unavailable' || entity.state === 'unknown'
  const isToggleable = !isIr && TOGGLEABLE_DOMAINS.has(entity.domain) && entity.state !== 'unavailable'
  const { primary: stateLabel, secondary: stateSecondary } = (!isIr && !isHidden)
    ? formatEntityState(entity)
    : { primary: isHidden ? 'Hidden' : '', secondary: null }
  const isActive = !isOff
  const showStatusBadge = !isIr && !linkedIr && ziggyStatus && ziggyStatus !== 'connected' && STATUS_LABEL[ziggyStatus]

  // IR assumed-state picker (standalone IR cards only)
  const [showStatePicker, setShowStatePicker] = useState(false)
  const irStateOptions = IR_STATE_OPTIONS_MAP[irDevice?.type] || IR_STATE_OPTIONS_MAP.default
  const assumedState = irDevice?.assumed_state && irDevice.assumed_state !== 'unknown' ? irDevice.assumed_state : null
  // State confidence: confirmed (has HA entity link), estimated (we sent a command), unknown (no info)
  const irConfidence = irDevice?.ha_entity_id ? 'confirmed'
    : (assumedState != null) ? 'estimated'
    : 'unknown'

  return (
    <motion.div
      ref={ref} layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: isHidden ? 0.45 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.15 }}
    >
      <Card className={cn('p-4 transition-all duration-200', isActive && !isHidden && 'shadow-card-hover')}>
        {/* ── Card header ── */}
        <div className="flex items-start justify-between mb-3">
          <div className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center text-xl relative',
            isActive ? 'bg-zinc-900 dark:bg-white' : 'bg-zinc-100 dark:bg-zinc-800',
          )}>
            {domainIcon(entity.domain, entity.device_class)}
            {isIr && (
              <span className="absolute -bottom-1 -right-1 bg-violet-500 text-white text-[7px] font-bold px-1 py-px rounded-sm leading-none tracking-tight">IR</span>
            )}
            {linkedIr && (
              <span className="absolute -bottom-1 -right-1 bg-violet-500 text-white text-[7px] font-bold px-1 py-px rounded-sm leading-none tracking-tight">IR</span>
            )}
            {!isIr && !linkedIr && ziggyStatus && STATUS_DOT[ziggyStatus] && (
              <span className={cn('absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-zinc-900', STATUS_DOT[ziggyStatus])} />
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Navigate to full device detail page */}
            {!isIr && (
              <button
                onClick={() => navigate(`/devices/${encodeURIComponent(entity.entity_id)}`)}
                className="p-1 rounded-lg text-zinc-300 dark:text-zinc-700 hover:text-zinc-500 dark:hover:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                title="Device details"
              >
                <ChevronRight size={14} />
              </button>
            )}
            {isToggleable && (
              <Toggle checked={isOn} onCheckedChange={(v) => onToggle(entity.entity_id, v)} />
            )}
            {isIr ? (
              <IRCardMenu
                irDevice={irDevice}
                rooms={rooms}
                onEdit={() => onEditIr(irDevice)}
                onDelete={() => onDeleteIr(irDevice.id)}
                onAssign={(roomId) => onAssign(entity.entity_id, roomId)}
                onLinkToWifi={() => onLinkIr(irDevice)}
                onUnlinkFromWifi={() => onUnlinkIr(irDevice.id)}
              />
            ) : linkedIr ? (
              // Merged HA+IR card — HA menu with IR extras
              <DeviceMenu
                entity={entity}
                rooms={rooms}
                onHide={onHide}
                onUnhide={onUnhide}
                isHidden={isHidden}
                onAssign={onAssign}
                extraItems={[
                  { label: 'Edit IR remote', icon: <Pencil size={12} />, onClick: () => onEditIr(linkedIr) },
                  { label: 'Unlink IR', icon: <span className="text-[11px]">⬡</span>, onClick: () => onUnlinkIr(linkedIr.id), className: 'text-violet-600 dark:text-violet-400' },
                ]}
              />
            ) : (
              <DeviceMenu entity={entity} rooms={rooms} onHide={onHide} onUnhide={onUnhide} isHidden={isHidden} onAssign={onAssign} />
            )}
          </div>
        </div>

        {/* ── Name ── */}
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 leading-tight mb-0.5 truncate">
          {entity.display_name || entity.friendly_name || entity.entity_id.split('.')[1]}
        </p>

        {/* ── State ── */}
        {isIr ? (
          // Standalone IR: assumed state chip with picker
          <div className="relative">
            <button
              onClick={() => setShowStatePicker((v) => !v)}
              title="IR state is estimated — tap to correct manually"
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors',
                assumedState === 'on' || (assumedState && assumedState !== 'off')
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                  : assumedState === 'off'
                  ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500'
                  : 'bg-zinc-50 dark:bg-zinc-800/50 border-dashed border-zinc-200 dark:border-zinc-700 text-zinc-400',
              )}
            >
              <span>{assumedState ?? 'unknown'}</span>
              <span className="text-[9px] opacity-60 ml-0.5">{irConfidence} ▾</span>
            </button>
            <AnimatePresence>
              {showStatePicker && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }} transition={{ duration: 0.1 }}
                  className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-zinc-100 dark:border-zinc-800 overflow-hidden min-w-[110px]"
                >
                  <p className="px-3 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-400">Set assumed state</p>
                  {irStateOptions.map((s) => (
                    <button key={s} onClick={() => { onIrStateChange(irDevice.id, s); setShowStatePicker(false) }}
                      className={cn('w-full text-left px-3 py-2 text-xs capitalize hover:bg-zinc-50 dark:hover:bg-zinc-800', assumedState === s ? 'text-violet-600 font-semibold' : 'text-zinc-700 dark:text-zinc-300')}
                    >
                      {assumedState === s && <span className="text-violet-400 mr-1 text-[10px]">✓</span>}{s}
                    </button>
                  ))}
                  <div className="border-t border-zinc-100 dark:border-zinc-800 mt-1">
                    <button onClick={() => { onIrStateChange(irDevice.id, 'unknown'); setShowStatePicker(false) }}
                      className="w-full text-left px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    >Clear assumption</button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : showStatusBadge ? (
          <p className="text-xs font-medium text-red-400">{STATUS_LABEL[ziggyStatus]}</p>
        ) : (
          <p className={cn(
            'text-xs font-medium',
            isHidden ? 'text-zinc-300 dark:text-zinc-700' :
            entity.state === 'unavailable' ? 'text-zinc-300 dark:text-zinc-600' :
            isActive ? 'text-emerald-500' : 'text-zinc-400 dark:text-zinc-600',
          )}>
            {stateLabel}
          </p>
        )}
        {!isIr && stateSecondary && !isHidden && (
          <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-0.5">{stateSecondary}</p>
        )}
        {isIr && irDevice?.last_command_sent_at && (
          <p className="text-[10px] text-zinc-400 dark:text-zinc-600 mt-0.5 truncate">
            Last: {irDevice.last_command_sent?.replace(/_/g, ' ')} · {_fmtAgo(irDevice.last_command_sent_at)}
          </p>
        )}

        {/* ── Controls ── */}
        {!isHidden && (
          isIr ? (
            // Standalone IR card: full remote drawer trigger
            <IRRemoteButton irDevice={irDevice} onCommand={onIrCommand} onChannel={onIrChannel} />
          ) : linkedIr ? (
            // Merged card: HA controls + IR Power-On + IR Remote drawer trigger
            <>
              {/* Power On via IR — shown prominently when device is off/unavailable */}
              {isOff && linkedIr.learned_commands?.includes('power') && linkedIr.commands?.power && (
                <button
                  onClick={() => onIrCommand(linkedIr.id, 'power')}
                  className="w-full mt-2 flex items-center justify-center gap-2 py-2 rounded-xl bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 text-xs font-semibold hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors border border-violet-200 dark:border-violet-800/50"
                >
                  ⏻ Turn On via IR
                </button>
              )}
              {/* Standard HA controls (play/pause, volume, sources, climate modes, etc.) */}
              <DeviceControls entity={entity} onService={(service, data) => onService(entity, service, data)} />
              {/* IR Remote drawer trigger */}
              <IRRemoteButton irDevice={linkedIr} onCommand={onIrCommand} onChannel={onIrChannel} />
            </>
          ) : (
            // Regular HA entity
            <DeviceControls entity={entity} onService={(service, data) => onService(entity, service, data)} />
          )
        )}

        {showAssign && !isIr && (
          <AssignRoomDropdown entityId={entity.entity_id} rooms={rooms} onAssign={onAssign} />
        )}
      </Card>
    </motion.div>
  )
})

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Devices() {
  const { entities, rooms, deviceStatusMap, loading, fetchAll, hiddenEntities, showHidden, hideEntity, unhideEntity, toggleShowHidden, getUnassigned, getNoRoom, ziggyRooms, unclaimedDevices, updateIrAssumedState, getActiveCount, getTotalControllable } = useDeviceStore()
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

  // HA-area room list with entity assignments (needed by DeviceMenu to detect current room)
  const allRooms = rooms.map((r) => ({ id: r.id, name: r.name, entities: r.entities || [] }))

  // Full room picker list: use ziggyRooms (all rooms) enriched with HA entity lists
  // This ensures every room the user created is shown, not only HA areas
  const haAreaMap = Object.fromEntries(rooms.map((r) => [r.id, r]))
  const roomsForPicker = ziggyRooms.map((zr) => ({
    id:       zr.id,
    name:     zr.name,
    entities: haAreaMap[zr.id]?.entities || [],
  }))
  const unassigned = getUnassigned()
  const noRoomEntities = getNoRoom()

  // Dynamic filter chips — only groups that have at least one entity present.
  const irEntities = entities.filter(e => e._ir)
  const groupFilters = buildGroupFilters(entities, irEntities)
  const DOMAIN_FILTER = [..._STATUS_FILTERS, ...groupFilters]

  // If the current filter is a group that no longer has any devices, reset to 'all'.
  useEffect(() => {
    if (domain !== 'all' && !DOMAIN_FILTER.some(f => f.id === domain)) {
      setDomain('all')
    }
  }, [entities.length])

  const filtered = (() => {
    if (domain === 'unassigned') return unassigned
    if (domain === 'noroom') return noRoomEntities
    return entities.filter((e) => {
      const isHidden = hiddenEntities.has(e.entity_id)
      if (isHidden && !showHidden) return false
      let matchDomain = true
      if (domain === 'active') matchDomain = isEntityOn(e)
      else if (domain === 'offline') matchDomain = e.state === 'unavailable' || e.state === 'unknown'
      else if (domain === 'connected') matchDomain = e.state !== 'unavailable' && e.state !== 'unknown'
      else if (domain === 'ir') matchDomain = e._ir === true || Boolean(e._linkedIr)
      else if (domain !== 'all') {
        // Check if it's a group ID (e.g. 'security', 'climate') or a direct domain name
        const isGroupFilter = groupFilters.some((f) => f.id === domain)
        matchDomain = isGroupFilter ? domainGroup(e) === domain : e.domain === domain
      }
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
      await controlDevice(entityId, on ? 'turn_on' : 'turn_off')
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

  const handleAssign = async (entityId, roomId) => {
    try {
      if (entityId?.startsWith('ir.')) {
        // IR device — assign by normalized room name slug, not HA area ID.
        // Send '' (empty string) to unassign; backend treats '' as "no room".
        const irId = entityId.replace('ir.', '')
        const room = roomsForPicker.find((r) => r.id === roomId)
        const roomSlug = roomId === null
          ? ''
          : room ? normRoomSlug(room.name) : roomId
        await patchIrDevice(irId, { room: roomSlug })
      } else {
        await assignEntityToArea(entityId, roomId)
      }
      await fetchAll()
      addToast(roomId ? 'Assigned to room' : 'Removed from room', 'success')
    } catch (e) { addToast(e.message || 'Failed', 'error') }
  }

  const [showPairing, setShowPairing]         = useState(false)
  const [showIRWizard, setShowIRWizard]       = useState(false)
  const [editingIrDevice, setEditingIrDevice] = useState(null)
  const [linkingIrDevice, setLinkingIrDevice] = useState(null) // IR device being linked to HA entity
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())

  const handleLinkIr = async (haEntityId) => {
    if (!linkingIrDevice || !haEntityId) return
    try {
      await patchIrDevice(linkingIrDevice.id, { ha_entity_id: haEntityId })
      await fetchAll()
      addToast('Devices linked — controls merged', 'success')
    } catch { addToast('Failed to link', 'error') }
    setLinkingIrDevice(null)
  }

  const handleUnlinkIr = async (irId) => {
    try {
      await patchIrDevice(irId, { ha_entity_id: '' })
      await fetchAll()
      addToast('IR device unlinked', 'success')
    } catch { addToast('Failed to unlink', 'error') }
  }
  const toggleGroup = (id) => setCollapsedGroups((prev) => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const handleDeleteIr = async (irId) => {
    try {
      await deleteIrDevice(irId)
      await fetchAll()
      addToast('IR device removed', 'success')
    } catch { addToast('Failed to remove', 'error') }
  }

  const handleIrStateChange = async (id, newState) => {
    try {
      await patchIrDevice(id, { assumed_state: newState === 'unknown' ? null : newState })
      updateIrAssumedState(id, newState === 'unknown' ? 'unknown' : newState)
      addToast(`State set to "${newState}"`, 'success')
    } catch { addToast('Failed to update state', 'error') }
  }

  const handleIrCommand = async (deviceId, cmd) => {
    try {
      await irSend(deviceId, cmd)
      addToast('Command sent', 'success')
    } catch { addToast('IR command failed', 'error') }
  }

  const handleIrChannel = async (deviceId, channel) => {
    try {
      await irSendChannel(deviceId, channel)
      addToast(`Channel ${channel}`, 'success')
    } catch { addToast('Channel change failed', 'error') }
  }

  const activeCount = getActiveCount()
  const hiddenCount = hiddenEntities.size

  // Devices in DeviceRegistry with status needing attention (lost/unconfigured) — not visible in HA entity list
  const allZiggyDevices = [
    ...ziggyRooms.flatMap((r) => (r.devices || []).map((d) => ({ ...d, roomName: r.name }))),
    ...(unclaimedDevices || []).map((d) => ({ ...d, roomName: null })),
  ]
  const NON_DEVICE_DOMAINS = new Set(['automation', 'script', 'scene', 'timer', 'counter', 'input_select', 'input_number', 'input_text', 'input_datetime', 'input_button', 'group', 'zone'])
  const attentionDevices = allZiggyDevices.filter((d) => {
    if (d.status !== 'lost' && d.status !== 'unconfigured') return false
    const domain = (d.entity_id || '').split('.')[0] || d.device_type || ''
    return !NON_DEVICE_DOMAINS.has(domain)
  })

  // ── By-room grouping (primary view) ──────────────────────────────────────────
  const [viewMode, setViewMode] = useState('room') // 'room' | 'type'

  const deviceCardProps = (entity, assign = false) => ({
    entity,
    rooms: roomsForPicker,
    onToggle: handleToggle,
    onService: handleService,
    onHide: hideEntity,
    onUnhide: unhideEntity,
    onAssign: handleAssign,
    onIrCommand: handleIrCommand,
    onIrChannel: handleIrChannel,
    onIrStateChange: handleIrStateChange,
    onEditIr: setEditingIrDevice,
    onDeleteIr: handleDeleteIr,
    onLinkIr: setLinkingIrDevice,
    onUnlinkIr: handleUnlinkIr,
    isHidden: hiddenEntities.has(entity.entity_id),
    showAssign: assign,
    ziggyStatus: deviceStatusMap[entity.entity_id],
  })

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 20px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>Home Assistant entities</p>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}>Devices</h1>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4, fontFamily: '"IBM Plex Mono", monospace' }}>
            {activeCount} of {getTotalControllable()} active · {entities.length} total
            {hiddenCount > 0 && ` · ${hiddenCount} hidden`}
            {unassigned.length > 0 && <span style={{ color: 'var(--warn)', marginLeft: 4 }}>· {unassigned.length} unassigned</span>}
            {noRoomEntities.length > 0 && <span style={{ color: 'var(--ink-faint)', marginLeft: 4 }}>· {noRoomEntities.length} no room</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {hiddenCount > 0 && (
            <button onClick={toggleShowHidden} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '7px 11px', borderRadius: 999, fontSize: 12, fontWeight: 500,
              background: showHidden ? 'var(--ink)' : 'var(--surface)',
              color: showHidden ? 'var(--bg)' : 'var(--ink-mute)',
              border: showHidden ? 'none' : '0.5px solid var(--line)', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              {showHidden ? <Eye size={12} /> : <EyeOff size={12} />}
              {showHidden ? 'Showing hidden' : 'Show hidden'}
            </button>
          )}
          <button onClick={() => setShowPairing(true)} className="z-btn-primary" style={{ padding: '8px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <Plus size={13} /> Pair device
          </button>
        </div>
      </div>

      {/* Unassigned banner */}
      {unassigned.length > 0 && domain !== 'unassigned' && domain !== 'noroom' && (
        <motion.button initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          onClick={() => setDomain('unassigned')}
          style={{
            width: '100%', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', borderRadius: 11, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
            background: `color-mix(in srgb, var(--warn) 8%, var(--surface))`, border: '0.5px solid color-mix(in srgb, var(--warn) 30%, var(--line))',
          }}
        >
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{unassigned.length} device{unassigned.length !== 1 ? 's' : ''} not assigned to any room</p>
            <p style={{ fontSize: 11, color: 'var(--warn)', marginTop: 2 }}>Tap to review and assign them</p>
          </div>
          <span style={{ fontSize: 12, color: 'var(--warn)', fontWeight: 500 }}>Review ›</span>
        </motion.button>
      )}

      {/* Attention banner */}
      {attentionDevices.length > 0 && domain !== 'attention' && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          style={{ marginBottom: 14, borderRadius: 11, background: `color-mix(in srgb, var(--accent) 8%, var(--surface))`, border: '0.5px solid color-mix(in srgb, var(--accent) 30%, var(--line))', overflow: 'hidden' }}
        >
          <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--line)' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{attentionDevices.length} device{attentionDevices.length !== 1 ? 's' : ''} need attention</p>
            <p style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>Lost from hub or missing HA entity configuration</p>
          </div>
          <div>
            {attentionDevices.map((d, i) => (
              <div key={d.entity_id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '0.5px solid var(--line)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: d.status === 'lost' ? 'var(--accent)' : 'var(--line-2)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.display_name || d.entity_id || d.device_type}</p>
                  <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{d.roomName ? `${d.roomName} · ` : ''}{STATUS_LABEL[d.status] || d.status}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Search */}
      {domain !== 'unassigned' && (
        <div style={{ position: 'relative', marginBottom: 14 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-faint)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search devices…" className="z-input" style={{ paddingLeft: 34 }} />
        </div>
      )}

      {/* View mode + filter chips */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, marginBottom: 20 }} className="scrollbar-thin">
        {/* View mode toggle */}
        {[{ id: 'room', label: 'By room' }, { id: 'type', label: 'By type' }].map(v => (
          <button key={v.id} onClick={() => setViewMode(v.id)} style={{
            padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', cursor: 'pointer', fontFamily: 'inherit',
            background: viewMode === v.id ? 'var(--ink)' : 'var(--surface)',
            color: viewMode === v.id ? 'var(--bg)' : 'var(--ink-mute)',
            border: viewMode === v.id ? 'none' : '0.5px solid var(--line)',
          }}>{v.label}</button>
        ))}
        <div style={{ width: 1, background: 'var(--line)', flexShrink: 0, margin: '0 2px' }} />
        {DOMAIN_FILTER.map(f => (
          <button key={f.id} onClick={() => { setDomain(f.id); if (f.id !== 'all') setViewMode('type') }} style={{
            padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', cursor: 'pointer', fontFamily: 'inherit',
            background: domain === f.id && viewMode === 'type'
              ? (f.id === 'unassigned' ? 'var(--warn)' : 'var(--ink)')
              : f.id === 'unassigned' && unassigned.length > 0
              ? `color-mix(in srgb, var(--warn) 8%, var(--surface))`
              : 'var(--surface)',
            color: domain === f.id && viewMode === 'type'
              ? (f.id === 'unassigned' ? '#fff' : 'var(--bg)')
              : f.id === 'unassigned' && unassigned.length > 0 ? 'var(--warn)' : 'var(--ink-mute)',
            border: (domain === f.id && viewMode === 'type') ? 'none' : f.id === 'unassigned' && unassigned.length > 0 ? `0.5px solid color-mix(in srgb, var(--warn) 40%, var(--line))` : '0.5px solid var(--line)',
          }}>
            {f.label}
            {f.id === 'unassigned' && unassigned.length > 0 && (
              <span style={{ marginLeft: 4, background: 'var(--warn)', color: '#fff', fontSize: 9, padding: '1px 5px', borderRadius: 999, fontWeight: 700 }}>{unassigned.length}</span>
            )}
            {f.id === 'noroom' && noRoomEntities.length > 0 && (
              <span style={{ marginLeft: 4, background: 'var(--ink-faint)', color: 'var(--bg)', fontSize: 9, padding: '1px 5px', borderRadius: 999, fontWeight: 700 }}>{noRoomEntities.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Unassigned section info */}
      {domain === 'unassigned' && (
        <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 11, background: `color-mix(in srgb, var(--warn) 8%, var(--surface))`, border: `0.5px solid color-mix(in srgb, var(--warn) 30%, var(--line))` }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>Devices not assigned to any room</p>
          <p style={{ fontSize: 11, color: 'var(--warn)' }}>Use "Assign to room" on each card to organize them.</p>
        </div>
      )}
      {domain === 'noroom' && (
        <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 11, background: 'var(--surface)', border: '0.5px solid var(--line)' }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>Devices with no room</p>
          <p style={{ fontSize: 11, color: 'var(--ink-mute)' }}>These devices are intentionally left without a room. Use the ··· menu to assign one.</p>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[1,2,3,4,5,6].map(i => <div key={i} style={{ height: 60, borderRadius: 11, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--ink-faint)' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>
            {domain === 'unassigned' ? 'All devices are assigned to rooms' : domain === 'noroom' ? 'No devices without a room' : 'No devices found'}
          </p>
        </div>
      )}

      {/* ── By-room view (default) ── */}
      {!loading && viewMode === 'room' && domain === 'all' && filtered.length > 0 && (() => {
        const entitySet = new Set(filtered.map(e => e.entity_id))
        // Resolve a room device entry to its enriched entity object.
        // HA entities have `d.entity_id`; standalone IR devices in rooms only
        // have `d.ir_device_id` (entity_id is null) — we map these to `ir.<id>`.
        const resolveDevice = (d) => {
          if (d.entity_id) return entities.find(e => e.entity_id === d.entity_id)
          if (d.ir_device_id) return entities.find(e => e.entity_id === `ir.${d.ir_device_id}`)
          return null
        }
        const roomGroups = ziggyRooms.map(room => ({
          room,
          items: (room.devices || [])
            .map(resolveDevice)
            .filter(e => e && entitySet.has(e.entity_id)),
        })).filter(g => g.items.length > 0)
        // Use the same unassigned set as the filter chip so counts are consistent.
        // unassigned = getUnassigned() = non-IR entities in DEVICE_DOMAINS not in any HA area.
        const unroomedItems = unassigned.filter(e => entitySet.has(e.entity_id))

        const noRoomItems = noRoomEntities.filter(e => entitySet.has(e.entity_id))

        return (
          <>
            {roomGroups.map(({ room, items }) => (
              <CollapsibleGroup key={room.id} label={room.name} count={items.length} open={!collapsedGroups.has(room.id)} onToggle={() => toggleGroup(room.id)}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginBottom: 4 }}>
                  <AnimatePresence mode="popLayout">
                    {items.map(entity => <DeviceCard key={entity.entity_id} {...deviceCardProps(entity)} />)}
                  </AnimatePresence>
                </div>
              </CollapsibleGroup>
            ))}
            {noRoomItems.length > 0 && (
              <CollapsibleGroup label="No Room" count={noRoomItems.length} open={!collapsedGroups.has('__noroom__')} onToggle={() => toggleGroup('__noroom__')}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginBottom: 4 }}>
                  <AnimatePresence mode="popLayout">
                    {noRoomItems.map(entity => <DeviceCard key={entity.entity_id} {...deviceCardProps(entity)} />)}
                  </AnimatePresence>
                </div>
              </CollapsibleGroup>
            )}
            {unroomedItems.length > 0 && (
              <CollapsibleGroup label="Unassigned" count={unroomedItems.length} open={!collapsedGroups.has('__unassigned__')} onToggle={() => toggleGroup('__unassigned__')}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginBottom: 4 }}>
                  <AnimatePresence mode="popLayout">
                    {unroomedItems.map(entity => <DeviceCard key={entity.entity_id} {...deviceCardProps(entity, true)} />)}
                  </AnimatePresence>
                </div>
              </CollapsibleGroup>
            )}
          </>
        )
      })()}

      {/* ── By-type view ── */}
      {!loading && (viewMode === 'type' || domain !== 'all') && domain !== 'unassigned' && domain !== 'noroom' && filtered.length > 0 && (() => {
        const groups = DOMAIN_GROUPS.map(g => ({
          ...g, items: filtered.filter(e => domainGroup(e) === g.id),
        })).filter(g => g.items.length > 0)
        return groups.map(g => (
          <CollapsibleGroup key={g.id} label={g.label} count={g.items.length} open={!collapsedGroups.has(g.id)} onToggle={() => toggleGroup(g.id)}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginBottom: 4 }}>
              <AnimatePresence mode="popLayout">
                {g.items.map(entity => <DeviceCard key={entity.entity_id} {...deviceCardProps(entity)} />)}
              </AnimatePresence>
            </div>
          </CollapsibleGroup>
        ))
      })()}

      {/* Unassigned flat view */}
      {!loading && domain === 'unassigned' && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          <AnimatePresence mode="popLayout">
            {filtered.map(entity => <DeviceCard key={entity.entity_id} {...deviceCardProps(entity, true)} />)}
          </AnimatePresence>
        </div>
      )}

      {/* No Room flat view */}
      {!loading && domain === 'noroom' && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          <AnimatePresence mode="popLayout">
            {filtered.map(entity => <DeviceCard key={entity.entity_id} {...deviceCardProps(entity)} />)}
          </AnimatePresence>
        </div>
      )}

      <PairingWizard
        open={showPairing}
        onClose={() => setShowPairing(false)}
        onAddIrDevice={() => setShowIRWizard(true)}
      />

      {showIRWizard && (
        <IRWizard
          onClose={() => setShowIRWizard(false)}
          onCreated={() => { fetchAll(); setShowIRWizard(false) }}
        />
      )}

      {editingIrDevice && (
        <IREditModal
          device={editingIrDevice}
          onClose={() => setEditingIrDevice(null)}
          onSaved={() => { fetchAll(); setEditingIrDevice(null) }}
        />
      )}

      <LinkIrModal
        irDevice={linkingIrDevice}
        open={!!linkingIrDevice}
        onClose={() => setLinkingIrDevice(null)}
        onLink={handleLinkIr}
      />
    </div>
  )
}
