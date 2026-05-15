import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'

export function Modal({ open, onClose, title, children, className }) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose?.()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                style={{
                  position: 'fixed', inset: 0, zIndex: 40,
                  background: 'rgba(0,0,0,0.35)',
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
                    width: '100%', maxWidth: 520, maxHeight: '90vh',
                    display: 'flex', flexDirection: 'column',
                    background: 'var(--surface)',
                    border: '0.5px solid var(--line)',
                    borderRadius: 18,
                    boxShadow: '0 8px 40px rgba(0,0,0,0.20)',
                  }}
                  initial={{ opacity: 0, scale: 0.97, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 6 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                >
                  {/* Header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '18px 20px 14px', borderBottom: '0.5px solid var(--line)',
                    flexShrink: 0,
                  }}>
                    {title && (
                      <Dialog.Title style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
                        {title}
                      </Dialog.Title>
                    )}
                    <button
                      onClick={onClose}
                      style={{
                        marginLeft: 'auto', padding: 6, borderRadius: 8,
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        color: 'var(--ink-faint)', display: 'flex', alignItems: 'center',
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                  </div>

                  {/* Body */}
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
