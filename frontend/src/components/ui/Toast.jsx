import { AnimatePresence, motion } from 'framer-motion'
import { X, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useUIStore } from '../../stores/uiStore'

const TYPE_META = {
  success: { dot: 'var(--ok)',   bg: `color-mix(in srgb, var(--ok)   8%, var(--surface))` },
  error:   { dot: 'var(--err)',  bg: `color-mix(in srgb, var(--err)  8%, var(--surface))` },
  warning: { dot: 'var(--warn)', bg: `color-mix(in srgb, var(--warn) 8%, var(--surface))` },
  info:    { dot: 'var(--info)', bg: `color-mix(in srgb, var(--info) 8%, var(--surface))` },
}

function Toast({ t, onDismiss }) {
  const [expanded, setExpanded] = useState(false)
  const m = TYPE_META[t.type] || TYPE_META.info
  const hasDetail = !!t.detail

  return (
    <motion.div
      key={t.id}
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0,  scale: 1 }}
      exit={{ opacity: 0, y: -6,   scale: 0.97 }}
      transition={{ duration: 0.18 }}
      style={{
        borderRadius: 12,
        background: m.bg, border: '0.5px solid var(--line)',
        boxShadow: 'var(--shadow-md)',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.dot, flexShrink: 0 }} />
        <span dir="auto" style={{ flex: 1, fontSize: 13, color: 'var(--ink)', lineHeight: 1.4, unicodeBidi: 'plaintext' }}>{t.message}</span>
        {hasDetail && (
          <button
            onClick={() => setExpanded(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 2, display: 'flex', alignItems: 'center' }}
          >
            <ChevronDown size={12} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
          </button>
        )}
        <button
          onClick={() => onDismiss(t.id)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 2, display: 'flex', alignItems: 'center' }}
        >
          <X size={12} />
        </button>
      </div>
      {hasDetail && expanded && (
        <div dir="auto" style={{ paddingBlockStart: 0, paddingBlockEnd: 10, paddingInlineEnd: 14, paddingInlineStart: 30, fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.5, unicodeBidi: 'plaintext' }}>
          {t.detail}
        </div>
      )}
    </motion.div>
  )
}

export function ToastContainer() {
  const { toasts, removeToast } = useUIStore()

  return (
    <div style={{
      position: 'fixed',
      // Sit above the bottom nav + safe-area on mobile.
      // On desktop (md+), no bottom nav — but anchoring to nav-h + safe still
      // gives a comfortable 60-68px hover above the bottom edge.
      bottom: 'calc(var(--nav-h) + max(var(--safe-bottom), 8px) + 12px)',
      left: '50%', transform: 'translateX(-50%)',
      zIndex: 60, display: 'flex', flexDirection: 'column', gap: 6,
      width: '100%', maxWidth: 360,
      paddingLeft: 'max(16px, var(--safe-left))',
      paddingRight: 'max(16px, var(--safe-right))',
      pointerEvents: 'none',
    }}>
      <AnimatePresence>
        {toasts.map(t => (
          <div key={t.id} style={{ pointerEvents: 'auto' }}>
            <Toast t={t} onDismiss={removeToast} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  )
}
