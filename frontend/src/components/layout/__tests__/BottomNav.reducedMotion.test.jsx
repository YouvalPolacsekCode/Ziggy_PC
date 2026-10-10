// The bottom nav had no reduced-motion path at all: the depth cell scaled,
// lifted and drop-shadowed, and the More items flew up from the bar, whatever
// the OS said. motion.css cannot answer for either, because both are framer
// inline styles — an inline transform outranks a stylesheet rule.
//
// `useReducedMotion` is mocked rather than driven through matchMedia, because
// jsdom's media query list is static: the hook subscribes to a change event
// that never fires there.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('framer-motion', async (orig) => ({ ...(await orig()), useReducedMotion: () => true }))
vi.mock('../../../lib/i18n', async (orig) => ({ ...(await orig()), useT: () => (k) => k, useLang: () => 'en', useIsRTL: () => false }))
vi.mock('../../../stores/featuresStore', () => ({ useFeature: () => true }))
vi.mock('../../../stores/authStore', () => ({ useAuthStore: () => ({ role: 'user' }) }))

import { setMotion } from '../../../motion/flag'
import { BottomNav } from '../BottomNav'

function mount(path = '/rooms') {
  setMotion(true)
  return render(<MemoryRouter initialEntries={[path]}><BottomNav connected /></MemoryRouter>)
}

describe('BottomNav under reduced motion', () => {
  beforeEach(() => { try { localStorage.clear() } catch { /* jsdom may lack it */ } })

  it('the depth cell states itself in opacity only — no scale, lift or shadow', () => {
    const { container } = mount('/rooms')
    const cell = container.querySelector('[data-nav-depth="active"]')
    expect(cell).not.toBeNull()
    expect(cell.style.transform).toBe('')
    // The inner span is the one that scaled 1.16, lifted 2px and cast a shadow.
    const iconBox = cell.querySelector('span')
    expect(iconBox).not.toBeNull()
    expect(iconBox.style.transform).toBe('')
    expect(iconBox.style.filter === '' || iconBox.style.filter === 'none').toBe(true)
    // ...and the cells are still told apart, which is the information.
    expect(container.querySelectorAll('[data-nav-depth="idle"]').length).toBe(4)
  })

  it('the More items fade in where they belong instead of flying up', () => {
    const { container } = mount('/')
    fireEvent.click(container.querySelector('button[aria-expanded]'))
    const items = container.querySelectorAll('[data-fan-item]')
    expect(items.length).toBe(3)
    for (const item of items) expect(item.style.transform).toBe('')
  })
})
