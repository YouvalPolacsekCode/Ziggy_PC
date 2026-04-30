import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Zap, ListTodo, Cpu, ChevronRight, Users, Music2, Thermometer, Wind, Lightbulb } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
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

const stagger = { animate: { transition: { staggerChildren: 0.06 } } }
const item = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0, transition: { duration: 0.25 } } }

function HomeStatusCard({ entities, presenceSummary = [] }) {
  const lights = entities.filter((e) => e.domain === 'light' && e.state === 'on')
  const playing = entities.filter((e) => e.domain === 'media_player' && e.state === 'playing')
  const climate = entities.filter((e) => e.domain === 'climate' && e.state !== 'off' && e.state !== 'unavailable')
  const fans = entities.filter((e) => e.domain === 'fan' && e.state === 'on')

  const items = []
  if (presenceSummary.length) presenceSummary.forEach((text) => items.push({ icon: '👤', text }))
  if (lights.length) items.push({ icon: '💡', text: `${lights.length} light${lights.length !== 1 ? 's' : ''} on` })
  if (playing.length) items.push({ icon: '🎵', text: playing.map((e) => e.friendly_name || e.entity_id.split('.')[1]).join(', ') + ' playing' })
  if (climate.length) {
    const c = climate[0]
    const temp = c.temperature != null ? ` · ${c.temperature}°` : ''
    items.push({ icon: '❄️', text: (c.friendly_name || 'Climate') + temp })
  }
  if (fans.length) items.push({ icon: '🌀', text: `${fans.length} fan${fans.length !== 1 ? 's' : ''} on` })

  if (items.length === 0) return null

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
      <Card className="p-4 bg-gradient-to-br from-violet-50 to-zinc-50 dark:from-violet-900/10 dark:to-zinc-900 border-violet-100 dark:border-violet-900/30">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-500 dark:text-violet-400 mb-2">Right now</p>
        <div className="flex flex-col gap-1.5">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-sm">{item.icon}</span>
              <span className="text-sm text-zinc-700 dark:text-zinc-300">{item.text}</span>
            </div>
          ))}
        </div>
      </Card>
    </motion.div>
  )
}

function StatCard({ icon, label, value, sub, color }) {
  return (
    <motion.div variants={item}>
      <Card className="p-3">
        <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center mb-2', color)}>{icon}</div>
        <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{value}</p>
        <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200 mt-0.5">{label}</p>
        {sub && <p className="text-[10px] text-zinc-400 dark:text-zinc-600 mt-0.5">{sub}</p>}
      </Card>
    </motion.div>
  )
}

function SensorPill({ entity }) {
  const { primary } = formatEntityState(entity)
  const dc = entity.device_class
  const icon = dc === 'temperature' ? '🌡️' : dc === 'humidity' ? '💧' : dc === 'illuminance' ? '☀️' : '📊'
  const name = (entity.friendly_name || entity.entity_id.split('.')[1] || '').replace(/_/g, ' ')
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs">
      <span>{icon}</span>
      <span className="text-zinc-500 dark:text-zinc-400 truncate flex-1">{name}</span>
      <span className="font-semibold text-zinc-900 dark:text-zinc-100 shrink-0">{primary}</span>
    </div>
  )
}

function OccupancyBadge({ presenceSummary = [] }) {
  if (!presenceSummary.length) return null
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300">
      <Users size={11} />
      <span>{presenceSummary[0]}</span>
    </div>
  )
}

function QuickRoomCard({ room }) {
  const navigate = useNavigate()
  return (
    <motion.div variants={item}>
      <Card onClick={() => navigate(`/rooms/${room.id}`)} className="p-3 flex items-center gap-2.5">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{room.name}</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-0.5">
            {room.entityCount} device{room.entityCount !== 1 ? 's' : ''}
            {room.activeCount > 0 && ` · ${room.activeCount} on`}
          </p>
        </div>
        {room.activeCount > 0 && (
          <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)] shrink-0" />
        )}
        <ChevronRight size={14} className="text-zinc-300 dark:text-zinc-700 shrink-0" />
      </Card>
    </motion.div>
  )
}

