import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react'
import { useUIStore } from '../../stores/uiStore'
import { cn } from '../../lib/utils'

const icons = {
  success: <CheckCircle size={16} className="text-emerald-500" />,
  error: <AlertCircle size={16} className="text-red-500" />,
  info: <Info size={16} className="text-blue-500" />,
}

export function ToastContainer() {
  const { toasts, removeToast } = useUIStore()

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-full max-w-sm px-4">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg',
              'bg-white dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700',
              'text-sm text-zinc-800 dark:text-zinc-200'
            )}
          >
            {icons[t.type] || icons.info}
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => removeToast(t.id)}
              className="p-0.5 text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
