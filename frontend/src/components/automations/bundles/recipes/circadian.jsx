import React from 'react'
import { saveCircadian, deleteCircadian } from '../../../../lib/api'
import { entityDisplayName } from '../../../../lib/utils'

// ── Smart Light Schedule (circadian) recipe ───────────────────────────────────
// Save target is the ramp-engine CONFIG (services/circadian_engine), not an HA
// automation. The only things worth setting are the two extremes + your sleep
// timing; the curve between them is interpolated.

const DEF = { peak: { kelvin: 5500, pct: 100 }, floor: { kelvin: 2200, pct: 30 }, wake: '07:00', bedtime: '22:00' }
const KMIN = 2000, KMAX = 6500

function warmthWord(t, k) {
  if (k <= 2400) return t('automations.circadian.warmthAmber')
  if (k <= 3200) return t('automations.circadian.warmthWarm')
  if (k <= 4500) return t('automations.circadian.warmthNeutral')
  return t('automations.circadian.warmthCool')
}

// Color-temp-capable lights (or the prefilled list from the template/status).
const lightItems = (ctx, values) => {
  const label = (eid) => entityDisplayName(ctx.entityMap[eid]) || eid
  const prefill = values?._candidateLights || []
  if (prefill.length) return prefill.map((eid) => ({ id: eid, label: label(eid) }))
  return (ctx.entities || [])
    .filter((e) => {
      if (!e?.entity_id?.startsWith('light.')) return false
      const a = e.attributes || {}
      const modes = a.supported_color_modes || []
      return modes.includes('color_temp')
        || 'color_temp' in a || 'color_temp_kelvin' in a
        || a.min_color_temp_kelvin != null || a.max_color_temp_kelvin != null
        || a.min_mireds != null || a.max_mireds != null
    })
    .map((e) => ({ id: e.entity_id, label: label(e.entity_id) }))
}

// Live "right now" banner — the useful part of the old read-only view modal,
// kept at the top of the editor for installed schedules.
function RightNow({ values, ctx, t }) {
  const cur = values._status?.current
  if (!cur) return null
  return (
    <div style={{ borderRadius: 14, padding: '14px 16px',
      background: 'color-mix(in srgb, var(--ok) 7%, var(--surface))',
      border: '0.5px solid color-mix(in srgb, var(--ok) 22%, var(--line))' }}>
      <p className="z-eyebrow" style={{ margin: '0 0 4px' }}>{t('automations.circadian.rightNow')}</p>
      <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', margin: 0 }} dir="auto">
        {cur.kelvin}K · {cur.pct}%
      </p>
      <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: '2px 0 0' }} dir="auto">{warmthWord(t, cur.kelvin || 3000)}</p>
    </div>
  )
}

const timeOk = (v) => /^\d{2}:\d{2}$/.test(v.wake) && /^\d{2}:\d{2}$/.test(v.bedtime)

