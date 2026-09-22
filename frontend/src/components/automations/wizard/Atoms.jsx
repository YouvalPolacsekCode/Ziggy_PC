import React from 'react'
import { useT } from '../../../lib/i18n'

// Small helper: a one-line description below a field that explains what it does.
// Subhead role — a hint is a secondary line the person reads, not metadata.
export function FieldHint({ children }) {
  return (
    <p className="z-subhead" style={{ margin: 0 }} dir="auto">
      {children}
    </p>
  )
}

// Small AND chip drawn between consecutive conditions to make the implicit
// "all of these must be true" relationship visible.
export function AndConnector() {
  const t = useT()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }} aria-hidden="true">
      <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      <span className="z-chip" style={{ letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>{t('automations.cond.and')}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
    </div>
  )
}

/** The same rule, when the list is "any of these" rather than "all of these". */
export function OrConnector() {
  const t = useT()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }} aria-hidden="true">
      <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      <span className="z-chip" style={{ letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>{t('automations.cond.or')}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
    </div>
  )
}
