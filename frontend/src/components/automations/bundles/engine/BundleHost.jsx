import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useT } from '../../../../lib/i18n'
import { useBundleCtx } from './context'
import BundleWizard from './BundleWizard'
import BundleEditor from './BundleEditor'
import { RECIPES } from '../recipes'

// ── BundleHost ────────────────────────────────────────────────────────────────
// The one entry point for every OOTB bundle. Resolves the recipe, assembles the
// home context, loads any extra data, derives values (create defaults or the
// reconstruction of an installed bundle), then renders:
//   • create  → BundleWizard (stepped, review = flat editor body)
//   • installed → BundleEditor (flat, live-editable; view IS edit)

export default function BundleHost({ recipeId, initial, automations, hostActions,
  onSaved, onClose, confirmDelete }) {
  const t = useT()
  const recipe = RECIPES[recipeId]
  const ctxBase = useBundleCtx({ automations, hostActions })

  const [extra, setExtra] = useState(null)
  const [ready, setReady] = useState(!recipe?.loadData)
  const [values, setValues] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const ctx = useMemo(() => ({ ...ctxBase, ...(extra || {}) }), [ctxBase, extra])
  const isInstalled = !!initial?._isInstalled

  useEffect(() => {
    let alive = true
    if (recipe?.loadData) {
      recipe.loadData(ctxBase, initial)
        .then((x) => { if (alive) { setExtra(x || {}); setReady(true) } })
        .catch(() => { if (alive) { setExtra({}); setReady(true) } })
    }
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Derive once the data is in. Values are frozen against later store churn —
  // exactly like every legacy wizard's one-shot `derived` useMemo.
  useEffect(() => {
    if (ready && values === null && recipe) {
      setValues({ ...recipe.derive(initial, ctx), _installed: isInstalled })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  // Late-arriving candidates (entities load async) fill unset defaults —
  // the "default the AC once acEnts load" pattern, centralized.
  useEffect(() => {
    if (!values || !recipe?.autoDefaults) return
    const patch = recipe.autoDefaults(values, ctx)
    if (patch && Object.keys(patch).length) setValues((v) => ({ ...v, ...patch }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, ctx.entities, extra])

  if (!recipe) return null
  if (!ready || values === null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 12px' }}>
        <motion.span style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent' }}
          animate={{ rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }} />
      </div>
    )
  }

  const setValue = (key, val) => setValues((v) => ({ ...v, [key]: val }))
  const steps = typeof recipe.steps === 'function' ? recipe.steps(values, ctx) : recipe.steps
  const canSave = !saving && (recipe.canSave ? recipe.canSave(values, ctx) : true)

  const doSave = async () => {
    setSaving(true); setError(null)
    try {
      await recipe.save(values, ctx, initial)
      await onSaved?.({ updated: isInstalled })
    } catch (e) {
      setError(e?.userMessage || e?.message || t(recipe.failedKey || 'automations.failedToSave'))
      setSaving(false)
    }
  }
  const doRemove = async () => {
    const label = recipe.deleteLabel ? recipe.deleteLabel(values, ctx, t) : t(recipe.titleKey)
    if (confirmDelete && !(await confirmDelete(label))) return
    setSaving(true); setError(null)
    try {
      await recipe.remove(ctx, initial, values)
      await onSaved?.({ removed: true })
    } catch (e) {
      setError(e?.userMessage || e?.message || t(recipe.failedKey || 'automations.failedToSave'))
      setSaving(false)
    }
  }

  if (isInstalled) {
    return (
      <BundleEditor
        recipe={recipe} steps={steps} values={values} setValue={setValue} ctx={ctx}
        error={error} saving={saving} canSave={canSave}
        onSave={doSave} onDelete={doRemove} onClose={onClose}
        hideSave={recipe.saveHidden ? recipe.saveHidden(values, ctx, initial) : false}
      />
    )
  }
  return (
    <BundleWizard
      recipe={recipe} steps={steps} values={values} setValue={setValue} ctx={ctx}
      error={error} saving={saving} canSave={canSave}
      onCreate={doSave} onClose={onClose}
    />
  )
}
