import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ChevronRight, AlertTriangle, Users, Zap, Lightbulb } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Badge } from '../components/ui/Badge'
import { useDeviceStore } from '../stores/deviceStore'
import { useTaskStore } from '../stores/taskStore'
import { useAutomationStore } from '../stores/automationStore'
import { useUIStore } from '../stores/uiStore'
import { greetingByTime, domainIcon, formatEntityState } from '../lib/utils'
import { controlDevice } from '../lib/api'
import { useSuggestionStore } from '../stores/suggestionStore'
import { cn } from '../lib/utils'
import { CONTROLLABLE_DOMAINS } from '../stores/deviceStore'
import { useQuickAskStore } from '../stores/quickAskStore'
import { getRoomPhoto } from '../lib/roomPhotos'

const stagger = { animate: { transition: { staggerChildren: 0.05 } } }
const fadeUp = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.2 } } }

// ── "Right now" summary card ───────────────────────────────────────────────────
function HomeStatusCard({ entities, presenceSummary }) {
  const lights  = entities.filter((e) => e.domain === 'light' && e.state === 'on')
  const playing = entities.filter((e) => e.domain === 'media_player' && e.state === 'playing')
  const climate = entities.filter((e) => e.domain === 'climate' && e.state !== 'off' && e.state !== 'unavailable')
  const fans    = entities.filter((e) => e.domain === 'fan' && e.state === 'on')

  const items = []
  if (presenceSummary.length) presenceSummary.slice(0, 2).forEach((t) => items.push({ icon: '👤', text: t }))
  if (lights.length)  items.push({ icon: '💡', text: `${lights.length} light${lights.length !== 1 ? 's' : ''} on` })
  if (playing.length) items.push({ icon: '🎵', text: playing.map((e) => e.friendly_name || e.entity_id.split('.')[1]).join(', ') + ' playing' })
  if (climate.length) {
    const c = climate[0]
    const temp = c.temperature != null ? ` · ${c.temperature}°` : ''
    items.push({ icon: '❄️', text: (c.friendly_name || 'Climate') + temp })
  }
  if (fans.length) items.push({ icon: '🌀', text: `${fans.length} fan${fans.length !== 1 ? 's' : ''} on` })

  if (items.length === 0) return null

  return (
    <motion.div variants={fadeUp} className="mb-4">
      <Card className="px-4 py-3 bg-gradient-to-br from-violet-50 to-zinc-50 dark:from-violet-900/10 dark:to-zinc-900 border-violet-100 dark:border-violet-900/30">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-500 dark:text-violet-400 mb-2">Right now</p>
        <div className="flex flex-col gap-1">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-sm w-5">{item.icon}</span>
              <span className="text-sm text-zinc-700 dark:text-zinc-300">{item.text}</span>
            </div>
          ))}
        </div>
      </Card>
    </motion.div>
  )
}

// ── Environment sensor pills ───────────────────────────────────────────────────
function SensorPill({ entity }) {
  const { primary } = formatEntityState(entity)
  const dc = entity.device_class
  const icon = dc === 'temperature' ? '🌡️' : dc === 'humidity' ? '💧' : dc === 'illuminance' ? '☀️' : '📊'
  const name = (entity.friendly_name || entity.entity_id.split('.')[1] || '').replace(/_/g, ' ')
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 text-xs">
      <span>{icon}</span>
      <span className="text-zinc-500 dark:text-zinc-400 truncate flex-1">{name}</span>
      <span className="font-semibold text-zinc-900 dark:text-zinc-100 shrink-0">{primary}</span>
    </div>
  )
}

