// WHICH ELEMENT ACTUALLY SCROLLS.
//
// AppShell's outer wrapper is `display: flex; min-height: var(--vh)` and
// <main> is `flex-1 … overflow-y-auto`. In a ROW flex container a column grows
// to its content, so <main> is never taller than its own content and
// `main.scrollTop` is permanently 0 — the DOCUMENT is the scroller. Everything
// that read `main.scrollTop` therefore read 0 for ever: the bottom nav never
// condensed, and the exit overlay in PageTransition froze the page at its top
// instead of at the slice the person was looking at.
//
// `effectiveScrollTop` asks the element first and the document second, so a
// genuinely scrolling <main> (desktop, or a future layout) keeps working.
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { effectiveScrollTop, useScrollChrome } from '../gestures'

// jsdom defines `scrollY` as an own accessor on window, so a plain assignment
// is dropped; redefining it is the documented way to stub it.
const setWindowScroll = (y) => Object.defineProperty(window, 'scrollY', { value: y, configurable: true })

describe('effectiveScrollTop', () => {
  afterEach(() => setWindowScroll(0))

  it('reads the element when the element is the scroller', () => {
    setWindowScroll(123)
    expect(effectiveScrollTop({ scrollTop: 40, scrollHeight: 1000, clientHeight: 100 })).toBe(40)
  })

  it('falls back to the document when the element does not scroll', () => {
    setWindowScroll(40)
    expect(effectiveScrollTop({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 })).toBe(40)
  })

  it('falls back to the document when there is no element at all', () => {
    setWindowScroll(40)
    expect(effectiveScrollTop(null)).toBe(40)
  })

  it('is 0 when nothing has scrolled anywhere', () => {
    expect(effectiveScrollTop(null)).toBe(0)
  })
})

describe('useScrollChrome', () => {
  afterEach(() => setWindowScroll(0))

  function Chrome({ onDirection, elRef }) {
    const ref = React.useRef(null)
    const { scrolled, onScroll } = useScrollChrome(ref, { onDirection })
    if (elRef) elRef.current = { onScroll }
    return <div ref={ref} data-testid="main" data-scrolled={String(scrolled)} onScroll={onScroll} />
  }

  it('sees a document scroll, which is the one the real shell does', () => {
    const dirs = []
    const { getByTestId } = render(<Chrome onDirection={(d) => dirs.push(d)} />)
    setWindowScroll(200)
    act(() => { window.dispatchEvent(new Event('scroll')) })
    expect(dirs).toContain('down')
    expect(getByTestId('main').getAttribute('data-scrolled')).toBe('true')
  })

  it('comes back up when the document returns to the top', () => {
    const dirs = []
    render(<Chrome onDirection={(d) => dirs.push(d)} />)
    setWindowScroll(200)
    act(() => { window.dispatchEvent(new Event('scroll')) })
    setWindowScroll(0)
    act(() => { window.dispatchEvent(new Event('scroll')) })
    expect(dirs[dirs.length - 1]).toBe('up')
  })

  it('still answers a genuinely scrolling element through the returned handler', () => {
    const dirs = []
    const { getByTestId } = render(<Chrome onDirection={(d) => dirs.push(d)} />)
    const main = getByTestId('main')
    Object.defineProperty(main, 'scrollHeight', { value: 2000, configurable: true })
    Object.defineProperty(main, 'clientHeight', { value: 400, configurable: true })
    Object.defineProperty(main, 'scrollTop', { value: 300, configurable: true })
    act(() => { main.dispatchEvent(new Event('scroll')) })
    expect(dirs).toContain('down')
  })

  it('detaches its window listener on unmount', () => {
    const dirs = []
    const { unmount } = render(<Chrome onDirection={(d) => dirs.push(d)} />)
    unmount()
    setWindowScroll(200)
    act(() => { window.dispatchEvent(new Event('scroll')) })
    expect(dirs).toEqual([])
  })
})
