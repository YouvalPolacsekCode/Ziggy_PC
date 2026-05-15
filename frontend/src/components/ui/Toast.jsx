import { AnimatePresence, motion } from 'framer-motion'
import { useUIStore } from '../../stores/uiStore'

const TYPE_META = {
  success: { dot: 'var(--ok)',     bg: `color-mix(in srgb, var(--ok)     8%, var(--surface))` },
  error:   { dot: 'var(--accent)', bg: `color-mix(in srgb, var(--accent) 8%, var(--surface))` },
  info:    { dot: 'var(--info)',   bg: `color-mix(in srgb, var(--info)   8%, var(--surface))` },
}

export function ToastContainer() {
  const { toasts, removeToast } = useUIStore()

  return (
    <div style={{
      position: 'fixed', bottom: 96, left: '50%', transform: 'translateX(-50%)',
      zIndex: 50, display: 'flex', flexDirection: 'column', gap: 6,
      width: '100%', maxWidth: 360, padding: '0 16px',
    }}>
      <AnimatePresence>
        {toasts.map(t => {
          const m = TYPE_META[t.type] || TYPE_META.info
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0,  scale: 1 }}
              exit={{ opacity: 0, y: -6,   scale: 0.97 }}
              transition={{ duration: 0.18 }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', borderRadius: 12,
                background: m.bg, border: '0.5px solid var(--line)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.dot, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13, color: 'var(--ink)' }}>{t.message}</span>
              <button
                onClick={() => removeToast(t.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 2 }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