// ── Active device toggle chip ──────────────────────────────────────────────────
function ActiveDeviceChip({ entity, onToggle }) {
  const isOn = entity.state === 'on'
  const name = (entity.friendly_name || entity.entity_id.split('.')[1] || '').replace(/_/g, ' ')
  return (
    <div className={cn(
      'flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors shrink-0',
      isOn ? 'bg-zinc-900 dark:bg-white border-zinc-900 dark:border-white' : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700'
    )}>
      <span className="text-sm">{domainIcon(entity.domain)}</span>
      <span className={cn('text-xs font-medium truncate max-w-[96px]', isOn ? 'text-white dark:text-zinc-900' : 'text-zinc-600 dark:text-zinc-400')}>
        {name}
      </span>
      <Toggle checked={isOn} onCheckedChange={(v) => onToggle(entity, v)} className="shrink-0 scale-75" />
    </div>
  )
}

// ── Room list row ──────────────────────────────────────────────────────────────
function RoomRow({ room }) {
  const navigate = useNavigate()
  const photo = getRoomPhoto(room)
  return (
    <motion.div variants={fadeUp}>
      <button
        onClick={() => navigate(`/rooms/${room.id}`)}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors text-left"
      >
        <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0">
          <img src={photo} alt={room.name} className="w-full h-full object-cover" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{room.name}</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-0.5">
            {room.entityCount} device{room.entityCount !== 1 ? 's' : ''}
            {room.activeCount > 0 && <span className="text-emerald-500 ml-1">· {room.activeCount} on</span>}
          </p>
        </div>
        {room.activeCount > 0 && (
          <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)] shrink-0" />
        )}
        <ChevronRight size={14} className="text-zinc-300 dark:text-zinc-700 shrink-0" />
      </button>
    </motion.div>
  )
}

// ── Alert strip ────────────────────────────────────────────────────────────────
function AlertStrip({ tasks, pendingCount }) {
  const navigate = useNavigate()
  const alerts = []

  if (pendingCount > 0) {
    alerts.push({
      id: 'suggestions',
      icon: <Lightbulb size={14} className="text-violet-500" />,
      text: `${pendingCount} automation suggestion${pendingCount !== 1 ? 's' : ''} ready`,
      to: '/suggestions',
      color: 'border-violet-200 dark:border-violet-800/50 bg-violet-50/50 dark:bg-violet-900/10',
    })
  }

  const overdueTasks = tasks.filter((t) => {
    if (t.done || t.completed) return false
    if (!t.due_date) return false
    return new Date(t.due_date) < new Date()
  })
  if (overdueTasks.length > 0) {
    alerts.push({
      id: 'overdue',
      icon: <AlertTriangle size={14} className="text-amber-500" />,
      text: `${overdueTasks.length} overdue task${overdueTasks.length !== 1 ? 's' : ''}`,
      to: '/tasks',
      color: 'border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-900/10',
    })
  }

  if (alerts.length === 0) return null

  return (
    <motion.div variants={fadeUp} className="flex flex-col gap-2 mb-4">
      {alerts.map((a) => (
        <button
          key={a.id}
          onClick={() => navigate(a.to)}
          className={cn('w-full flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-left transition-opacity hover:opacity-80', a.color)}
        >
          {a.icon}
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex-1">{a.text}</span>
          <ChevronRight size={12} className="text-zinc-400 shrink-0" />
        </button>
      ))}
    </motion.div>
  )
}

