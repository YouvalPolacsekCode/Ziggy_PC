import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { T_STATE, T_ENTER } from '../../lib/motion'
import { isMotionOn } from '../../motion/flag'
import { SheetSurface, useWideFrame } from '../../motion/SheetSurface'

// Modal — Title 3 (20px) header, 44px close target, sheet radius, one enter
// curve. `fullScreen` is the phone-sheet form: it fills the viewport and
// clears the system bars itself.
//
// `sheet` is the one opt-in: a caller whose dialog is really "a thing that
// comes up from the bottom of a phone" (the Actions create chooser, the
// Library) can ask for the app's sheet surface instead of a centred dialog.
// It is a narrow-screen, motion-on presentation only — on a wide screen, and
// with `data-motion="off"`, a `sheet` modal renders as the identical centred
// dialog it always did.
//
// The split is a component boundary on purpose: a call site that does not pass
// `sheet` reaches BaseModal directly, with the same hooks in the same order and
// not one line of new work. Nothing about the other 40 call sites changes.
export function Modal(props) {
  if (props.sheet && !props.fullScreen && isMotionOn()) return <SheetModal {...props} />
  return <BaseModal {...props} />
}

// Peek at 60% of the viewport, or the content's own height when that is
// smaller — a short chooser sizes itself, a long list gets a drag to the top.
const SHEET_DETENTS = [0.6, 1]
const SHEET_ELASTIC = { top: 0.12, bottom: 1 }
const SHEET_CLASSES = { panel: 'z-msheet', head: 'z-msheet-head', body: 'z-msheet-body scrollbar-thin' }

function SheetModal({ open, onClose, title, children, sheet: _sheet, ...rest }) {
  const wide = useWideFrame()
  // The docked 320px panel is too narrow for a 520–620px chooser, so the wide
  // frame stays the dialog this has always been.
  if (wide) return <BaseModal open={open} onClose={onClose} title={title} {...rest}>{children}</BaseModal>
  return (
    <SheetSurface
      open={open}
      onClose={onClose}
      title={title}
      detents={SHEET_DETENTS}
      dragElastic={SHEET_ELASTIC}
      bodyDrag
      closeButton
      restoreFocus
      classNames={SHEET_CLASSES}
    >
      {children}
    </SheetSurface>
  )
}

function BaseModal({ open, onClose, title, children, className, maxWidth = 520, fullScreen = false }) {
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
