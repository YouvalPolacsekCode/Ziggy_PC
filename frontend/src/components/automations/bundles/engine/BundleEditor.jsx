import React, { useState } from 'react'
import { useT } from '../../../../lib/i18n'
import { FieldList, SummaryList } from './fields'
import { EditorFooter, ErrorBox } from './StepFrame'

// ── BundleEditor ──────────────────────────────────────────────────────────────
// The ONE flat surface for an installed (or reviewed) bundle: every step's
// fields rendered live, grouped under the step titles. Installed bundles open
// LOCKED — a calm read-only view of exactly what's running — and the pencil
// unlocks the same surface for editing (no separate view modal). It's also the
// create flow's final review screen (unlocked, footer swapped for Create).

export function EditorBody({ steps, values, setValue, ctx, isInstalled }) {
  const t = useT()
  const visibleSteps = (steps || []).filter((s) => !s.visibleWhen || s.visibleWhen(values, ctx))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }} dir="auto">
      {visibleSteps.map((s) => (
        <div key={s.key}>
          {s.titleKey && (
            <p className="z-eyebrow" style={{ margin: '0 0 10px' }}>
              {s.icon ? `${s.icon} ` : ''}{t(s.titleKey)}
            </p>
          )}
          <FieldList fields={s.fields} values={values} setValue={setValue} ctx={ctx} isInstalled={isInstalled} />
        </div>
      ))}
    </div>
  )
}

export default function BundleEditor({ recipe, steps, values, setValue, ctx,
  error, saving, canSave, onSave, onDelete, onClose, hideSave, startEditing = false }) {
  const t = useT()
  const [editing, setEditing] = useState(!!startEditing)
  const locked = !editing && !hideSave

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 2px' }} dir="auto">
      {/* Subtitle + the pencil that unlocks the surface. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0, flex: 1, minWidth: 0 }} dir="auto">
          {recipe.subtitleKey ? t(recipe.subtitleKey) : ''}
        </p>
        {locked && (
          <button type="button" onClick={() => setEditing(true)}
            title={t('common.edit')} aria-label={t('common.edit')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, cursor: 'pointer',
              padding: '7px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, fontFamily: 'inherit',
              border: '0.5px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            {t('common.edit')}
          </button>
        )}
      </div>

      {/* Locked = a COMPACT summary: one line per setting, derived from the
          same field definitions — fits without scrolling. The pencil expands
          it into the full editor. */}
      {locked ? (
        <div style={{ pointerEvents: 'none' }} aria-readonly>
          <SummaryList steps={steps} values={values} ctx={ctx} />
        </div>
      ) : (
        <EditorBody steps={steps} values={values} setValue={setValue} ctx={ctx} isInstalled />
      )}

      <ErrorBox error={error} />
      {locked ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} className="z-btn-secondary"
            style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13 }}>
            {t('automations.bundles.close')}
          </button>
        </div>
      ) : (
        <EditorFooter
          onDelete={onDelete}
          onCancel={onClose}
          onSave={onSave}
          hideSave={hideSave}
          saveLabel={t('automations.bundles.update')}
          saveDisabled={!canSave || saving}
        />
      )}
    </div>
  )
}
