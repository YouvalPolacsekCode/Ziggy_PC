// Floating chat bubble — phones only.
//
// On a narrow screen the chat has no room to live beside a page the way the
// wide-screen dock does, so it folds into this 56px FAB (ink fill, the
// sparkle in the page colour) above the bottom nav. Tapping it raises the chat as a bottom sheet (ChatSheet) over whatever
// page is open; the conversation itself lives in chatStore, so it is the
// same chat the /chat tab shows, not a second one.
//
// Where it appears: every AppShell route except /chat (the page IS the chat)
// — plus a defensive list of surfaces that never carry it (wall, ops,
// onboarding) should one of them ever be mounted under the shell. On wide
// screens (CHAT_DOCK_QUERY) it never renders: the dock is the phone-free
// answer there, and mounting both would be two live chats.
//
// Unread: a `ziggy_response` push that lands while the sheet is closed bumps
// a badge, so a reply to something asked before closing the sheet (Ziggy was
// still thinking) is not lost. Counting uses the same monotonic `_seq` cursor
// as useChatThreads / App.jsx, primed at mount so the WS buffer's history is
// never counted as new. Opening the sheet — or landing on /chat — clears it.

import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useChatStore, CHAT_DOCK_QUERY } from '../../stores/chatStore'
import { useMediaQuery } from '../../wall/useMediaQuery'
import { useWsMessages } from '../../hooks/useWebSocket'
import { useT } from '../../lib/i18n'
import { ZIcon } from '../layout/ZIcon'
import './chatBubble.css'

// Routes that carry their own chat (or none at all). Prefix match on a path
// segment boundary, so `/chatter` would not be swallowed by `/chat`.
const HIDDEN_PREFIXES = ['/chat', '/wall', '/ops', '/mobile-onboarding', '/mobile-diagnostics', '/invite', '/welcome', '/login']

export function chatSurfaceHidden(pathname) {
  const p = pathname || '/'
  return HIDDEN_PREFIXES.some((pre) => p === pre || p.startsWith(pre + '/'))
}

// One hook answers "may the phone chat surface exist here?" for both the
// bubble and the sheet, so they can never disagree.
export function useChatSurfaceEligible() {
  const location = useLocation()
  const wide = useMediaQuery(CHAT_DOCK_QUERY)
  return !wide && !chatSurfaceHidden(location.pathname)
}

export function ChatBubble() {
  const t = useT()
  const location = useLocation()
  const eligible = useChatSurfaceEligible()
  const open = useChatStore((s) => s.chatSheet)
  const unread = useChatStore((s) => s.chatUnread)
  const setChatSheet = useChatStore((s) => s.setChatSheet)
  const bumpChatUnread = useChatStore((s) => s.bumpChatUnread)
  const clearChatUnread = useChatStore((s) => s.clearChatUnread)

  // Unread counter. `lastSeq` starts null so the first pass only primes the
  // cursor from whatever the buffer already holds.
  const wsMessages = useWsMessages()
  const lastSeq = useRef(null)
  useEffect(() => {
    const list = wsMessages || []
    if (lastSeq.current === null) {
      lastSeq.current = list.reduce((m, x) => Math.max(m, x?._seq ?? 0), 0)
      return
    }
    let fresh = 0
    for (const m of list) {
      if (m?._seq == null || m._seq <= lastSeq.current) continue
      lastSeq.current = m._seq
      if (m.type === 'ziggy_response') fresh += 1
    }
    if (!fresh) return
    // Only a reply nobody is looking at is "unread": the sheet is closed and
    // the page under it is not the chat itself.
    const s = useChatStore.getState()
    if (!s.chatSheet && !chatSurfaceHidden(location.pathname)) bumpChatUnread(fresh)
  }, [wsMessages, location.pathname, bumpChatUnread])

  // Landing on /chat is reading the chat.
  useEffect(() => {
    if (location.pathname === '/chat' || location.pathname.startsWith('/chat/')) clearChatUnread()
  }, [location.pathname, clearChatUnread])

  if (!eligible) return null

  const label = unread > 0
    ? (unread === 1 ? t('chat.bubble.unreadOne') : t('chat.bubble.unread', { n: unread }))
    : t('chat.bubble.open')

  return (
    <button
      type="button"
      className="z-chat-bubble"
      data-testid="chat-bubble"
      data-open={open || undefined}
      aria-label={label}
      title={label}
      aria-expanded={open}
      aria-haspopup="dialog"
      onClick={() => setChatSheet(true)}
    >
      <ZIcon name="sparkle" size={24} stroke={1.75} color="var(--bg)" />
      {unread > 0 && (
        <span className="z-chat-bubble-badge" data-testid="chat-bubble-badge" aria-hidden="true">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  )
}

export default ChatBubble
