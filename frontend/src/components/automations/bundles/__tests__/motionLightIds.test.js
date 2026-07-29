// Multi-instance Motion Light id scheme. Locks the contract that lets "Add"
// create a second independent Motion Light instead of overwriting the first,
// while keeping the legacy single-instance ids working.

import { describe, expect, it } from 'vitest'
import {
  isMotionLightId, isInstanceBaseId, isStageId, instanceBaseOf,
  instanceBases, instanceMemberIds, freshInstanceBase, stageId,
} from '../recipes/motionLightIds'

describe('motionLightIds', () => {
  it('recognises family membership', () => {
    expect(isMotionLightId('ziggy_motion_light')).toBe(true)
    expect(isMotionLightId('ziggy_motion_light_2')).toBe(true)
    expect(isMotionLightId('ziggy_motion_light_2_kitchen')).toBe(true)
    expect(isMotionLightId('ziggy_motion_light_office')).toBe(true) // 1st-instance stage
    expect(isMotionLightId('ziggy_leave_home')).toBe(false)
    expect(isMotionLightId('my_custom')).toBe(false)
  })

  it('separates instance bases from stages', () => {
    expect(isInstanceBaseId('ziggy_motion_light')).toBe(true)
    expect(isInstanceBaseId('ziggy_motion_light_2')).toBe(true)
    expect(isInstanceBaseId('ziggy_motion_light_10')).toBe(true)
    expect(isInstanceBaseId('ziggy_motion_light_2_kitchen')).toBe(false)
    expect(isInstanceBaseId('ziggy_motion_light_kitchen')).toBe(false) // 1st-instance stage
    expect(isStageId('ziggy_motion_light_2_kitchen')).toBe(true)
    expect(isStageId('ziggy_motion_light_kitchen')).toBe(true)
    expect(isStageId('ziggy_motion_light')).toBe(false)
    expect(isStageId('ziggy_motion_light_2')).toBe(false)
  })

  it('maps any id back to its instance base', () => {
    expect(instanceBaseOf('ziggy_motion_light')).toBe('ziggy_motion_light')
    expect(instanceBaseOf('ziggy_motion_light_2')).toBe('ziggy_motion_light_2')
    expect(instanceBaseOf('ziggy_motion_light_2_kitchen')).toBe('ziggy_motion_light_2')
    expect(instanceBaseOf('ziggy_motion_light_office')).toBe('ziggy_motion_light')
    expect(instanceBaseOf('ziggy_motion_light_living')).toBe('ziggy_motion_light')
    expect(instanceBaseOf('ziggy_leave_home')).toBe('ziggy_leave_home') // untouched
  })

  it('lists distinct instance bases + members', () => {
    const ids = [
      'ziggy_motion_light', 'ziggy_motion_light_office',
      'ziggy_motion_light_2', 'ziggy_motion_light_2_kitchen',
      'ziggy_leave_home',
    ]
    expect(instanceBases(ids).sort()).toEqual(['ziggy_motion_light', 'ziggy_motion_light_2'])
    expect(instanceMemberIds('ziggy_motion_light', ids).sort())
      .toEqual(['ziggy_motion_light', 'ziggy_motion_light_office'])
    expect(instanceMemberIds('ziggy_motion_light_2', ids).sort())
      .toEqual(['ziggy_motion_light_2', 'ziggy_motion_light_2_kitchen'])
  })

  it('picks the next free instance base', () => {
    expect(freshInstanceBase([])).toBe('ziggy_motion_light')
    expect(freshInstanceBase(['ziggy_leave_home'])).toBe('ziggy_motion_light')
    expect(freshInstanceBase(['ziggy_motion_light'])).toBe('ziggy_motion_light_2')
    expect(freshInstanceBase(['ziggy_motion_light', 'ziggy_motion_light_office'])).toBe('ziggy_motion_light_2')
    expect(freshInstanceBase(['ziggy_motion_light', 'ziggy_motion_light_2'])).toBe('ziggy_motion_light_3')
    // 1st-instance stages don't count as their own instance
    expect(freshInstanceBase(['ziggy_motion_light', 'ziggy_motion_light_kitchen'])).toBe('ziggy_motion_light_2')
  })

  it('builds stage ids that match the backend fan-out + round-trip', () => {
    expect(stageId('ziggy_motion_light', 'office')).toBe('ziggy_motion_light_office')
    expect(stageId('ziggy_motion_light_2', 'kitchen')).toBe('ziggy_motion_light_2_kitchen')
    expect(isStageId(stageId('ziggy_motion_light_2', 'kitchen'))).toBe(true)
    expect(instanceBaseOf(stageId('ziggy_motion_light_2', 'kitchen'))).toBe('ziggy_motion_light_2')
    expect(instanceBaseOf(stageId('ziggy_motion_light', 'office'))).toBe('ziggy_motion_light')
  })
})
