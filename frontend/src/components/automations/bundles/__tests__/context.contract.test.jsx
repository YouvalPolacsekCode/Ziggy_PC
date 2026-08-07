// Bundle context — the PROVIDER contract.
//
// recipes.test.jsx hands every recipe a hand-rolled fake ctx. That is fine for
// exercising recipe logic, but it means a key the recipes read can go missing
// from the REAL context and every test still passes. That is exactly what
// happened: 4e98a0d added `roomEntityIds` to the recipes and defined it inside
// useBundleCtx, but never put it on the returned object. `ctx.roomEntityIds`
// was undefined in the app, so Smart Room (view AND create) and Smart Climate
// threw `ctx.roomEntityIds is not a function` into the ErrorBoundary —
// "Something didn't go through. Please try again." The minifier then
// tree-shook the unused const, so the shipped bundle contained the five call
// sites and no provider at all.
//
// These tests bind against the real hook, and the last one derives the required
// key set from the recipe sources so a new ctx.<key> can never again ship
// without a provider.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const RECIPE_DIR = join(HERE, '..', 'recipes')

// ── Store mocks (the hook's only outside world) ──────────────────────────────
const state = {
  entities: [
    { entity_id: 'light.ceiling', domain: 'light' },
    { entity_id: 'light.lamp', domain: 'light' },
  ],
  // Registry rooms carry `.devices[]` (user truth) — NOT `.entities[]`.
  ziggyRooms: [{ id: 'office', name: 'Office', devices: [
    { entity_id: 'light.ceiling' }, { entity_id: 'light.lamp' },
  ] }],
  // HA areas: the office lamp is deliberately absent — it exists only in Ziggy.
  rooms: [{ id: 'office', name: 'Office', entities: ['light.ceiling'] }],
  occupancySensors: [],
}

vi.mock('../../../../lib/i18n', () => ({
  useT: () => (k) => k,
  useLangStore: (sel) => sel({ lang: 'en' }),
}))
vi.mock('../../../../stores/deviceStore', () => ({
  useDeviceStore: (sel) => sel(state),
}))
vi.mock('../../../../lib/utils', () => ({
  entityDisplayName: (e) => e.entity_id,
}))

let useBundleCtx
beforeEach(async () => {
  ({ useBundleCtx } = await import('../engine/context'))
})

const ctxOf = () => renderHook(() => useBundleCtx({ automations: [], hostActions: {} })).result.current

describe('useBundleCtx provider contract', () => {
  it('exposes roomEntityIds as a callable', () => {
    expect(typeof ctxOf().roomEntityIds).toBe('function')
  })

  it('resolves room members from the REGISTRY room, not the HA area', () => {
    // The office lamp has no HA area. Reading ctx.rooms[].entities would drop
    // it — the original office-lamp bug this helper exists to prevent.
    const ids = ctxOf().roomEntityIds({ id: 'office', name: 'Office' })
    expect(ids).toEqual(['light.ceiling', 'light.lamp'])
  })

  it('provides every ctx.<key> the recipes actually read', () => {
    // A recipe that declares loadData() gets its result spread over the base
    // context by BundleHost, so it may legitimately read keys the base doesn't
    // provide (precool's ctx.zones, motionLight's ctx.allLights…). Recipes
    // WITHOUT loadData have no such escape hatch: every ctx.<key> they read
    // must exist here or they throw at render. Smart Room and Smart Climate are
    // both in that group, which is why the missing roomEntityIds killed them.
    const required = new Map()   // key → files that need it from the base ctx
    for (const f of readdirSync(RECIPE_DIR).filter((n) => /\.jsx?$/.test(n))) {
      const src = readFileSync(join(RECIPE_DIR, f), 'utf8')
      if (/\bloadData\b/.test(src)) continue
      for (const m of src.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)) {
        if (!required.has(m[1])) required.set(m[1], [])
        required.get(m[1]).push(f)
      }
    }
    expect(required.size).toBeGreaterThan(0)
    expect(required.has('roomEntityIds')).toBe(true)   // the regression itself

    const ctx = ctxOf()
    const missing = [...required.keys()].filter((k) => !(k in ctx)).sort()
    const detail = missing.map((k) => `ctx.${k} (${required.get(k).join(', ')})`).join('; ')
    expect(missing, `recipes read ${detail} but useBundleCtx never provides it`).toEqual([])
  })
})
