// i18n key integrity.
//
// Why this exists: the Settings hub rendered the literal strings
// `media.settingsLinkTitle` / `media.settingsLinkSubtitle` for anyone with the
// music feature on, and the speaker "forget" button announced `common.forget`,
// because those keys were referenced in JSX but never added to either
// dictionary. `t()` falls back to the key itself, so nothing threw and no test
// noticed. This scans every source file for literal `t('…')` keys and fails
// the build if any is missing from en.js — and separately checks that he.js
// mirrors en.js, since a Hebrew user silently reading English is a bug too.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import en from '../en'
import he from '../he'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      if (name === '__tests__' || name === 'i18n' || name === 'node_modules') continue
      walk(p, out)
    } else if (/\.(jsx?|tsx?)$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

// Literal keys only: `t('a.b')`, `i18nT('a.b')`, `t("a.b")`. Dynamic keys
// (template literals) are the caller's responsibility.
const KEY_RE = /\b(?:t|i18nT)\(\s*['"]([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)['"]/g

function usedKeys() {
  const used = new Map()
  for (const file of walk(SRC)) {
    // Drop // line comments and /* */ blocks so a usage example in a doc
    // comment is not mistaken for a real call.
    const text = fs.readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    let m
    while ((m = KEY_RE.exec(text))) {
      if (!used.has(m[1])) used.set(m[1], path.relative(SRC, file))
    }
  }
  return used
}

describe('i18n dictionaries', () => {
  it('every literal t() key used in src exists in en.js', () => {
    const missing = []
    for (const [key, file] of usedKeys()) {
      if (!(key in en)) missing.push(`${key}  (${file})`)
    }
    expect(missing, `keys referenced but not defined:\n${missing.join('\n')}`).toEqual([])
  })

  it('he.js defines every key en.js defines', () => {
    const missing = Object.keys(en).filter(k => !(k in he))
    expect(missing, `en.js keys missing from he.js:\n${missing.join('\n')}`).toEqual([])
  })

  it('en.js defines every key he.js defines', () => {
    const extra = Object.keys(he).filter(k => !(k in en))
    expect(extra, `he.js keys with no en.js counterpart:\n${extra.join('\n')}`).toEqual([])
  })

  // A duplicated key silently resolves to whichever entry comes last, so an
  // edit to the first one changes nothing on screen. en.js carried 114 of
  // these before this test existed.
  for (const name of ['en', 'he']) {
    it(`${name}.js has no duplicate keys`, () => {
      const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../${name}.js`)
      const keys = [...fs.readFileSync(file, 'utf8').matchAll(/^\s*'([a-zA-Z0-9_.]+)':/gm)].map(m => m[1])
      const seen = new Set(), dupes = []
      for (const k of keys) { if (seen.has(k)) dupes.push(k); seen.add(k) }
      expect(dupes, `duplicate keys in ${name}.js:\n${[...new Set(dupes)].join('\n')}`).toEqual([])
    })
  }
})
