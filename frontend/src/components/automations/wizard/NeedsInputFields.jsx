import React, { useEffect, useState } from 'react'
import { Input } from '../../ui/Input'
import { useT } from '../../../lib/i18n'
import { getEntityState } from '../../../lib/api'
import { selectStyle } from '../../../lib/automations/styles'

// ── NeedsInputFields ──────────────────────────────────────────────────────────
function NeedsInputFields({ fields, entityId, serviceData, onChangeServiceData }) {
  const t = useT()
  const [attrs, setAttrs] = useState({})
  useEffect(() => {
    if (!entityId || !fields.some(f => f.fetchKey)) return
    getEntityState(entityId).then(data => setAttrs(data.attributes || {})).catch(() => {})
  }, [entityId])
  return fields.map(({ key, label, placeholder, isNumber, fetchKey }) => {
    const options    = fetchKey ? (attrs[fetchKey] || []) : []
    const currentVal = (serviceData || {})[key] ?? ''
    if (fetchKey && options.length > 0) {
      return (
        <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>{label}</label>
          <select style={selectStyle} value={currentVal} onChange={e => onChangeServiceData({ ...(serviceData || {}), [key]: e.target.value })}>
            <option value="">{t('automations.needs.pickLabel', { label })}</option>
            {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>
      )
    }
    if (fetchKey && !entityId) return (
      <p key={key} style={{ fontSize: 11, color: 'var(--ink-faint)', fontStyle: 'italic' }}>{t('automations.needs.entityHint', { label: label.toLowerCase() })}</p>
    )
    return (
      <Input
        key={key}
        label={label}
        placeholder={fetchKey && entityId ? t('automations.needs.loading') : placeholder}
        type={isNumber ? 'number' : 'text'}
        value={currentVal}
        onChange={e => { const v = isNumber ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value; onChangeServiceData({ ...(serviceData || {}), [key]: v }) }}
        dir={isNumber ? undefined : 'auto'}
      />
    )
  })
}

export default NeedsInputFields
