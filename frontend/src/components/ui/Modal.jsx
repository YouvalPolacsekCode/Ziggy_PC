import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

export function Modal({ open, onClose, title, children, className, maxWidth = 520 }) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose?.()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                style={{
                  position: 'fixed', inset: 0, zIndex: 40,
                  background: 'rgba(0,0,0,0.40)',
                  backdropFilter: 'blur(8px)',
                }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              />
            </Dialog.Overlay>

            <Dialog.Content asChild>
              <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                <motion.div
                  style={{
                    width: '100%', maxWidth, maxHeight: '90vh',
                    display: 'flex', flexDirection: 'column',
                    background: 'var(--surface)',
                    border: '0.5px solid var(--line)',
                    borderRadius: 18,
                    boxShadow: 'var(--shadow-lg)',
                  }}
                  initial={{ opacity: 0, scale: 0.97, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 6 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className={className}
                >
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '18px 20px 14px', borderBottom: '0.5px solid var(--line)',
                    flexShrink: 0,
                  }}>
                    {title && (
                      <Dialog.Title style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ink)', margin: 0 }}>
                        {title}
                      </Dialog.Title>
                    )}
                    <button
                      onClick={onClose}
                      className="z-icon-btn"
                      style={{ marginLeft: 'auto', width: 30, height: 30, borderRadius: 8 }}
                      aria-label="Close"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="scrollbar-thin" style={{ padding: '18px 20px 20px', overflowY: 'auto', overflowX: 'visible' }}>
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
