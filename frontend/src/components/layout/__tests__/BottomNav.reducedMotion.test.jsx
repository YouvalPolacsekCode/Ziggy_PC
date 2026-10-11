// The bottom nav had no reduced-motion path at all: the depth cell scaled,
// lifted and drop-shadowed, and the More items flew up from the bar, whatever
// the OS said. motion.css cannot answer for either, because both are framer
// inline styles — an inline transform outranks a stylesheet rule.
//
// `useReducedMotion` is mocked rather than driven through matchMedia, because
// jsdom's media query list is static: the hook subscribes to a change event
// that never fires there. The mock reads a mutable flag so the last test can
// flip the setting MID-SESSION, which is the case that catches a reduced
// target that merely omits `scale`/`y`/`filter` instead of resetting them.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const flag = vi.hoisted(() => ({ reduced: true }))
vi.mock('framer-motion', async (orig) => ({ ...(await orig()), useReducedMotion: () => flag.reduced }))
vi.mock('../../../lib/i18n', async (orig) => ({ ...(await orig()), useT: () => (k) => k, useLang: () => 'en', useIsRTL: () => false }))
vi.mock('../../../stores/featuresStore', () => ({ useFeature: () => true }))
vi.mock('../../../stores/authStore', () => ({ useAuthStore: () => ({ role: 'user' }) }))

import { setMotion } from '../../../motion/flag'
import { BottomNav } from '../BottomNav'

function mount(path = '/rooms') {
  setMotion(true)
  return render(<MemoryRouter initialEntries={[path]}><BottomNav connected /></MemoryRouter>)
}
// framer writes `transform: none` when every transform key is at its resting
// value, and nothing at all when it never wrote one. Both are "no movement".
const atRest = (v) => v === '' || v === 'none'
const hasVisibleShadow = (v) => /drop-shadow\(\s*0\s+[1-9]/.test(v || '')

describe('BottomNav under reduced motion', () => {
  beforeEach(() => { flag.reduced = true; try { localStorage.clear() } catch { /* jsdom may lack it */ } })

  it('the depth cell states itself in opacity only — no scale, lift or shadow', () => {
    const { container } = mount('/rooms')
    const cell = container.querySelector('[data-nav-depth="active"]')
    expect(cell).not.toBeNull()
    expect(atRest(cell.style.transform)).toBe(true)
    // The inner span is the one that scaled 1.16, lifted 2px and cast a shadow.
    const iconBox = cell.querySelector('span')
    expect(iconBox).not.toBeNull()
    expect(atRest(iconBox.style.transform)).toBe(true)
    expect(hasVisibleShadow(iconBox.style.filter)).toBe(false)
    // ...and the cells are still told apart, which is the information.
    expect(container.querySelectorAll('[data-nav-depth="idle"]').length).toBe(4)
  })

  it('the More items fade in where they belong instead of flying up', () => {
    const { container } = mount('/')
    fireEvent.click(container.querySelector('button[aria-expanded]'))
    const items = container.querySelectorAll('[data-fan-item]')
    expect(items.length).toBe(3)
    for (const item of items) expect(atRest(item.style.transform)).toBe(true)
  })

  // The OS setting can flip while the app is open. A reduced target that just
  // OMITS scale/y/filter is a target framer stops writing, so the last
  // full-motion values stay inline — the active icon stuck at 1.16 and lifted,
  // for the rest of the session. Naming the resting values is what resets it.
  it('resets the depth transform when the setting flips mid-session', async () => {
    flag.reduced = false
    const { container, rerender } = render(
      <MemoryRouter initialEntries={['/rooms']}><BottomNav connected /></MemoryRouter>,
    )
    setMotion(true)
    const iconBox = container.querySelector('[data-nav-depth="active"] span')
    expect(iconBox.style.transform).toContain('scale(1.16)')

    flag.reduced = true
    rerender(<MemoryRouter initialEntries={['/rooms']}><BottomNav connected /></MemoryRouter>)
    // Real timers: framer's frame loop captures rAF at import, so fake timers
    // never drive it (see TabCrossfade's storm test).
    await act(async () => { await new Promise((r) => setTimeout(r, 400)) })
    expect(atRest(iconBox.style.transform)).toBe(true)
    expect(hasVisibleShadow(iconBox.style.filter)).toBe(false)
  })
})
