import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useT } from '../../../../lib/i18n'
import { FieldList } from './fields'
import { EditorBody } from './BundleEditor'
import { StepFrame, ErrorBox } from './StepFrame'

// ── BundleWizard ──────────────────────────────────────────────────────────────
// Stepped CREATE flow: one recipe step per screen, then a final review step
// that is literally the flat editor's body — so what you review is exactly the
// surface you'll come back to later. Back on step 0 closes (or hands back to a
// recipe-level pre-phase, e.g. Smart Room's room pick).

export default function BundleWizard({ recipe, steps, values, setValue, ctx,
  error, saving, canSave, onCreate, onClose }) {
  const t = useT()
  const [idx, setIdx] = useState(0)
  const [maxReached, setMaxReached] = useState(0)
  useEffect(() => { if (idx > maxReached) setMaxReached(idx) }, [idx, maxReached])

  const visibleSteps = (steps || []).filter((s) => !s.visibleWhen || s.visibleWhen(values, ctx))
  const total = visibleSteps.length + 1              // + review
  const isReview = idx >= visibleSteps.length
  const step = visibleSteps[Math.min(idx, visibleSteps.length - 1)]

  const stepOk = isReview ? canSave : (step?.validate ? step.validate(values, ctx) : true)
  const back = () => (idx === 0 ? onClose?.() : setIdx((i) => i - 1))
  const next = () => setIdx((i) => Math.min(i + 1, visibleSteps.length))

  // A step can own its own navigation (an embedded sub-flow like the
  // presence-sensor creator). While it does, hide the outer footer so there's
  // one clear set of buttons, and let it drive the outer "back" via a
  // monotonic _navBack signal (canceling the forced sub-flow steps us back).
  const navHidden = !isReview && !!step?.hideNav?.(values, ctx)
  const navBackSignal = values._navBack || 0
  useEffect(() => {
    if (navBackSignal) { setValue('_navBack', 0); back() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navBackSignal])

  const title = isReview
    ? t('automations.bundles.review')
    : `${step?.icon ? `${step.icon} ` : ''}${step?.titleKey ? t(step.titleKey) : ''}`

  return (
    <StepFrame
      title={title}
      step={Math.min(idx, total - 1)} total={total} maxReached={maxReached}
      onJump={(i) => setIdx(i)}
      onBack={back}
      backLabel={idx === 0 ? t('common.cancel') : t('automations.bundles.back')}
      onPrimary={isReview ? onCreate : next}
      primaryLabel={isReview ? t('automations.bundles.create') : t('automations.bundles.next')}
      primaryDisabled={!stepOk || (isReview && saving)}
      hideFooter={navHidden}
    >
      {idx === 0 && recipe.subtitleKey && !isReview && (
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }} dir="auto">
          {t(recipe.subtitleKey)}
        </p>
      )}
      <AnimatePresence mode="wait">
        <motion.div key={isReview ? '__review__' : step?.key}
          initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}
          transition={{ duration: 0.15 }}>
          {isReview
            ? <EditorBody steps={visibleSteps} values={values} setValue={setValue} ctx={ctx} />
            : <FieldList fields={step?.fields} values={values} setValue={setValue} ctx={ctx} />}
        </motion.div>
      </AnimatePresence>
      <ErrorBox error={error} />
    </StepFrame>
  )
}
