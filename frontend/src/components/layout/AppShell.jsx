import { useState, useEffect, Component } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { ToastContainer } from '../ui/Toast'
import { getFeaturesSettings } from '../../lib/api'

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
  const [features, setFeatures] = useState({ scenes: false })
  const isChatRoute = location.pathname.startsWith('/chat')

  useEffect(() => {
    getFeaturesSettings().then(setFeatures).catch(() => {})
  }, [])

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <Sidebar connected={connected} features={features} />

      {/* On the chat route, overflow must be hidden so the browser cannot auto-scroll
          main to reveal the focused input — that scroll is what makes the header jump off-screen. */}
      <main
        className={`flex-1 min-w-0 ${isChatRoute ? 'overflow-hidden' : 'overflow-y-auto scrollbar-thin pb-nav'}`}
        style={{ background: 'var(--bg)' }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.15 } }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            style={{ minHeight: '100%' }}
          >
            <PageErrorBoundary key={location.pathname}>
              <Outlet />
            </PageErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </main>

      <BottomNav connected={connected} features={features} />
      <ToastContainer />
    </div>
  )
}