export default {
  id: 'circadian',
  titleKey: 'automations.circadian.title',
  subtitleKey: 'automations.circadian.subtitle',
  icon: '🌗',
  failedKey: 'automations.circadian.failed',

  derive: (initial, ctx) => {
    const prefill = (initial?.lights || initial?.defaults?.lights || []).filter(Boolean)
    const candidates = prefill.length ? prefill : lightItems(ctx, {}).map((i) => i.id)
    return {
      _candidateLights: prefill.length ? prefill : null,
      _status: initial?._status || null,
      lights: { mode: 'choose', ids: initial?.lights || candidates },
      peakKelvin: initial?.peak?.kelvin ?? DEF.peak.kelvin,
      peakPct: initial?.peak?.pct ?? DEF.peak.pct,
      floorKelvin: initial?.floor?.kelvin ?? DEF.floor.kelvin,
      floorPct: initial?.floor?.pct ?? DEF.floor.pct,
      wake: initial?.wake || DEF.wake,
      bedtime: initial?.bedtime || DEF.bedtime,
      autoOn: !!initial?.auto_on,
    }
  },

  // Fresh homes: pre-check every candidate light once entities land.
  autoDefaults: (v, ctx) => {
    if (!v._installed && (v.lights?.ids || []).length === 0) {
      const cands = lightItems(ctx, v)
      if (cands.length) return { lights: { mode: 'choose', ids: cands.map((i) => i.id) } }
    }
    return {}
  },

  steps: [
    {
      key: 'now', fields: [
        { key: '_now', type: 'custom', visibleWhen: (v) => !!v._installed && !!v._status,
          render: (p) => <RightNow {...p} />, lockedRender: (p) => <RightNow {...p} /> },
      ],
      visibleWhen: (v) => !!v._installed && !!v._status,
    },
    {
      key: 'lights', titleKey: 'automations.circadian.lights', icon: '💡',
      validate: (v, ctx) => (v.lights?.ids || []).length > 0,
      fields: [
        { key: 'lights', type: 'pickMany', allToggle: false, items: lightItems,
          emptyKey: 'automations.circadian.noLights' },
      ],
    },
    {
      key: 'peak', titleKey: 'automations.circadian.dayPeak', icon: '☀️',
      fields: [
        { key: '_peakHint', type: 'note', textKey: 'automations.circadian.dayPeakHint' },
        { key: 'peakKelvin', type: 'slider', min: KMIN, max: KMAX, step: 100, suffix: 'K',
          label: (t, v) => `${t('automations.circadian.warmth')} · ${warmthWord(t, v.peakKelvin)}` },
        { key: 'peakPct', type: 'slider', min: 1, max: 100, step: 1, suffix: '%',
          labelKey: 'automations.circadian.brightness' },
      ],
    },
    {
      key: 'floor', titleKey: 'automations.circadian.nightFloor', icon: '🌙',
      fields: [
        { key: '_floorHint', type: 'note', textKey: 'automations.circadian.nightFloorHint' },
        { key: 'floorKelvin', type: 'slider', min: KMIN, max: KMAX, step: 100, suffix: 'K',
          label: (t, v) => `${t('automations.circadian.warmth')} · ${warmthWord(t, v.floorKelvin)}` },
        { key: 'floorPct', type: 'slider', min: 1, max: 100, step: 1, suffix: '%',
          labelKey: 'automations.circadian.brightness' },
      ],
    },
    {
      key: 'timing', titleKey: 'automations.bundles.timing', icon: '⏰',
      validate: (v) => timeOk(v),
      fields: [
        { key: 'wake', type: 'time', icon: '⏰', labelKey: 'automations.circadian.wake' },
        { key: 'bedtime', type: 'time', icon: '🛏️', labelKey: 'automations.circadian.bedtime' },
        { key: '_timingHelp', type: 'note', textKey: 'automations.circadian.timingHelp' },
      ],
    },
    {
      key: 'mode', titleKey: 'automations.circadian.applyMode', icon: '⚙️',
      fields: [
        { key: 'autoOn', type: 'choice', options: [
          { value: false, labelKey: 'automations.circadian.modeOnlyOn', descKey: 'automations.circadian.modeOnlyOnHelp' },
          { value: true, labelKey: 'automations.circadian.modeTurnOn', descKey: 'automations.circadian.modeTurnOnHelp' },
        ] },
      ],
    },
  ],

  canSave: (v) => (v.lights?.ids || []).length > 0 && timeOk(v),

  save: async (v) => {
    await saveCircadian({
      lights: v.lights?.ids || [],
      peak: { kelvin: v.peakKelvin, pct: v.peakPct },
      floor: { kelvin: v.floorKelvin, pct: v.floorPct },
      wake: v.wake, bedtime: v.bedtime, auto_on: v.autoOn,
    })
  },

  remove: async () => { await deleteCircadian() },
}
