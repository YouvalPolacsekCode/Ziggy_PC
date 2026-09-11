import React, { useEffect, useState } from 'react'
import { Select } from '../../ui/Select'
import { EntitySelect } from '../../ui/EntitySelect'
import { useT } from '../../../lib/i18n'
import { getEntities } from '../../../lib/api'
import { entityDisplayName } from '../../../lib/utils'
import { TRACKER_DOMAINS } from '../../../lib/automations/types'
import { noteBox } from '../../../lib/automations/styles'

// ── ZoneTriggerEditor ─────────────────────────────────────────────────────────
function ZoneTriggerEditor({ trigger, onChange }) {
  const t = useT()
  const [zones, setZones] = useState([])
  useEffect(() => {
    getEntities('zone').then(r => {
      setZones((r.entities || r || []).filter(e => e.entity_id?.startsWith('zone.')))
    }).catch(() => {})
  }, [])

  // Build only the non-home zones — Home is the implied default and we don't
  // make the user pick "Home" out of a one-item dropdown.
  const extraZones = zones.filter(z => z.entity_id !== 'zone.home').map(z => ({
    value: z.entity_id,
    label: entityDisplayName(z),
  }))
  const zoneOptions = [
    { value: 'zone.home', label: t('automations.editor.zoneHome') },
    ...extraZones,
  ]

  // Default the trigger to home if nothing's chosen yet. Stored value never goes
  // empty so HA always gets a valid zone target.
  useEffect(() => {
    if (!trigger.zone) onChange({ ...trigger, zone: 'zone.home' })
  }, [])

  const eventOptions = [
    { value: 'enter', label: t('automations.editor.zoneEnter') },
    { value: 'leave', label: t('automations.editor.zoneLeave') },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <EntitySelect
        label={t('automations.editor.zoneTrackLabel')}
        value={trigger.entity_id || ''}
        onChange={v => onChange({ ...trigger, entity_id: v })}
        allowedDomains={TRACKER_DOMAINS}
        placeholder={t('automations.editor.zoneTrackPh')}
      />
      {/* Zone is always shown — even with only Home available — so users
          discover they can add more zones in HA (the tip below explains how). */}
      <Select
        label={t('automations.editor.zoneLabel')}
        options={zoneOptions}
        value={trigger.zone || 'zone.home'}
        onChange={e => onChange({ ...trigger, zone: e.target.value })}
      />
      <Select
        label={t('automations.editor.stateWhen')}
        options={eventOptions}
        value={trigger.event || 'enter'}
        onChange={e => onChange({ ...trigger, event: e.target.value })}
      />

      {/* Tip: approaching home — a quiet note, not a blue callout. */}
      <div style={noteBox}>
        <p className="z-subhead" style={{ fontWeight: 600, color: 'var(--ink)', margin: '0 0 4px' }}>
          {t('automations.editor.zoneBeforeTitle')}
        </p>
        <p className="z-subhead" style={{ margin: 0 }}>
          {t('automations.editor.zoneBeforeBody')}
        </p>
      </div>
    </div>
  )
}

export default ZoneTriggerEditor
