import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../lib/i18n', async (orig) => ({ ...(await orig()), useT: () => (k) => k, useLang: () => 'en', useIsRTL: () => false }))
vi.mock('../../../stores/featuresStore', () => ({ useFeature: () => true }))
vi.mock('../../../stores/authStore', () => ({ useAuthStore: () => ({ role: 'user' }) }))

import { setMotion } from '../../../motion/flag'
import { BottomNav } from '../BottomNav'

function mount(path, motion) {
  setMotion(motion)
  return render(<MemoryRouter initialEntries={[path]}><BottomNav connected /></MemoryRouter>)
}

describe('BottomNav depth active state', () => {
  beforeEach(() => { try { localStorage.clear() } catch {} })

  it('motion on: the active tab is marked active, the others idle', () => {
    const { container } = mount('/rooms', true)
    const cells = container.querySelectorAll('[data-nav-depth]')
    expect(cells.length).toBe(5)
    const active = [...cells].filter(c => c.getAttribute('data-nav-depth') === 'active')
    expect(active.length).toBe(1)
    expect(active[0].closest('a')?.getAttribute('href')).toBe('/rooms')
  })
  it('motion on: the More cell participates', () => {
    const { container } = mount('/settings', true)
    const active = container.querySelector('[data-nav-depth="active"]')
    expect(active.closest('button')?.getAttribute('aria-expanded')).toBe('false')
  })
  it('motion off: today\'s DOM — no depth wrapper, stroke 2 on the active icon', () => {
    const { container } = mount('/rooms', false)
    expect(container.querySelector('[data-nav-depth]')).toBeNull()
    const activeLink = container.querySelector('a[aria-current="page"]')
    expect(activeLink.querySelector('svg')?.getAttribute('stroke-width')).toBe('2')
    expect(container.querySelector('[data-motion-nav-hl]')).toBeNull()
  })
})
