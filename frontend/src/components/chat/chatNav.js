// In-context navigation out of the chat.
//
// A card names a real object (a device, a room, a page); opening it keeps
// the conversation at hand: on wide screens AppShell keeps the chat docked
// beside the page (chatDock), on phones the page shows a "back to chat" pill
// for any location whose state carries `fromChat`. One rule, used by every
// card deep-link and by the agent's own `navigate` card (AIChat follows it).
//
// Both the /chat page and the dock render inside the router, so useNavigate
// is safe here.

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
  return useCallback((path) => {
    if (!isAppPath(path)) return
    if (isWideForChatDock()) setChatDock(true)
    navigate(path, { state: { fromChat: true } })
  }, [navigate, setChatDock])
}
