import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'

export function Modal({ open, onClose, title, children, className }) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose?.()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              />
            </Dialog.Overlay>

            <Dialog.Content asChild>
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <motion.div
                  className={cn(
                    'w-full max-w-lg max-h-[90vh] flex flex-col',
                    'bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl',
                    'border border-zinc-100 dark:border-zinc-800',
                    className
                  )}
                  initial={{ opacity: 0, scale: 0.96, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                >
                  {/* Fixed header */}
                  <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
                    {title && (
                      <Dialog.Title className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                        {title}
                      </Dialog.Title>
                    )}
                    <button
                      onClick={onClose}
                      className="ml-auto p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {/* Scrollable body — overflow-visible so dropdowns escape */}
                  <div className="px-6 pb-6 overflow-y-auto overflow-x-visible scrollbar-thin">
                    {children}
                  </div>
                </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}