function ActiveDeviceChip({ entity, onToggle }) {
  const isOn = entity.state === 'on'
  const name = (entity.friendly_name || entity.entity_id.split('.')[1] || '').replace(/_/g, ' ')
  return (
    <div className={cn(
      'flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors',
      isOn ? 'bg-zinc-900 dark:bg-white border-zinc-900 dark:border-white' : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700'
    )}>
      <span className="text-sm">{domainIcon(entity.domain)}</span>
      <span className={cn('text-xs font-medium truncate max-w-[110px]', isOn ? 'text-white dark:text-zinc-900' : 'text-zinc-600 dark:text-zinc-400')}>
        {name}
      </span>
      <Toggle checked={isOn} onCheckedChange={(v) => onToggle(entity, v)} className="shrink-0 scale-75" />
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { entities, ziggyRooms, fetchAll, updateEntityState, getActiveCount, getTotalControllable, getPresenceSummary } = useDeviceStore()
  const { tasks, fetch: fetchTasks } = useTaskStore()
  const { automations, fetchAutomations, fetchRoutines } = useAutomationStore()
  const { addToast } = useUIStore()
  const { fetch: fetchSuggestions, pendingCount } = useSuggestionStore()
  const { items: quickAsks, fetch: fetchQuickAsks } = useQuickAskStore()

  useEffect(() => { fetchAll(); fetchTasks(); fetchAutomations(); fetchRoutines(); fetchSuggestions(); fetchQuickAsks() }, [])

  const rooms = ziggyRooms
    .filter((r) => (r.devices || []).length > 0)
    .map((r) => ({
      id: r.id,
      name: r.name,
      entityCount: (r.devices || []).length,
      activeCount: (r.devices || []).filter((d) => d.ha_state === 'on').length,
    }))
  const presenceSummary = getPresenceSummary()
  const activeDeviceChips = entities.filter((e) => CONTROLLABLE_DOMAINS.has(e.domain) && e.state === 'on').slice(0, 6)
  const pendingTasks = tasks.filter((t) => !t.done && !t.completed)
  const enabledAutomations = automations.filter((a) => a.enabled)

  const sensorHighlights = entities
    .filter((e) => e.domain === 'sensor' && ['temperature', 'humidity'].includes(e.device_class) && e.state !== 'unavailable' && e.state !== 'unknown')
    .slice(0, 4)

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
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-5">
        <p className="text-sm text-zinc-400 dark:text-zinc-600 font-medium mb-0.5">{greetingByTime()}</p>
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Your Smart Home</h1>
          <OccupancyBadge presenceSummary={presenceSummary} />
        </div>
      </motion.div>

      {/* What's on right now */}
      <HomeStatusCard entities={entities} presenceSummary={presenceSummary} />

      {/* Stats row */}
      <motion.div variants={stagger} initial="initial" animate="animate" className="grid grid-cols-3 gap-2 mb-4">
        <StatCard icon={<Cpu size={18} className="text-zinc-700 dark:text-zinc-300" />} label="Active" value={getActiveCount()} sub={`${getTotalControllable()} devices`} color="bg-zinc-100 dark:bg-zinc-800" />
        <StatCard icon={<Zap size={18} className="text-violet-600" />} label="Automations" value={enabledAutomations.length} sub="enabled" color="bg-violet-50 dark:bg-violet-900/20" />
        <StatCard icon={<ListTodo size={18} className="text-blue-600" />} label="Tasks" value={pendingTasks.length} sub="pending" color="bg-blue-50 dark:bg-blue-900/20" />
      </motion.div>

      {/* Sensor highlights */}
      {sensorHighlights.length > 0 && (
        <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }} className="mb-4">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Environment</h2>
          <div className="grid grid-cols-2 gap-2">
            {sensorHighlights.map((e) => <SensorPill key={e.entity_id} entity={e} />)}
          </div>
        </motion.section>
      )}

      {/* Active devices */}
      {activeDeviceChips.length > 0 && (
        <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Active now</h2>
            <button onClick={() => navigate('/devices')} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">See all</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {activeDeviceChips.map((e) => <ActiveDeviceChip key={e.entity_id} entity={e} onToggle={handleToggleDevice} />)}
          </div>
        </motion.section>
      )}

      {/* Rooms */}
      {rooms.length > 0 && (
        <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Rooms</h2>
            <button onClick={() => navigate('/rooms')} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">See all</button>
          </div>
          <motion.div variants={stagger} initial="initial" animate="animate" className="grid grid-cols-2 gap-2">
            {rooms.slice(0, 4).map((room) => <QuickRoomCard key={room.id} room={room} />)}
          </motion.div>
        </motion.section>
      )}

      {/* Suggestion nudge */}
      {pendingCount() > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
          className="mb-4"
        >
          <button
            onClick={() => navigate('/suggestions')}
            className="w-full text-left"
          >
            <Card className="p-4 bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-900/15 dark:to-indigo-900/10 border-violet-200 dark:border-violet-800/50 hover:border-violet-400 dark:hover:border-violet-600 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0">
                  <Lightbulb size={17} className="text-violet-600 dark:text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-violet-900 dark:text-violet-100">
                    {pendingCount()} automation suggestion{pendingCount() !== 1 ? 's' : ''} ready
                  </p>
                  <p className="text-xs text-violet-600/70 dark:text-violet-400/70 mt-0.5">
                    Ziggy spotted patterns in your habits — tap to review
                  </p>
                </div>
                <ChevronRight size={15} className="text-violet-400 dark:text-violet-600 shrink-0" />
              </div>
            </Card>
          </button>
        </motion.div>
      )}

      {/* Quick actions */}
      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Quick ask</h2>
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
    </div>
  )
}
