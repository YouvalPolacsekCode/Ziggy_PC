import React, { useState } from 'react'
import { Pencil } from 'lucide-react'
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} dir="auto">
      {visibleSteps.map((s) => (
        <div key={s.key}>
          {s.titleKey && (
            <p className="z-eyebrow" style={{ margin: '0 0 12px' }}>
              {t(s.titleKey)}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 2px' }} dir="auto">
      {/* Subtitle + the pencil that unlocks the surface. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <p className="z-subhead" style={{ color: 'var(--ink-2)', margin: 0, flex: 1, minWidth: 0 }} dir="auto">
          {recipe.subtitleKey ? t(recipe.subtitleKey) : ''}
        </p>
        {locked && (
          <button type="button" onClick={() => setEditing(true)}
            title={t('common.edit')} aria-label={t('common.edit')}
            className="z-btn-secondary" style={{ flexShrink: 0 }}>
            <Pencil size={16} strokeWidth={1.75} aria-hidden="true" />
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
          <button type="button" onClick={onClose} className="z-btn-secondary">
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
