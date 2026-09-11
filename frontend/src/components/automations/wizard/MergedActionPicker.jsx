import React from 'react'
import { getActionLabel } from '../../ui/EntitySelect'
import { useT } from '../../../lib/i18n'
import { selectStyle } from '../../../lib/automations/styles'

// ── MergedActionPicker ────────────────────────────────────────────────────────
function MergedActionPicker({ haActions, irDevice, haValue, onChangeHa, onPickIrCommand }) {
  const t = useT()
  const learned = new Set(irDevice?.learned_commands || [])
  const cmds    = irDevice?.commands || {}
  const irList  = Object.keys(cmds).filter(c => cmds[c] && learned.has(c))

  const handleChange = e => {
    const val = e.target.value
    if (val.startsWith('__ir__:')) onPickIrCommand(val.slice(7))
    else onChangeHa(val)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>{t('automations.action.label')}</label>
      <select style={selectStyle} value={haValue} onChange={handleChange}>
        <optgroup label={t('automations.action.haGroup')}>
          {haActions.map(a => <option key={a.value} value={a.value}>{getActionLabel(a, t)}</option>)}
        </optgroup>
        {irList.length > 0 && (
          <optgroup label={t('automations.action.irGroup', { name: irDevice?.name })}>
            {irList.map(cmd => <option key={cmd} value={`__ir__:${cmd}`}>{cmd.replace(/_/g, ' ')}</option>)}
          </optgroup>
        )}
      </select>
      {irList.length > 0 && <p style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{t('automations.action.irConvertHint')}</p>}
    </div>
  )
}

export default MergedActionPicker
