import React, { Suspense, StrictMode, lazy } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

import { PageTransition, PUSH_MS, getLastExited } from '../PageTransition'

const renderPage = (el, key) => <Suspense key={key} fallback={<div data-testid="fallback" />}>{el}</Suspense>
const Page = ({ name }) => <div data-testid={`page-${name}`}>{name}</div>

function Harness({ path, back = false, enabled = true, rtl = false, tick = 0 }) {
  const scrollerRef = React.useRef({ scrollTop: 0 })
  return (
    <div data-tick={tick}>
      <PageTransition pathKey={path} back={back} rtl={rtl} enabled={enabled} scrollerRef={scrollerRef} renderPage={renderPage}>
        <Page name={path} />
      </PageTransition>
    </div>
  )
}

describe('PageTransition', () => {
  beforeEach(() => vi.useFakeTimers())

  it('first mount: no overlay, today\'s enter wrapper', () => {
    const { container } = render(<Harness path="/" />)
    expect(container.querySelector('[data-motion-page="exit"]')).toBeNull()
    expect(container.querySelector('[data-motion-enter]')).not.toBeNull()
  })

  it('forward: overlays the old page, marks the new one, drops the overlay by the watchdog', () => {
    const { container, rerender } = render(<Harness path="/" />)
    rerender(<Harness path="/rooms" />)
    expect(container.querySelector('[data-motion-page="exit"] [data-testid="page-/"]')).not.toBeNull()
    expect(container.querySelector('[data-motion-page="enter"] [data-testid="page-/rooms"]')).not.toBeNull()
    expect(container.querySelector('[data-motion-page="enter"]').getAttribute('data-motion-enter')).toBe('true')
    act(() => { vi.advanceTimersByTime(PUSH_MS + 400) })
    expect(container.querySelector('[data-motion-page="exit"]')).toBeNull()
    const enter = container.querySelector('[data-motion-page="enter"]')
    expect(enter.style.transform === '' || enter.style.transform === 'none').toBe(true)
  })

  it('back: the entering wrapper is marked back', () => {
    const { container, rerender } = render(<Harness path="/rooms" />)
    rerender(<Harness path="/" back />)
    expect(container.querySelector('[data-motion-page="enter"]').getAttribute('data-motion-enter')).toBe('back')
  })

  it('a re-render storm mid-transition cannot leave the page stuck', () => {
    const { container, rerender } = render(<Harness path="/" />)
    rerender(<Harness path="/devices" />)
    for (let i = 1; i <= 20; i++) rerender(<Harness path="/devices" tick={i} />)
    act(() => { vi.advanceTimersByTime(PUSH_MS + 400) })
    expect(container.querySelector('[data-motion-page="exit"]')).toBeNull()
    expect(container.querySelector('[data-testid="page-/devices"]')).not.toBeNull()
    const enter = container.querySelector('[data-motion-page="enter"]')
    expect(enter.style.opacity === '' || enter.style.opacity === '1').toBe(true)
  })

  it('a lazy page that suspends shows the fallback inside the entering layer', async () => {
    let resolve
    const Lazy = lazy(() => new Promise(r => { resolve = r }))
    function H({ path }) {
      const scrollerRef = React.useRef({ scrollTop: 0 })
      return (
        <PageTransition pathKey={path} back={false} rtl={false} enabled scrollerRef={scrollerRef} renderPage={renderPage}>
          <Suspense fallback={<div data-testid="fallback" />}>{path === '/lazy' ? <Lazy /> : <Page name={path} />}</Suspense>
        </PageTransition>
      )
    }
    const { container, rerender } = render(<H path="/" />)
    rerender(<H path="/lazy" />)
    expect(container.querySelector('[data-motion-page="enter"] [data-testid="fallback"]')).not.toBeNull()
    await act(async () => { resolve({ default: () => <div data-testid="page-lazy" /> }) })
    expect(container.querySelector('[data-testid="page-lazy"]')).not.toBeNull()
  })

  it('disabled: today\'s wrapper only, no overlay, no entering layer', () => {
    const { container, rerender } = render(<Harness path="/" enabled={false} />)
    rerender(<Harness path="/rooms" enabled={false} />)
    expect(container.querySelector('[data-motion-page="exit"], [data-motion-page="enter"]')).toBeNull()
    expect(container.querySelector('[data-motion-page="current"][data-motion-enter]')).not.toBeNull()
  })

  it('rtl flips the travel sign', () => {
    const { container, rerender } = render(<Harness path="/" rtl />)
    rerender(<Harness path="/rooms" rtl />)
    expect(container.querySelector('[data-motion-page="enter"]').getAttribute('data-motion-dir')).toBe('-1')
  })
})

