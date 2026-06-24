import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useT, useLang } from '../../../lib/i18n'
import { listBlueprints, instantiateBlueprint } from '../../../lib/api'

// ── BlueprintsModal ──────────────────────────────────────────────────────────
//
// Renders Ziggy's community templates (bundled HA blueprints, plus any
// user-imported ones). The user picks a template, fills its inputs, and
// taps Configure — we POST /api/blueprints/:id/instantiate which routes
// through the same save_automation pipeline as every other automation.
//
// Wording note: this UI NEVER uses the word "blueprint". HA jargon stays
// invisible per the project's surface-area rule (CLAUDE.md). We call them
// "templates" or "community templates" only.
function BlueprintsModal({ open, onClose, onCreated }) {
  const t           = useT()
  const lang        = useLang()              // 'en' | 'he'
  const isHe        = lang === 'he'
  const [templates, setTemplates] = useState([])
  const [loading,   setLoading]   = useState(false)
  const [selected,  setSelected]  = useState(null)   // chosen template dict
  const [inputs,    setInputs]    = useState({})     // user-filled input values
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')
  const [search,    setSearch]    = useState('')
  const [category,  setCategory]  = useState('all')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    listBlueprints()
      .then(r => setTemplates(r.templates || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open])

  // Reset selection when the modal closes/opens.
  useEffect(() => {
    if (!open) {
      setSelected(null)
      setInputs({})
      setError('')
      setSearch('')
      setCategory('all')
    }
  }, [open])

  // Seed inputs with defaults the moment the user picks a template — that
  // way Israeli defaults (24°C AC, 90s motion timeout, 22:00 bedtime) show
  // up pre-populated in the form rather than as empty placeholders.
  useEffect(() => {
    if (!selected) return
    const seeded = {}
    for (const i of selected.inputs || []) {
      if (i.default !== null && i.default !== undefined) seeded[i.key] = i.default
    }
    setInputs(seeded)
    setError('')
  }, [selected])

  const categories = useMemo(() => {
    const set = new Set(templates.map(t => t.category || 'blueprint'))
    return ['all', ...Array.from(set)]
  }, [templates])

  const filtered = useMemo(() => templates.filter(t => {
    const name = (isHe && t.name_he) ? t.name_he : t.name
    const desc = (isHe && t.description_he) ? t.description_he : t.description
    return (category === 'all' || (t.category || 'blueprint') === category)
      && (search === '' || name.toLowerCase().includes(search.toLowerCase()) || (desc || '').toLowerCase().includes(search.toLowerCase()))
  }), [templates, search, category, isHe])

  const handleSave = async () => {
    if (!selected) return
    setSaving(true)
    setError('')
    try {
      const result = await instantiateBlueprint(selected.blueprint_id, inputs)
      if (typeof onCreated === 'function') onCreated(result)
      onClose()
    } catch (e) {
      // FastAPI HTTPException(400, detail=str) wraps detail in `detail` —
      // axios-style clients surface as `response.data.detail`. Some helpers
      // surface as just `e.message`. Handle both.
      const detail = e?.response?.data?.detail || e?.message || t('automations.blueprintSaveFailed')
      setError(String(detail))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <motion.div
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', damping: 24, stiffness: 260 }}
        style={{
          width: '100%', maxWidth: 720,
          maxHeight: '88vh', borderRadius: '18px 18px 0 0',
          background: 'var(--bg)', display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '18px 20px 12px', borderBottom: '0.5px solid var(--line)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <p className="z-eyebrow" style={{ marginBottom: 2 }}>{t('automations.communityEyebrow')}</p>
              <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }} dir="auto">
                {selected ? ((isHe && selected.name_he) ? selected.name_he : selected.name) : t('automations.communityTitle')}
              </h2>
            </div>
            <button onClick={() => selected ? setSelected(null) : onClose()} aria-label={t('common.close')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: 'var(--ink-mute)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {selected
                  ? <path d="M19 12H5M12 19l-7-7 7-7"/>
                  : <path d="M18 6L6 18M6 6l12 12"/>}
              </svg>
            </button>
          </div>

          {!selected && (
            <>
              <input
                type="text"
                placeholder={t('automations.libraryRunSearch')}
                value={search}
                onChange={e => setSearch(e.target.value)}
                dir="auto"
                style={{
                  width: '100%', height: 36, padding: '0 12px', borderRadius: 9,
                  background: 'var(--surface)', border: '0.5px solid var(--line)',
                  color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 10, overflowX: 'auto', paddingBottom: 2 }}>
                {categories.map(cat => (
                  <button key={cat} onClick={() => setCategory(cat)} style={{
                    padding: '4px 12px', borderRadius: 999, fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
                    background: category === cat ? 'var(--ink)' : 'var(--surface)',
                    color: category === cat ? 'var(--bg)' : 'var(--ink-mute)',
                    border: category === cat ? 'none' : '0.5px solid var(--line)',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    {cat === 'all' ? t('automations.libraryAll') : cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px' }}>
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1,2,3].map(i => <div key={i} style={{ height: 80, borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.5 }} />)}
            </div>
          )}

          {/* List view */}
          {!loading && !selected && (
            <>
              {filtered.length === 0 && (
                <p style={{ textAlign: 'center', padding: '32px 0', fontSize: 13, color: 'var(--ink-faint)' }}>
                  {t('automations.libraryNoMatch')}
                </p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {filtered.map(tpl => {
                  const name  = (isHe && tpl.name_he) ? tpl.name_he : tpl.name
                  const desc  = (isHe && tpl.description_he) ? tpl.description_he : (tpl.description || '').split('\n')[0]
                  return (
                    <button key={tpl.id} onClick={() => setSelected(tpl)} style={{
                      textAlign: isHe ? 'right' : 'left', cursor: 'pointer', fontFamily: 'inherit',
                      padding: '14px 16px', borderRadius: 12,
                      background: 'var(--surface)', border: '0.5px solid var(--line)',
                      display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%',
                    }} dir="auto">
                      <div style={{
                        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'var(--bg-2)', fontSize: 18,
                      }}>{tpl.icon || '🧩'}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14, letterSpacing: '-0.01em', marginBottom: 3 }} dir="auto">{name}</p>
                        {desc && (
                          <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0, lineHeight: 1.4 }} dir="auto">{desc}</p>
                        )}
                        <p style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 4, fontFamily: '"IBM Plex Mono", monospace' }}>
                          {t('automations.communityInputCount', { n: (tpl.inputs || []).length })}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {/* Detail view: input form */}
          {!loading && selected && (
            <AnimatePresence initial={false}>
              <motion.div
                key={selected.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.15 }}
              >
                <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: '0 0 16px', lineHeight: 1.45 }} dir="auto">
                  {(isHe && selected.description_he) ? selected.description_he : selected.description}
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {(selected.inputs || []).map(inp => (
                    <BlueprintInputField
                      key={inp.key}
                      input={inp}
                      value={inputs[inp.key] ?? ''}
                      isHe={isHe}
                      onChange={(v) => setInputs(prev => ({ ...prev, [inp.key]: v }))}
                    />
                  ))}
                </div>

                {error && (
                  <p style={{ color: 'var(--err, #d33)', fontSize: 12, marginTop: 12 }} dir="auto">
                    {error}
                  </p>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
                  <button onClick={() => setSelected(null)} className="z-btn-secondary" disabled={saving} style={{ fontSize: 13, padding: '8px 14px', borderRadius: 10 }}>
                    {t('common.back')}
                  </button>
                  <button onClick={handleSave} className="z-btn-primary" disabled={saving} style={{ fontSize: 13, padding: '8px 14px', borderRadius: 10 }}>
                    {saving ? t('common.saving') : t('automations.template.configure')}
                  </button>
                </div>
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// One row in the configure form. The selector kind drives the input type;
// unknown kinds fall back to a free-text input.
function BlueprintInputField({ input, value, onChange, isHe }) {
  const label    = (isHe && input.name_he) ? input.name_he : input.name
  const help     = input.description
  const kind     = input.selector_kind
  const sel      = input.selector_meta || {}
  const required = input.required

  const commonInputStyle = {
    width: '100%', height: 36, padding: '0 12px', borderRadius: 9,
    background: 'var(--surface)', border: '0.5px solid var(--line)',
    color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  }

  let control
  if (kind === 'number') {
    control = (
      <input
        type="number"
        min={sel.min}
        max={sel.max}
        step={sel.step ?? 1}
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
        style={commonInputStyle}
      />
    )
  } else if (kind === 'time') {
    // HA `time` selector wants HH:MM:SS but <input type="time"> emits HH:MM.
    const display = typeof value === 'string' ? value.slice(0, 5) : (value || '')
    control = (
      <input
        type="time"
        value={display}
        onChange={e => onChange(e.target.value ? `${e.target.value}:00` : '')}
        style={commonInputStyle}
      />
    )
  } else if (kind === 'boolean') {
    control = (
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)', cursor: 'pointer' }}>
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
        {label}
      </label>
    )
  } else if (kind === 'select' && Array.isArray(sel.options)) {
    control = (
      <select value={value ?? ''} onChange={e => onChange(e.target.value)} style={commonInputStyle}>
        <option value="">—</option>
        {sel.options.map(opt => {
          const v = typeof opt === 'object' ? opt.value : opt
          const l = typeof opt === 'object' ? opt.label : opt
          return <option key={v} value={v}>{l}</option>
        })}
      </select>
    )
  } else {
    // entity selector + text selector + unknown → text input. For entity
    // selectors we annotate placeholder with the expected domain(s) so the
    // user can paste the right entity id; a future iteration can wire this
    // to the existing entity picker component.
    const placeholder = kind === 'entity'
      ? (sel.domain
          ? (Array.isArray(sel.domain) ? sel.domain.join(', ') + '.…' : `${sel.domain}.…`)
          : 'entity_id')
      : ''
    control = (
      <input
        type="text"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        dir="ltr"
        style={commonInputStyle}
      />
    )
  }

  if (kind === 'boolean') {
    // Boolean rows render the label inline with the checkbox, so the header
    // row would duplicate it.
    return (
      <div>
        {control}
        {help && (
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', margin: '4px 0 0 22px', lineHeight: 1.35 }} dir="auto">{help}</p>
        )}
      </div>
    )
  }

  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }} dir="auto">
        {label}{required ? <span style={{ color: 'var(--warn)', marginLeft: 4 }}>*</span> : null}
      </label>
      {control}
      {help && (
        <p style={{ fontSize: 11, color: 'var(--ink-faint)', margin: '4px 0 0', lineHeight: 1.35 }} dir="auto">{help}</p>
      )}
    </div>
  )
}

export default BlueprintsModal
