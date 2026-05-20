import { Component } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { ToastContainer } from '../ui/Toast'

class PageErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('[PageErrorBoundary]', error, info?.componentStack) }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: 240, gap: 12, padding: 24, textAlign: 'center',
        }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Something went wrong</p>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', maxWidth: 360 }}>
            {this.state.error?.message || 'Unknown error'}
          </p>
          <button
            style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export function AppShell({ connected }) {
  const location = useLocation()
  const isChatRoute = location.pathname.startsWith('/chat')

  return (
    // Use dvh (via --vh) so the shell tracks the *visible* viewport as
    // mobile browser chrome and the on-screen keyboard show/hide. Safe-area
    // padding is moved inside each column (sidebar + main) rather than on
    // the outer flex — the outer one would also offset the sidebar's
    // sticky top, breaking flush-to-top alignment on desktop.
    <div style={{ display: 'flex', minHeight: 'var(--vh)', background: 'var(--bg)' }}>
      <Sidebar connected={connected} />

      <main
        className={`flex-1 min-w-0 ${isChatRoute ? 'overflow-hidden' : 'overflow-y-auto scrollbar-thin pb-nav'}`}
        style={{
          background: 'var(--bg)',
          // Safe-area top here, NOT on the outer wrapper, so sidebar can stay
          // flush at viewport top on desktop while mobile main content clears
          // the status bar on iOS PWA (black-translucent) and Android cutouts.
          paddingTop: 'var(--safe-top)',
        }}
      >
        {/* Disconnected banner */}
        {connected === false && (
          <div style={{
            position: 'sticky', top: 0, zIndex: 10,
            background: 'var(--err)', color: '#fff',
            fontSize: 12, fontWeight: 500, textAlign: 'center', padding: '4px 0',
          }}>
            Offline — reconnecting…
          </div>
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0, transition: { duration: 0.15 } }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            style={{ minHeight: '100%' }}
          >
            <PageErrorBoundary key={location.pathname}>
              <Outlet />
            </PageErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </main>

      <BottomNav connected={connected} />
      <ToastContainer />
    </div>
  )
}
