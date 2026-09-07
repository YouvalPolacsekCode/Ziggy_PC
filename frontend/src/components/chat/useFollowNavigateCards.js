// The agent decided to open a screen ("take me to the lamp's page"): its
// reply carries a `navigate` card, and the app FOLLOWS it — once, when the
// reply arrives, with the same dock/`fromChat` rule as a card deep-link.
//
// Once-only is guarded twice:
//   1. Only a message that arrived LIVE qualifies (`msg.live`, stamped by
//      AIChat's send paths). Messages restored from a thread
//      (chatStore.loadThreadMessages) never carry it, so reloading or
//      switching threads replays nothing — the NavigateCard in the thread is
//      the receipt, and its "Open again" is the way back.
//   2. Handled message ids are remembered in a MODULE-level set, not a ref:
//      following the card on a wide screen unmounts the /chat page and mounts
//      the dock's AIChat over the same store, and a fresh per-instance ref
//      would fire the same card a second time.

import { useEffect } from 'react'
import { useChatNav, isAppPath } from './chatNav'

const handled = new Set()

export function navigateCardOf(msg) {
  if (!msg || msg.role === 'user' || msg.ok === false || !msg.live) return null
  const card = msg.card
  return card && card.kind === 'navigate' && isAppPath(card.path) ? card : null
}

export function useFollowNavigateCards(messages) {
  const go = useChatNav()
  useEffect(() => {
    for (const msg of messages || []) {
      const card = navigateCardOf(msg)
      if (!card || msg.id == null || handled.has(msg.id)) continue
      handled.add(msg.id)
      go(card.path)
    }
  }, [messages, go])
}

// Tests only: the set outlives a test's render.
export function _resetFollowedNavigateCards() {
  handled.clear()
}
