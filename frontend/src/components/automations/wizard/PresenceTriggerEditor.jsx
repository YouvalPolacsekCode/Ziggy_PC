import React, { useEffect, useState } from 'react'
import { Select } from '../../ui/Select'
import { useT } from '../../../lib/i18n'
import { getHousehold, listPresenceZones } from '../../../lib/api'
import { FieldHint } from './Atoms'

// ── PresenceTriggerEditor ─────────────────────────────────────────────────────
//
// "When someone arrives or leaves", on Ziggy's own presence engine.
//
// This replaced a Home Assistant `zone` trigger that asked the user to pick a
// `person.*` / `device_tracker.*` entity. Ziggy never creates those — presence
// lives in Ziggy's own store and publishes ONE household roll-up to HA on
// purpose (see services/presence_mqtt.py). So that dropdown was empty in every
// Ziggy home ever built, while the engine that actually tracks people fires
// `person_arrives` / `person_leaves` / `all_persons_left` and nothing in the
// wizard could emit them.
//
// The list comes from /api/presence/household — ACCOUNTS joined to presence,
// not presence alone. Someone invited an hour ago has no presence record yet,
// and a picker built from presence would leave them out, so you could not
// write "when Rachel gets home" until Rachel had already installed the app.
// They appear immediately, marked as not-yet-tracked.
//
// The trigger stores a NAME (matching services/presence_side_effects.py, which
// compares `trigger.person` against the person's name, case-insensitively).
// "*" means anyone.
function PresenceTriggerEditor({ trigger, onChange }) {
  const t = useT()
  const [household, setHousehold] = useState([])
  const [zones, setZones] = useState([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    getHousehold()
      .then(r => { if (alive) { setHousehold(r?.household || []); setLoaded(true) } })
      .catch(() => { if (alive) setLoaded(true) })
    // Named places ("Near Home"), for the arriving-at / leaving-a-place
    // options. Only offered when the home actually has one.
    listPresenceZones()
      .then(r => { if (alive) setZones(r?.zones || []) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // `all_persons_left` carries no person — it is the whole household by
  // definition. Presented as a third option in the same dropdown as
  // arrives/leaves because "when everyone's out" is the same thought as
  // "when I leave", not a different kind of trigger.
  const event = trigger.type === 'all_persons_left' ? 'all_left'
    : trigger.type === 'person_leaves' ? 'leaves'
    : trigger.type === 'zone_entered' ? 'zone_in'
    : trigger.type === 'zone_left' ? 'zone_out'
    : 'arrives'

  // Named places are a separate geofence from home ("Near Home" is the wide
  // approach ring Pre-cool uses). Only worth offering once one exists.
  const eventOptions = [
    { value: 'arrives',  label: t('automations.presence.arrives') },
    { value: 'leaves',   label: t('automations.presence.leaves') },
    { value: 'all_left', label: t('automations.presence.allLeft') },
    ...(zones.length > 0 ? [
      { value: 'zone_in',  label: t('automations.presence.zoneIn') },
      { value: 'zone_out', label: t('automations.presence.zoneOut') },
    ] : []),
  ]
  const isZoneEvent = event === 'zone_in' || event === 'zone_out'

  const personOptions = [
    { value: '*', label: t('automations.presence.anyone') },
    ...household.map(m => ({
      value: m.name,
      // An untracked member is selectable — the automation saves and waits.
      label: m.tracked ? m.name : t('automations.presence.notTrackedOption', { name: m.name }),
    })),
  ]

  const setEvent = (next) => {
    if (next === 'all_left') onChange({ type: 'all_persons_left' })
    else if (next === 'zone_in' || next === 'zone_out') onChange({
      type:   next === 'zone_in' ? 'zone_entered' : 'zone_left',
      zone:   trigger.zone || zones[0]?.name || '',
      person: trigger.person || '*',
    })
    else onChange({
      type:   next === 'leaves' ? 'person_leaves' : 'person_arrives',
      person: trigger.person || '*',
    })
  }

  const selected = household.find(m => m.name === trigger.person)
  const showWaiting = event !== 'all_left' && selected && !selected.tracked
  const nobodyTracked = loaded && household.length > 0 && household.every(m => !m.tracked)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Select
        label={t('automations.presence.whenLabel')}
        options={eventOptions}
        value={event}
        onChange={e => setEvent(e.target.value)}
      />

      {isZoneEvent && (
        <Select
          label={t('automations.presence.placeLabel')}
          options={zones.map(z => ({ value: z.name, label: z.name }))}
          value={trigger.zone || zones[0]?.name || ''}
          onChange={e => onChange({ ...trigger, zone: e.target.value })}
        />
      )}

      {event !== 'all_left' && (
        <Select
          label={t('automations.presence.whoLabel')}
          options={personOptions}
          value={trigger.person || '*'}
          onChange={e => onChange({ ...trigger, person: e.target.value })}
        />
      )}

      {/* "Waiting for their phone" — the automation is valid and saved, it
          just cannot fire until that person's phone checks in once. Saying so
          here is the difference between a known wait and a silent no-op the
          user reports as "it didn't work". */}
      {showWaiting && (
        <FieldHint>{t('automations.presence.waitingForPhone', { name: selected.name })}</FieldHint>
      )}

      {event === 'all_left' && (
        <FieldHint>{t('automations.presence.allLeftHint')}</FieldHint>
      )}

      {nobodyTracked && event !== 'all_left' && !showWaiting && (
        <FieldHint>{t('automations.presence.nobodyTracked')}</FieldHint>
      )}
    </div>
  )
}

export default PresenceTriggerEditor
