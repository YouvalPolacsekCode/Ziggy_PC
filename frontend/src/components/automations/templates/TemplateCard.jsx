import React, { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Zap, Hand, Mic, Sparkles, Check, ChevronRight } from 'lucide-react'
import { useT, useLang } from '../../../lib/i18n'
import { T_STATE } from '../../../lib/motion'

// Trigger chip — makes the Automatic/On-demand line visible per-card in a
// MIXED list (Active tab, a filtered "all" view). Inside a single-kind Library
// section it's just noise (the section header already says it), so TemplatesTab
// passes showTriggerChip={false} there.
const TRIGGER_CHIP = {
  automatic: { Icon: Zap,  labelKey: 'automations.chipAutomatic' },
  tap:       { Icon: Hand, labelKey: 'automations.chipTap' },
  say:       { Icon: Mic,  labelKey: 'automations.chipSay' },
}

export function TriggerChip({ kind }) {
  const t = useT()
  const chip = TRIGGER_CHIP[kind]
  if (!chip) return null
  const { Icon } = chip
  return (
    <span className="z-chip">
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" />{t(chip.labelKey)}
    </span>
  )
}

// ── TemplateCard ──────────────────────────────────────────────────────────────
// Friendly, plain-language card. No tier caps-badges, no ✓/✗ capability audit —
// just: what it does, whether you can add it now, and one warm line about what
// (if anything) it still needs.
//
// HIG pass: 44px glyph box (the recipe's own emoji identity when the library
// supplies one, else a line glyph), Headline name, Subhead status line, 13px
// chips, and one class-driven Add button. The ready tint is gone — "Ready to
// add" in words is the signal; a green card border was a second, louder one.
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
        padding: 16, borderRadius: 'var(--r-card)',
        background: 'var(--surface)', border: '0.5px solid var(--line)',
        display: 'flex', alignItems: 'flex-start', gap: 16,
        cursor: 'pointer', userSelect: 'none',
      }}
      dir="auto"
    >
      <div aria-hidden="true" style={{
        width: 44, height: 44, borderRadius: 'var(--r-ctl)', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--surface-2)', color: 'var(--ink-2)', fontSize: 22, lineHeight: 1,
      }}>
        {template.icon || <Sparkles size={22} strokeWidth={1.75} />}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Name row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
          <p className="z-headline" style={{ margin: 0 }} dir="auto">{displayName}</p>
          {showTriggerChip && <TriggerChip kind={template.trigger_kind} />}
          {template.already_exists && (
            <span className="z-chip" style={{ color: 'var(--ok-text)' }}>
              <Check size={14} strokeWidth={2} aria-hidden="true" />{t('automations.template.added')}
            </span>
          )}
        </div>

        {/* One-line status + expander chevron */}
        <div className="z-subhead" style={{ display: 'flex', alignItems: 'center', gap: 4, color: isReady ? 'var(--ok-text)' : 'var(--ink-mute)' }}>
          <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true"
            style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform var(--dur-state) var(--ease-standard)', color: 'var(--ink-faint)', flexShrink: 0 }} />
          {statusLine}
        </div>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={T_STATE}
              style={{ overflow: 'hidden' }}
            >
              <p className="z-subhead" style={{ color: 'var(--ink-2)', margin: '8px 0 0' }} dir="auto">{template.description}</p>
              {!isReady && missReq.length > 0 && (
                <p className="z-subhead" style={{ margin: '8px 0 0' }} dir="auto">
                  {t('automations.template.youllNeed', { items: nameOf(missReq) })}
                </p>
              )}
              {isReady && missOpt.length > 0 && (
                <p className="z-footnote" style={{ margin: '8px 0 0' }} dir="auto">
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
          className={canAdd ? 'z-btn-primary' : 'z-btn-secondary'}
          style={{ whiteSpace: 'nowrap', opacity: canAdd ? 1 : 0.4, cursor: canAdd ? 'pointer' : 'not-allowed' }}
        >
          {t('automations.template.add')}
        </button>
      </div>
    </div>
  )
}

export default TemplateCard
