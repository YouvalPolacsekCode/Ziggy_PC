// ChatBubble + ChatSheet — the phone chat surface exists only where it may
// (narrow, not /chat), raises the one AIChat, counts replies nobody saw, and
// folds away on Escape / close / a card navigation.

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

// i18n → identity so assertions match on keys.
vi.mock('../../../lib/i18n', () => ({
  t: (k) => k,
  useT: () => (k) => k,
  useLang: () => 'en',
  useIsRTL: () => false,
}))

// AIChat is 2,300 lines of mic + threads + viewport; the sheet only needs to
// prove it mounts exactly one of them.
vi.mock('../../../pages/AIChat', () => ({
  default: (props) => <div data-testid="aichat-stub" data-docked={props.docked ? '1' : '0'} />,
}))

// The WS module opens a socket at import; stand in with a push-able store
// that hands out the same `_seq`-tagged buffer shape the real hook does.
const ws = vi.hoisted(() => {
  const listeners = new Set()
  let messages = []
  let seq = 0
  return {
    get messages() { return messages },
    listeners,
    push(m) { messages = [...messages, { ...m, _seq: ++seq }]; listeners.forEach((l) => l()) },
    reset() { messages = []; seq = 0 },
  }
})
vi.mock('../../../hooks/useWebSocket', async () => {
  const React = await import('react')
  return {
    useWsMessages: () => React.useSyncExternalStore(
      (cb) => { ws.listeners.add(cb); return () => ws.listeners.delete(cb) },
      () => ws.messages,
    ),
  }
})

// framer-motion → plain elements (same shape as ChatCards.test). Drag
// controls become a no-op; AnimatePresence just renders its children so a
// close is an immediate unmount.
const motionState = { reduce: false }
const MOTION_PROPS = ['initial', 'animate', 'exit', 'transition', 'layout', 'whileHover', 'whileTap', 'variants',
  'drag', 'dragListener', 'dragControls', 'dragConstraints', 'dragElastic', 'dragMomentum', 'onDragEnd']
vi.mock('framer-motion', () => {
  const cache = {}
  const motion = new Proxy({}, {
    get(_, tag) {
      if (!cache[tag]) {
        cache[tag] = React.forwardRef(function Motion(props, ref) {
          const rest = { ...props }
          for (const k of MOTION_PROPS) delete rest[k]
          return React.createElement(tag, { ...rest, ref })
        })
      }
      return cache[tag]
    },
  })
  return {
    motion,
    AnimatePresence: ({ children }) => children,
    useReducedMotion: () => motionState.reduce,
    useDragControls: () => ({ start() {} }),
  }
})

import { ChatBubble, chatSurfaceHidden } from '../ChatBubble'
import { ChatSheet } from '../ChatSheet'
import { useChatNav } from '../chatNav'
import { useChatStore } from '../../../stores/chatStore'

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc" data-path={loc.pathname} />
}

// A page-side button that follows a card link, the way a chat card would.
function CardLink({ to }) {
  const go = useChatNav()
  return <button type="button" data-testid="card-link" onClick={() => go(to)}>go</button>
}

