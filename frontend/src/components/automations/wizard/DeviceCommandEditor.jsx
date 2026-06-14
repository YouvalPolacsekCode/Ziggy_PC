import React, { useEffect, useState } from 'react'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { EntitySelect } from '../../ui/EntitySelect'
import { useT } from '../../../lib/i18n'
import { getDeviceCommands } from '../../../lib/api'
import { CONTROLLABLE_DOMAINS } from '../../../lib/domainRegistry'

// ── ActionRow ─────────────────────────────────────────────────────────────────
// Renders the full HA service catalog for a chosen entity. Backed by
// services/ha_capabilities (services/ha_capabilities.py) so every command
// HA exposes for the device becomes selectable in automations / routines —
// not just the curated `call_service` shortlist.
function DeviceCommandEditor({ value, onChange }) {
  const t = useT()
  const [commands, setCommands] = useState([])
  const [loading, setLoading] = useState(false)
  const entityId = value.entity_id || ''
  const commandId = value.command_id || ''
  const params = value.params || {}

  useEffect(() => {
    let cancelled = false
    if (!entityId) { setCommands([]); return }
    setLoading(true)
    getDeviceCommands(entityId)
      .then(r => { if (!cancelled) setCommands(r?.commands || []) })
      .catch(() => { if (!cancelled) setCommands([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [entityId])

  const selectedCmd = commands.find(c => c.id === commandId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <EntitySelect
        value={entityId}
        onChange={v => onChange({ entity_id: v, command_id: '', params: {} })}
        placeholder={t('automations.action.selectDevice')}
        allowedDomains={CONTROLLABLE_DOMAINS}
      />
      {entityId && (
        <Select
          value={commandId}
          onChange={e => onChange({ command_id: e.target.value, params: {} })}
          options={[
            { value: '', label: loading ? t('automations.action.loadingCommands') : t('automations.action.chooseCommand') },
            ...commands.map(c => ({
              value: c.id,
              label: c.source === 'ir' ? t('automations.action.commandIRSuffix', { label: c.label }) : c.label,
            })),
          ]}
        />
      )}
      {selectedCmd && (selectedCmd.fields || []).map(f => (
        <div key={f.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
            {f.label}{f.required ? ' *' : ''}
          </span>
          {f.kind === 'number' ? (
            <Input
              type="number" min={f.min} max={f.max} step={f.step}
              value={params[f.name] ?? f.default ?? ''}
              placeholder={f.description || f.label}
              onChange={e => onChange({ params: { ...params, [f.name]: e.target.value === '' ? null : Number(e.target.value) } })}
            />
          ) : f.kind === 'select' ? (
            <Select
              value={params[f.name] ?? f.default ?? ''}
              onChange={e => onChange({ params: { ...params, [f.name]: e.target.value } })}
              options={[{ value: '', label: t('automations.action.selectPlaceholder') }, ...((f.options || []).map(o => {
                const v = typeof o === 'object' ? (o.value ?? o.label) : o
                const l = typeof o === 'object' ? (o.label ?? o.value) : o
                return { value: v, label: l }
              }))]}
            />
          ) : f.kind === 'boolean' ? (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={Boolean(params[f.name] ?? f.default ?? false)}
                onChange={e => onChange({ params: { ...params, [f.name]: e.target.checked } })}
              />
              <span style={{ fontSize: 12 }}>{f.label}</span>
            </label>
          ) : (
            <Input
              value={params[f.name] ?? f.default ?? ''}
              placeholder={f.description || f.label}
              onChange={e => onChange({ params: { ...params, [f.name]: e.target.value } })}
              dir="auto"
            />
          )}
        </div>
      ))}
    </div>
  )
}

export default DeviceCommandEditor
