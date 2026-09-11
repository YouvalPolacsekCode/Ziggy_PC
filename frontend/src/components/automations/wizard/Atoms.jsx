import React from 'react'
import { useT } from '../../../lib/i18n'

// Small helper: a one-line description below a field that explains what it does.
export function FieldHint({ children }) {
  return (
    <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', lineHeight: 1.5, fontFamily: '"IBM Plex Mono", monospace' }}>
      {children}
    </p>
  )
}

// Small AND chip drawn between consecutive conditions to make the implicit
// "all of these must be true" relationship visible.
export function AndConnector() {
  const t = useT()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
      <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      <span style={{
        fontSize: 9, padding: '2px 8px', borderRadius: 999,
        background: 'var(--surface-2)', color: 'var(--ink-faint)',
        fontFamily: '"IBM Plex Mono", monospace', fontWeight: 700, letterSpacing: '0.08em',
      }}>{t('automations.cond.and')}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
    </div>
  )
}
