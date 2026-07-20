import React, { useMemo, useState } from 'react'
import { Input } from '../ui/Input'
import { useT } from '../../lib/i18n'
import { useDeviceStore } from '../../stores/deviceStore'
import { saveCircadian, deleteCircadian } from '../../lib/api'
import { entityDisplayName } from '../../lib/utils'

// ── CircadianBundleWizard ─────────────────────────────────────────────────────
// Smart Light Schedule = a continuous adaptive ramp (services/circadian_engine).
// The only things worth setting are the two extremes + your sleep timing; the
// curve between them is interpolated. So this wizard is: pick lights, set the
// Day peak (cool+bright) and Night floor (warm+dim), and your wake/bedtime.

const DEF = { peak: { kelvin: 5500, pct: 100 }, floor: { kelvin: 2200, pct: 30 }, wake: '07:00', bedtime: '22:00' }
const KMIN = 2000, KMAX = 6500

function warmthWord(t, k) {
  if (k <= 2400) return t('automations.circadian.warmthAmber')
  if (k <= 3200) return t('automations.circadian.warmthWarm')
  if (k <= 4500) return t('automations.circadian.warmthNeutral')
  return t('automations.circadian.warmthCool')
}

function Slider({ label, value, min, max, step, suffix, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{label}</span>
        <span className="z-mono" style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 600 }}>{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--ok)' }} />
    </div>
  )
}

function AnchorEditor({ t, title, hint, anchor, onChange }) {
  return (
    <div style={{ border: '0.5px solid var(--line)', borderRadius: 12, padding: '12px 14px', background: 'var(--surface)' }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: '0 0 2px' }} dir="auto">{title}</p>
      <p style={{ fontSize: 11, color: 'var(--ink-faint)', margin: '0 0 12px' }} dir="auto">{hint}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Slider label={`${t('automations.circadian.warmth')} · ${warmthWord(t, anchor.kelvin)}`}
          value={anchor.kelvin} min={KMIN} max={KMAX} step={100} suffix="K"
          onChange={v => onChange({ ...anchor, kelvin: v })} />
        <Slider label={t('automations.circadian.brightness')}
          value={anchor.pct} min={1} max={100} step={1} suffix="%"
          onChange={v => onChange({ ...anchor, pct: v })} />
      </div>
    </div>
  )
}

function CircadianBundleWizard({ initial, onSaved, onClose }) {
  const t = useT()
  const { entities } = useDeviceStore()

  const candidateLights = useMemo(() => {
    const fromPrefill = (initial?.lights || initial?.defaults?.lights || []).filter(Boolean)
    if (fromPrefill.length > 0) return fromPrefill
    return (entities || [])
      .filter(e => {
        if (!e?.entity_id?.startsWith('light.')) return false
        const a = e.attributes || {}
        const modes = a.supported_color_modes || []
        return modes.includes('color_temp')
          || 'color_temp' in a || 'color_temp_kelvin' in a
          || a.min_color_temp_kelvin != null || a.max_color_temp_kelvin != null
          || a.min_mireds != null || a.max_mireds != null
      })
      .map(e => e.entity_id)
  }, [initial, entities])

  const [selected, setSelected] = useState(() => new Set(initial?.lights || candidateLights))
  const [peak,    setPeak]    = useState(initial?.peak  || DEF.peak)
  const [floor,   setFloor]   = useState(initial?.floor || DEF.floor)
  const [wake,    setWake]    = useState(initial?.wake    || DEF.wake)
  const [bedtime, setBedtime] = useState(initial?.bedtime || DEF.bedtime)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  const isUpdate = !!initial?._isInstalled
  const noLights = candidateLights.length === 0
  const timeOk   = /^\d{2}:\d{2}$/.test(wake) && /^\d{2}:\d{2}$/.test(bedtime)
  const canSave  = !noLights && selected.size > 0 && timeOk && !saving

  const toggle = (eid) => setSelected(prev => {
    const next = new Set(prev); next.has(eid) ? next.delete(eid) : next.add(eid); return next
  })
  const labelFor = (eid) => entityDisplayName(entities?.find(e => e.entity_id === eid)) || eid

  const handleConfirm = async () => {
    setSaving(true); setError(null)
    try {
      await saveCircadian({ lights: Array.from(selected), peak, floor, wake, bedtime })
      await onSaved?.({ updated: isUpdate })
    } catch (e) {
      setError(e?.userMessage || e?.message || t('automations.circadian.failed')); setSaving(false)
    }
  }
  const handleRemove = async () => {
    setSaving(true); setError(null)
    try { await deleteCircadian(); await onSaved?.({ removed: true }) }
    catch (e) { setError(e?.userMessage || e?.message || t('automations.circadian.failed')); setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 2px' }}>
      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }} dir="auto">
        {t('automations.circadian.subtitle')}
      </p>

      {/* Lights */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.circadian.lights')}</p>
        {noLights ? (
          <p style={{ fontSize: 12, color: 'var(--warn)', padding: '10px 12px', background: 'color-mix(in srgb, var(--warn) 8%, transparent)', borderRadius: 10 }}>
            {t('automations.circadian.noLights')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, border: '0.5px solid var(--line)', borderRadius: 10, padding: 6, background: 'var(--surface)' }}>
            {candidateLights.map(eid => {
              const checked = selected.has(eid)
              return (
                <button key={eid} type="button" onClick={() => toggle(eid)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8,
                    background: checked ? 'color-mix(in srgb, var(--ok) 8%, transparent)' : 'transparent',
                    border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}>
                  <span style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                    border: `1.5px solid ${checked ? 'var(--ok)' : 'var(--line)'}`,
                    background: checked ? 'var(--ok)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {checked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--bg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6"/></svg>}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{labelFor(eid)}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Two anchors */}
      <AnchorEditor t={t} title={`☀️ ${t('automations.circadian.dayPeak')}`} hint={t('automations.circadian.dayPeakHint')} anchor={peak}  onChange={setPeak} />
      <AnchorEditor t={t} title={`🌙 ${t('automations.circadian.nightFloor')}`} hint={t('automations.circadian.nightFloorHint')} anchor={floor} onChange={setFloor} />

      {/* Timing */}
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <p className="z-eyebrow" style={{ marginBottom: 6 }}>{t('automations.circadian.wake')}</p>
          <Input type="time" value={wake} onChange={e => setWake(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <p className="z-eyebrow" style={{ marginBottom: 6 }}>{t('automations.circadian.bedtime')}</p>
          <Input type="time" value={bedtime} onChange={e => setBedtime(e.target.value)} />
        </div>
      </div>
      <p style={{ fontSize: 11, color: 'var(--ink-faint)', margin: '-6px 0 0', lineHeight: 1.45 }} dir="auto">
        {t('automations.circadian.timingHelp')}
      </p>

      {error && (
        <p style={{ fontSize: 12, color: 'var(--accent)', padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>{error}</p>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          {isUpdate && (
            <button type="button" onClick={handleRemove} disabled={saving} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, color: 'var(--accent)' }}>
              {t('automations.circadian.delete')}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13 }}>{t('common.cancel')}</button>
          <button type="button" onClick={handleConfirm} disabled={!canSave} className="z-btn-primary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, opacity: canSave ? 1 : 0.5 }}>
            {isUpdate ? t('automations.circadian.update') : t('automations.circadian.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CircadianBundleWizard
