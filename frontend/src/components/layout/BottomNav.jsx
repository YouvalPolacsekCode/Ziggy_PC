import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Cpu, MessageCircle, Zap, ListTodo,
  MoreHorizontal, Home, RotateCcw, Settings, Brain, X, Sparkles, Boxes, Lightbulb,
} from 'lucide-react'
import { cn } from '../../lib/utils'

const MAIN_NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Home' },
  { to: '/rooms', icon: Home, label: 'Rooms' },
  { to: '/chat', icon: MessageCircle, label: 'Ziggy' },
  { to: '/automations', icon: Zap, label: 'Auto' },
  { to: '/tasks', icon: ListTodo, label: 'Tasks' },
]

const MORE_NAV = [
  { to: '/devices', icon: Cpu, label: 'Devices' },
  { to: '/virtual-devices', icon: Boxes, label: 'Capabilities' },
  { to: '/routines', icon: RotateCcw, label: 'Routines' },
  { to: '/scenes', icon: Sparkles, label: 'Scenes' },
  { to: '/suggestions', icon: Lightbulb, label: 'Suggestions' },
  { to: '/memory', icon: Brain, label: 'Memory' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

function NavBtn({ to, icon: Icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-0.5 flex-1 py-1 group">
      <div className={cn(
        'flex items-center justify-center w-10 h-7 rounded-xl transition-all duration-200',
        active ? 'bg-zinc-900 dark:bg-white' : 'group-hover:bg-zinc-100 dark:group-hover:bg-zinc-800'
      )}>
        <Icon size={18} className={cn(
          'transition-colors duration-200',
          active ? 'text-white dark:text-zinc-900' : 'text-zinc-400 dark:text-zinc-500'
        )} />
      </div>
      <span className={cn(
        'text-[10px] font-medium transition-colors duration-200',
        active ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-600'
      )}>
        {label}
      </span>
    </button>
  )
}

export function BottomNav({ connected }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [showMore, setShowMore] = useState(false)

  const isMoreActive = MORE_NAV.some((n) => location.pathname.startsWith(n.to))

  return (
    <>
      {/* More drawer */}
      <AnimatePresence>
        {showMore && (
          <>
            <motion.div
              className="fixed inset-0 z-30 md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMore(false)}
            />
            <motion.div
              className="fixed bottom-16 left-0 right-0 z-40 md:hidden mx-3 mb-1"
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="bg-zinc-50 dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 p-2 grid grid-cols-4 gap-1">
                {MORE_NAV.map(({ to, icon: Icon, label }) => {
                  const active = location.pathname.startsWith(to)
                  return (
                    <button
                      key={to}
                      onClick={() => { navigate(to); setShowMore(false) }}
                      className={cn(
                        'flex flex-col items-center gap-1 py-3 px-2 rounded-xl transition-colors',
                        active
                          ? 'bg-zinc-100 dark:bg-zinc-800'
                          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60'
                      )}
                    >
                      <Icon size={20} className={cn(
                        active ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'
                      )} />
                      <span className={cn(
                        'text-[11px] font-medium',
                        active ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'
                      )}>
                        {label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Bottom bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-zinc-900/90 backdrop-blur-xl border-t border-zinc-200 dark:border-zinc-800 md:hidden">
        <div className="flex items-center justify-around h-16 px-2 max-w-lg mx-auto">
          {MAIN_NAV.map(({ to, icon: Icon, label }) => {
            const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
            return (
              <NavLink key={to} to={to} onClick={() => setShowMore(false)} className="flex flex-col items-center gap-0.5 flex-1 py-1 group">
                <div className={cn(
                  'flex items-center justify-center w-10 h-7 rounded-xl transition-all duration-200',
                  active ? 'bg-zinc-900 dark:bg-white' : 'group-hover:bg-zinc-100 dark:group-hover:bg-zinc-800'
                )}>
                  <Icon size={18} className={cn(
                    active ? 'text-white dark:text-zinc-900' : 'text-zinc-400 dark:text-zinc-500'
                  )} />
                </div>
                <span className={cn(
                  'text-[10px] font-medium',
                  active ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-600'
                )}>
                  {label}
                </span>
              </NavLink>
            )
          })}

          {/* More button */}
          <NavBtn
            to=""
            icon={MoreHorizontal}
            label="More"
            active={isMoreActive || showMore}
            onClick={() => setShowMore((v) => !v)}
          />
        </div>

        {connected === false && (
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full pb-1">
            <span className="text-[10px] bg-red-500 text-white px-2 py-0.5 rounded-full">offline</span>
          </div>
        )}
      </nav>
    </>
  )
}
