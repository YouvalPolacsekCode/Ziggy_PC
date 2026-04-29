import { Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { ToastContainer } from '../ui/Toast'
import { cn } from '../../lib/utils'

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
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      <BottomNav connected={connected} />
      <ToastContainer />
    </div>
  )
}
