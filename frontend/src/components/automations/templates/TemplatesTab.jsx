import React, { useEffect, useMemo, useState } from 'react'
import { Zap, Hand, Puzzle } from 'lucide-react'
import { useT, useLang } from '../../../lib/i18n'
import { getAutomationTemplates, getSuggestedRoutines, listBlueprints } from '../../../lib/api'
import { chipStyle } from '../../../lib/automations/styles'
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

  // Category select shares the chip geometry (44 tall, capsule); the active
  // state is surface-2 + ink + hairline like every other filter chip.
  const catActive = category !== ''
  const { background: catBg, ...catChip } = chipStyle(catActive)

  return (
    <div>
      {/* Filter chips: [ All | Not set up | By category ▾ ] */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => setSetupFilter('all')} aria-pressed={setupFilter === 'all'} style={chipStyle(setupFilter === 'all')}>
          {t('automations.templatesTab.filterAll')}
        </button>
        <button onClick={() => setSetupFilter('notSetUp')} aria-pressed={setupFilter === 'notSetUp'} style={chipStyle(setupFilter === 'notSetUp')}>
          {t('automations.templatesTab.filterNotSetUp')}
        </button>
        <div style={{ position: 'relative', display: 'inline-flex' }}>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            aria-label={t('automations.templatesTab.filterByCategory')}
            style={{
              // NOTE: use backgroundColor (longhand), NOT the `background`
              // shorthand — the shorthand resets backgroundImage and wipes the
              // arrow, leaving the native select's default control background.
              ...catChip,
              backgroundColor: catBg,
              appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
              paddingInlineEnd: 36,
              backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'><path fill='none' stroke='%236E5A48' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round' d='M1 1.5l5 5 5-5'/></svg>")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: isHe ? 'left 14px center' : 'right 14px center',
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
          {[1,2,3].map(i => <div key={i} style={{ height: 80, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.5 }} />)}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <p className="z-subhead" style={{ textAlign: 'center', padding: '32px 0' }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {automatic.length > 0 && (
              <p className="z-eyebrow" style={{ margin: '0 0 4px', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Zap size={14} strokeWidth={1.75} aria-hidden="true" />{t('automations.librarySectionAutomatic')}
              </p>
            )}
            {automatic.map(renderItem)}
            {ondemand.length > 0 && (
              <p className="z-eyebrow" style={{ margin: '16px 0 4px', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Hand size={14} strokeWidth={1.75} aria-hidden="true" />{t('automations.librarySectionOnDemand')}
              </p>
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
      padding: 16, borderRadius: 'var(--r-card)',
      background: 'var(--surface)', border: '0.5px solid var(--line)',
      display: 'flex', alignItems: 'flex-start', gap: 16,
    }} dir="auto">
      <div aria-hidden="true" style={{
        width: 44, height: 44, borderRadius: 'var(--r-ctl)', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--surface-2)', color: 'var(--ink-2)', fontSize: 22, lineHeight: 1,
      }}>{template.icon || <Puzzle size={22} strokeWidth={1.75} />}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="z-headline" style={{ margin: '0 0 2px' }} dir="auto">{name}</p>
        {desc && <p className="z-subhead" style={{ margin: 0 }} dir="auto">{desc}</p>}
        <p className="z-footnote z-mono" style={{ margin: '4px 0 0', color: 'var(--ink-faint)' }}>
          {t('automations.communityInputCount', { n: (template.inputs || []).length })}
        </p>
      </div>
      <div style={{ flexShrink: 0 }}>
        <button
          onClick={() => onConfigure(template.blueprint_id || template.id)}
          className="z-btn-primary"
          style={{ whiteSpace: 'nowrap' }}
        >
          {t('automations.template.configure')}
        </button>
      </div>
    </div>
  )
}

export default TemplatesTab
