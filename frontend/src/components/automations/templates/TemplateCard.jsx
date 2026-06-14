import React, { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useT } from '../../../lib/i18n'

// ── TemplateCard ──────────────────────────────────────────────────────────────
const TIER_STYLE = {
  ready:       { border: 'color-mix(in srgb, var(--ok)   30%, var(--line))', bg: 'color-mix(in srgb, var(--ok)   4%, var(--surface))', badgeBg: 'color-mix(in srgb, var(--ok)   14%, transparent)', badgeColor: 'var(--ok)',      badgeKey: 'ready' },
  partial:     { border: 'color-mix(in srgb, var(--warn) 40%, var(--line))', bg: 'color-mix(in srgb, var(--warn) 4%, var(--surface))', badgeBg: 'color-mix(in srgb, var(--warn) 14%, transparent)', badgeColor: 'var(--warn)',    badgeKey: 'incomplete' },
  unavailable: { border: 'var(--line)',                                       bg: 'var(--surface)',                                      badgeBg: 'var(--bg-2)',                                       badgeColor: 'var(--ink-faint)', badgeKey: 'notAvailable' },
}

function TemplateCard({ template, onConfigure }) {
  const t = useT()
  const tier        = template.tier || (template.can_run ? 'ready' : 'unavailable')
  const ts          = TIER_STYLE[tier] || TIER_STYLE.unavailable
  const matched     = template.matched_labels || []
  const missReq     = template.missing_req_labels || []
  const missOpt     = template.missing_opt_labels || []
  const canConfigure = tier === 'ready' || tier === 'partial'
  // Collapsed by default — Library lists many templates at once, so the
  // header alone (name + tier badge + one-line status) is the right scan
  // level. Tapping anywhere on the card (except Configure) reveals the
  // description and the per-device match list.
  const [expanded, setExpanded] = useState(false)

  const statusLine = tier === 'ready'
    ? t(matched.length === 1 ? 'automations.template.deviceReadyOne' : 'automations.template.devicesReady', { n: matched.length })
    : tier === 'partial'
    ? t('automations.template.partialFound', { matched: matched.length, total: matched.length + missReq.length })
    : t(missReq.length === 1 ? 'automations.template.deviceNeededOne' : 'automations.template.devicesNeeded', { n: missReq.length })

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={() => setExpanded(v => !v)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v) } }}
      style={{
        padding: '14px 16px', borderRadius: 12,
        background: ts.bg, border: `0.5px solid ${ts.border}`,
        display: 'flex', alignItems: 'flex-start', gap: 12,
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `color-mix(in srgb, ${ts.badgeColor} 10%, var(--surface))`,
        fontSize: 18,
      }}>
        {template.icon}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Name row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3, flexWrap: 'wrap' }}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14, letterSpacing: '-0.01em' }} dir="auto">{template.name}</p>
          <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 999, fontWeight: 700, fontFamily: '"IBM Plex Mono", monospace', background: ts.badgeBg, color: ts.badgeColor }}>
            {t(ts.badgeKey === 'ready' ? 'automations.template.ready' : ts.badgeKey === 'incomplete' ? 'automations.template.incomplete' : 'automations.template.notAvailable')}
          </span>
          {template.already_exists && (
            <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 999, fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace', background: `color-mix(in srgb, var(--ok) 14%, transparent)`, color: 'var(--ok)' }}>
              {t('automations.template.active')}
            </span>
          )}
        </div>

        {/* One-line status — visible in both states so the card stays scannable. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ink-mute)', fontFamily: 'inherit' }}>
          <span aria-hidden="true" style={{ transform: expanded ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>›</span>
          {statusLine}
        </div>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              style={{ overflow: 'hidden' }}
            >
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: '8px 0', lineHeight: 1.4 }} dir="auto">{template.description}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 4 }}>
                {matched.map(m => (
                  <div key={m.cap} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--ok)', fontSize: 11, flexShrink: 0 }}>✓</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-2)' }} dir="auto">{m.label}</span>
                  </div>
                ))}
                {missReq.map(m => (
                  <div key={m.cap} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--warn)', fontSize: 11, flexShrink: 0 }}>✗</span>
                    <span style={{ fontSize: 11, color: 'var(--warn)' }} dir="auto">{m.label}</span>
                    <span style={{ fontSize: 10, color: 'var(--warn)', fontFamily: '"IBM Plex Mono", monospace', opacity: 0.7 }}>{t('automations.template.required')}</span>
                  </div>
                ))}
                {missOpt.map(m => (
                  <div key={m.cap} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--ink-faint)', fontSize: 11, flexShrink: 0 }}>○</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-faint)' }} dir="auto">{m.label}</span>
                    <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{t('automations.template.optional')}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div style={{ flexShrink: 0 }}>
        <button
          onClick={(e) => { e.stopPropagation(); onConfigure(template) }}
          disabled={!canConfigure}
          className={tier === 'ready' ? 'z-btn-primary' : 'z-btn-secondary'}
          style={{ fontSize: 12, padding: '6px 12px', borderRadius: 9, whiteSpace: 'nowrap', opacity: canConfigure ? 1 : 0.35 }}
        >
          {tier === 'ready' ? t('automations.template.configure') : tier === 'partial' ? t('automations.template.configure') : t('automations.template.addDevices')}
        </button>
      </div>
    </div>
  )
}

export default TemplateCard
