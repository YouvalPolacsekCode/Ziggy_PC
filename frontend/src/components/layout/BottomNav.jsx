import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { Home, Grid2x2, Cpu, Zap, MessageCircle, Bell, CheckSquare, Settings, ShieldAlert, WifiOff } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'

const ROLE_ORDER = ['user', 'admin', 'super_admin']
function hasRole(userRole, minRole) {
  return ROLE_ORDER.indexOf(userRole) >= ROLE_ORDER.indexOf(minRole)
}

const PRIMARY = [
  { to: '/',            Icon: Home,         label: 'Home' },
  { to: '/rooms',       Icon: Grid2x2,      label: 'Rooms' },
  { to: '/devices',     Icon: Cpu,          label: 'Devices' },
  { to: '/automations', Icon: Zap,          label: 'Auto' },
]

const SECONDARY = [
  { to: '/alerts',   Icon: Bell,        label: 'Alerts' },
  { to: '/tasks',    Icon: CheckSquare, label: 'Tasks' },
  { to: '/settings', Icon: Settings,    label: 'Settings' },
]

function Tab({ to, Icon, label }) {
  const location = useLocation()
  const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
  return (
    <NavLink
      to={to}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '7px 4px', textDecoration: 'none', WebkitTapHighlightColor: 'transparent' }}
    >
      <div style={{
        width: 40, height: 26, borderRadius: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: active ? 'var(--ink)' : 'transparent',
        transition: 'background 0.15s',
      }}>
        <Icon size={17} strokeWidth={active ? 2 : 1.7} color={active ? 'var(--bg)' : 'var(--ink-faint)'} />
      </div>
      <span style={{ fontSize: 10, fontWeight: active ? 600 : 500, color: active ? 'var(--ink)' : 'var(--ink-faint)', lineHeight: 1 }}>
        {label}
      </span>
    </NavLink>
  )
}

export function BottomNav({ connected }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { role } = useAuthStore()
  const [showMore, setShowMore] = useState(false)

  const chatActive = location.pathname.startsWith('/chat')
  const moreItems = [
    ...SECONDARY,
    ...(hasRole(role, 'super_admin') ? [{ to: '/ops', Icon: ShieldAlert, label: 'Ops' }] : []),
  ]
  const isMoreActive = moreItems.some(n => location.pathname.startsWith(n.to))

  return (
    <>
      {/* More drawer */}
      <AnimatePresence>
        {showMore && (
          <>
            <motion.div
              className="fixed inset-0 z-30 md:hidden"
              style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(2px)' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setShowMore(false)}
            />
            <motion.div
              className="fixed left-0 right-0 z-40 md:hidden"
              style={{
                bottom: 'calc(64px + env(safe-area-inset-bottom, 0px) + 8px)',
                padding: '0 12px',
              }}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <div style={{
                background: 'var(--surface)', border: '0.5px solid var(--line)',
                borderRadius: 18, boxShadow: 'var(--shadow-lg)',
                padding: 8, display: 'grid',
                gridTemplateColumns: `repeat(${moreItems.length}, 1fr)`, gap: 4,
              }}>
                {moreItems.map(({ to, Icon, label }) => {
                  const active = location.pathname.startsWith(to)
                  return (
                    <button
                      key={to}
                      onClick={() => { navigate(to); setShowMore(false) }}
                      style={{
                        background: active ? 'var(--surface-2)' : 'transparent',
                        border: active ? '0.5px solid var(--line)' : 'none',
                        cursor: 'pointer', borderRadius: 12,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                        padding: '12px 8px', fontFamily: 'inherit',
                      }}
                    >
                      <Icon size={20} strokeWidth={1.7} color={active ? 'var(--ink)' : 'var(--ink-mute)'} />
                      <span style={{ fontSize: 11, fontWeight: 500, color: active ? 'var(--ink)' : 'var(--ink-mute)' }}>
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
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 md:hidden"
        style={{
          background: 'var(--surface)',
          borderTop: '0.5px solid var(--line)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {connected === false && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3px 0', background: 'var(--err)', gap: 4 }}>
            <WifiOff size={10} color="#fff" />
            <span style={{ fontSize: 10, color: '#fff', fontWeight: 500 }}>offline</span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', height: 60, maxWidth: 480, margin: '0 auto', padding: '0 4px' }}>
          {/* Left 2 tabs */}
          {PRIMARY.slice(0, 2).map(p => <Tab key={p.to} {...p} />)}

          {/* Center Ask button */}
          <NavLink
            to="/chat"
            onClick={() => setShowMore(false)}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, textDecoration: 'none', marginTop: -14, WebkitTapHighlightColor: 'transparent' }}
          >
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: chatActive ? 'var(--accent)' : 'var(--ink)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: 'var(--shadow-md)',
              border: '2.5px solid var(--bg)',
              transition: 'background 0.15s',
            }}>
              <MessageCircle size={20} color="var(--bg)" strokeWidth={1.8} />
            </div>
            <span style={{ fontSize: 10, fontWeight: 600, color: chatActive ? 'var(--accent)' : 'var(--ink-faint)', lineHeight: 1 }}>
              Ask
            </span>
          </NavLink>

          {/* Right 2 tabs */}
          {PRIMARY.slice(2).map(p => <Tab key={p.to} {...p} />)}

          {/* More */}
          <button
            onClick={() => setShowMore(v => !v)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              padding: '7px 4px', background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent',
            }}
          >
            <div style={{
              width: 40, height: 26, borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: (isMoreActive || showMore) ? 'var(--ink)' : 'transparent',
              transition: 'background 0.15s',
            }}>
              <svg width="16" height="4" viewBox="0 0 22 4" fill="none">
                {[2, 11, 20].map(cx => (
                  <circle key={cx} cx={cx} cy="2" r="1.8"
                    fill={(isMoreActive || showMore) ? 'var(--bg)' : 'var(--ink-faint)'} />
                ))}
              </svg>
            </div>
            <span style={{ fontSize: 10, fontWeight: (isMoreActive || showMore) ? 600 : 500, color: (isMoreActive || showMore) ? 'var(--ink)' : 'var(--ink-faint)', lineHeight: 1 }}>
              More
            </span>
          </button>
        </div>
      </nav>
    </>
  )
}
