import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ChevronRight, AlertTriangle, Lightbulb } from 'lucide-react'
import { useDeviceStore } from '../stores/deviceStore'
import { useTaskStore } from '../stores/taskStore'
import { useAutomationStore } from '../stores/automationStore'
import { useUIStore } from '../stores/uiStore'
import { useSuggestionStore } from '../stores/suggestionStore'
import { useQuickAskStore } from '../stores/quickAskStore'
import { greetingByTime } from '../lib/utils'
import { cn } from '../lib/utils'

const fadeUp = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.2 } } }
const stagger = { animate: { transition: { staggerChildren: 0.06 } } }

// ── Active room card ────────────────────────────────────────────────────────
function ActiveRoomCard({ room }) {
  const navigate = useNavigate()

  const parts = []
  if (room.activeLights.length === 1) {
    parts.push(`💡 ${room.activeLights[0].display_name || 'Light'} on`)
  } else if (room.activeLights.length > 1) {
    parts.push(`💡 ${room.activeLights.length} lights on`)
  }
  room.playingMedia.slice(0, 2).forEach(m => parts.push(`📺 ${m.display_name || 'TV'} playing`))
  if (room.activeClimate.length) parts.push('❄️ AC on')
  if (room.activeFans.length) parts.push('🌀 Fan on')
  if (room.activeSwitches.length === 1) parts.push(`⚡ ${room.activeSwitches[0].display_name || 'Switch'} on`)
  else if (room.activeSwitches.length > 1) parts.push(`⚡ ${room.activeSwitches.length} switches on`)

  return (
    <motion.button
      variants={fadeUp}
      onClick={() => navigate(`/rooms/${room.id}`)}
      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 active:scale-[0.98] transition-all text-left"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{room.name}</span>
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_5px_rgba(52,211,153,0.8)]" />
          <span className="text-xs text-emerald-500 font-medium">{room.activeCount} on</span>
        </div>
        {parts.length > 0 && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-snug truncate">
            {parts.join(' · ')}
          </p>
        )}
        {(room.tempSensor || room.humSensor) && (
          <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-0.5">
            {room.tempSensor && `🌡 ${parseFloat(room.tempSensor.state).toFixed(1)}${room.tempSensor.attributes?.unit_of_measurement ?? '°C'}`}
            {room.tempSensor && room.humSensor && '   '}
            {room.humSensor && `💧 ${parseFloat(room.humSensor.state).toFixed(0)}${room.humSensor.attributes?.unit_of_measurement ?? '%'}`}
          </p>
        )}
      </div>
      <ChevronRight size={15} className="text-zinc-300 dark:text-zinc-700 shrink-0" />
    </motion.button>
  )
}

// ── Alert strip ─────────────────────────────────────────────────────────────
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

  const overdueTasks = tasks.filter(t => !t.done && !t.completed && t.due_date && new Date(t.due_date) < new Date())
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
      {alerts.map(a => (
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

// ── Dashboard ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate()
  const { entities, ziggyRooms, fetchAll, getActiveCount, getTotalControllable, getPresenceSummary } = useDeviceStore()
  const { tasks, fetch: fetchTasks } = useTaskStore()
  const { fetchAutomations, fetchRoutines } = useAutomationStore()
  const { fetch: fetchSuggestions, pendingCount } = useSuggestionStore()
  const { items: quickAsks, fetch: fetchQuickAsks } = useQuickAskStore()

  useEffect(() => {
    fetchAll(); fetchTasks(); fetchAutomations(); fetchRoutines(); fetchSuggestions(); fetchQuickAsks()
  }, [])

  const presenceSummary = getPresenceSummary()
  const pendingTasks = tasks.filter(t => !t.done && !t.completed)

  // Entity lookup for per-room sensor resolution
  const entityMap = Object.fromEntries(entities.map(e => [e.entity_id, e]))

  // Build per-room activity summaries
  const roomSummaries = ziggyRooms
    .filter(r => (r.devices || []).length > 0)
    .map(r => {
      const devices = r.devices || []
      const activeLights   = devices.filter(d => d.domain === 'light'        && d.ha_state === 'on')
      const playingMedia   = devices.filter(d => d.domain === 'media_player' && d.ha_state === 'playing')
      const activeClimate  = devices.filter(d => d.domain === 'climate'      && !['off', 'unavailable', 'unknown'].includes(d.ha_state))
      const activeSwitches = devices.filter(d => d.domain === 'switch'       && d.ha_state === 'on')
      const activeFans     = devices.filter(d => d.domain === 'fan'          && d.ha_state === 'on')

      // Look up sensor entities from the full entity list so device_class is reliable
      const sensorEntities = devices
        .map(d => entityMap[d.entity_id])
        .filter(e => e?.domain === 'sensor' && e.state !== 'unavailable' && e.state !== 'unknown')
      const tempSensor = sensorEntities.find(e => e.device_class === 'temperature')
      const humSensor  = sensorEntities.find(e => e.device_class === 'humidity')

      const activeCount = activeLights.length + playingMedia.length + activeClimate.length + activeSwitches.length + activeFans.length

      return { id: r.id, name: r.name, deviceCount: devices.length, activeCount, activeLights, playingMedia, activeClimate, activeSwitches, activeFans, tempSensor, humSensor }
    })

  const activeRooms = roomSummaries.filter(r => r.activeCount > 0)
  const quietRooms  = roomSummaries.filter(r => r.activeCount === 0)

  return (
    <div className="max-w-2xl mx-auto px-5 pt-5 pb-4">
      {/* Header */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-5">
        <p className="text-sm text-zinc-400 dark:text-zinc-600 font-medium mb-0.5">{greetingByTime()}</p>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Your Home</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-500 mt-0.5">
          {getActiveCount()} of {getTotalControllable()} devices on
          {pendingTasks.length > 0 && ` · ${pendingTasks.length} task${pendingTasks.length !== 1 ? 's' : ''} pending`}
        </p>
        {presenceSummary.length > 0 && (
          <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-1">
            👤 {presenceSummary.join(' · ')}
          </p>
        )}
      </motion.div>

      <motion.div variants={stagger} initial="initial" animate="animate">
        {/* Alerts */}
        <AlertStrip tasks={tasks} pendingCount={pendingCount()} />

        {/* Active rooms */}
        {activeRooms.length > 0 ? (
          <motion.section variants={fadeUp} className="mb-5">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Active now</h2>
            <div className="flex flex-col gap-2">
              {activeRooms.map(room => <ActiveRoomCard key={room.id} room={room} />)}
            </div>
          </motion.section>
        ) : (
          <motion.div
            variants={fadeUp}
            className="mb-5 px-4 py-8 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 text-center"
          >
            <p className="text-2xl mb-2">🌙</p>
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Everything's quiet</p>
          </motion.div>
        )}

        {/* Quiet rooms — compact pill row */}
        {quietRooms.length > 0 && (
          <motion.section variants={fadeUp} className="mb-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 mb-2">Quiet</h2>
            <div className="flex flex-wrap gap-2">
              {quietRooms.map(r => (
                <button
                  key={r.id}
                  onClick={() => navigate(`/rooms/${r.id}`)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium text-zinc-500 dark:text-zinc-400 bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                >
                  {r.name}
                </button>
              ))}
            </div>
          </motion.section>
        )}

        {/* Quick ask */}
        {quickAsks.length > 0 && (
          <motion.section variants={fadeUp}>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Quick ask</h2>
            <div className="flex flex-wrap gap-2">
              {quickAsks.map(qa => (
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
