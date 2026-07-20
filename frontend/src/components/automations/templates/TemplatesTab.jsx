import React, { useEffect, useMemo, useState } from 'react'
import { useT, useLang } from '../../../lib/i18n'
import { getAutomationTemplates, getSuggestedRoutines, listBlueprints } from '../../../lib/api'
import TemplateCard from './TemplateCard'

// ── TemplatesTab — the unified Library (2026-07-19 IA addendum A2/A4) ───────
//
// ONE flat shelf serving both Actions tabs, split by the only line that
// matters — what pulls the trigger:
//
//   ⚡ Automatic  — automation templates (+ user-pasted blueprints); it
//                   starts itself. → TemplateCard + onConfigureNative /
//                   CommunityCard + onConfigureCommunity(blueprint_id)
//   👆 On-demand — routine templates; you start it.
//                   → TemplateCard + onConfigureRoutine(template)
//
// No "curated vs community" distinction — the backend already hides bundled
// blueprints (all dups of curated items); anything user-pasted just shows as
// a normal Automatic card. Data layers untouched: we fetch the three sources
// and NORMALISE at render for filtering only.

function normalise(native, routines, community) {
  const nativeItems = (native || []).map(tpl => ({
    key:      `n:${tpl.id}`,
    source:   'native',
    kind:     'automatic',
    category: tpl.category || 'general',
    notSetUp: !tpl.already_exists,
    raw:      tpl,
  }))
  const routineItems = (routines || []).map(tpl => ({
    key:      `r:${tpl.id}`,
    source:   'routine',
    kind:     'ondemand',
    category: tpl.category || 'general',
    notSetUp: !tpl.already_exists,
    raw:      tpl,
  }))
  const communityItems = (community || []).map(tpl => ({
    key:      `c:${tpl.id}`,
    source:   'community',
    kind:     'automatic',
    category: tpl.category || 'general',
    // User-pasted blueprints don't track instantiation, so they're always a
    // "next step" the user hasn't set up.
    notSetUp: true,
    raw:      tpl,
  }))
  return [...nativeItems, ...communityItems, ...routineItems]
}

