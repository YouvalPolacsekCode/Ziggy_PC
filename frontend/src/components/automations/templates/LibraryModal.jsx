import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useT } from '../../../lib/i18n'
import { getAutomationTemplates } from '../../../lib/api'
import TemplateCard from './TemplateCard'

// ── LibraryModal ──────────────────────────────────────────────────────────────
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
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      padding: '0 0 0 0',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <motion.div
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', damping: 24, stiffness: 260 }}
        style={{
          width: '100%', maxWidth: 720,
          maxHeight: '85vh', borderRadius: '18px 18px 0 0',
          background: 'var(--bg)', display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '18px 20px 12px', borderBottom: '0.5px solid var(--line)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <p className="z-eyebrow" style={{ marginBottom: 2 }}>{t('automations.libraryEyebrow')}</p>
              <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>{t('automations.libraryTitle')}</h2>
            </div>
            <button onClick={onClose} aria-label={t('common.close')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: 'var(--ink-mute)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
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
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px' }}>
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1,2,3].map(i => <div key={i} style={{ height: 80, borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.5 }} />)}
            </div>
          )}
          {!loading && (
            <>
              {ready.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <p className="z-eyebrow" style={{ marginBottom: 10, color: 'var(--ok)' }}>{t('automations.libraryReady', { n: ready.length })}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {ready.map(tpl => <TemplateCard key={tpl.id} template={tpl} onConfigure={cfg => { onConfigure(cfg); onClose() }} />)}
                  </div>
                </div>
              )}
              {partial.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <p className="z-eyebrow" style={{ marginBottom: 6, color: 'var(--warn)' }}>{t('automations.libraryPartial', { n: partial.length })}</p>
                  <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 10, lineHeight: 1.4 }}>
                    {t('automations.libraryPartialHint')}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {partial.map(tpl => <TemplateCard key={tpl.id} template={tpl} onConfigure={cfg => { onConfigure(cfg); onClose() }} />)}
                  </div>
                </div>
              )}
              {unavailable.length > 0 && (
                <div>
                  <p className="z-eyebrow" style={{ marginBottom: 10, color: 'var(--ink-faint)' }}>{t('automations.libraryUnavailable', { n: unavailable.length })}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {unavailable.map(tpl => <TemplateCard key={tpl.id} template={tpl} onConfigure={cfg => { onConfigure(cfg); onClose() }} />)}
                  </div>
                </div>
              )}
              {filtered.length === 0 && (
                <p style={{ textAlign: 'center', padding: '32px 0', fontSize: 13, color: 'var(--ink-faint)' }}>{t('automations.libraryNoMatch')}</p>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  )
}

export default LibraryModal
