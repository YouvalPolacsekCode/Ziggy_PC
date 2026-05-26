// Lightweight i18n for Ziggy. Hebrew + English, RTL aware.
//
// Usage:
//   const t = useT()
//   <h1>{t('settings.title')}</h1>
//   <p>{t('tasks.count', { n: 5 })}</p>
//
// Adding a string:
//   1. Add `key: 'English text'` to en.js
//   2. Add `key: 'טקסט בעברית'` to he.js (or it falls back to EN)
//
// Switching language: the user changes it in Settings → General → Language.
// That dispatches setLang(), which:
//   - flips <html dir> + <html lang>
//   - persists to localStorage (ziggy-lang)
//   - patches general settings on the backend (caller's responsibility)
//
// Hebrew strings here cover the WHOLE UI. If a key is missing in he.js the
// English string is shown verbatim — never a raw key.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import en from './en'
import he from './he'

const DICTS = { en, he }
export const LANGS = [
  { value: 'en', label: 'English' },
  { value: 'he', label: 'עברית' },
]

function applyToDocument(lang) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lang === 'he' ? 'he' : 'en'
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr'
}

export const useLangStore = create(
  persist(
    (set, get) => ({
      lang: 'en',
      setLang: (lang) => {
        if (lang !== 'en' && lang !== 'he') lang = 'en'
        applyToDocument(lang)
        set({ lang })
      },
    }),
    {
      name: 'ziggy-lang',
      // Re-apply <html dir>/<html lang> on hydration so the page boots with
      // the right direction without a flicker.
      onRehydrateStorage: () => (state) => {
        if (state?.lang) applyToDocument(state.lang)
      },
    },
  ),
)

export function getLang() {
  return useLangStore.getState().lang
}

export function setLang(lang) {
  useLangStore.getState().setLang(lang)
}

function format(template, params) {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`))
}

// Pure translation — usable outside React (toasts emitted from stores, etc.)
export function t(key, params, lang) {
  const useLang = lang || getLang()
  const dict = DICTS[useLang] || DICTS.en
  const value = dict[key] ?? DICTS.en[key] ?? key
  return format(value, params)
}

// React hook — returns a stable-ish function that closes over the current lang
export function useT() {
  const lang = useLangStore((s) => s.lang)
  return (key, params) => t(key, params, lang)
}

export function useLang() {
  return useLangStore((s) => s.lang)
}

export function useIsRTL() {
  return useLangStore((s) => s.lang === 'he')
}

// Helpers for dir="auto" on user-generated content (names, messages) — falls
// back to the active UI language when the text has no Hebrew chars.
const HEBREW_RE = /[֐-׿]/
export function dirOf(text, fallback) {
  if (HEBREW_RE.test(text || '')) return 'rtl'
  if (fallback === 'rtl' || fallback === 'ltr') return fallback
  return 'ltr'
}
