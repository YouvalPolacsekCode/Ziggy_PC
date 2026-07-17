import React, { useMemo, useState } from 'react'
import { Input } from '../ui/Input'
import { useT } from '../../lib/i18n'
import { useDeviceStore } from '../../stores/deviceStore'
import { saveCircadianBundle, deleteCircadianBundle } from '../../lib/api'
import { entityDisplayName } from '../../lib/utils'

// ── CircadianBundleWizard ─────────────────────────────────────────────────────
// Dedicated wizard for the "Smart Light Schedule" suggestion (D1). The
// regular AutomationWizard speaks the single-trigger/single-action schema;
// circadian is 4 HA automations under the hood, so this wizard renders only
// the two user-tunable knobs (lights + bedtime) and POSTs to the dedicated
// /api/automations/circadian-bundle endpoint via saveCircadianBundle().
//
// Lights pool comes from initial.defaults.lights (server-pre-filtered to
// has_color_temp_light). Falling back to filtering the live deviceStore
// covers the edit flow where the wizard reopens on an existing bundle.
function CircadianBundleWizard({ initial, onSaved, onClose }) {
  const t = useT()
  const { entities } = useDeviceStore()

  const candidateLights = useMemo(() => {
    const fromPrefill = (initial?.defaults?.lights || initial?.lights || []).filter(Boolean)
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

  const [selected, setSelected] = useState(() => {
    const pre = initial?.selectedLights || initial?.defaults?.lights || candidateLights
    return new Set(pre)
  })
  const [bedtime, setBedtime] = useState(initial?.defaults?.bedtime || initial?.bedtime || '22:00')
  // Default ON — matches the user expectation that all selected lights follow
  // the schedule. Restored from an existing bundle when editing.
  const [autoOn, setAutoOn]   = useState(() => {
    const v = initial?.autoOn ?? initial?.defaults?.autoOn
    return v == null ? true : !!v
  })
  const [saving, setSaving]   = useState(false)
  const [error,  setError]    = useState(null)

  const toggle = (eid) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(eid)) next.delete(eid); else next.add(eid)
    return next
  })

  const isUpdate = !!initial?._isInstalled
  const noLights = candidateLights.length === 0
  const canSave  = !noLights && selected.size > 0 && /^\d{2}:\d{2}$/.test(bedtime) && !saving

  const handleConfirm = async () => {
    setSaving(true); setError(null)
    try {
      await saveCircadianBundle({ lights: Array.from(selected), bedtime, auto_on: autoOn })
      await onSaved?.({ updated: isUpdate })
    } catch (e) {
      setError(e?.userMessage || e?.message || t('automations.circadian.failed'))
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    setSaving(true); setError(null)
    try {
      await deleteCircadianBundle()
      await onSaved?.({ removed: true })
    } catch (e) {
      setError(e?.userMessage || e?.message || t('automations.circadian.failed'))
      setSaving(false)
    }
  }

  const labelFor = (eid) => entityDisplayName(entities?.find(e => e.entity_id === eid)) || eid

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 2px' }}>
      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
        {t('automations.circadian.subtitle')}
      </p>

      {/* Lights multi-select (color-temp lights only) */}
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
                <button
                  key={eid}
                  type="button"
                  onClick={() => toggle(eid)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 8,
                    background: checked ? 'color-mix(in srgb, var(--ok) 8%, transparent)' : 'transparent',
                    border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit',
                  }}
                >
                  <span style={{
                    width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                    border: `1.5px solid ${checked ? 'var(--ok)' : 'var(--line)'}`,
                    background: checked ? 'var(--ok)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {checked && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--bg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 12l5 5L20 6"/>
                      </svg>
                    )}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{labelFor(eid)}</span>
                </button>
              )
            })}
          </div>
        )}
        <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 6, lineHeight: 1.45 }}>
          {t('automations.circadian.lightsHelp')}
        </p>
      </div>

      {/* Bedtime */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.circadian.bedtime')}</p>
        <Input
          type="time"
          value={bedtime}
          onChange={e => setBedtime(e.target.value)}
          style={{ maxWidth: 140 }}
        />
        <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 6, lineHeight: 1.45 }}>
          {t('automations.circadian.bedtimeHelp')}
        </p>
      </div>

      {/* Turn-on behaviour */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.circadian.autoOnLabel')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { on: true,  label: t('automations.circadian.autoOnTurnOn') },
            { on: false, label: t('automations.circadian.autoOnAdjust') },
          ].map(opt => {
            const active = autoOn === opt.on
            return (
              <button
                key={String(opt.on)}
                type="button"
                onClick={() => setAutoOn(opt.on)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 11px', borderRadius: 10, textAlign: 'start', fontFamily: 'inherit',
                  background: active ? 'color-mix(in srgb, var(--ok) 8%, transparent)' : 'var(--surface)',
                  border: `0.5px solid ${active ? 'var(--ok)' : 'var(--line)'}`,
                  cursor: 'pointer',
                }}
                dir="auto"
              >
                <span style={{
                  width: 16, height: 16, borderRadius: 999, flexShrink: 0,
                  border: `1.5px solid ${active ? 'var(--ok)' : 'var(--line)'}`,
                  background: active ? 'var(--ok)' : 'transparent',
                }} />
                <span style={{ fontSize: 13, color: 'var(--ink)' }}>{opt.label}</span>
              </button>
            )
          })}
        </div>
        <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 6, lineHeight: 1.45 }}>
          {t('automations.circadian.autoOnHelp')}
        </p>
      </div>

      {/* Daily-schedule preview */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.circadian.preview')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: '"IBM Plex Mono", monospace', fontSize: 11.5, color: 'var(--ink-2)' }}>
          <div>🌅 {t('automations.circadian.previewSunrise')}</div>
          <div>☀️ {t('automations.circadian.previewNoon')}</div>
          <div>🌇 {t('automations.circadian.previewSunset')}</div>
          <div>🌙 {t('automations.circadian.previewBedtime', { time: bedtime || '22:00' })}</div>
        </div>
      </div>

      {error && (
        <p style={{ fontSize: 12, color: 'var(--accent)', padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>
          {error}
        </p>
      )}

      {/* Footer actions */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          {isUpdate && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={saving}
              className="z-btn-secondary"
              style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, color: 'var(--accent)' }}
            >
              {t('automations.circadian.delete')}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13 }}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canSave}
            className="z-btn-primary"
            style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, opacity: canSave ? 1 : 0.5 }}
          >
            {isUpdate ? t('automations.circadian.update') : t('automations.circadian.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CircadianBundleWizard
