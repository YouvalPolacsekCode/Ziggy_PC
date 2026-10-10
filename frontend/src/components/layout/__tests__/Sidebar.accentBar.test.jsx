import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../lib/i18n', async (orig) => ({ ...(await orig()), useT: () => (k) => k, useLang: () => 'en' }))
vi.mock('../../../stores/featuresStore', () => ({ useFeature: () => true }))
vi.mock('../../../stores/authStore', () => ({ useAuthStore: () => ({ role: 'user' }) }))
vi.mock('../../../stores/uiStore', () => ({ useUIStore: () => ({ theme: 'light', toggleTheme: () => {} }) }))
vi.mock('../../ui/Logo', () => ({ default: () => null }))

import { setMotion } from '../../../motion/flag'
import { Sidebar } from '../Sidebar'

const mount = (motion, path = '/rooms') => { setMotion(motion); return render(<MemoryRouter initialEntries={[path]}><Sidebar connected /></MemoryRouter>) }

describe('Sidebar accent bar', () => {
  beforeEach(() => { try { localStorage.clear() } catch { /* jsdom may lack localStorage */ } })
  it('motion on: the primary group draws one accent bar and hands the surface over', () => {
    const { container } = mount(true)
    const groups = container.querySelectorAll('[data-motion-nav-group]')
    expect(groups.length).toBe(2)
    expect(groups[0].getAttribute('data-motion-hl')).toBe('true')
    expect(groups[0].querySelector('[data-motion-nav-bar]')).not.toBeNull()
    expect(groups[1].querySelector('[data-motion-nav-bar]')).toBeNull()
    expect(container.querySelector('[data-motion-nav-hl]')).toBeNull()
  })
  it('motion off: no bar, the active item keeps its own class', () => {
    const { container } = mount(false)
    expect(container.querySelector('[data-motion-nav-bar]')).toBeNull()
    expect(container.querySelector('[data-motion-nav-group]')).toBeNull()
    expect(container.querySelector('.z-nav-item.active')?.getAttribute('href')).toBe('/rooms')
  })
})
