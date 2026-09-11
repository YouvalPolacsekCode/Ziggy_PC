import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useT } from '../../../lib/i18n'
import { getAutomationTemplates } from '../../../lib/api'
import { SPRING_SHEET } from '../../../lib/motion'
import { chipStyle } from '../../../lib/automations/styles'
import TemplateCard from './TemplateCard'

// ── LibraryModal ──────────────────────────────────────────────────────────────
// Bottom sheet: Title 3 header, 44px close, Body-size search field, 44px filter
// chips (active = surface-2 + ink + hairline), neutral section eyebrows.
function LibraryModal({ open, onClose, onConfigure }) {
  const t = useT()
  const [templates, setTemplates] = useState([])
  const [loading,   setLoading]   = useState(false)
  const [search,    setSearch]    = useState('')
  const [category,  setCategory]  = useState('all')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    getAutomationTemplates()
      .then(r => setTemplates(r.templates || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open])

  // Templates the user already created live in the Active tab — hide them here
  // so the Library only shows templates that still represent a "next step".
  const available = templates.filter(t => !t.already_exists)
  const categories = ['all', ...Array.from(new Set(available.map(t => t.category)))]
  const filtered = available.filter(t =>
    (category === 'all' || t.category === category) &&
    (search === '' || t.name.toLowerCase().includes(search.toLowerCase()) || t.description.toLowerCase().includes(search.toLowerCase()))
  )
  const ready       = filtered.filter(t => t.tier === 'ready')
  const partial     = filtered.filter(t => t.tier === 'partial')
  const unavailable = filtered.filter(t => t.tier === 'unavailable')

  if (!open) return null
  const section = (label, items, hint) => items.length > 0 && (
    <div style={{ marginBottom: 24 }}>
      <p className="z-eyebrow" style={{ marginBottom: hint ? 4 : 12 }}>{label}</p>
      {hint && <p className="z-footnote" style={{ marginBottom: 12 }}>{hint}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(tpl => <TemplateCard key={tpl.id} template={tpl} onConfigure={cfg => { onConfigure(cfg); onClose() }} />)}
      </div>
    </div>
  )

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
          maxHeight: '85vh', borderRadius: 'var(--r-sheet) var(--r-sheet) 0 0',
          background: 'var(--bg)', display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', borderBottom: '0.5px solid var(--line)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <div style={{ minWidth: 0 }}>
              <p className="z-eyebrow" style={{ marginBottom: 2 }}>{t('automations.libraryEyebrow')}</p>
              <h2 className="z-title3" style={{ margin: 0 }}>{t('automations.libraryTitle')}</h2>
            </div>
            <button onClick={onClose} aria-label={t('common.close')} className="z-icon-btn">
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>
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
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px' }}>
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1,2,3].map(i => <div key={i} style={{ height: 80, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.5 }} />)}
            </div>
          )}
          {!loading && (
            <>
              {section(t('automations.libraryReady', { n: ready.length }), ready)}
              {section(t('automations.libraryPartial', { n: partial.length }), partial, t('automations.libraryPartialHint'))}
              {section(t('automations.libraryUnavailable', { n: unavailable.length }), unavailable)}
              {filtered.length === 0 && (
                <p className="z-subhead" style={{ textAlign: 'center', padding: '32px 0' }}>{t('automations.libraryNoMatch')}</p>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  )
}

export default LibraryModal