function TemplatesTab({ onConfigureNative, onConfigureCommunity, onConfigureRoutine }) {
  const t    = useT()
  const lang = useLang()
  const isHe = lang === 'he'

  const [native,    setNative]    = useState([])
  const [routines,  setRoutines]  = useState([])
  const [community, setCommunity] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [setupFilter, setSetupFilter] = useState('all')  // 'all' | 'notSetUp'
  const [category,    setCategory]    = useState('')      // '' = all categories

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.allSettled([getAutomationTemplates(), getSuggestedRoutines(), listBlueprints()])
      .then(([nat, rout, com]) => {
        if (!alive) return
        if (nat.status === 'fulfilled')  setNative(nat.value?.templates || [])
        if (rout.status === 'fulfilled') setRoutines(rout.value?.suggested || [])
        if (com.status === 'fulfilled')  setCommunity(com.value?.templates || [])
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const items = useMemo(() => normalise(native, routines, community), [native, routines, community])

  const categories = useMemo(
    () => Array.from(new Set(items.map(i => i.category).filter(Boolean))).sort(),
    [items],
  )

  const filtered = useMemo(() => items.filter(i =>
    (setupFilter === 'all' || i.notSetUp) &&
    (category === '' || i.category === category)
  ), [items, setupFilter, category])

  const chipStyle = active => ({
    padding: '5px 13px', borderRadius: 999, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
    background: active ? 'var(--ink)' : 'var(--surface)',
    color: active ? 'var(--bg)' : 'var(--ink-mute)',
    border: active ? 'none' : '0.5px solid var(--line)',
    cursor: 'pointer', fontFamily: 'inherit',
  })

  return (
    <div>
      {/* Filter chips: [ All | Not set up | By category ▾ ] */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => setSetupFilter('all')} style={chipStyle(setupFilter === 'all')}>
          {t('automations.templatesTab.filterAll')}
        </button>
        <button onClick={() => setSetupFilter('notSetUp')} style={chipStyle(setupFilter === 'notSetUp')}>
          {t('automations.templatesTab.filterNotSetUp')}
        </button>
        <div style={{ position: 'relative', display: 'inline-flex' }}>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            aria-label={t('automations.templatesTab.filterByCategory')}
            style={{
              ...chipStyle(category !== ''),
              appearance: 'none', paddingRight: 26,
              backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='${category !== '' ? 'white' : 'gray'}' d='M0 0h10L5 6z'/></svg>")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: isHe ? 'left 9px center' : 'right 9px center',
            }}
            dir="auto"
          >
            <option value="">{t('automations.templatesTab.filterByCategory')}</option>
            {categories.map(c => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Presence-sensor creation lives on the room page (only when a room has
          2+ sensors to combine) + inside the Builder/Smart-Room flows that need
          it — not here. A fused sensor is plumbing, not an automation. */}

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 74, borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.5 }} />)}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <p style={{ textAlign: 'center', padding: '32px 0', fontSize: 13, color: 'var(--ink-faint)' }}>
          {t('automations.templatesTab.empty')}
        </p>
      )}

      {!loading && filtered.length > 0 && (() => {
        // showTriggerChip={false}: each section is already single-kind (header
        // says ⚡ / 👆), so a per-card chip would just repeat it.
        const renderItem = (item) =>
          item.source === 'native'    ? <TemplateCard key={item.key} template={item.raw} onConfigure={onConfigureNative} showTriggerChip={false} />
          : item.source === 'routine' ? <TemplateCard key={item.key} template={item.raw} onConfigure={onConfigureRoutine} showTriggerChip={false} />
          :                             <CommunityCard key={item.key} template={item.raw} isHe={isHe} t={t} onConfigure={onConfigureCommunity} />
        const automatic = filtered.filter(i => i.kind === 'automatic')
        const ondemand  = filtered.filter(i => i.kind === 'ondemand')
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {automatic.length > 0 && (
              <p className="z-eyebrow" style={{ margin: '2px 0 3px' }}>⚡ {t('automations.librarySectionAutomatic')}</p>
            )}
            {automatic.map(renderItem)}
            {ondemand.length > 0 && (
              <p className="z-eyebrow" style={{ margin: '14px 0 3px' }}>👆 {t('automations.librarySectionOnDemand')}</p>
            )}
            {ondemand.map(renderItem)}
          </div>
        )
      })()}

    </div>
  )
}

// One user-pasted-blueprint row. Mirrors TemplateCard's chrome so the unified
// Library reads as a single surface — no source badge (2026-07-19: the
// curated/community distinction is gone; a template is a template).
function CommunityCard({ template, isHe, t, onConfigure }) {
  const name = (isHe && template.name_he) ? template.name_he : template.name
  const desc = (isHe && template.description_he) ? template.description_he : (template.description || '').split('\n')[0]
  return (
    <div style={{
      padding: '14px 16px', borderRadius: 12,
      background: 'var(--surface)', border: '0.5px solid var(--line)',
      display: 'flex', alignItems: 'flex-start', gap: 12,
    }} dir="auto">
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-2)', fontSize: 18,
      }}>{template.icon || '🧩'}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3, flexWrap: 'wrap' }}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14, letterSpacing: '-0.01em', margin: 0 }} dir="auto">{name}</p>
        </div>
        {desc && <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0, lineHeight: 1.4 }} dir="auto">{desc}</p>}
        <p style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 4, fontFamily: '"IBM Plex Mono", monospace' }}>
          {t('automations.communityInputCount', { n: (template.inputs || []).length })}
        </p>
      </div>
      <div style={{ flexShrink: 0 }}>
        <button
          onClick={() => onConfigure(template.blueprint_id || template.id)}
          className="z-btn-primary"
          style={{ fontSize: 12, padding: '6px 12px', borderRadius: 9, whiteSpace: 'nowrap' }}
        >
          {t('automations.template.configure')}
        </button>
      </div>
    </div>
  )
}

export default TemplatesTab
