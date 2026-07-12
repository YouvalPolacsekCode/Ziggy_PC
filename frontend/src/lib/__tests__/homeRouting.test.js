// Per-home mobile routing tests (Stream 4).
//
// Covers:
//   • homeConfig — upsert / active selection / sync resolution / ws derivation
//   • pairingCapture — QR/payload parsing + finalizeHome base recovery
//   • nativeApiBase — the pure HTTP/WS URL rewrite against the active home
//
// jsdom gives us localStorage + window, so homeConfig's synchronous mirror
// behaves the same as it does in the Capacitor WebView.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearHomes,
  upsertHome,
  setActiveHome,
  listHomesSync,
  getActiveHomeSync,
  resolveHttpBaseSync,
  resolveWsBaseSync,
  setProvisionalTarget,
  clearProvisionalTarget,
  deriveWsBase,
  removeHome,
} from '../homeConfig'
import {
  parsePairPayload,
  applyPairingTarget,
  finalizeHome,
} from '../pairingCapture'
import { rewriteHttpUrl, rewriteWsUrl } from '../nativeApiBase'

const PROD_HTTP = 'https://app.ziggy-home.com'
const PROD_WS   = 'wss://app.ziggy-home.com'

beforeEach(() => {
  clearHomes()
  clearProvisionalTarget()
})

describe('homeConfig', () => {
  it('derives a ws base from an http base, preserving path prefix', () => {
    expect(deriveWsBase('https://a.hubs.ziggy-home.com')).toBe('wss://a.hubs.ziggy-home.com')
    expect(deriveWsBase('http://box.local:8001')).toBe('ws://box.local:8001')
    expect(deriveWsBase('https://relay.ziggy-home.com/api/proxy/home_1/')).toBe('wss://relay.ziggy-home.com/api/proxy/home_1')
    expect(deriveWsBase(null)).toBe(null)
  })

  it('upserts a home, makes the first one active, and resolves sync bases', () => {
    upsertHome({ home_id: 'home_1', baseUrl: 'https://home1.hubs.ziggy-home.com' })
    expect(listHomesSync()).toHaveLength(1)
    expect(getActiveHomeSync().home_id).toBe('home_1')
    expect(resolveHttpBaseSync()).toBe('https://home1.hubs.ziggy-home.com')
    expect(resolveWsBaseSync()).toBe('wss://home1.hubs.ziggy-home.com')
  })

  it('supports multiple homes with active-home switching', () => {
    upsertHome({ home_id: 'home_1', baseUrl: 'https://home1.hubs.ziggy-home.com' })
    upsertHome({ home_id: 'home_2', baseUrl: 'https://home2.hubs.ziggy-home.com' })
    expect(listHomesSync()).toHaveLength(2)
    expect(getActiveHomeSync().home_id).toBe('home_1')   // unchanged
    expect(setActiveHome('home_2')).toBe(true)
    expect(resolveHttpBaseSync()).toBe('https://home2.hubs.ziggy-home.com')
    expect(setActiveHome('does_not_exist')).toBe(false)
  })

  it('keeps the active home resolvable and mirrors to sync storage when present', () => {
    upsertHome({ home_id: 'home_9', baseUrl: 'https://home9.hubs.ziggy-home.com' })
    setActiveHome('home_9')
    // In-memory cache is the always-on guarantee.
    expect(resolveHttpBaseSync()).toBe('https://home9.hubs.ziggy-home.com')
    expect(resolveWsBaseSync()).toBe('wss://home9.hubs.ziggy-home.com')
    // When a synchronous localStorage backend exists (real WebView / browser —
    // this is what nativeApiBase reads at boot before any async load), the
    // mirror must land with the derived ws base too. jsdom in CI may not expose
    // localStorage, in which case homeConfig runs in-memory only — still valid.
    const ls = (typeof localStorage !== 'undefined' && localStorage) || null
    if (ls) {
      const homes = JSON.parse(ls.getItem('ziggy_homes'))
      expect(homes.find(h => h.home_id === 'home_9')).toMatchObject({
        baseUrl: 'https://home9.hubs.ziggy-home.com',
        wsBaseUrl: 'wss://home9.hubs.ziggy-home.com',
      })
      expect(ls.getItem('ziggy_active_home_id')).toBe('home_9')
    }
  })

  it('provisional target wins over the active home', () => {
    upsertHome({ home_id: 'home_1', baseUrl: 'https://home1.hubs.ziggy-home.com' })
    setProvisionalTarget('https://fresh.hubs.ziggy-home.com')
    expect(resolveHttpBaseSync()).toBe('https://fresh.hubs.ziggy-home.com')
    expect(resolveWsBaseSync()).toBe('wss://fresh.hubs.ziggy-home.com')
    clearProvisionalTarget()
    expect(resolveHttpBaseSync()).toBe('https://home1.hubs.ziggy-home.com')
  })

  it('removes a home and reselects an active one', () => {
    upsertHome({ home_id: 'home_1', baseUrl: 'https://home1.hubs.ziggy-home.com' })
    upsertHome({ home_id: 'home_2', baseUrl: 'https://home2.hubs.ziggy-home.com' })
    removeHome('home_1')
    expect(listHomesSync()).toHaveLength(1)
    expect(getActiveHomeSync().home_id).toBe('home_2')
  })
})

