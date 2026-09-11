import { AnimatePresence, motion } from 'framer-motion'
import { X, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { EASE_ENTER, DUR_ENTER } from '../../lib/motion'

const TYPE_META = {
  success: { dot: 'var(--ok)',   bg: `color-mix(in srgb, var(--ok)   8%, var(--surface))` },
  error:   { dot: 'var(--err)',  bg: `color-mix(in srgb, var(--err)  8%, var(--surface))` },
  warning: { dot: 'var(--warn)', bg: `color-mix(in srgb, var(--warn) 8%, var(--surface))` },
  info:    { dot: 'var(--info)', bg: `color-mix(in srgb, var(--info) 8%, var(--surface))` },
}

// Icon-only buttons inside the toast keep a 44px target even though the
// glyph is 16px — the toast sits over the bottom nav where a mis-tap costs
// a navigation.
const iconBtn = {
  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)',
  width: 44, height: 44, margin: '-12px -8px', padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
}

function Toast({ t, onDismiss }) {
  const [expanded, setExpanded] = useState(false)
  const m = TYPE_META[t.type] || TYPE_META.info
  const hasDetail = !!t.detail

  return (
    <motion.div
      key={t.id}
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0,  scale: 1 }}
      exit={{ opacity: 0, y: -4,   scale: 0.98 }}
      transition={{ duration: DUR_ENTER, ease: EASE_ENTER }}
      style={{
        borderRadius: 'var(--r-card)',
        background: m.bg, border: '0.5px solid var(--line)',
        boxShadow: 'var(--shadow-md)',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.dot, flexShrink: 0 }} />
        <span dir="auto" style={{ flex: 1, fontSize: 15, color: 'var(--ink)', lineHeight: 1.4, unicodeBidi: 'plaintext' }}>{t.message}</span>
        {hasDetail && (
          <button onClick={() => setExpanded(v => !v)} style={iconBtn} aria-expanded={expanded}>
            <ChevronDown size={16} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-state) var(--ease-standard)' }} />
          </button>
        )}
        <button onClick={() => onDismiss(t.id)} style={iconBtn} aria-label="Dismiss">
          <X size={16} />
        </button>
      </div>
      {hasDetail && expanded && (
        <div dir="auto" style={{ paddingBlockStart: 0, paddingBlockEnd: 12, paddingInlineEnd: 16, paddingInlineStart: 36, fontSize: 13, color: 'var(--ink-mute)', lineHeight: 1.5, unicodeBidi: 'plaintext' }}>
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
      // gives a comfortable hover above the bottom edge.
      bottom: 'calc(var(--nav-h) + max(var(--safe-bottom), 8px) + 12px)',
      left: '50%', transform: 'translateX(-50%)',
      zIndex: 60, display: 'flex', flexDirection: 'column', gap: 8,
      width: '100%', maxWidth: 400,
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
