import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../lib/i18n', async (orig) => ({ ...(await orig()), useT: () => (k) => k, useLang: () => 'en', useIsRTL: () => false }))
vi.mock('../../../stores/featuresStore', () => ({ useFeature: () => true }))
vi.mock('../../../stores/authStore', () => ({ useAuthStore: () => ({ role: 'user' }) }))

import { setMotion } from '../../../motion/flag'
import { BottomNav } from '../BottomNav'

const mount = (motion, props) => { setMotion(motion); return render(<MemoryRouter initialEntries={['/']}><BottomNav connected {...props} /></MemoryRouter>) }

describe('BottomNav condense', () => {
  beforeEach(() => { try { localStorage.clear() } catch {} })
  it('motion on + tucked: emits data-condensed="true" and never data-tucked', () => {
    const { container } = mount(true, { tucked: true })
    const nav = container.querySelector('nav')
    expect(nav.getAttribute('data-condensed')).toBe('true')
    expect(nav.hasAttribute('data-tucked')).toBe(false)
    expect(container.querySelector('[data-nav-row]')).not.toBeNull()
    expect(container.querySelectorAll('[data-nav-label]').length).toBe(5)
  })
  it('offline strip pins the bar open', () => {
    const { container } = mount(true, { tucked: true, connected: false })
    expect(container.querySelector('nav').getAttribute('data-condensed')).toBe('false')
  })
  it('motion off: no condense attributes', () => {
    const { container } = mount(false, { tucked: true })
    const nav = container.querySelector('nav')
    expect(nav.hasAttribute('data-condensed')).toBe(false)
    expect(nav.hasAttribute('data-motion-nav')).toBe(false)
    expect(container.querySelector('[data-nav-row]')).toBeNull()
  })
})
