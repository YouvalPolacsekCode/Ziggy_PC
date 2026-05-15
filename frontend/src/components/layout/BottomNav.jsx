import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'

function ZIcon({ name, size = 20 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (name) {
    case 'home':  return <svg {...p}><path d="M3 11l9-8 9 8M5 10v10h14V10"/></svg>
    case 'grid':  return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
    case 'mic':   return <svg {...p}><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
    case 'bolt':  return <svg {...p}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>
    case 'tasks': return <svg {...p}><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
    case 'more':  return <svg {...p}><circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>
    case 'cpu':   return <svg {...p}><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/></svg>
    case 'brain': return <svg {...p}><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.07-4.58A3 3 0 0 1 4.5 9.5a2.5 2.5 0 0 1 3-3.45A2.5 2.5 0 0 1 9.5 2M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.07-4.58A3 3 0 0 0 19.5 9.5a2.5 2.5 0 0 0-3-3.45A2.5 2.5 0 0 0 14.5 2"/></svg>
    case 'route': return <svg {...p}><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M6 9v6a3 3 0 0 0 3 3h6"/></svg>
    case 'scene': return <svg {...p}><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
    case 'bulb':  return <svg {...p}><path d="M9 18h6M10 22h4"/><path d="M12 2a6 6 0 0 0-4 10.5c.7.7 1 1.6 1 2.5v1h6v-1c0-.9.3-1.8 1-2.5A6 6 0 0 0 12 2z"/></svg>
    case 'bell':  return <svg {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
    case 'wave':  return <svg {...p}><path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 12h2"/></svg>
    case 'camera':return <svg {...p}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
    case 'cog':   return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1c.5.5 1.3.6 1.8.3.6-.2 1-.8 1-1.5V3a2 2 0 0 1 4 0v.1c0 .7.4 1.3 1 1.5.5.3 1.3.2 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8c.2.6.8 1 1.5 1H21a2 2 0 0 1 0 4h-.1c-.7 0-1.3.4-1.5 1z"/></svg>
    case 'shield':return <svg {...p}><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z"/></svg>
    case 'boxes': return <svg {...p}><path d="M12 3l-8 4.5v9L12 21l8-4.5v-9L12 3zM12 3v18M4 7.5l8 4.5 8-4.5"/></svg>
    default: return null
  }
}

// Left of mic
const LEFT_NAV = [
  { to: '/',       icon: 'home',  label: 'Home' },
  { to: '/rooms',  icon: 'grid',  label: 'Rooms' },
  { to: '/devices', icon: 'cpu',  label: 'Devices' },
]
// Right of mic
const RIGHT_NAV = [
  { to: '/tasks',       icon: 'tasks', label: 'Tasks' },
  { to: '/automations', icon: 'bolt',  label: 'Automations' },
]
// More drawer
const MORE_NAV = [
  { to: '/cameras',         icon: 'camera', label: 'Security' },
  { to: '/memory',          icon: 'brain',  label: 'Memory' },
  { to: '/virtual-devices', icon: 'boxes',  label: 'Capabilities' },
  { to: '/routines',        icon: 'route',  label: 'Routines' },
  { to: '/scenes',          icon: 'scene',  label: 'Scenes' },
  { to: '/quick-asks',      icon: 'wave',   label: 'Quick Asks' },
  { to: '/suggestions',     icon: 'bulb',   label: 'Suggestions' },
  { to: '/anomalies',       icon: 'bell',   label: 'Alerts' },
  { to: '/settings',        icon: 'cog',    label: 'Settings' },
]

function TabItem({ to, icon, label, active, onClick }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px 4px', textDecoration: 'none' }}
    >
      <div style={{
        width: 40, height: 28, borderRadius: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: active ? 'var(--ink)' : 'transparent',
        transition: 'background 0.15s',
      }}>
        <span style={{ color: active ? 'var(--bg)' : 'var(--ink-faint)' }}>
          <ZIcon name={icon} size={18} />
        </span>
      </div>
      <span style={{ fontSize: 10, fontWeight: 500, color: active ? 'var(--ink)' : 'var(--ink-faint)' }}>
        {label}
      </span>
    </NavLink>
  )
}

export function BottomNav({ connected, features }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [showMore, setShowMore] = useState(false)
  const ziggyActive = location.pathname.startsWith('/chat')
  const visibleMore = MORE_NAV.filter(item => !(item.to === '/scenes' && !features?.scenes))
  const isMoreActive = visibleMore.some(n => location.pathname.startsWith(n.to))

  return (
    <>
      {/* More drawer */}
      <AnimatePresence>
        {showMore && (
          <>
            <motion.div
              className="fixed inset-0 z-30 md:hidden"
              style={{ background: 'rgba(0,0,0,0.3)' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowMore(false)}
            />
            <motion.div
              className="fixed left-0 right-0 z-40 md:hidden mx-3"
              style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom, 0px) + 6px)' }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              <div style={{
                background: 'var(--surface)',
                border: '0.5px solid var(--line)',
                borderRadius: 18,
                boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                padding: 8,
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4,
              }}>
                {visibleMore.map(({ to, icon, label }) => {
                  const active = location.pathname.startsWith(to)
                  return (
                    <button
                      key={to}
                      onClick={() => { navigate(to); setShowMore(false) }}
                      style={{
                        background: active ? 'var(--bg-2)' : 'transparent',
                        border: 'none', cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                        padding: '12px 8px', borderRadius: 12,
                        fontFamily: 'inherit',
                      }}
                    >
                      <span style={{ color: active ? 'var(--ink)' : 'var(--ink-mute)' }}>
                        <ZIcon name={icon} size={20} />
                      </span>
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
          background: 'var(--bg)',
          borderTop: '0.5px solid var(--line)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', height: 60, padding: '0 4px', maxWidth: 480, margin: '0 auto' }}>
          {LEFT_NAV.map(({ to, icon, label }) => {
            const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
            return <TabItem key={to} to={to} icon={icon} label={label} active={active} onClick={() => setShowMore(false)} />
          })}

          {/* Center mic button */}
          <NavLink
            to="/chat"
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: -18 }}
          >
            <div style={{
              width: 52, height: 52, borderRadius: '50%',
              background: 'var(--ink)',
              color: 'var(--bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 6px 18px -6px rgba(0,0,0,0.35)',
              border: '3px solid var(--bg)',
              opacity: ziggyActive ? 0.75 : 1,
            }}>
              <ZIcon name="mic" size={22} />
            </div>
            <span style={{ fontSize: 10, fontWeight: 500, marginTop: 2, color: ziggyActive ? 'var(--ink)' : 'var(--ink-faint)' }}>
              Ziggy
            </span>
          </NavLink>

          {RIGHT_NAV.map(({ to, icon, label }) => {
            const active = location.pathname.startsWith(to)
            return <TabItem key={to} to={to} icon={icon} label={label} active={active} onClick={() => setShowMore(false)} />
          })}

          <button
            onClick={() => setShowMore(v => !v)}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px 4px', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <div style={{
              width: 40, height: 28, borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: (isMoreActive || showMore) ? 'var(--ink)' : 'transparent',
            }}>
              <span style={{ color: (isMoreActive || showMore) ? 'var(--bg)' : 'var(--ink-faint)' }}>
                <ZIcon name="more" size={18} />
              </span>
            </div>
            <span style={{ fontSize: 10, fontWeight: 500, color: (isMoreActive || showMore) ? 'var(--ink)' : 'var(--ink-faint)' }}>
              More
            </span>
          </button>
        </div>

        {connected === false && (
          <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translate(-50%, -100%)' }}>
            <span style={{ fontSize: 10, background: 'var(--accent)', color: '#fff', padding: '2px 8px', borderRadius: 999 }}>
              offline
            </span>
          </div>
        )}
      </nav>
    </>
  )
}
