import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ArrowLeft, Puzzle } from 'lucide-react'
import { useT, useLang } from '../../../lib/i18n'
import { listBlueprints, instantiateBlueprint } from '../../../lib/api'
import { SPRING_SHEET, T_ENTER } from '../../../lib/motion'
import { chipStyle, fieldLabelStyle } from '../../../lib/automations/styles'
import { Toggle } from '../../ui/Toggle'

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
function BlueprintsModal({ open, onClose, onCreated, initialBlueprintId = null }) {
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
      .then(r => {
        const list = r.templates || []
        setTemplates(list)
        // Deep-link from the Templates tab: jump straight to one template's
        // input form instead of the browse list.
        if (initialBlueprintId) {
          const hit = list.find(tpl => tpl.blueprint_id === initialBlueprintId || tpl.id === initialBlueprintId)
          if (hit) setSelected(hit)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open, initialBlueprintId])

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
      background: 'var(--backdrop)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <motion.div
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={SPRING_SHEET}
        style={{
          width: '100%', maxWidth: 'var(--page-max-w-narrow)',
          maxHeight: '88vh', borderRadius: 'var(--r-sheet) var(--r-sheet) 0 0',
          background: 'var(--bg)', display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', borderBottom: '0.5px solid var(--line)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: selected ? 0 : 12 }}>
            <div style={{ minWidth: 0 }}>
              <p className="z-eyebrow" style={{ marginBottom: 2 }}>{t('automations.communityEyebrow')}</p>
              <h2 className="z-title3" style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">
                {selected ? ((isHe && selected.name_he) ? selected.name_he : selected.name) : t('automations.communityTitle')}
              </h2>
            </div>
            <button onClick={() => selected ? setSelected(null) : onClose()} aria-label={selected ? t('common.back') : t('common.close')} className="z-icon-btn">
              {selected
                ? <ArrowLeft size={18} strokeWidth={1.75} style={{ transform: isHe ? 'scaleX(-1)' : 'none' }} />
                : <X size={18} strokeWidth={1.75} />}
            </button>
          </div>

          {!selected && (
            <>
              <input
                type="text"
                className="z-input"
                placeholder={t('automations.libraryRunSearch')}
                value={search}
                onChange={e => setSearch(e.target.value)}
                dir="auto"
                style={{ boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 12, overflowX: 'auto', paddingBottom: 2 }}>
                {categories.map(cat => (
                  <button key={cat} onClick={() => setCategory(cat)} aria-pressed={category === cat} style={chipStyle(category === cat)}>
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
              {[1,2,3].map(i => <div key={i} style={{ height: 80, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.5 }} />)}
            </div>
          )}

          {/* List view */}
          {!loading && !selected && (
            <>
              {filtered.length === 0 && (
                <p className="z-subhead" style={{ textAlign: 'center', padding: '32px 0' }}>
                  {t('automations.libraryNoMatch')}
                </p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filtered.map(tpl => {
                  const name  = (isHe && tpl.name_he) ? tpl.name_he : tpl.name
                  const desc  = (isHe && tpl.description_he) ? tpl.description_he : (tpl.description || '').split('\n')[0]
                  return (
                    <button key={tpl.id} onClick={() => setSelected(tpl)} style={{
                      textAlign: 'start', cursor: 'pointer', fontFamily: 'inherit',
                      minHeight: 56, padding: 12, borderRadius: 'var(--r-card)',
                      background: 'var(--surface)', border: '0.5px solid var(--line)', color: 'var(--ink)',
                      display: 'flex', alignItems: 'flex-start', gap: 16, width: '100%',
                      transition: 'background var(--dur-press) var(--ease-standard)',
                    }} dir="auto">
                      <div aria-hidden="true" style={{
                        width: 40, height: 40, borderRadius: 'var(--r-ctl)', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'var(--surface-2)', color: 'var(--ink-2)', fontSize: 20, lineHeight: 1,
                      }}>{tpl.icon || <Puzzle size={22} strokeWidth={1.75} />}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p className="z-headline" style={{ margin: '0 0 2px' }} dir="auto">{name}</p>
                        {desc && (
                          <p className="z-subhead" style={{ margin: 0 }} dir="auto">{desc}</p>
                        )}
                        <p className="z-footnote z-mono" style={{ margin: '4px 0 0', color: 'var(--ink-faint)' }}>
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
                transition={T_ENTER}
              >
                <p className="z-subhead" style={{ margin: '0 0 16px' }} dir="auto">
                  {(isHe && selected.description_he) ? selected.description_he : selected.description}
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
                  <p className="z-subhead" style={{ color: 'var(--err-text)', marginTop: 12 }} dir="auto">
                    {error}
                  </p>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                  <button onClick={() => setSelected(null)} className="z-btn-secondary" disabled={saving}>
                    {t('common.back')}
                  </button>
                  <button onClick={handleSave} className="z-btn-primary" disabled={saving} style={{ opacity: saving ? 0.6 : 1 }}>
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
// unknown kinds fall back to a free-text input. Controls are the 44px / 17px
// text field (iOS Safari zooms under 16px); booleans use the shared Toggle.
function BlueprintInputField({ input, value, onChange, isHe }) {
  const label    = (isHe && input.name_he) ? input.name_he : input.name
  const help     = input.description
  const kind     = input.selector_kind
  const sel      = input.selector_meta || {}
  const required = input.required

  const commonInputStyle = { boxSizing: 'border-box' }

  let control
  if (kind === 'number') {
    control = (
      <input
        type="number"
        className="z-input"
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
        className="z-input"
        value={display}
        onChange={e => onChange(e.target.value ? `${e.target.value}:00` : '')}
        style={commonInputStyle}
      />
    )
  } else if (kind === 'boolean') {
    control = (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 40 }}>
        <span className="z-body" dir="auto">{label}</span>
        <Toggle checked={!!value} onCheckedChange={onChange} aria-label={label} />
      </div>
    )
  } else if (kind === 'select' && Array.isArray(sel.options)) {
    control = (
      <select value={value ?? ''} onChange={e => onChange(e.target.value)} className="z-input" style={commonInputStyle}>
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
        className={kind === 'entity' ? 'z-input z-code' : 'z-input'}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        dir="ltr"
        style={commonInputStyle}
      />
    )
  }

  if (kind === 'boolean') {
    // Boolean rows render the label inline with the toggle, so the header
    // row would duplicate it.
    return (
      <div>
        {control}
        {help && (
          <p className="z-footnote" style={{ margin: '4px 0 0' }} dir="auto">{help}</p>
        )}
      </div>
    )
  }

  return (
    <div>
      <label style={fieldLabelStyle} dir="auto">
        {label}{required ? <span style={{ color: 'var(--warn-text)', marginInlineStart: 4 }} aria-label="required">*</span> : null}
      </label>
      {control}
      {help && (
        <p className="z-footnote" style={{ margin: '4px 0 0' }} dir="auto">{help}</p>
      )}
    </div>
  )
}

export default BlueprintsModal
