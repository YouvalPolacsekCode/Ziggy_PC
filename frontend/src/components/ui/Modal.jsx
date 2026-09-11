import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { T_STATE, T_ENTER } from '../../lib/motion'

// Modal — Title 3 (20px) header, 44px close target, sheet radius, one enter
// curve. `fullScreen` is the phone-sheet form: it fills the viewport and
// clears the system bars itself.
export function Modal({ open, onClose, title, children, className, maxWidth = 520, fullScreen = false }) {
  const t = useT()
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose?.()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            {!fullScreen && (
              <Dialog.Overlay asChild>
                <motion.div
                  style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'var(--backdrop)', backdropFilter: 'blur(8px)' }}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={T_STATE}
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
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 16 }}
                  transition={T_ENTER}
                  className={className}
                >
                  {/* Full-screen header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 16px', borderBottom: '0.5px solid var(--line)',
                    flexShrink: 0, background: 'var(--surface)',
                  }}>
                    <button onClick={onClose} className="z-icon-btn" aria-label={t('common.close')}>
                      <X size={18} />
                    </button>
                    {title && (
                      <Dialog.Title className="z-title3" style={{ margin: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                      borderRadius: 'var(--r-sheet)',
                      boxShadow: 'var(--shadow-lg)',
                    }}
                    initial={{ opacity: 0, scale: 0.98, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98, y: 8 }}
                    transition={T_ENTER}
                    className={className}
                  >
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                      padding: '16px 16px 16px 24px', borderBottom: '0.5px solid var(--line)',
                      flexShrink: 0,
                    }}>
                      {title && (
                        <Dialog.Title className="z-title3" style={{ margin: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {title}
                        </Dialog.Title>
                      )}
                      <button onClick={onClose} className="z-icon-btn" style={{ marginInlineStart: 'auto' }} aria-label={t('common.close')}>
                        <X size={18} />
                      </button>
                    </div>
                    <div className="scrollbar-thin" style={{ padding: '24px', overflowY: 'auto', overflowX: 'visible' }}>
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
