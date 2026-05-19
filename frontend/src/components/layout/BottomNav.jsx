import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { Bell, CheckSquare, Settings, ShieldAlert, WifiOff } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'

const ROLE_ORDER = ['user', 'admin', 'super_admin']
function hasRole(userRole, minRole) {
  return ROLE_ORDER.indexOf(userRole) >= ROLE_ORDER.indexOf(minRole)
}

// Design-system icons matching ziggy-atoms.jsx
function ZIcon({ name, size = 20, stroke = 1.6, color = 'currentColor' }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (name) {
    case 'home':    return <svg {...p}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>
    case 'rooms':   return <svg {...p}><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>
    case 'plug':    return <svg {...p}><path d="M9 2v6M15 2v6"/><path d="M5 8h14v3a7 7 0 0 1-14 0z"/><path d="M12 18v4"/></svg>
    case 'auto':    return <svg {...p}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>
    case 'sparkle': return <svg {...p}><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M5.6 18.4L18.4 5.6"/></svg>
    case 'mic':     return <svg {...p}><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
    default: return null
  }
}

const PRIMARY = [
  { to: '/',            name: 'home',    label: 'Home' },
  { to: '/rooms',       name: 'rooms',   label: 'Rooms' },
  { to: '/devices',     name: 'plug',    label: 'Devices' },
  { to: '/automations', name: 'auto',    label: 'Auto' },
]

const SECONDARY = [
  { to: '/alerts',   Icon: Bell,        label: 'Alerts' },
  { to: '/tasks',    Icon: CheckSquare, label: 'Tasks' },
  { to: '/settings', Icon: Settings,    label: 'Settings' },
]

function Tab({ to, name, label }) {
  const location = useLocation()
  const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
  return (
    <NavLink
      to={to}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        padding: '7px 4px', textDecoration: 'none', WebkitTapHighlightColor: 'transparent',
      }}
    >
      <ZIcon
        name={name}
        size={20}
        stroke={active ? 1.9 : 1.5}
        color={active ? 'var(--ink)' : 'var(--ink-faint)'}
      />
      <span style={{
        fontSize: 10, fontWeight: active ? 600 : 500,
        color: active ? 'var(--ink)' : 'var(--ink-faint)',
        lineHeight: 1, letterSpacing: '0.01em',
      }}>
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
              style={{ background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(4px)' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setShowMore(false)}
            />
            <motion.div
              className="fixed left-0 right-0 z-40 md:hidden"
              style={{
                bottom: 'calc(68px + env(safe-area-inset-bottom, 0px) + 8px)',
                padding: '0 12px',
              }}
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <div style={{
                background: 'var(--surface)', border: '0.5px solid var(--line)',
                borderRadius: 20, boxShadow: 'var(--shadow-lg)',
                padding: 10, display: 'grid',
                gridTemplateColumns: `repeat(${moreItems.length}, 1fr)`, gap: 6,
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
                        cursor: 'pointer', borderRadius: 14,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                        padding: '14px 8px', fontFamily: 'inherit',
                      }}
                    >
                      <Icon size={22} strokeWidth={active ? 2 : 1.6} color={active ? 'var(--ink)' : 'var(--ink-mute)'} />
                      <span style={{ fontSize: 11, fontWeight: 500, color: active ? 'var(--ink)' : 'var(--ink-mute)', letterSpacing: '0.01em' }}>
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

      {/* Bottom bar — frosted glass */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 md:hidden"
        style={{
          background: 'color-mix(in srgb, var(--bg) 88%, transparent)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: '0.5px solid var(--line)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {connected === false && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3px 0', background: 'var(--err)', gap: 5 }}>
            <WifiOff size={10} color="#fff" />
            <span style={{ fontSize: 10, color: '#fff', fontWeight: 500 }}>offline</span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-end', height: 60, maxWidth: 480, margin: '0 auto', padding: '0 4px' }}>

          {/* Left 2 */}
          {PRIMARY.slice(0, 2).map(p => <Tab key={p.to} {...p} />)}

          {/* Center Ask */}
          <NavLink
            to="/chat"
            onClick={() => setShowMore(false)}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textDecoration: 'none', marginBottom: 4, WebkitTapHighlightColor: 'transparent' }}
          >
            <div style={{
              width: 44, height: 44, borderRadius: '50%',
              background: chatActive ? 'var(--accent)' : 'var(--ink)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: chatActive ? '0 0 0 6px color-mix(in srgb, var(--accent) 18%, transparent)' : 'var(--shadow-md)',
              transition: 'background 0.2s, box-shadow 0.2s',
            }}>
              <ZIcon name="sparkle" size={18} stroke={1.8} color="var(--bg)" />
            </div>
            <span style={{ fontSize: 10, fontWeight: 600, color: chatActive ? 'var(--accent)' : 'var(--ink-faint)', lineHeight: 1, letterSpacing: '0.01em' }}>
              Ask
            </span>
          </NavLink>

          {/* Right 2 */}
          {PRIMARY.slice(2).map(p => <Tab key={p.to} {...p} />)}

          {/* More */}
          <button
            onClick={() => setShowMore(v => !v)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              padding: '7px 4px', background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent',
            }}
          >
            <div style={{ display: 'flex', gap: 3, alignItems: 'center', height: 20 }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{
                  width: 4, height: 4, borderRadius: '50%',
                  background: (isMoreActive || showMore) ? 'var(--ink)' : 'var(--ink-faint)',
                }} />
              ))}
            </div>
            <span style={{ fontSize: 10, fontWeight: (isMoreActive || showMore) ? 600 : 500, color: (isMoreActive || showMore) ? 'var(--ink)' : 'var(--ink-faint)', lineHeight: 1, letterSpacing: '0.01em' }}>
              More
            </span>
          </button>
        </div>
      </nav>
    </>
  )
}