// The invariants the two historical black screens came from, plus the one
// this implementation rests on. Written after the seven above, because each
// is a thing the obvious implementation gets wrong.
describe('PageTransition invariants', () => {
  let mounts = 0
  function Counted({ name }) {
    React.useEffect(() => { mounts += 1 }, [])
    return <div data-testid={`page-${name}`}>{name}</div>
  }
  function Scroller({ path, back = false, enabled = true }) {
    const scrollerRef = React.useRef({ scrollTop: 40 })
    return (
      <PageTransition pathKey={path} back={back} rtl={false} enabled={enabled} scrollerRef={scrollerRef} renderPage={renderPage}>
        <Counted name={path} />
      </PageTransition>
    )
  }
  beforeEach(() => { vi.useFakeTimers(); mounts = 0 })

  // The page layer is ONE element for the life of the route. If dropping the
  // overlay swapped it for a different element type, the whole routed page
  // would unmount and remount — losing its state and refetching its data —
  // 420ms after every navigation.
  it('does not remount the entering page when the overlay drops', () => {
    const { container, rerender } = render(<Scroller path="/" />)
    rerender(<Scroller path="/rooms" />)
    const layer = container.querySelector('[data-motion-page="enter"]')
    const page = container.querySelector('[data-testid="page-/rooms"]')
    const before = mounts
    act(() => { vi.advanceTimersByTime(PUSH_MS + 400) })
    expect(container.querySelector('[data-motion-page="enter"]')).toBe(layer)
    expect(container.querySelector('[data-testid="page-/rooms"]')).toBe(page)
    expect(mounts).toBe(before)
  })

  it('does not remount the entering page on a back slide either', () => {
    const { container, rerender } = render(<Scroller path="/rooms" />)
    rerender(<Scroller path="/" back />)
    const page = container.querySelector('[data-testid="page-/"]')
    const before = mounts
    act(() => { vi.advanceTimersByTime(PUSH_MS + 400) })
    expect(container.querySelector('[data-testid="page-/"]')).toBe(page)
    expect(mounts).toBe(before)
  })

  // Failure mode 2: two pages in normal flow, stacking vertically. There is
  // never more than one overlay, and it leaves nothing behind.
  it('a second navigation mid-slide leaves exactly one overlay', () => {
    const { container, rerender } = render(<Scroller path="/" />)
    rerender(<Scroller path="/rooms" />)
    rerender(<Scroller path="/devices" />)
    expect(container.querySelectorAll('[data-motion-page="exit"]').length).toBe(1)
    expect(container.querySelector('[data-motion-page="exit"] [data-testid="page-/rooms"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-motion-page]').length).toBe(2)
    act(() => { vi.advanceTimersByTime(PUSH_MS + 400) })
    expect(container.querySelectorAll('[data-motion-page="exit"]').length).toBe(0)
    expect(container.querySelector('[data-testid="page-/devices"]')).not.toBeNull()
  })

  // The outgoing page is out of reach of the keyboard as well as the reader,
  // is frozen at the scroll position it was looking at, and is handed to
  // whoever asks for the last page (the swipe-back under-page).
  it('the overlay is inert, frozen at its scroll position, and remembered', () => {
    const { container, rerender } = render(<Scroller path="/" />)
    rerender(<Scroller path="/rooms" />)
    const exit = container.querySelector('[data-motion-page="exit"]')
    expect(exit.inert).toBe(true)
    expect(exit.getAttribute('aria-hidden')).toBe('true')
    expect(exit.firstChild.style.transform).toBe('translateY(-40px)')
    act(() => { vi.advanceTimersByTime(PUSH_MS + 400) })
    expect(getLastExited()).toMatchObject({ key: '/', scrollTop: 40 })
  })

  // Failure mode 1, in its surviving form: a page left transformed. The
  // switch flipping off mid-flight is the nastiest version of it.
  it('the kill switch flipping mid-slide cannot strand a transform', () => {
    const { container, rerender } = render(<Scroller path="/" />)
    rerender(<Scroller path="/rooms" />)
    rerender(<Scroller path="/rooms" enabled={false} />)
    rerender(<Scroller path="/devices" enabled={false} />)
    const el = container.querySelector('[data-motion-page="current"]')
    expect(el.style.transform === '' || el.style.transform === 'none').toBe(true)
    expect(el.style.opacity === '' || el.style.opacity === '1').toBe(true)
  })

  // The stage is pinned during render, which React's dev StrictMode renders
  // twice. Bumping the sequence or freezing the wrong page on the second
  // pass would show up here and nowhere else — main.jsx wraps the app in it.
  it('survives StrictMode double-rendering', () => {
    const { container, rerender } = render(<StrictMode><Scroller path="/" /></StrictMode>)
    rerender(<StrictMode><Scroller path="/rooms" /></StrictMode>)
    expect(container.querySelectorAll('[data-motion-page="exit"]').length).toBe(1)
    expect(container.querySelector('[data-motion-page="exit"] [data-testid="page-/"]')).not.toBeNull()
    expect(container.querySelector('[data-motion-page="enter"] [data-testid="page-/rooms"]')).not.toBeNull()
    act(() => { vi.advanceTimersByTime(PUSH_MS + 400) })
    expect(container.querySelector('[data-motion-page="exit"]')).toBeNull()
  })

  // At rest the layer is as close to yesterday's plain wrapper as it can be:
  // no stacking context over a page's own fixed menus, no standing clip.
  it('leaves no slide scaffolding standing once the slide is over', () => {
    const { container, rerender } = render(<Scroller path="/" />)
    rerender(<Scroller path="/rooms" />)
    act(() => { vi.advanceTimersByTime(PUSH_MS + 400) })
    const layer = container.querySelector('[data-motion-page="enter"]')
    expect(layer.style.zIndex).toBe('')
    expect(layer.style.boxShadow).toBe('')
    expect(layer.style.willChange).toBe('')
    expect(container.querySelector('[data-motion-stage]').style.overflowX).toBe('')
  })
})
