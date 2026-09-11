import React, { useState } from 'react'
import { ListChecks } from 'lucide-react'
import { Input } from '../../ui/Input'
import { useT } from '../../../lib/i18n'
import { getSendIntentGroups } from '../../../lib/automations/types'

// ── SendIntentEditor ──────────────────────────────────────────────────────────
// Free-text phrase + a 44px "templates" button that reveals a list of ready
// phrases (44px rows). The old 📝 emoji button is a line glyph now.
function SendIntentEditor({ value, onChange }) {
  const t = useT()
  const sendIntentGroups = getSendIntentGroups(t)
  const [showTemplates, setShowTemplates] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Input
            placeholder={t('automations.sendIntent.placeholder')}
            value={value}
            onChange={e => onChange(e.target.value)}
            dir="auto"
          />
        </div>
        <button type="button" onClick={() => setShowTemplates(v => !v)} className="z-icon-btn"
          aria-pressed={showTemplates} aria-label={t('automations.sendIntent.placeholder')}>
          <ListChecks size={18} strokeWidth={1.75} />
        </button>
      </div>
      {showTemplates && (
        <div style={{ borderRadius: 'var(--r-ctl)', border: '0.5px solid var(--line)', overflow: 'hidden', background: 'var(--surface)' }}>
          {sendIntentGroups.map(({ key, items }) => (
            <div key={key}>
              <p className="z-eyebrow" style={{ padding: '12px 16px 4px', margin: 0 }}>{t(`automations.sendIntent.${key}`)}</p>
              {items.map(tpl => (
                <button key={tpl} type="button" onClick={() => { onChange(tpl); setShowTemplates(false) }} dir="auto"
                  style={{
                    display: 'block', width: '100%', minHeight: 44, padding: '8px 16px',
                    background: 'none', border: 'none', textAlign: 'start',
                    fontSize: 15, color: 'var(--ink-2)', cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'background var(--dur-press) var(--ease-standard)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >{tpl}</button>
              ))}
            </div>
          ))}
        </div>
      )}
      <p className="z-footnote" style={{ margin: 0 }}>
        {t('automations.sendIntent.replaceHint')}
      </p>
    </div>
  )
}

export default SendIntentEditor
