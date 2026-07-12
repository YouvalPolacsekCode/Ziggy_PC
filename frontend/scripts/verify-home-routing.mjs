// Runnable smoke check for per-home mobile routing (Stream 4).
//
//   cd frontend && npx vite-node scripts/verify-home-routing.mjs
//
// Uses vite-node (a vitest dependency) so the app's extensionless ESM imports
// resolve exactly as they do under Vite/vitest — plain `node` cannot resolve
// them. In this context there's no localStorage; homeConfig degrades to its
// in-memory cache (the mirror simply no-ops), which is enough to exercise the
// routing logic end to end. `npm test` (vitest, jsdom) is the fuller suite —
// this script is a quick manual/CI sanity gate.

import assert from 'node:assert/strict'
import {
  clearHomes, upsertHome, setActiveHome,
  resolveHttpBaseSync, resolveWsBaseSync,
  setProvisionalTarget, clearProvisionalTarget, deriveWsBase,
} from '../src/lib/homeConfig.js'
import { parsePairPayload, finalizeHome } from '../src/lib/pairingCapture.js'
import { rewriteHttpUrl, rewriteWsUrl } from '../src/lib/nativeApiBase.js'

let n = 0
const check = (name, fn) => { fn(); n++; console.log('  ok -', name) }

clearHomes(); clearProvisionalTarget()

check('deriveWsBase preserves proxy path', () => {
  assert.equal(deriveWsBase('https://relay/api/proxy/h1/'), 'wss://relay/api/proxy/h1')
})

check('unconfigured install falls back to PROD default', () => {
  assert.equal(rewriteHttpUrl('/api/mobile/pair'), 'https://app.ziggy-home.com/api/mobile/pair')
  assert.equal(rewriteWsUrl('wss://localhost/ws?token=x'), 'wss://app.ziggy-home.com/ws?token=x')
})

check('active per-home base routes http + ws', () => {
  upsertHome({ home_id: 'home_1', baseUrl: 'https://home1.hubs.ziggy-home.com' })
  setActiveHome('home_1')
  assert.equal(rewriteHttpUrl('/api/devices'), 'https://home1.hubs.ziggy-home.com/api/devices')
  assert.equal(rewriteWsUrl('wss://localhost/ws?token=x'), 'wss://home1.hubs.ziggy-home.com/ws?token=x')
})

check('relay-proxy prefix routes with preserved ws path', () => {
  clearHomes()
  upsertHome({ home_id: 'home_5', baseUrl: 'https://relay.ziggy-home.com/api/proxy/home_5' })
  setActiveHome('home_5')
  assert.equal(rewriteHttpUrl('/api/status'), 'https://relay.ziggy-home.com/api/proxy/home_5/api/status')
  assert.equal(rewriteWsUrl('wss://localhost/ws?token=t'), 'wss://relay.ziggy-home.com/api/proxy/home_5/ws?token=t')
})

check('provisional target overrides active during pairing handshake', () => {
  setProvisionalTarget('https://fresh.hubs.ziggy-home.com')
  assert.equal(resolveHttpBaseSync(), 'https://fresh.hubs.ziggy-home.com')
  assert.equal(resolveWsBaseSync(), 'wss://fresh.hubs.ziggy-home.com')
  clearProvisionalTarget()
})

check('QR deep-link parses code + base + relay + home', () => {
  const raw = 'ziggy://pair?code=abc123&base=' +
    encodeURIComponent('https://home7.hubs.ziggy-home.com') +
    '&relay=' + encodeURIComponent('https://relay.ziggy-home.com') + '&home=home_7'
  const p = parsePairPayload(raw)
  assert.equal(p.code, 'ABC123')
  assert.equal(p.baseUrl, 'https://home7.hubs.ziggy-home.com')
  assert.equal(p.homeId, 'home_7')
})

check('finalizeHome recovers base from pair response webhook_url', () => {
  clearHomes()
  const home = finalizeHome({
    pairResponse: {
      home_id: 'home_42',
      webhook_url: 'https://home42.ziggy.app/api/mobile/webhook/wh_1',
      ws_url: 'wss://home42.ziggy.app/api/mobile/ws',
    },
  })
  assert.equal(home.baseUrl, 'https://home42.ziggy.app')
  assert.equal(home.wsBaseUrl, 'wss://home42.ziggy.app')
  assert.equal(resolveHttpBaseSync(), 'https://home42.ziggy.app')
})

console.log(`\n${n} checks passed.`)
