import React from 'react'
import { useT } from '../../../../lib/i18n'
import { FieldList } from './fields'
import { EditorFooter, ErrorBox } from './StepFrame'

// ── BundleEditor ──────────────────────────────────────────────────────────────
// The ONE flat surface for an installed (or reviewed) bundle: every step's
// fields rendered live-editable, grouped under the step titles. It is both the
// create flow's final review screen (footer swapped for Create) and the screen
// an installed bundle opens straight into — view IS edit.

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
  error, saving, canSave, onSave, onDelete, onClose, hideSave }) {
  const t = useT()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 2px' }} dir="auto">
      {recipe.subtitleKey && (
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }} dir="auto">
          {t(recipe.subtitleKey)}
        </p>
      )}
      <EditorBody steps={steps} values={values} setValue={setValue} ctx={ctx} isInstalled />
      <ErrorBox error={error} />
      <EditorFooter
        onDelete={onDelete}
        onCancel={onClose}
        onSave={onSave}
        hideSave={hideSave}
        saveLabel={t('automations.bundles.update')}
        saveDisabled={!canSave || saving}
      />
    </div>
  )
}
