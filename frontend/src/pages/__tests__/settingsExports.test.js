// Every Settings sub-page that is exported must be reachable.
//
// Why this exists: `IrHubsPage` was exported from Settings.jsx, had i18n keys
// in both dictionaries, and was mentioned in a comment as "the homeowner
// surface for IR blasters" — and had no route and no importer for months.
// Nothing linked to it, so the only UI for renaming, deleting or re-scanning
// an IR hub was unreachable. Exporting a page is a claim that it is mounted;
// this test makes App.jsx back that claim.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PAGES = path.resolve(HERE, '..')
const APP = fs.readFileSync(path.resolve(PAGES, '../App.jsx'), 'utf8')

function namedExports(file) {
  const src = fs.readFileSync(path.join(PAGES, file), 'utf8')
  return [...src.matchAll(/^export function ([A-Z][A-Za-z0-9]*)\(/gm)].map(m => m[1])
}

describe('Settings sub-page exports are mounted', () => {
  for (const file of ['Settings.jsx', 'AdminSettings.jsx']) {
    it(`${file}: every named export is referenced by App.jsx`, () => {
      const unrouted = namedExports(file).filter(name => {
        // A sub-component consumed by another page (PushPreferenceCenter) is
        // not a page; only things App.jsx should mount are checked.
        if (name === 'PushPreferenceCenter') return false
        return !new RegExp(`\\b${name}\\b`).test(APP)
      })
      expect(unrouted, `exported but never mounted: ${unrouted.join(', ')}`).toEqual([])
    })
  }
})
