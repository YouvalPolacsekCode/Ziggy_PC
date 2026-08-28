import { describe, it, expect } from 'vitest'
import { applyThreadTitle } from '../threadTitles'

// The hub titles a thread a second or two after the first exchange and pushes
// thread_titled. The open drawer renames that row in place — no refetch, and
// nothing else in the list moves.

describe('applyThreadTitle', () => {
  const list = [
    { thread_id: 'a', title: 'New chat', preview: 'the kitchen light is dead' },
    { thread_id: 'b', title: 'Groceries', preview: 'milk' },
  ]

  it('renames the thread it names', () => {
    const out = applyThreadTitle(list, 'a', 'Kitchen light trouble')
    expect(out[0].title).toBe('Kitchen light trouble')
  })

  it('leaves every other thread untouched', () => {
    const out = applyThreadTitle(list, 'a', 'Kitchen light trouble')
    expect(out[1]).toBe(list[1])
    expect(out[0].preview).toBe('the kitchen light is dead')
  })

  it('returns the same list when the thread is not loaded yet', () => {
    expect(applyThreadTitle(list, 'zzz', 'Something')).toBe(list)
  })

  it('ignores an empty title rather than blanking the row', () => {
    expect(applyThreadTitle(list, 'a', '')).toBe(list)
  })

  it('survives an empty list', () => {
    expect(applyThreadTitle(null, 'a', 'x')).toEqual([])
  })
})
