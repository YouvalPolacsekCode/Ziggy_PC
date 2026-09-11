import React, { useEffect, useState } from 'react'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { useT } from '../../../lib/i18n'
import { getEntityState } from '../../../lib/api'

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
        <Select
          key={key}
          label={label}
          value={currentVal}
          onChange={e => onChangeServiceData({ ...(serviceData || {}), [key]: e.target.value })}
          options={[
            { value: '', label: t('automations.needs.pickLabel', { label }) },
            ...options.map(opt => ({ value: opt, label: opt })),
          ]}
        />
      )
    }
    if (fetchKey && !entityId) return (
      <p key={key} className="z-subhead" style={{ margin: 0 }}>{t('automations.needs.entityHint', { label: label.toLowerCase() })}</p>
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
