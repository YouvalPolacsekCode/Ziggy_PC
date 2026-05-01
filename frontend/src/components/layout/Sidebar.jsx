import { useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Cpu, Zap, RotateCcw, MessageCircle,
  ListTodo, Settings, ChevronRight, Wifi, WifiOff, Brain, Sparkles, Lightbulb, Bolt,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { useUIStore } from '../../stores/uiStore'
import { useSuggestionStore } from '../../stores/suggestionStore'
import { Sun, Moon } from 'lucide-react'

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/rooms', icon: null, label: 'Rooms', emoji: '🏠' },
      { to: '/devices', icon: Cpu, label: 'HA Devices' },
      { to: '/virtual-devices', icon: null, label: 'Capabilities', emoji: '⚡' },
    ],
  },
  {
    label: 'Automation',
    items: [
      { to: '/automations', icon: Zap, label: 'Automations' },
      { to: '/routines', icon: RotateCcw, label: 'Routines' },
      { to: '/scenes', icon: Sparkles, label: 'Scenes' },
      { to: '/suggestions', icon: Lightbulb, label: 'Suggestions', badgeKey: 'suggestions' },
    ],
  },
  {
    label: 'AI',
    items: [
      { to: '/chat', icon: MessageCircle, label: 'Ziggy AI' },
      { to: '/quick-asks', icon: Bolt, label: 'Quick Asks' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { to: '/tasks', icon: ListTodo, label: 'Tasks' },
      { to: '/memory', icon: Brain, label: 'Memory' },
      { to: '/settings', icon: Settings, label: 'Settings' },
    ],
  },
]

function NavItem({ to, icon: Icon, label, emoji, badge }) {
  const location = useLocation()
  const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)

  return (
    <NavLink
      to={to}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150',
        active
          ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
          : 'text-zinc-500 dark:text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 hover:text-zinc-800 dark:hover:text-zinc-300'
      )}
    >
      <span className="w-5 flex items-center justify-center">
        {emoji ? (
          <span className="text-base">{emoji}</span>
        ) : (
          Icon && <Icon size={17} />
        )}
      </span>
      <span className="flex-1">{label}</span>
      {badge > 0 && (
        <span className="bg-violet-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
          {badge}
        </span>
      )}
      {active && !badge && <ChevronRight size={14} className="text-zinc-400 dark:text-zinc-600" />}
    </NavLink>
  )
}

export function Sidebar({ connected }) {
  const { theme, toggleTheme } = useUIStore()
  const { fetch: fetchSuggestions, pendingCount } = useSuggestionStore()

  useEffect(() => { fetchSuggestions() }, [])

  const badges = { suggestions: pendingCount() }

  return (
    <aside className="hidden md:flex flex-col w-56 shrink-0 h-screen sticky top-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 py-4 px-3">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-3 mb-6">
        <div className="w-8 h-8 rounded-xl bg-zinc-900 dark:bg-white flex items-center justify-center">
          <span className="text-white dark:text-zinc-900 text-sm font-bold">Z</span>
        </div>
        <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-base">Ziggy</span>
        <div
          className={cn(
            'ml-auto w-1.5 h-1.5 rounded-full',
            connected ? 'bg-emerald-400' : 'bg-red-400'
          )}
        />
      </div>

      {/* Nav groups */}
      <nav className="flex-1 flex flex-col gap-5 overflow-y-auto scrollbar-thin">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 px-3 mb-1">
              {group.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavItem key={item.to} {...item} badge={item.badgeKey ? badges[item.badgeKey] : 0} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="flex items-center gap-2 px-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <span className="text-xs text-zinc-400 dark:text-zinc-600 ml-auto">
          {connected ? (
            <Wifi size={14} className="text-emerald-400" />
          ) : (
            <WifiOff size={14} className="text-red-400" />
          )}
        </span>
      </div>
    </aside>
  )
}
