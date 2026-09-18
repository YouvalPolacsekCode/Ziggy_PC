// The /welcome waitlist form posts to the Desk lead pipeline and falls back
// to a mailto (hello@ziggy-home.com — the old .co.il address was a typo) when
// the Desk is unreachable. Nobody's interest may be dropped either way.

import { describe, expect, it, vi } from 'vitest'
import {
  DESK_LEADS_URL, WAITLIST_EMAIL, buildLeadBody, detectLanguage, mailtoFallback,
  submitWaitlistLead,
} from '../leads'

const okResponse = (json) => ({ ok: true, json: async () => json })

describe('buildLeadBody', () => {
  it('matches the Desk lead contract exactly', () => {
    expect(buildLeadBody('  a@b.com ', { language: 'he' })).toEqual({
      email: 'a@b.com',
      intent: 'waitlist',
      form: 'welcome',
      language: 'he',
      consent_marketing: false,
      website: 'app',
      hp: '',
    })
  })

  it('detects Hebrew from the browser, defaults to English', () => {
    expect(detectLanguage({ language: 'he-IL' })).toBe('he')
    expect(detectLanguage({ language: 'iw' })).toBe('he')
    expect(detectLanguage({ language: 'en-US' })).toBe('en')
    expect(detectLanguage({ languages: ['he'] })).toBe('he')
    expect(detectLanguage(null)).toBe('en')
  })
})

describe('submitWaitlistLead', () => {
  it('POSTs JSON to the Desk and returns the lead id', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ ok: true, lead_id: 'ld_abc123def456' }))
    const navigate = vi.fn()
    const res = await submitWaitlistLead('a@b.com', { fetchImpl, navigate, language: 'en' })
    expect(res).toEqual({ ok: true, lead_id: 'ld_abc123def456' })
    expect(navigate).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(DESK_LEADS_URL)
    expect(url).toBe('https://ziggy-desk.fly.dev/api/leads')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({
      email: 'a@b.com', intent: 'waitlist', form: 'welcome', language: 'en',
      consent_marketing: false, website: 'app', hp: '',
    })
  })

  it('falls back to mailto on a non-2xx reply', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    const navigate = vi.fn()
    const res = await submitWaitlistLead('a@b.com', { fetchImpl, navigate, language: 'en' })
    expect(res).toEqual({ ok: false, fallback: true })
    expect(navigate).toHaveBeenCalledWith(mailtoFallback('a@b.com'))
  })

  it('falls back to mailto when the network throws', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const navigate = vi.fn()
    const res = await submitWaitlistLead('a@b.com', { fetchImpl, navigate, language: 'en' })
    expect(res.fallback).toBe(true)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('falls back when fetch is unavailable', async () => {
    const navigate = vi.fn()
    const res = await submitWaitlistLead('a@b.com', { fetchImpl: null, navigate, language: 'en' })
    expect(res.fallback).toBe(true)
    expect(navigate).toHaveBeenCalledTimes(1)
  })
})

describe('mailto fallback', () => {
  it('uses the .com inbox, not the old .co.il typo', () => {
    expect(WAITLIST_EMAIL).toBe('hello@ziggy-home.com')
    const href = mailtoFallback('a@b.com')
    expect(href.startsWith('mailto:hello@ziggy-home.com?')).toBe(true)
    expect(href).not.toContain('.co.il')
    expect(decodeURIComponent(href)).toContain('Please add me to the Ziggy waitlist: a@b.com')
  })
})
