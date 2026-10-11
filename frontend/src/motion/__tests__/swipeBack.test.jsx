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
      <div ref={ref} data-testid="page" style={{ width: 390 }}>
        <div data-testid="child" />
      </div>
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
    expect(onSwipe).toHaveBeenLastCalledWith('end', { committed: true })
  })

  // The host keeps the under-page mounted past a committed settle (the page
  // is off-screen by then; the under-page is the only thing left to look at)
  // and drops it at once on a cancel. So the two ends are not the same event.
  it('a cancelled swipe ends uncommitted, and leaves nothing behind', () => {
    const onSwipe = vi.fn()
    const onBack = vi.fn()
    const { getByTestId } = render(<Host onBack={onBack} onSwipe={onSwipe} />)
    const page = getByTestId('page')
    page.getBoundingClientRect = () => ({ left: 0, right: 390, width: 390, top: 0, bottom: 800 })
    // Out and then back again: short of the 30% threshold and, by the end,
    // travelling the wrong way, so neither the distance nor the flick commits.
    ptr('pointerdown', page, 4)
    ptr('pointermove', page, 54); ptr('pointermove', page, 40); ptr('pointermove', page, 30)
    ptr('pointerup', page, 30)
    act(() => { vi.advanceTimersByTime(400) })
    expect(onBack).not.toHaveBeenCalled()
    expect(onSwipe).toHaveBeenLastCalledWith('end', { committed: false })
    expect(page.style.transform).toBe('')
    expect(page.style.transition).toBe('')
    expect(page.style.transformOrigin).toBe('')
    expect(page.style.willChange).toBe('')
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

  // `transitionend` bubbles. The page is full of things with transitions of
  // their own, and one of them finishing mid-settle used to end the settle —
  // navigating early from wherever the page had got to.
  it('a child\'s transitionend does not end the settle', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Host onBack={onBack} />)
    const page = getByTestId('page')
    page.getBoundingClientRect = () => ({ left: 0, right: 390, width: 390, top: 0, bottom: 800 })
    ptr('pointerdown', page, 4); ptr('pointermove', page, 300); ptr('pointerup', page, 300)
    getByTestId('child').dispatchEvent(new Event('transitionend', { bubbles: true }))
    expect(onBack).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(400) })
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  // A committed settle waits 240ms before it navigates, and the app can
  // navigate for a reason of its own inside that window (a chat card, a push
  // notification, a redirect guard). That re-binds this hook — and the
  // orphaned timer used to fire anyway, sending the person a second step back
  // from wherever they had just landed.
  it('a settle abandoned by an unbind never calls back', () => {
    const onBack = vi.fn()
    function Unbindable({ enabled }) {
      const ref = React.useRef(null)
      useSwipeBack(ref, onBack, { enabled })
      return <div ref={ref} data-testid="page" />
    }
    const { getByTestId, rerender } = render(<Unbindable enabled />)
    const page = getByTestId('page')
    page.getBoundingClientRect = () => ({ left: 0, right: 390, width: 390, top: 0, bottom: 800 })
    ptr('pointerdown', page, 4); ptr('pointermove', page, 300); ptr('pointerup', page, 300)
    // ...mid-settle, something else unbinds the hook.
    rerender(<Unbindable enabled={false} />)
    act(() => { vi.advanceTimersByTime(600) })
    expect(onBack).not.toHaveBeenCalled()
    // ...and a transitionend arriving late on the detached node is just as dead.
    page.dispatchEvent(new Event('transitionend'))
    expect(onBack).not.toHaveBeenCalled()
  })

  // A committed swipe leaves the page off-screen for the 240ms it waits for
  // its navigation, and an off-screen page reports a NEGATIVE distance from
  // the edge — which passes the edge guard. So a second finger could start a
  // gesture inside that window, and the first settle's finish() would null the
  // second's registration while the two fought over one inline transform.
  it('a second gesture cannot start while a settle is pending', () => {
    const onSwipe = vi.fn()
    const onBack = vi.fn()
    const { getByTestId } = render(<Host onBack={onBack} onSwipe={onSwipe} />)
    const page = getByTestId('page')
    page.getBoundingClientRect = () => ({ left: 0, right: 390, width: 390, top: 0, bottom: 800 })
    ptr('pointerdown', page, 4); ptr('pointermove', page, 300); ptr('pointerup', page, 300)
    onSwipe.mockClear()
    // Mid-settle, with the page off-screen: left is now negative, so the edge
    // guard alone would have let this through.
    page.getBoundingClientRect = () => ({ left: -390, right: 0, width: 390, top: 0, bottom: 800 })
    ptr('pointerdown', page, 4); ptr('pointermove', page, 84)
    expect(onSwipe).not.toHaveBeenCalledWith('start')
    // ...and the first settle still finishes exactly once.
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
    const rect = () => ({ left: 0, right: 390, width: 390, top: 0, bottom: 800 })
    const { getByTestId, rerender } = render(<Rebinder pathKey="/devices/a" />)
    const first = getByTestId('page')
    first.getBoundingClientRect = rect
    ptr('pointerdown', first, 4); ptr('pointermove', first, 84)
    expect(first.style.transform).toMatch(/translate3d\(48px,0,0\)/)

    rerender(<Rebinder pathKey="/devices/b" />)
    const second = getByTestId('page')
    expect(second).not.toBe(first)
    second.getBoundingClientRect = rect
    ptr('pointerdown', second, 4)
    ptr('pointermove', second, 84)
    expect(second.style.transform).toMatch(/translate3d\(48px,0,0\)/)
    // The node it let go of is left clean and deaf: the unbind clears what it
    // painted, and an abandoned gesture on the old layer moves nothing.
    expect(first.style.transform).toBe('')
    ptr('pointerdown', first, 4); ptr('pointermove', first, 84)
    expect(first.style.transform).toBe('')
  })
})
