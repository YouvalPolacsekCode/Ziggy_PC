import React from 'react'
import { useT } from '../../../../lib/i18n'

// ── StepFrame ─────────────────────────────────────────────────────────────────
// The one step shell every wizard (bundles AND the custom builder) renders in:
// header row (eyebrow title + clickable step dots + n/N counter), body,
// then the Back / primary nav row. This is the "same language" — nothing else
// draws its own step chrome.

// Each dot is a 44px-tall target (the visible pill is 7px); the row of dots
// stays compact because the buttons overlap horizontally only by their gap.
export function StepDots({ count, current, maxReached, onJump }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }} role="group">
      {Array.from({ length: count }, (_, i) => {
        const isCurrent = i === current
        const isDone = i < current
        const enabled = onJump && i <= maxReached
        return (
          <button key={i} type="button" onClick={() => enabled && onJump(i)} disabled={!enabled}
            aria-label={`${i + 1}/${count}`} aria-current={isCurrent ? 'step' : undefined}
            style={{ height: 44, padding: '0 2px', background: 'none', border: 'none',
              display: 'flex', alignItems: 'center', cursor: enabled ? 'pointer' : 'default' }}>
            <span aria-hidden="true" style={{ display: 'block', width: isCurrent ? 18 : 7, height: 7, borderRadius: 999,
              transition: 'width var(--dur-state) var(--ease-standard), background var(--dur-state) var(--ease-standard)',
              background: isCurrent ? 'var(--ink)' : isDone ? 'var(--ink-mute)' : 'var(--line-2)' }} />
          </button>
        )
      })}
    </div>
  )
}

export function StepFrame({ title, step, total, maxReached, onJump, onBack, backLabel,
  onPrimary, primaryLabel, primaryDisabled, children, hideFooter = false }) {
  const t = useT()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 2px' }} dir="auto">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <p className="z-eyebrow" style={{ margin: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</p>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <StepDots count={total} current={step} maxReached={maxReached} onJump={onJump} />
          <span className="z-footnote z-mono" style={{ color: 'var(--ink-faint)' }}>
            {step + 1}/{total}
          </span>
        </span>
      </div>
      {children}
      {/* hideFooter: an embedded sub-flow (e.g. the presence-sensor creator
          inside Smart Room) owns its own Back/Next, so the outer nav is
          suppressed to avoid two competing button rows. */}
      {!hideFooter && (
        <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
          <button type="button" onClick={onBack} className="z-btn-secondary" style={{ flex: 1 }}>
            {backLabel || t('automations.bundles.back')}
          </button>
          <button type="button" onClick={onPrimary} disabled={primaryDisabled} className="z-btn-primary"
            style={{ flex: 1, opacity: primaryDisabled ? 0.5 : 1 }}>
            {primaryLabel || t('automations.bundles.next')}
          </button>
        </div>
      )}
    </div>
  )
}

// Shared footer for the flat editor: Delete on the start side, Cancel + Save on
// the end side. Same buttons, same order, everywhere. Delete is the --err
// family (a secondary button in err-text), never the brand accent.
export function EditorFooter({ onDelete, onCancel, onSave, saveLabel, saveDisabled, deleteLabel, hideSave }) {
  const t = useT()
  return (
    <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
      <div>
        {onDelete && (
          <button type="button" onClick={onDelete} className="z-btn-secondary" style={{ color: 'var(--err-text)' }}>
            {deleteLabel || t('automations.bundles.delete')}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={onCancel} className="z-btn-secondary">
          {hideSave ? t('automations.bundles.close') : t('common.cancel')}
        </button>
        {!hideSave && (
          <button type="button" onClick={onSave} disabled={saveDisabled} className="z-btn-primary"
            style={{ opacity: saveDisabled ? 0.5 : 1 }}>
            {saveLabel}
          </button>
        )}
      </div>
    </div>
  )
}

export function ErrorBox({ error }) {
  if (!error) return null
  return (
    <p className="z-subhead" role="alert" style={{ color: 'var(--err-text)', padding: '12px 16px', borderRadius: 'var(--r-ctl)', margin: 0,
      background: 'color-mix(in srgb, var(--err) 8%, var(--surface))', border: '0.5px solid color-mix(in srgb, var(--err) 30%, var(--line))' }} dir="auto">{error}</p>
  )
}

// One spinner for the whole bundle engine: 1s linear, ink on line.
export function Spinner({ size = 24 }) {
  return (
    <span className="z-spin" role="status" aria-live="polite" style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%',
      border: '2px solid var(--line-2)', borderTopColor: 'var(--ink)', flexShrink: 0 }} />
  )
}
