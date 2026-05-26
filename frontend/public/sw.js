// Ziggy service worker — push notifications only.
//
// IMPORTANT: this SW intentionally does NOT register any fetch handler. The
// previous workbox-generated SW precached the hashed JS bundle and intercepted
// navigation requests, which broke mobile clients whenever the bundle was
// rebuilt (the cached index.html still pointed at the old asset hash → 404 →
// blank page). Direct network fetch from the backend is fine and avoids the
// stale-index-html trap.
//
// On install, the SW also tries to wipe any precache left behind by an older
// workbox SW so that mobiles that were previously stuck on a broken cache
// recover automatically on the next page load.

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // Drop everything any prior SW (workbox or otherwise) had cached so the
    // browser has to re-fetch HTML+JS from the network. Safe — we don't rely
    // on any cache for offline ourselves.
    try {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    } catch {}
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Take over open tabs immediately, then tell every controlled client to
    // reload so a previously-broken page (showing only HTML because the old
    // workbox SW pointed it at a missing asset hash) recovers without the
    // user needing a second manual reload.
    await self.clients.claim()
    const list = await self.clients.matchAll({ type: 'window' })
    for (const client of list) {
      try { client.navigate(client.url) } catch {}
    }
  })())
})

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'Ziggy', body: 'New notification', url: '/' }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {}

  // Action buttons (max 2-3 per platform). Each entry: { action: <token>, title: <label> }.
  // The backend mints one-shot tokens via services/push_actions.py and binds each to a
  // deferred Action; tapping the button POSTs /api/push/action/{token} to fire it.
  const actions = Array.isArray(data.actions) ? data.actions.slice(0, 3) : []

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:                data.body,
      icon:                '/icons/icon-192.png',
      badge:               '/icons/icon-192.png',
      data:                { url: data.url, actions },
      requireInteraction:  actions.length > 0,
      actions:             actions,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}

  // If the user tapped an action button, fire the bound backend Action.
  if (event.action) {
    event.waitUntil((async () => {
      try {
        await fetch(`/api/push/action/${encodeURIComponent(event.action)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (e) {
        // Best-effort: if the network call fails (offline, expired token), fall back to opening the app.
        const list = await clients.matchAll({ type: 'window', includeUncontrolled: true })
        for (const client of list) {
          if (client.url.includes(self.location.origin) && 'focus' in client) return client.focus()
        }
        return clients.openWindow(data.url || '/')
      }
    })())
    return
  }

  // Default click (no specific button) → open the app at the notification's URL.
  const url = data.url || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return clients.openWindow(url)
    })
  )
})
