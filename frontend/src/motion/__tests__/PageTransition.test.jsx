import React, { Suspense, StrictMode, lazy } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

import { PageTransition, PUSH_MS, getLastExited } from '../PageTransition'

const Page = ({ name }) => <div data-testid={`page-${name}`}>{name}</div>

function Harness({ path, back = false, enabled = true, rtl = false, tick = 0, swiping = false, settled }) {
  const scrollerRef = React.useRef({ scrollTop: 0 })
  return (
    <div data-tick={tick}>
      <PageTransition pathKey={path} back={back} rtl={rtl} enabled={enabled} scrollerRef={scrollerRef} swiping={swiping} settled={settled}>
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
        <PageTransition pathKey={path} back={false} rtl={false} enabled scrollerRef={scrollerRef}>
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

// The under-page: what a swipe-back reveals. Same snapshot as the overlay,
// which is exactly why only one of the two may hold it at a time.
describe('PageTransition under-page (swipe-back)', () => {
  // `_lastExited` is module state with a 30s TTL, so each test says outright
  // whether a remembered page exists rather than inheriting one.
  const forgetLastPage = () => act(() => { vi.advanceTimersByTime(31_000) })
  beforeEach(() => vi.useFakeTimers())

  it('paints the last page beneath, with a scrim, while swiping', () => {
    const { container, rerender } = render(<Harness path="/" />)
    rerender(<Harness path="/rooms" />)
    act(() => { vi.advanceTimersByTime(PUSH_MS + 400) })   // overlay drops, snapshot handed over
    rerender(<Harness path="/rooms" swiping />)
    const under = container.querySelector('[data-motion-under]')
    expect(under).not.toBeNull()
    expect(under.querySelector('[data-testid="page-/"]')).not.toBeNull()
    expect(under.querySelector('[data-motion-scrim]')).not.toBeNull()
    expect(under.getAttribute('aria-hidden')).toBe('true')
    expect(under.inert).toBe(true)
    // ...and it goes when the gesture does, releasing the node again.
    rerender(<Harness path="/rooms" />)
    expect(container.querySelector('[data-motion-under]')).toBeNull()
    expect(getLastExited().node.querySelector('[data-testid="page-/"]')).not.toBeNull()
  })

  it('no under-page when nothing was exited (a deep link)', () => {
    forgetLastPage()
    const { container } = render(<Harness path="/devices/x" swiping />)
    expect(getLastExited()).toBeNull()
    expect(container.querySelector('[data-motion-under]')).toBeNull()
    expect(container.querySelector('[data-testid="page-/devices/x"]')).not.toBeNull()
  })

  // A DOM node can only be in one place. If both layers claimed the snapshot
  // the second mount would MOVE it out of the first — the overlay would empty
  // mid-slide.
  it('no under-page while the exit overlay still holds the snapshot', () => {
    const { container, rerender } = render(<Harness path="/" />)
    rerender(<Harness path="/rooms" />)
    act(() => { vi.advanceTimersByTime(PUSH_MS + 400) })
    rerender(<Harness path="/devices" />)                  // a slide is running again
    expect(getLastExited()).not.toBeNull()
    rerender(<Harness path="/devices" swiping />)
    expect(container.querySelector('[data-motion-under]')).toBeNull()
    expect(container.querySelector('[data-motion-page="exit"] [data-testid="page-/rooms"]')).not.toBeNull()
  })

  // Same rule as the slide: nothing of it stands at rest. A gesture is not
  // rest, the moment after it is.
  it('positions and clips the stage only for the length of the gesture', () => {
    const { container, rerender } = render(<Harness path="/" />)
    rerender(<Harness path="/rooms" />)
    act(() => { vi.advanceTimersByTime(PUSH_MS + 400) })
    expect(container.querySelector('[data-motion-stage]').style.position).toBe('')
    rerender(<Harness path="/rooms" swiping />)
    const stage = container.querySelector('[data-motion-stage]')
    expect(stage.style.position).toBe('relative')
    expect(stage.style.overflowX).toBe('clip')
    expect(container.querySelector('[data-motion-page="enter"]').style.position).toBe('relative')
    rerender(<Harness path="/rooms" />)
    expect(container.querySelector('[data-motion-stage]').style.position).toBe('')
    expect(container.querySelector('[data-motion-stage]').style.overflowX).toBe('')
    expect(container.querySelector('[data-motion-page="enter"]').style.position).toBe('')
    expect(container.querySelector('[data-motion-page="enter"]').style.background).toBe('')
  })

  // The remembered page is only BEHIND this one if a forward navigation put
  // it away. Arrive here by going back and it is the page AHEAD — painting
  // that under a back-gesture would show the wrong room.
  it('no under-page when the remembered page is the one ahead', () => {
    const { container, rerender } = render(<Harness path="/" />)
    rerender(<Harness path="/rooms" />)
    act(() => { vi.advanceTimersByTime(PUSH_MS + 400) })
    rerender(<Harness path="/" back />)                    // ...and back again
    act(() => { vi.advanceTimersByTime(PUSH_MS + 400) })
    expect(getLastExited()).toMatchObject({ key: '/rooms', back: true })
    rerender(<Harness path="/" back swiping />)
    expect(container.querySelector('[data-motion-under]')).toBeNull()
  })

  // A committed swipe has already told the story: the finger carried the page
  // off and brought the previous one in behind it. The navigation it asks for
  // must add nothing, or the page the finger placed jumps back to -30% and
  // slides in while a clone of the page it threw off slides off a second time.
  it('a gesture-committed navigation lands at rest, once', () => {
    const settled = { current: false }
    const { container, rerender } = render(<Harness path="/rooms/x" settled={settled} />)
    settled.current = true
    rerender(<Harness path="/rooms" back settled={settled} />)
    expect(container.querySelector('[data-motion-page="exit"]')).toBeNull()
    const layer = container.querySelector('[data-motion-page]')
    expect(layer.hasAttribute('data-motion-settled')).toBe(true)
    expect(layer.hasAttribute('data-motion-push')).toBe(false)
    expect(layer.getAttribute('data-motion-enter')).toBe('back')   // morph.js still finds it
    expect(layer.style.transform).toBe('')
    expect(settled.current).toBe(false)                            // consumed, once
    // The page it threw off is still remembered, so the next swipe has one.
    expect(getLastExited()).toMatchObject({ key: '/rooms/x' })
    // ...and the navigation after it is an ordinary one again.
    rerender(<Harness path="/devices" settled={settled} />)
    expect(container.querySelector('[data-motion-page="exit"] [data-testid="page-/rooms"]')).not.toBeNull()
    const next = container.querySelector('[data-motion-page="enter"]')
    expect(next.hasAttribute('data-motion-settled')).toBe(false)
    expect(next.hasAttribute('data-motion-push')).toBe(true)
  })

  // The gesture moves the page LAYER, not <main> — so the host needs the node.
  it('hands the page layer to the host through pageRef', () => {
    const pageRef = React.createRef()
    function H({ path }) {
      const scrollerRef = React.useRef({ scrollTop: 0 })
      return (
        <PageTransition pathKey={path} back={false} rtl={false} enabled scrollerRef={scrollerRef} pageRef={pageRef}>
          <Page name={path} />
        </PageTransition>
      )
    }
    const { container, rerender } = render(<H path="/" />)
    expect(pageRef.current).toBe(container.querySelector('[data-motion-page]'))
    rerender(<H path="/rooms" />)
    // The layer is keyed on the route, so the node is a NEW one — and the ref
    // must follow it, never the detached old layer.
    expect(pageRef.current).toBe(container.querySelector('[data-motion-page="enter"]'))
    expect(pageRef.current.querySelector('[data-testid="page-/rooms"]')).not.toBeNull()
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
  // `scrollHeight > clientHeight` is what makes this ref the SCROLLER. A bare
  // `{ scrollTop: 40 }` is not one, and effectiveScrollTop would correctly
  // ignore it and read the document instead (the case below this one).
  function Scroller({ path, back = false, enabled = true }) {
    const scrollerRef = React.useRef({ scrollTop: 40, scrollHeight: 1000, clientHeight: 100 })
    return (
      <PageTransition pathKey={path} back={back} rtl={false} enabled={enabled} scrollerRef={scrollerRef}>
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

  // ...and in the real shell it is the DOCUMENT that scrolled, because <main>
  // is a column in a row flex container and never exceeds its own content.
  // Reading the element would have given 0 and shown the page's top.
  it('freezes the overlay at the document scroll when <main> is not the scroller', () => {
    Object.defineProperty(window, 'scrollY', { value: 40, configurable: true })
    try {
      function DocScroller({ path }) {
        const scrollerRef = React.useRef({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 })
        return (
          <PageTransition pathKey={path} back={false} rtl={false} enabled scrollerRef={scrollerRef}>
            <Counted name={path} />
          </PageTransition>
        )
      }
      const { container, rerender } = render(<DocScroller path="/" />)
      rerender(<DocScroller path="/rooms" />)
      const exit = container.querySelector('[data-motion-page="exit"]')
      expect(exit.firstChild.style.transform).toBe('translateY(-40px)')
    } finally {
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    }
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

  // The outgoing page is a DOM snapshot. Were it the previous render's
  // element rendered again, it would be a SECOND MOUNT of that page: its
  // effects would re-run (a POST, a camera stream, a redirect guard calling
  // navigate() would navigate the app on its way out), its ids would
  // duplicate — with the copy FIRST in DOM order, so every idref in the live
  // page resolves into the dying one — and its autoFocus would steal focus.
  it('overlays a snapshot, not a second instance of the page', () => {
    function Rich({ path }) {
      const scrollerRef = React.useRef({ scrollTop: 0 })
      return (
        <PageTransition pathKey={path} back={false} rtl={false} enabled scrollerRef={scrollerRef}>
          <div data-testid={`page-${path}`}>
            <Counted name={path} />
            <label htmlFor="field-x">x</label>
            <input id="field-x" autoFocus />
          </div>
        </PageTransition>
      )
    }
    const { container, rerender } = render(<Rich path="/" />)
    expect(mounts).toBe(1)
    rerender(<Rich path="/rooms" />)
    const exit = container.querySelector('[data-motion-page="exit"]')
    expect(exit.querySelector('[data-testid="page-/"]')).not.toBeNull()  // it IS the old page
    expect(mounts).toBe(2)                                              // ...mounted twice, not three times
    expect(exit.querySelectorAll('[id]').length).toBe(0)
    expect(exit.querySelectorAll('[autofocus]').length).toBe(0)
    // The clone's root is no longer a page layer: nothing may read it as one.
    expect(container.querySelectorAll('[data-motion-page]').length).toBe(2)
    expect(exit.querySelectorAll('[data-motion-enter], [data-motion-push]').length).toBe(0)
    // The live page keeps its own id, and it is the only one.
    expect(container.querySelectorAll('#field-x').length).toBe(1)
    act(() => { vi.advanceTimersByTime(PUSH_MS + 400) })
    expect(getLastExited().node.querySelector('[data-testid="page-/"]')).not.toBeNull()
  })

  // Nothing of the slide stands at rest. A standing `position: relative`
  // re-parents every absolutely positioned descendant of every page, because
  // <main> is not positioned and today's wrapper is not either.
  it('is unpositioned at rest, on both the stage and the page layer', () => {
    const { container, rerender } = render(<Scroller path="/" />)
    expect(container.querySelector('[data-motion-stage]').style.position).toBe('')
    expect(container.querySelector('[data-motion-page]').style.position).toBe('')
    rerender(<Scroller path="/rooms" />)
    expect(container.querySelector('[data-motion-stage]').style.position).toBe('relative')
    act(() => { vi.advanceTimersByTime(PUSH_MS + 400) })
    expect(container.querySelector('[data-motion-stage]').style.position).toBe('')
    expect(container.querySelector('[data-motion-page="enter"]').style.position).toBe('')
  })

  // With the slide off, the push marker must not appear — it is what tells
  // motion.css to suppress the CSS enter, which is the only entrance left.
  it('never marks a page as pushed while the slide is off', () => {
    const { container, rerender } = render(<Scroller path="/" enabled={false} />)
    rerender(<Scroller path="/rooms" enabled={false} />)
    expect(container.querySelector('[data-motion-push]')).toBeNull()
    expect(container.querySelector('[data-motion-page="current"][data-motion-enter]')).not.toBeNull()
    // ...and the snapshot still exists, so a swipe-back has an under-page.
    expect(getLastExited().node.querySelector('[data-testid="page-/"]')).not.toBeNull()
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
