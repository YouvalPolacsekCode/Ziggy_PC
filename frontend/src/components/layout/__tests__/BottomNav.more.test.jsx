import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'

vi.mock('../../../lib/i18n', async (orig) => ({ ...(await orig()), useT: () => (k) => k, useLang: () => 'en', useIsRTL: () => false }))
vi.mock('../../../stores/featuresStore', () => ({ useFeature: () => true }))
vi.mock('../../../stores/authStore', () => ({ useAuthStore: () => ({ role: 'user' }) }))

import { setMotion } from '../../../motion/flag'
import { BottomNav } from '../BottomNav'

function Go({ to }) { const nav = useNavigate(); return <button data-testid="go" onClick={() => nav(to)}>go</button> }
function mount(motion) {
  setMotion(motion)
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes><Route path="*" element={<><Go to="/rooms" /><BottomNav connected /></>} /></Routes>
    </MemoryRouter>,
  )
}
const openMore = (c) => fireEvent.click(c.querySelector('button[aria-expanded]'))

describe('More menu fan-out', () => {
  beforeEach(() => { try { localStorage.clear() } catch {}; vi.useFakeTimers() })

  it('motion on: three fan items, nearest the More tab first', () => {
    const { container } = mount(true)
    openMore(container)
    const items = container.querySelectorAll('[data-fan-item]')
    expect(items.length).toBe(3)
    expect(items[2].getAttribute('data-fan-item')).toBe('0') // last in DOM = nearest More = first to arrive
  })
  it('motion on: backdrop tap retracts then unmounts after the exit window', () => {
    const { container } = mount(true)
    openMore(container)
    fireEvent.click(container.querySelector('[data-motion-more-backdrop]'))
    expect(container.querySelector('[data-motion-more]')?.getAttribute('data-closing')).toBe('true')
    act(() => { vi.advanceTimersByTime(300) })
    expect(container.querySelector('[data-motion-more]')).toBeNull()
    expect(container.querySelector('[data-motion-more-backdrop]')).toBeNull()
  })
  it('a route change while closing unmounts synchronously (no stuck backdrop)', () => {
    const { container, getByTestId } = mount(true)
    openMore(container)
    fireEvent.click(container.querySelector('[data-motion-more-backdrop]'))
    fireEvent.click(getByTestId('go'))
    expect(container.querySelector('[data-motion-more]')).toBeNull()
    expect(container.querySelector('[data-motion-more-backdrop]')).toBeNull()
  })
  it('motion off: today\'s single card, no fan attributes, instant close', () => {
    const { container } = mount(false)
    openMore(container)
    expect(container.querySelector('[data-fan-item]')).toBeNull()
    expect(container.querySelector('[data-motion-more]')).toBeNull()
    fireEvent.click(container.querySelector('.fixed.inset-0'))
    expect(container.querySelector('[aria-expanded="true"]')).toBeNull()
  })
  it('motion on: tapping the More tab while closing is tappable and cancels the retract', () => {
    const { container } = mount(true)
    openMore(container)
    fireEvent.click(container.querySelector('[data-motion-more-backdrop]'))
    const backdrop = container.querySelector('[data-motion-more-backdrop]')
    expect(backdrop.style.pointerEvents).toBe('none')
    fireEvent.click(container.querySelector('button[aria-expanded]'))
    expect(container.querySelector('[data-motion-more]')?.getAttribute('data-closing')).toBeNull()
    expect(container.querySelectorAll('[data-fan-item]').length).toBe(3)
  })
  it('motion on: repeated backdrop taps do not restart the retract timer', () => {
    const { container } = mount(true)
    openMore(container)
    fireEvent.click(container.querySelector('[data-motion-more-backdrop]'))
    act(() => { vi.advanceTimersByTime(100) })
    fireEvent.click(container.querySelector('[data-motion-more-backdrop]'))
    act(() => { vi.advanceTimersByTime(150) })
    expect(container.querySelector('[data-motion-more]')).toBeNull()
  })
})