// ── Dashboard ──────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate()
  const { entities, ziggyRooms, fetchAll, updateEntityState, getActiveCount, getTotalControllable, getPresenceSummary } = useDeviceStore()
  const { tasks, fetch: fetchTasks } = useTaskStore()
  const { fetchAutomations, fetchRoutines } = useAutomationStore()
  const { addToast } = useUIStore()
  const { fetch: fetchSuggestions, pendingCount } = useSuggestionStore()
  const { items: quickAsks, fetch: fetchQuickAsks } = useQuickAskStore()

  useEffect(() => {
    fetchAll(); fetchTasks(); fetchAutomations(); fetchRoutines(); fetchSuggestions(); fetchQuickAsks()
  }, [])

  const presenceSummary = getPresenceSummary()
  const activeDeviceChips = entities
    .filter((e) => CONTROLLABLE_DOMAINS.has(e.domain) && e.state === 'on')
    .slice(0, 8)

  const sensorHighlights = entities
    .filter((e) => e.domain === 'sensor' && ['temperature', 'humidity'].includes(e.device_class) && e.state !== 'unavailable' && e.state !== 'unknown')
    .slice(0, 4)

  const rooms = ziggyRooms
    .filter((r) => (r.devices || []).length > 0)
    .map((r) => ({
      id: r.id,
      name: r.name,
      entityCount: (r.devices || []).length,
      activeCount: (r.devices || []).filter((d) => d.ha_state === 'on').length,
    }))

  const pendingTasks = tasks.filter((t) => !t.done && !t.completed)

  const handleToggleDevice = async (entity, on) => {
    updateEntityState(entity.entity_id, on ? 'on' : 'off')
    try {
      await controlDevice(entity.entity_id, on ? 'turn_on' : 'turn_off')
      addToast(`${on ? 'On' : 'Off'}`, 'success')
      setTimeout(() => fetchAll(), 1500)
    } catch {
      updateEntityState(entity.entity_id, on ? 'off' : 'on')
      addToast('Failed to control device', 'error')
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-5 pt-5 pb-4">
      {/* Header */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-4">
        <p className="text-sm text-zinc-400 dark:text-zinc-600 font-medium mb-0.5">{greetingByTime()}</p>
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Your Home</h1>
          {presenceSummary.length > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 shrink-0">
              <Users size={11} />
              <span className="max-w-[140px] truncate">{presenceSummary[0]}</span>
            </div>
          )}
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-500 mt-0.5">
          {getActiveCount()} of {getTotalControllable()} devices on
          {pendingTasks.length > 0 && ` · ${pendingTasks.length} task${pendingTasks.length !== 1 ? 's' : ''} pending`}
        </p>
      </motion.div>

      <motion.div variants={stagger} initial="initial" animate="animate">

        {/* Right now — presence + active items summary */}
        <HomeStatusCard entities={entities} presenceSummary={presenceSummary} />

        {/* Environment */}
        {sensorHighlights.length > 0 && (
          <motion.section variants={fadeUp} className="mb-4">
            <div className="grid grid-cols-2 gap-2">
              {sensorHighlights.map((e) => <SensorPill key={e.entity_id} entity={e} />)}
            </div>
          </motion.section>
        )}

        {/* Active now — device chips */}
        {activeDeviceChips.length > 0 && (
          <motion.section variants={fadeUp} className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Active now</h2>
              <button onClick={() => navigate('/devices')} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">All devices</button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {activeDeviceChips.map((e) => (
                <ActiveDeviceChip key={e.entity_id} entity={e} onToggle={handleToggleDevice} />
              ))}
            </div>
          </motion.section>
        )}

        {/* Rooms */}
        {rooms.length > 0 && (
          <motion.section variants={fadeUp} className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Rooms</h2>
              <button onClick={() => navigate('/rooms')} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">See all</button>
            </div>
            <motion.div variants={stagger} initial="initial" animate="animate" className="flex flex-col gap-2">
              {rooms.slice(0, 6).map((room) => <RoomRow key={room.id} room={room} />)}
            </motion.div>
          </motion.section>
        )}

        {/* Alerts */}
        <AlertStrip tasks={tasks} pendingCount={pendingCount()} />

        {/* Quick asks */}
        {quickAsks.length > 0 && (
          <motion.section variants={fadeUp}>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Quick ask</h2>
            <div className="flex flex-wrap gap-2">
              {quickAsks.map((qa) => (
                <button
                  key={qa.id}
                  onClick={() => navigate('/chat', { state: { quickAsk: qa } })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                >
                  {qa.icon && <span>{qa.icon}</span>}
                  {qa.label}
                </button>
              ))}
            </div>
          </motion.section>
        )}
      </motion.div>
    </div>
  )
}
