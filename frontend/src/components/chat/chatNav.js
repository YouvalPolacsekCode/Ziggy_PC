// In-context navigation out of the chat.
//
// A card names a real object (a device, a room, a page); opening it keeps
// the conversation at hand: on wide screens AppShell keeps the chat docked
// beside the page (chatDock); on phones the chat sheet, if it was open,
// collapses back to its bubble so the page it just opened is actually
// visible — the conversation stays in the store, one tap away. One rule,
// used by every card deep-link and by the agent's own `navigate` card
// (AIChat follows it).
//
// The /chat page, the dock and the sheet all render inside the router, so
// useNavigate is safe here.

import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChatStore, isWideForChatDock } from '../../stores/chatStore'

// Only an in-app path is ever followed: absolute, single leading slash. A
// card is server data; a scheme or a protocol-relative URL is refused.
export function isAppPath(path) {
  return typeof path === 'string' && path.length > 1 && path[0] === '/' && path[1] !== '/'
}

export function useChatNav() {
  const navigate = useNavigate()
  const setChatDock = useChatStore((s) => s.setChatDock)
  const setChatSheet = useChatStore((s) => s.setChatSheet)
  return useCallback((path) => {
    if (!isAppPath(path)) return
    if (isWideForChatDock()) setChatDock(true)
    // `fromChat` marks the location as reached from a conversation; nothing
    // renders off it today (the phone back-pill it fed is gone), it stays as
    // a cheap, honest breadcrumb for anything that wants it later.
    navigate(path, { state: { fromChat: true } })
    // Phone: the sheet collapses AFTER the page changes underneath it.
    if (useChatStore.getState().chatSheet) setChatSheet(false)
  }, [navigate, setChatDock, setChatSheet])
}
