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

// Every source file except the one being checked, for "does anyone import it".
function otherSources(except) {
  const out = []
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name)
      if (fs.statSync(p).isDirectory()) { if (name !== '__tests__') walk(p) }
      else if (/\.jsx?$/.test(name) && path.resolve(p) !== path.resolve(PAGES, except)) out.push(fs.readFileSync(p, 'utf8'))
    }
  }
  walk(path.resolve(PAGES, '..'))
  return out.join('\n')
}

describe('Settings exports are reachable', () => {
  for (const file of ['Settings.jsx', 'AdminSettings.jsx']) {
    it(`${file}: every *Page export is routed by App.jsx; every other export is imported somewhere`, () => {
      const others = otherSources(file)
      const dead = namedExports(file).filter(name => {
        const used = name.endsWith('Page') ? APP : others
        return !new RegExp(`\\b${name}\\b`).test(used)
      })
      expect(dead, `exported but never mounted or imported: ${dead.join(', ')}`).toEqual([])
    })
  }
})
