// useFollowNavigateCards — the agent's `navigate` card is followed exactly
// once, only when it arrives live, with the dock/fromChat rule of a card link.

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

import { useFollowNavigateCards, navigateCardOf, _resetFollowedNavigateCards } from '../useFollowNavigateCards'
import { useChatStore } from '../../../stores/chatStore'

// Every location the router lands on, in order — so a test can assert the
// number of navigations, not just the last one.
const visited = []
function LocationProbe() {
  const loc = useLocation()
  React.useEffect(() => { visited.push({ path: loc.pathname, state: loc.state }) }, [loc])
  return null
}

function Harness({ messages }) {
  useFollowNavigateCards(messages)
  return <div data-testid="harness" />
}

function render(messages) {
  const wrap = (msgs) => (
    <MemoryRouter initialEntries={['/chat']}>
      <Routes>
        <Route path="*" element={<><Harness messages={msgs} /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>
  )
  const r = rtlRender(wrap(messages))
  return { ...r, rerender: (msgs) => r.rerender(wrap(msgs)) }
}

const navigations = () => visited.filter((v) => v.path !== '/chat')

const user = { id: 1, role: 'user', text: 'take me to the lamp', ok: true }
const reply = (id, extra = {}) => ({
  id, role: 'assistant', ok: true, live: true, text: 'Opened the lamp.',
  card: { kind: 'navigate', path: '/devices/light.desk_lamp', screen: 'device', label: 'Desk lamp' },
  ...extra,
})

const withViewport = (matches, fn) => {
  const orig = window.matchMedia
  window.matchMedia = vi.fn(() => ({ matches, addEventListener() {}, removeEventListener() {} }))
  try { return fn() } finally { window.matchMedia = orig }
}

beforeEach(() => {
  visited.length = 0
  _resetFollowedNavigateCards()
  useChatStore.setState({ chatDock: false })
})

describe('useFollowNavigateCards', () => {
  it('follows a live navigate card once, with state.fromChat', () => {
    const { rerender } = render([user])
    expect(navigations()).toHaveLength(0)
    rerender([user, reply(2)])
    expect(navigations()).toEqual([{ path: '/devices/light.desk_lamp', state: { fromChat: true } }])
    // Re-renders with the same list do not navigate again.
    rerender([user, reply(2)])
    rerender([user, reply(2), { id: 3, role: 'user', text: 'thanks', ok: true }])
    expect(navigations()).toHaveLength(1)
  })

  it('survives a remount over the same messages (chat page → dock hand-over)', () => {
    const { unmount } = render([user, reply(2)])
    expect(navigations()).toHaveLength(1)
    unmount()
    render([user, reply(2)])
    expect(navigations()).toHaveLength(1)
  })

  it('ignores messages restored from a thread (no live flag)', () => {
    const { rerender } = render([])
    rerender([user, reply(2, { live: undefined })])
    rerender([user, reply(3, { live: false })])
    expect(navigations()).toHaveLength(0)
  })

  it('ignores a failed reply, a user message and a non-navigate card', () => {
    expect(navigateCardOf(reply(1, { ok: false }))).toBeNull()
    expect(navigateCardOf({ ...reply(1), role: 'user' })).toBeNull()
    expect(navigateCardOf(reply(1, { card: { kind: 'device_list', devices: [] } }))).toBeNull()
    expect(navigateCardOf(reply(1, { card: null }))).toBeNull()
    expect(navigateCardOf(reply(1))).toBeTruthy()
  })

  it('refuses anything that is not an in-app path', () => {
    for (const path of ['https://evil.example', '//evil.example', 'devices/x', '', null]) {
      expect(navigateCardOf(reply(1, { card: { kind: 'navigate', path } }))).toBeNull()
    }
    const { rerender } = render([])
    rerender([reply(2, { card: { kind: 'navigate', path: '//evil.example' } })])
    expect(navigations()).toHaveLength(0)
  })

  it('each new live navigate card is followed, each once', () => {
    const { rerender } = render([])
    rerender([reply(1)])
    rerender([reply(1), reply(2, { card: { kind: 'navigate', path: '/alerts', screen: 'alerts' } })])
    rerender([reply(1), reply(2, { card: { kind: 'navigate', path: '/alerts', screen: 'alerts' } })])
    expect(navigations().map((n) => n.path)).toEqual(['/devices/light.desk_lamp', '/alerts'])
  })

  it('docks the chat on a wide screen, not on a narrow one', () => {
    withViewport(false, () => {
      const { rerender } = render([])
      rerender([reply(1)])
      expect(useChatStore.getState().chatDock).toBe(false)
    })
    _resetFollowedNavigateCards()
    withViewport(true, () => {
      const { rerender } = render([])
      rerender([reply(1)])
      expect(useChatStore.getState().chatDock).toBe(true)
    })
  })
})
