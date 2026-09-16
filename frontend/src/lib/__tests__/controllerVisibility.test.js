import { describe, it, expect, beforeEach } from 'vitest'
import { useDeviceStore } from '../../stores/deviceStore'

// A controller group carries ZERO entities (a stateless remote has no HA
// entity), so its `primary_entity_id` is null. The grouping pass drops any
// entity that is not its group's primary — which silently deleted the
// controller card from the Devices page the moment the group was indexed by
// entity id. This locks the card in place.

const IEEE = '0x54ef441001782d71'
const EID = `controller.${IEEE}`

const controllerGroup = {
  group_id: `controller_${IEEE}`, kind: 'controller', card_kind: 'controller',
  signature: IEEE, name: 'Wall switch', room: 'living_room', status: 'connected',
  primary_entity_id: null, ha_device_id: 'dev123', entities: [], metrics: [],
  actions: [{ subtype: 'single_left', label: 'Left button — single press' }],
}

const lightGroup = {
  group_id: 'ha_light', kind: 'ha', card_kind: 'light', signature: 'l',
  name: 'Office Light', room: 'office', status: 'connected',
  primary_entity_id: 'light.office', ha_device_id: 'd1',
  entities: [{ entity_id: 'light.office', role: 'primary' }], metrics: [],
}

const controllerEntity = {
  entity_id: EID, domain: 'controller', state: 'ready',
  display_name: 'Wall switch', _controller: true, ha_device_id: 'dev123',
}

const lightEntity = { entity_id: 'light.office', domain: 'light', state: 'on' }

beforeEach(() => {
  useDeviceStore.setState({
    entities: [lightEntity, controllerEntity],
    deviceGroups: [lightGroup, controllerGroup],
    groupById: { [lightGroup.group_id]: lightGroup, [controllerGroup.group_id]: controllerGroup },
    groupByEntityId: { 'light.office': lightGroup.group_id, [EID]: controllerGroup.group_id },
    showHidden: false,
  })
})

describe('controller visibility', () => {
  it('keeps the controller in the visible device list', () => {
    const ids = useDeviceStore.getState().getGroupedEntities().map(e => e.entity_id)
    expect(ids).toContain(EID)
  })

  it('does not drop the ordinary device either', () => {
    const ids = useDeviceStore.getState().getGroupedEntities().map(e => e.entity_id)
    expect(ids).toEqual(expect.arrayContaining(['light.office', EID]))
  })

  it('attaches the group so the detail page can reach ha_device_id', () => {
    const c = useDeviceStore.getState().getGroupedEntities().find(e => e.entity_id === EID)
    expect(c._group?.ha_device_id).toBe('dev123')
  })

  it('still drops a genuine non-primary sibling', () => {
    useDeviceStore.setState({
      entities: [lightEntity, { entity_id: 'sensor.office_power', domain: 'sensor' }],
      groupByEntityId: { 'light.office': lightGroup.group_id,
                         'sensor.office_power': lightGroup.group_id },
    })
    const ids = useDeviceStore.getState().getGroupedEntities().map(e => e.entity_id)
    expect(ids).not.toContain('sensor.office_power')
  })
})

describe('controller in room views', () => {
  it('keeps the controller in its room (Devices "By room" and Rooms page)', () => {
    useDeviceStore.setState({
      ziggyRooms: [{ id: 'living_room', name: 'Living Room', devices: [
        { entity_id: 'light.office', display_name: 'Office Light' },
        { entity_id: EID, display_name: 'Wall switch', domain: 'controller',
          ha_device_id: 'dev123' },
      ] }],
    })
    const room = useDeviceStore.getState().getGroupedZiggyRooms()[0]
    expect(room.devices.map(d => d.entity_id)).toContain(EID)
  })

  it('still collapses a real multi-entity group to its primary', () => {
    useDeviceStore.setState({
      ziggyRooms: [{ id: 'office', name: 'Office', devices: [
        { entity_id: 'light.office' },
        { entity_id: 'sensor.office_power' },
      ] }],
      groupByEntityId: { 'light.office': lightGroup.group_id,
                         'sensor.office_power': lightGroup.group_id },
    })
    const room = useDeviceStore.getState().getGroupedZiggyRooms()[0]
    expect(room.devices.map(d => d.entity_id)).toEqual(['light.office'])
  })
})