function render(route = '/', extra = null) {
  return rtlRender(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="*" element={<><ChatBubble /><ChatSheet />{extra}<LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

let origMatchMedia
function setWide(wide) {
  window.matchMedia = vi.fn(() => ({ matches: wide, addEventListener() {}, removeEventListener() {} }))
}

beforeEach(() => {
  origMatchMedia = window.matchMedia
  setWide(false)
  ws.reset()
  useChatStore.setState({ chatSheet: false, chatUnread: 0, chatDock: false, threadId: null, threads: [] })
})
afterEach(() => { window.matchMedia = origMatchMedia })

describe('chatSurfaceHidden', () => {
  it('hides on the chat page and the surfaces that carry no shell chat', () => {
    for (const p of ['/chat', '/chat/x', '/wall', '/wall/tablets', '/ops', '/ops/debug', '/mobile-onboarding', '/welcome']) {
      expect(chatSurfaceHidden(p)).toBe(true)
    }
    for (const p of ['/', '/rooms', '/devices/light.x', '/chatter', '/settings']) {
      expect(chatSurfaceHidden(p)).toBe(false)
    }
  })
})

describe('ChatBubble', () => {
  it('renders on a narrow screen on a non-chat route', () => {
    render('/rooms')
    expect(screen.getByTestId('chat-bubble')).toBeInTheDocument()
    expect(screen.queryByTestId('aichat-stub')).toBeNull()
  })

  it('does not render on /chat', () => {
    render('/chat')
    expect(screen.queryByTestId('chat-bubble')).toBeNull()
  })

  it('does not render on a wide screen (the dock owns the chat there)', () => {
    setWide(true)
    render('/rooms')
    expect(screen.queryByTestId('chat-bubble')).toBeNull()
  })

  it('tap opens the sheet with exactly one docked AIChat', () => {
    render('/rooms')
    fireEvent.click(screen.getByTestId('chat-bubble'))
    expect(useChatStore.getState().chatSheet).toBe(true)
    const chats = screen.getAllByTestId('aichat-stub')
    expect(chats).toHaveLength(1)
    expect(chats[0]).toHaveAttribute('data-docked', '1')
    expect(screen.getByTestId('chat-sheet')).toHaveAttribute('role', 'dialog')
    // The bubble steps aside while the sheet is up.
    expect(screen.getByTestId('chat-bubble')).toHaveAttribute('data-open')
  })

  it('counts ziggy_response pushes while closed, clears on open', () => {
    render('/rooms')
    expect(screen.queryByTestId('chat-bubble-badge')).toBeNull()
    act(() => { ws.push({ type: 'ziggy_response', ok: true, reply: 'done' }) })
    expect(screen.getByTestId('chat-bubble-badge')).toHaveTextContent('1')
    act(() => {
      ws.push({ type: 'state_changed', entity_id: 'light.x' })   // not a reply
      ws.push({ type: 'ziggy_response', ok: true, reply: 'again' })
    })
    expect(screen.getByTestId('chat-bubble-badge')).toHaveTextContent('2')
    expect(useChatStore.getState().chatUnread).toBe(2)

    fireEvent.click(screen.getByTestId('chat-bubble'))
    expect(useChatStore.getState().chatUnread).toBe(0)
    expect(screen.queryByTestId('chat-bubble-badge')).toBeNull()

    // A reply that lands while the sheet is OPEN was seen — no badge.
    act(() => { ws.push({ type: 'ziggy_response', ok: true, reply: 'seen' }) })
    expect(useChatStore.getState().chatUnread).toBe(0)
  })

  it('ignores replies already in the WS buffer at mount', () => {
    ws.push({ type: 'ziggy_response', ok: true, reply: 'old' })
    render('/rooms')
    expect(screen.queryByTestId('chat-bubble-badge')).toBeNull()
  })

  it('Escape closes the sheet', () => {
    render('/rooms')
    fireEvent.click(screen.getByTestId('chat-bubble'))
    expect(screen.getByTestId('aichat-stub')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useChatStore.getState().chatSheet).toBe(false)
    expect(screen.queryByTestId('aichat-stub')).toBeNull()
  })

  it('× and the scrim close the sheet', () => {
    render('/rooms')
    fireEvent.click(screen.getByTestId('chat-bubble'))
    fireEvent.click(screen.getByTestId('chat-sheet-close'))
    expect(screen.queryByTestId('aichat-stub')).toBeNull()
    fireEvent.click(screen.getByTestId('chat-bubble'))
    fireEvent.click(screen.getByTestId('chat-sheet-scrim'))
    expect(screen.queryByTestId('aichat-stub')).toBeNull()
  })

  it('"Open full" goes to /chat and leaves no sheet or bubble behind', () => {
    render('/rooms')
    fireEvent.click(screen.getByTestId('chat-bubble'))
    fireEvent.click(screen.getByTestId('chat-sheet-open-full'))
    expect(screen.getByTestId('loc')).toHaveAttribute('data-path', '/chat')
    expect(useChatStore.getState().chatSheet).toBe(false)
    expect(screen.queryByTestId('chat-sheet')).toBeNull()
    expect(screen.queryByTestId('chat-bubble')).toBeNull()
    // The /chat page would mount its own AIChat; the sheet's is gone.
    expect(screen.queryByTestId('aichat-stub')).toBeNull()
  })

  it('a card navigation collapses the open sheet to the bubble', () => {
    render('/rooms', <CardLink to="/devices/light.desk_lamp" />)
    fireEvent.click(screen.getByTestId('chat-bubble'))
    expect(useChatStore.getState().chatSheet).toBe(true)
    fireEvent.click(screen.getByTestId('card-link'))
    expect(screen.getByTestId('loc')).toHaveAttribute('data-path', '/devices/light.desk_lamp')
    expect(useChatStore.getState().chatSheet).toBe(false)
    expect(screen.queryByTestId('aichat-stub')).toBeNull()
    expect(screen.getByTestId('chat-bubble')).not.toHaveAttribute('data-open')
  })

  it('shows the active thread title, falling back to Ziggy', () => {
    render('/rooms')
    fireEvent.click(screen.getByTestId('chat-bubble'))
    expect(screen.getByTestId('chat-sheet')).toHaveAttribute('aria-label', 'nav.ziggy')
    act(() => {
      useChatStore.setState({ threadId: 't1', threads: [{ thread_id: 't1', title: 'Bedroom lights' }] })
    })
    expect(screen.getByTestId('chat-sheet')).toHaveAttribute('aria-label', 'Bedroom lights')
    act(() => {
      useChatStore.setState({ threads: [{ thread_id: 't1', title: 'New chat' }] })
    })
    expect(screen.getByTestId('chat-sheet')).toHaveAttribute('aria-label', 'nav.ziggy')
  })
})
