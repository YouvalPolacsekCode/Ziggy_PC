import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

export function Modal({ open, onClose, title, children, className, maxWidth = 520, fullScreen = false }) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose?.()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            {!fullScreen && (
              <Dialog.Overlay asChild>
                <motion.div
                  style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(8px)' }}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                />
              </Dialog.Overlay>
            )}

            <Dialog.Content asChild>
              {fullScreen ? (
                <motion.div
                  style={{
                    position: 'fixed', inset: 0, zIndex: 50,
                    display: 'flex', flexDirection: 'column',
                    background: 'var(--bg)',
                    // Full-screen modals must explicitly clear system bars —
                    // the body padding doesn't apply inside the fixed layer.
                    paddingTop: 'var(--safe-top)',
                    paddingBottom: 'var(--safe-bottom)',
                    paddingLeft: 'var(--safe-left)',
                    paddingRight: 'var(--safe-right)',
                    // Use dvh-derived height instead of inset:0 alone, so the
                    // sheet shrinks with the on-screen keyboard.
                    height: 'var(--vh)',
                  }}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  className={className}
                >
                  {/* Full-screen header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '16px 20px', borderBottom: '0.5px solid var(--line)',
                    flexShrink: 0, background: 'var(--surface)',
                  }}>
                    <button onClick={onClose} className="z-icon-btn" style={{ width: 32, height: 32, borderRadius: 10 }} aria-label="Close">
                      <X size={15} />
                    </button>
                    {title && (
                      <Dialog.Title style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ink)', margin: 0 }}>
                        {title}
                      </Dialog.Title>
                    )}
                  </div>
                  <div className="scrollbar-thin" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 20px' }}>
                    {children}
                  </div>
                </motion.div>
              ) : (
                <div style={{
                  position: 'fixed', inset: 0, zIndex: 50,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  // Honor safe-areas so the modal never bumps against system
                  // bars on Android PWA / iOS notch.
                  padding: 'max(16px, var(--safe-top)) max(16px, var(--safe-right)) max(16px, var(--safe-bottom)) max(16px, var(--safe-left))',
                }}>
                  <motion.div
                    style={{
                      width: '100%', maxWidth,
                      // dvh tracks the *visible* viewport so the modal's max
                      // height shrinks with the URL bar and the keyboard,
                      // preventing action buttons from being clipped.
                      maxHeight: '90dvh',
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
                      <button onClick={onClose} className="z-icon-btn" style={{ marginLeft: 'auto', width: 30, height: 30, borderRadius: 8 }} aria-label="Close">
                        <X size={14} />
                      </button>
                    </div>
                    <div className="scrollbar-thin" style={{ padding: '18px 20px 20px', overflowY: 'auto', overflowX: 'visible' }}>
                      {children}
                    </div>
                  </motion.div>
                </div>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}
