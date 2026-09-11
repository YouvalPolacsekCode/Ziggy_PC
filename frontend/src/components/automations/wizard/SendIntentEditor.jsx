import React, { useState } from 'react'
import { Input } from '../../ui/Input'
import { useT } from '../../../lib/i18n'
import { getSendIntentGroups } from '../../../lib/automations/types'

// ── SendIntentEditor ──────────────────────────────────────────────────────────
function SendIntentEditor({ value, onChange }) {
  const t = useT()
  const sendIntentGroups = getSendIntentGroups(t)
  const [showTemplates, setShowTemplates] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <Input
          placeholder={t('automations.sendIntent.placeholder')}
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{ flex: 1 }}
          dir="auto"
        />
        <button onClick={() => setShowTemplates(v => !v)} style={{
          padding: '0 10px', borderRadius: 9,
          background: 'var(--bg-2)', border: '0.5px solid var(--line)',
          color: 'var(--ink-mute)', cursor: 'pointer', fontSize: 14, flexShrink: 0,
        }}>📝</button>
      </div>
      {showTemplates && (
        <div style={{ borderRadius: 11, border: '0.5px solid var(--line)', overflow: 'hidden', background: 'var(--surface)' }}>
          {sendIntentGroups.map(({ key, items }) => (
            <div key={key}>
              <p className="z-eyebrow" style={{ padding: '8px 10px 4px' }}>{t(`automations.sendIntent.${key}`)}</p>
              {items.map(tpl => (
                <button key={tpl} onClick={() => { onChange(tpl); setShowTemplates(false) }} dir="auto"
                  style={{
                    display: 'block', width: '100%', padding: '6px 10px',
                    background: 'none', border: 'none', textAlign: 'start',
                    fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >{tpl}</button>
              ))}
            </div>
          ))}
        </div>
      )}
      <p style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
        {t('automations.sendIntent.replaceHint')}
      </p>
    </div>
  )
}

export default SendIntentEditor
