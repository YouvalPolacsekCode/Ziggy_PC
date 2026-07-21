import React, { useState } from 'react'
import { useT } from '../../lib/i18n'

// ── BundleGate ────────────────────────────────────────────────────────────────
// Wraps a bundle wizard so an ALREADY-INSTALLED automation opens read-only, and
// editing is unlocked only by an explicit "Edit" tap — so it's hard to change a
// working automation by accident. Matches how Smart Light Schedule / Smart
// Climate / Smart Room already gate editing behind a view modal. The create flow
// (locked=false) stays immediately editable.
export default function BundleGate({ locked: initialLocked, children }) {
  const t = useT()
  const [locked, setLocked] = useState(!!initialLocked)
  return (
    <div>
      {locked && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 10px 9px 13px', marginBottom: 14, borderRadius: 10, background: 'color-mix(in srgb, var(--info) 8%, transparent)', border: '0.5px solid var(--line)' }}>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }} dir="auto">👁 {t('automations.bundle.viewingHint')}</span>
          <button type="button" onClick={() => setLocked(false)} className="z-btn-primary" style={{ padding: '7px 14px', borderRadius: 9, fontSize: 12.5, flexShrink: 0 }}>✏️ {t('automations.bundle.edit')}</button>
        </div>
      )}
      <div
        style={{ pointerEvents: locked ? 'none' : 'auto', opacity: locked ? 0.5 : 1, transition: 'opacity .15s', userSelect: locked ? 'none' : 'auto' }}
        aria-hidden={locked}
        inert={locked ? '' : undefined}
      >
        {children}
      </div>
    </div>
  )
}
