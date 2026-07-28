// safeUuid — a UUID generator that works on beta hubs reached over plain
// http://<lan-ip>.
//
// `crypto.randomUUID()` is a SECURE-CONTEXT-only API: it exists over HTTPS and
// on localhost, but is `undefined` over plain HTTP on a LAN IP. Beta users open
// their hub at e.g. http://192.168.1.171, so any code path that called
// `crypto.randomUUID()` threw `TypeError: crypto.randomUUID is not a function` —
// which is what silently broke the automation wizard's "Add action" (button did
// nothing) and "Add condition" (error boundary → "something went wrong").
//
// `crypto.getRandomValues()` is NOT secure-context-gated, so we can still mint a
// cryptographically-strong v4 UUID over http. We fall back to that, then to a
// non-crypto Math.random() variant as a last resort (fine for React list keys).
export function safeUuid() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  if (c && typeof c.getRandomValues === 'function') {
    const b = c.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 0x0f) | 0x40 // version 4
    b[8] = (b[8] & 0x3f) | 0x80 // variant 10x
    const h = [...b].map((x) => x.toString(16).padStart(2, '0'))
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
