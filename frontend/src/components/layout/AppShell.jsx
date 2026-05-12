import { Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Component } from 'react'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { ToastContainer } from '../ui/Toast'

class PageErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, key: 0 }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('[PageErrorBoundary]', error, info?.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-64 gap-3 px-6 text-center">
          <p className="text-3xl">⚠️</p>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Something went wrong</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono break-all">
            {this.state.error?.message || 'Unknown error'}
          </p>
          <button
            className="mt-2 text-xs text-violet-600 underline"
            onClick={() => this.setState({ error: null, key: this.state.key + 1 })}
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

  return (
    <div className="flex h-full min-h-screen">
      <Sidebar connected={connected} />

      <main className="flex-1 min-w-0 overflow-y-auto scrollbar-thin pb-16 md:pb-0">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.18 } }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            className="min-h-full"
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
