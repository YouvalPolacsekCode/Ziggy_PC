import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, act } from '@testing-library/react'
import { setMotion } from '../flag'
import { useSwipeBack } from '../gestures'

function Host({ onBack, onSwipe, rtl = false }) {
  const ref = React.useRef(null)
  useSwipeBack(ref, onBack, { enabled: true, rtl, onSwipe })
  return (
    <div data-testid="stage">
      <div data-motion-under="" data-testid="under"><div data-motion-scrim="" /></div>
      <div ref={ref} data-testid="page" style={{ width: 390 }} />
    </div>
  )
}
// jsdom has no PointerEvent, so a MouseEvent carries the two pointer fields
// the hook reads. `setPointerCapture` is absent there too — the hook
// optional-chains it for exactly this reason.
const ptr = (type, el, x, y = 10, id = 1) => el.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }), { pointerId: id, pointerType: 'touch' }))

describe('useSwipeBack (rubber-band edge)', () => {
  beforeEach(() => { setMotion(true); vi.useFakeTimers() })

  it('peels before it travels, then follows the finger', () => {
    const { getByTestId } = render(<Host onBack={() => {}} />)
    const page = getByTestId('page')
    page.getBoundingClientRect = () => ({ left: 0, right: 390, width: 390, top: 0, bottom: 800 })
    ptr('pointerdown', page, 4)
    ptr('pointermove', page, 20)   // 16px: inside the 32px peel
    expect(page.style.transform).toMatch(/translate3d\(0px,0,0\) scaleX\(1\.0[12]/)
    ptr('pointermove', page, 84)   // 80px: 48px of travel past the peel
    expect(page.style.transform).toMatch(/translate3d\(48px,0,0\) scaleX\(1(\.0+)?\)/)
    expect(getByTestId('under').style.transform).toMatch(/translate3d\(-\d+(\.\d+)?px,0,0\)/)
  })

  it('tells the host when a swipe starts and ends', () => {
    const onSwipe = vi.fn()
    const { getByTestId } = render(<Host onBack={() => {}} onSwipe={onSwipe} />)
    const page = getByTestId('page')
    page.getBoundingClientRect = () => ({ left: 0, right: 390, width: 390, top: 0, bottom: 800 })
    ptr('pointerdown', page, 4); ptr('pointermove', page, 40)
    expect(onSwipe).toHaveBeenCalledWith('start')
    ptr('pointerup', page, 40)
    // Long enough for either settle to finish: a 36px drag delivered as one
    // synthetic move reads as a flick well over 500px/s, so this commits on
    // the 240ms curve (240+80 fallback) rather than springing home on 200.
    act(() => { vi.advanceTimersByTime(400) })
    expect(onSwipe).toHaveBeenLastCalledWith('end')
  })

  it('commits once even if transitionend fires per property and the timer also fires', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Host onBack={onBack} />)
    const page = getByTestId('page')
    page.getBoundingClientRect = () => ({ left: 0, right: 390, width: 390, top: 0, bottom: 800 })
    ptr('pointerdown', page, 4); ptr('pointermove', page, 300); ptr('pointerup', page, 300)
    page.dispatchEvent(new Event('transitionend')); page.dispatchEvent(new Event('transitionend'))
    act(() => { vi.advanceTimersByTime(400) })
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('rtl: the edge is on the right and travel is negative', () => {
    const { getByTestId } = render(<Host onBack={() => {}} rtl />)
    const page = getByTestId('page')
    page.getBoundingClientRect = () => ({ left: 0, right: 390, width: 390, top: 0, bottom: 800 })
    ptr('pointerdown', page, 386); ptr('pointermove', page, 306)
    expect(page.style.transform).toMatch(/translate3d\(-48px,0,0\)/)
  })

  // The element this hook moves is now PageTransition's page layer, which is
  // keyed on the route — so the node is REPLACED on every navigation while
  // the ref object, `onBack`, `enabled` and `rtl` all stay identical. Without
  // a rebind signal the effect would never re-run and the hook would stay
  // bound to the detached old layer: swipe-back silently dead from the second
  // detail page onwards (/devices/a → /devices/b).
  it('rebinds when the element the ref points at is replaced', () => {
    function Rebinder({ pathKey }) {
      const ref = React.useRef(null)
      useSwipeBack(ref, () => {}, { enabled: true, bindKey: pathKey })
      return <div data-testid="stage"><div key={pathKey} ref={ref} data-testid="page" /></div>
    }
    const { getByTestId, rerender } = render(<Rebinder pathKey="/devices/a" />)
    const first = getByTestId('page')
    rerender(<Rebinder pathKey="/devices/b" />)
    const second = getByTestId('page')
    expect(second).not.toBe(first)
    second.getBoundingClientRect = () => ({ left: 0, right: 390, width: 390, top: 0, bottom: 800 })
    ptr('pointerdown', second, 4)
    ptr('pointermove', second, 84)
    expect(second.style.transform).toMatch(/translate3d\(48px,0,0\)/)
  })
})
