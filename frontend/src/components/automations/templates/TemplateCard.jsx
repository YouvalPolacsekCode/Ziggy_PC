import React, { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useT, useLang } from '../../../lib/i18n'

// Trigger chip — makes the Automatic/On-demand line visible per-card in a
// MIXED list (Active tab, a filtered "all" view). Inside a single-kind Library
// section it's just noise (the section header already says it), so TemplatesTab
// passes showTriggerChip={false} there.
const TRIGGER_CHIP = {
  automatic: { icon: '⚡', labelKey: 'automations.chipAutomatic' },
  tap:       { icon: '👆', labelKey: 'automations.chipTap' },
  say:       { icon: '🗣', labelKey: 'automations.chipSay' },
}

export function TriggerChip({ kind }) {
  const t = useT()
  const chip = TRIGGER_CHIP[kind]
  if (!chip) return null
  return (
    <span style={{
      fontSize: 9, padding: '1px 7px', borderRadius: 999, fontWeight: 600,
      fontFamily: '"IBM Plex Mono", monospace', display: 'inline-flex',
      alignItems: 'center', gap: 3, background: 'var(--bg-2)', color: 'var(--ink-mute)',
    }}>
      <span aria-hidden="true">{chip.icon}</span>{t(chip.labelKey)}
    </span>
  )
}

// ── TemplateCard ──────────────────────────────────────────────────────────────
// Friendly, plain-language card. No tier caps-badges, no ✓/✗ capability audit —
// just: what it does, whether you can add it now, and one warm line about what
// (if anything) it still needs.
function TemplateCard({ template, onConfigure, showTriggerChip = true }) {
  const t = useT()
  const lang = useLang()
  const displayName = (lang === 'he' && template.name_he) ? template.name_he : template.name

  const tier    = template.tier || (template.can_run ? 'ready' : 'unavailable')
  const isReady = tier === 'ready'
  const missReq = template.missing_req_labels || []
  const missOpt = template.missing_opt_labels || []
  // Add is enabled ONLY when the automation is actually runnable (all required
  // sensors present) — that's when a wizard_prefill exists. A 'partial' template
  // (has some relevant sensors but missing a required one) has no prefill, so
  // enabling Add there was a dead click that just closed the Library. Missing
  // sensors → Add disabled, and the card shows "Needs: …".
  const canAdd  = tier === 'ready' && !!template.wizard_prefill
  const [expanded, setExpanded] = useState(false)

  const nameOf = (arr) => arr.map(m => m.short || m.label).join(' + ')
  // One warm status line under the name.
  const statusLine = isReady
    ? t('automations.template.readyToAdd')
    : t('automations.template.needs', { items: nameOf(missReq) })

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={() => setExpanded(v => !v)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v) } }}
      style={{
        padding: '14px 16px', borderRadius: 14,
        background: isReady ? 'color-mix(in srgb, var(--ok) 4%, var(--surface))' : 'var(--surface)',
        border: `0.5px solid ${isReady ? 'color-mix(in srgb, var(--ok) 22%, var(--line))' : 'var(--line)'}`,
        display: 'flex', alignItems: 'flex-start', gap: 12,
        cursor: 'pointer', userSelect: 'none',
      }}
      dir="auto"
    >
      <div style={{
        width: 38, height: 38, borderRadius: 11, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-2)', fontSize: 19,
      }}>
        {template.icon}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Name row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3, flexWrap: 'wrap' }}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14.5, letterSpacing: '-0.01em', margin: 0 }} dir="auto">{displayName}</p>
          {showTriggerChip && <TriggerChip kind={template.trigger_kind} />}
          {template.already_exists && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, padding: '1px 7px', borderRadius: 999, fontWeight: 600, background: 'color-mix(in srgb, var(--ok) 14%, transparent)', color: 'var(--ok)' }}>
              ✓ {t('automations.template.added')}
            </span>
          )}
        </div>

        {/* One-line status + expander chevron */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: isReady ? 'var(--ok)' : 'var(--ink-mute)' }}>
          <span aria-hidden="true" style={{ transform: expanded ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s', color: 'var(--ink-faint)' }}>›</span>
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
              <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '9px 0 0', lineHeight: 1.45 }} dir="auto">{template.description}</p>
              {!isReady && missReq.length > 0 && (
                <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: '8px 0 0', lineHeight: 1.4 }} dir="auto">
                  {t('automations.template.youllNeed', { items: nameOf(missReq) })}
                </p>
              )}
              {isReady && missOpt.length > 0 && (
                <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: '6px 0 0', lineHeight: 1.4 }} dir="auto">
                  {t('automations.template.betterWith', { items: nameOf(missOpt) })}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div style={{ flexShrink: 0 }}>
        <button
          onClick={(e) => { e.stopPropagation(); onConfigure(template) }}
          disabled={!canAdd}
          className={isReady ? 'z-btn-primary' : 'z-btn-secondary'}
          style={{ fontSize: 13, padding: '7px 16px', borderRadius: 10, whiteSpace: 'nowrap', fontWeight: 600, opacity: canAdd ? 1 : 0.4 }}
        >
          {t('automations.template.add')}
        </button>
      </div>
    </div>
  )
}

export default TemplateCard
