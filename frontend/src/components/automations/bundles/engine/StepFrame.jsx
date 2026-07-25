import React from 'react'
import { useT } from '../../../../lib/i18n'

// ── StepFrame ─────────────────────────────────────────────────────────────────
// The one step shell every wizard (bundles AND the custom builder) renders in:
// header row (eyebrow title + clickable step dots + n/N mono counter), body,
// then the Back / primary nav row. This is the "same language" — nothing else
// draws its own step chrome.

export function StepDots({ count, current, maxReached, onJump }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      {Array.from({ length: count }, (_, i) => {
        const isCurrent = i === current
        const isDone = i < current
        const enabled = onJump && i <= maxReached
        return (
          <button key={i} type="button" onClick={() => enabled && onJump(i)} disabled={!enabled}
            aria-label={`${i + 1}/${count}`}
            style={{ width: isCurrent ? 18 : 7, height: 7, borderRadius: 999, padding: 0,
              border: 'none', cursor: enabled ? 'pointer' : 'default', transition: 'width 0.15s',
              background: isCurrent ? 'var(--ink)' : isDone ? 'var(--ink-mute)' : 'var(--line)' }} />
        )
      })}
    </div>
  )
}

export function StepFrame({ title, step, total, maxReached, onJump, onBack, backLabel,
  onPrimary, primaryLabel, primaryDisabled, children }) {
  const t = useT()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 2px' }} dir="auto">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <p className="z-eyebrow" style={{ margin: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</p>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <StepDots count={total} current={step} maxReached={maxReached} onJump={onJump} />
          <span style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
            {step + 1}/{total}
          </span>
        </span>
      </div>
      {children}
      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
        <button type="button" onClick={onBack} className="z-btn-secondary"
          style={{ flex: 1, padding: '10px', borderRadius: 10, fontSize: 13 }}>
          {backLabel || t('automations.bundles.back')}
        </button>
        <button type="button" onClick={onPrimary} disabled={primaryDisabled} className="z-btn-primary"
          style={{ flex: 1, padding: '10px', borderRadius: 10, fontSize: 13, opacity: primaryDisabled ? 0.5 : 1 }}>
          {primaryLabel || t('automations.bundles.next')}
        </button>
      </div>
    </div>
  )
}

// Shared footer for the flat editor: Delete on the start side, Cancel + Save on
// the end side. Same buttons, same order, everywhere.
export function EditorFooter({ onDelete, onCancel, onSave, saveLabel, saveDisabled, deleteLabel, hideSave }) {
  const t = useT()
  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        {onDelete && (
          <button type="button" onClick={onDelete} className="z-btn-secondary"
            style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, color: 'var(--accent)' }}>
            {deleteLabel || t('automations.bundles.delete')}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={onCancel} className="z-btn-secondary"
          style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13 }}>
          {hideSave ? t('automations.bundles.close') : t('common.cancel')}
        </button>
        {!hideSave && (
          <button type="button" onClick={onSave} disabled={saveDisabled} className="z-btn-primary"
            style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, opacity: saveDisabled ? 0.5 : 1 }}>
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
    <p style={{ fontSize: 12, color: 'var(--accent)', padding: '8px 10px', borderRadius: 8, margin: 0,
      background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }} dir="auto">{error}</p>
  )
}
