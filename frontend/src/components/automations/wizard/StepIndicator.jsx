import React from 'react'
import { useT } from '../../../lib/i18n'

// ── Step indicator ────────────────────────────────────────────────────────────
const STEP_KEYS = ['stepName', 'stepTrigger', 'stepConditions', 'stepActions', 'stepReview']
export const STEP_COUNT = STEP_KEYS.length

function StepIndicator({ current, onJump, maxReached = STEP_COUNT - 1 }) {
  const t = useT()
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 20 }}>
      {STEP_KEYS.map((sKey, i) => {
        const s = t(`automations.wizard.${sKey}`)
        const enabled = onJump && i <= maxReached
        const isCurrent = i === current
        const isDone = i < current
        return (
          <div key={sKey} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              onClick={() => enabled && onJump(i)}
              disabled={!enabled}
              title={enabled ? t('automations.wizard.goTo', { step: s }) : t('automations.wizard.completePrev')}
              style={{
                width: 24, height: 24, borderRadius: '50%', padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                background: isDone ? 'var(--ink)' : isCurrent ? `color-mix(in srgb, var(--ink) 12%, var(--surface))` : 'var(--bg-2)',
                color: isDone ? 'var(--bg)' : isCurrent ? 'var(--ink)' : 'var(--ink-faint)',
                border: isCurrent ? '1.5px solid var(--ink)' : '0.5px solid var(--line)',
                cursor: enabled ? 'pointer' : 'default',
              }}
            >
              {isDone ? '✓' : i + 1}
            </button>
            {i < STEP_COUNT - 1 && (
              <div style={{ width: 20, height: 1, background: i < current ? 'var(--ink)' : 'var(--line)' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default StepIndicator
