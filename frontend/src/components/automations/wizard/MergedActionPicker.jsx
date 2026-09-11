import React from 'react'
import { getActionLabel } from '../../ui/EntitySelect'
import { useT } from '../../../lib/i18n'
import { selectStyle, fieldLabelStyle } from '../../../lib/automations/styles'

// ── MergedActionPicker ────────────────────────────────────────────────────────
// A raw <select> (the shared Select can't render <optgroup>) drawn with the
// shared 44px / 17px select geometry.
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
      <label style={fieldLabelStyle}>{t('automations.action.label')}</label>
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
      {irList.length > 0 && <p className="z-footnote" style={{ margin: '4px 0 0' }}>{t('automations.action.irConvertHint')}</p>}
    </div>
  )
}

export default MergedActionPicker