describe('pairingCapture.parsePairPayload', () => {
  it('parses a bare code', () => {
    expect(parsePairPayload('ABC123')).toMatchObject({ code: 'ABC123', baseUrl: null })
  })

  it('parses a ziggy:// deep link with base + relay + home', () => {
    const raw = 'ziggy://pair?code=abc123&base=' +
      encodeURIComponent('https://home7.hubs.ziggy-home.com') +
      '&relay=' + encodeURIComponent('https://relay.ziggy-home.com') +
      '&home=home_7'
    const p = parsePairPayload(raw)
    expect(p.code).toBe('ABC123')
    expect(p.baseUrl).toBe('https://home7.hubs.ziggy-home.com')
    expect(p.relayUrl).toBe('https://relay.ziggy-home.com')
    expect(p.homeId).toBe('home_7')
  })

  it('synthesizes a relay-proxy base from relay + home_id when no base is given', () => {
    const raw = 'ziggy://pair?code=XYZ9&relay=' +
      encodeURIComponent('https://relay.ziggy-home.com/') + '&home=home_5'
    const p = parsePairPayload(raw)
    expect(p.baseUrl).toBe('https://relay.ziggy-home.com/api/proxy/home_5')
  })

  it('ignores non-http base hints (no accidental routing)', () => {
    const p = parsePairPayload('ziggy://pair?code=AA11&base=' + encodeURIComponent('javascript:alert(1)'))
    expect(p.code).toBe('AA11')
    expect(p.baseUrl).toBe(null)
  })
})

describe('pairingCapture.finalizeHome', () => {
  it('recovers the per-home base from the pair response webhook_url', () => {
    const home = finalizeHome({
      parsed: { code: 'ABC123' },
      pairResponse: {
        home_id: 'home_42',
        webhook_url: 'https://home42.ziggy.app/api/mobile/webhook/wh_1',
        ws_url: 'wss://home42.ziggy.app/api/mobile/ws',
      },
    })
    expect(home.home_id).toBe('home_42')
    expect(home.baseUrl).toBe('https://home42.ziggy.app')
    expect(home.wsBaseUrl).toBe('wss://home42.ziggy.app')
    expect(getActiveHomeSync().home_id).toBe('home_42')
  })

  it('falls back to ws_url origin when webhook_url is absent', () => {
    const home = finalizeHome({
      pairResponse: { home_id: 'home_43', ws_url: 'wss://home43.ziggy.app/api/mobile/ws' },
    })
    expect(home.baseUrl).toBe('https://home43.ziggy.app')
  })

  it('falls back to the QR base when the response carries no URLs', () => {
    const home = finalizeHome({
      parsed: { code: 'C', baseUrl: 'https://qr.hubs.ziggy-home.com' },
      pairResponse: { home_id: 'home_44' },
    })
    expect(home.baseUrl).toBe('https://qr.hubs.ziggy-home.com')
  })

  it('returns null (stores nothing) when no home_id can be resolved', () => {
    expect(finalizeHome({ pairResponse: {} })).toBe(null)
    expect(listHomesSync()).toHaveLength(0)
  })

  it('applyPairingTarget sets a provisional target that routes the pair request', () => {
    applyPairingTarget({ baseUrl: 'https://fresh.hubs.ziggy-home.com' })
    expect(resolveHttpBaseSync()).toBe('https://fresh.hubs.ziggy-home.com')
  })
})

describe('nativeApiBase URL rewrites', () => {
  it('falls back to the compiled-in PROD default when no home is configured', () => {
    expect(rewriteHttpUrl('/api/mobile/pair')).toBe(PROD_HTTP + '/api/mobile/pair')
    expect(rewriteWsUrl('wss://localhost/ws?token=abc')).toBe(PROD_WS + '/ws?token=abc')
  })

  it('routes to the active per-home base once configured', () => {
    upsertHome({ home_id: 'home_1', baseUrl: 'https://home1.hubs.ziggy-home.com' })
    expect(rewriteHttpUrl('/api/devices')).toBe('https://home1.hubs.ziggy-home.com/api/devices')
    expect(rewriteWsUrl('wss://localhost/ws?token=abc')).toBe('wss://home1.hubs.ziggy-home.com/ws?token=abc')
  })

  it('routes through a relay-proxy prefix, preserving the WS path + query', () => {
    upsertHome({ home_id: 'home_5', baseUrl: 'https://relay.ziggy-home.com/api/proxy/home_5' })
    expect(rewriteHttpUrl('/api/status')).toBe('https://relay.ziggy-home.com/api/proxy/home_5/api/status')
    expect(rewriteWsUrl('wss://localhost/ws?token=t')).toBe('wss://relay.ziggy-home.com/api/proxy/home_5/ws?token=t')
    expect(rewriteWsUrl('/ws')).toBe('wss://relay.ziggy-home.com/api/proxy/home_5/ws')
  })

  it('leaves fully-qualified non-localhost URLs untouched', () => {
    upsertHome({ home_id: 'home_1', baseUrl: 'https://home1.hubs.ziggy-home.com' })
    expect(rewriteHttpUrl('https://example.com/x')).toBe('https://example.com/x')
    expect(rewriteWsUrl('wss://other.example.com/ws')).toBe('wss://other.example.com/ws')
  })
})
