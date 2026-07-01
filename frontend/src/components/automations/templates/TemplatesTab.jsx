import React, { useEffect, useMemo, useState } from 'react'
import { useT, useLang } from '../../../lib/i18n'
import { getAutomationTemplates, listBlueprints } from '../../../lib/api'
import { Modal } from '../../ui/Modal'
import TemplateCard from './TemplateCard'
import OccupancySensorForm from '../OccupancySensorForm'

// ── TemplatesTab ────────────────────────────────────────────────────────────
//
// The single merged Templates surface. Collapses three previously-separate
// surfaces — the Library (Ziggy-native templates), Community templates
// (bundled HA blueprints), and the device-matched "Recommended" strip — into
// one filterable list:  [ All | Not set up | By category ▾ ].
//
// Additive rule: the two source-of-truth data layers are untouched. We fetch
// both (getAutomationTemplates + listBlueprints), NORMALISE at render into a
// common item shape for filtering only, and delegate the actual card rendering
// + configure flow back to each source's existing component/handler.
//
//   • native    → <TemplateCard> + onConfigureNative (wizard / circadian)
//   • community → <CommunityCard> + onConfigureCommunity(blueprint_id)
//                 (parent opens BlueprintsModal deep-linked to that template)
//
// "Suggested" (habit-learned proactive feed) is a DIFFERENT concept and stays
// its own tab — it is not merged here.

function normalise(native, community) {
  const nativeItems = (native || []).map(tpl => ({
    key:      `n:${tpl.id}`,
    source:   'native',
    category: tpl.category || 'general',
    notSetUp: !tpl.already_exists,
    raw:      tpl,
  }))
  const communityItems = (community || []).map(tpl => ({
    key:      `c:${tpl.id}`,
    source:   'community',
    category: tpl.category || 'community',
    // Community templates don't track instantiation, so they're always a
    // "next step" the user hasn't set up.
    notSetUp: true,
    raw:      tpl,
  }))
  return [...nativeItems, ...communityItems]
}

function TemplatesTab({ onConfigureNative, onConfigureCommunity, onSensorCreated }) {
  const t    = useT()
  const lang = useLang()
  const isHe = lang === 'he'

  const [native,    setNative]    = useState([])
  const [community, setCommunity] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [setupFilter, setSetupFilter] = useState('all')  // 'all' | 'notSetUp'
  const [category,    setCategory]    = useState('')      // '' = all categories
  const [showSensorForm, setShowSensorForm] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.allSettled([getAutomationTemplates(), listBlueprints()])
      .then(([nat, com]) => {
        if (!alive) return
        if (nat.status === 'fulfilled') setNative(nat.value?.templates || [])
        if (com.status === 'fulfilled') setCommunity(com.value?.templates || [])
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const items = useMemo(() => normalise(native, community), [native, community])

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

      {/* Presence-sensor CTA — a template-adjacent "make a room smart" helper. */}
      <button
        onClick={() => setShowSensorForm(true)}
        style={{
          width: '100%', textAlign: isHe ? 'right' : 'left', cursor: 'pointer', fontFamily: 'inherit',
          padding: '10px 14px', borderRadius: 12, marginBottom: 14,
          background: `color-mix(in srgb, var(--accent, var(--info)) 6%, var(--surface))`,
          border: `0.5px solid color-mix(in srgb, var(--accent, var(--info)) 25%, var(--line))`,
          fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 500,
        }}
        dir="auto"
      >
        ✨ {t('automations.templatesTab.sensorCta')}
      </button>

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

      {!loading && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {filtered.map(item => (
            item.source === 'native'
              ? <TemplateCard key={item.key} template={item.raw} onConfigure={onConfigureNative} />
              : <CommunityCard key={item.key} template={item.raw} isHe={isHe} t={t} onConfigure={onConfigureCommunity} />
          ))}
        </div>
      )}

      <Modal open={showSensorForm} onClose={() => setShowSensorForm(false)} title={t('automations.smartSensor.title')}>
        <OccupancySensorForm
          onCreated={(res) => { if (typeof onSensorCreated === 'function') onSensorCreated(res) }}
          onClose={() => setShowSensorForm(false)}
        />
      </Modal>
    </div>
  )
}

// One community-template row. Mirrors TemplateCard's chrome so the merged list
// reads as a single surface; the "Community" badge is the only source tell.
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
          <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 999, fontWeight: 700, fontFamily: '"IBM Plex Mono", monospace', background: 'var(--bg-2)', color: 'var(--ink-faint)' }}>
            {t('automations.templatesTab.communityBadge')}
          </span>
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
