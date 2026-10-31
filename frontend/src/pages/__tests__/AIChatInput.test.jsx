import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Sending a chat message must empty the input right away (fleet report,
// 2026-10-31: the text stayed in the box while Ziggy thought — 10–40 s for a
// designed automation — and for good when the send failed). A failed send
// hands the text back so a long question is never lost.

let resolveSend, rejectSend
vi.mock('../../lib/api', () => ({
  sendChat: vi.fn(() => new Promise((res, rej) => { resolveSend = res; rejectSend = rej })),
  sendVoiceTranscribe: vi.fn(), sendDirectIntent: vi.fn(), speakTtsStream: vi.fn(),
  flagTts: vi.fn(), getRehearsal: vi.fn(async () => ({ enabled: false })), patchRehearsal: vi.fn(),
}))
vi.mock('../../hooks/useChatThreads', () => ({
  useChatThreads: () => ({ threads: [], threadId: null, refreshList: () => {}, startNew: () => {}, select: () => {}, remove: () => {} }),
}))

import AIChat from '../AIChat'

const box = () => screen.getByPlaceholderText(/.+/)
function type(text) { fireEvent.change(box(), { target: { value: text } }) }
function pressEnter() { fireEvent.keyDown(box(), { key: 'Enter' }) }

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
  render(<MemoryRouter><AIChat /></MemoryRouter>)
})
afterEach(cleanup)

describe('chat input', () => {
  it('empties the moment the message is sent, before Ziggy replies', async () => {
    type('Water the garden at 6')
    await act(async () => { pressEnter() })
    expect(box().value).toBe('')
    await act(async () => { resolveSend({ ok: true, reply: 'Done' }) })
    expect(box().value).toBe('')
  })

  it('gives the question back when the send fails', async () => {
    type('A long question I do not want to retype')
    await act(async () => { pressEnter() })
    expect(box().value).toBe('')
    await act(async () => { rejectSend(new Error('HTTP 502')) })
    expect(box().value).toBe('A long question I do not want to retype')
  })

  it('never overwrites a new question typed while the old one failed', async () => {
    type('first')
    await act(async () => { pressEnter() })
    type('second')
    await act(async () => { rejectSend(new Error('HTTP 502')) })
    expect(box().value).toBe('second')
  })
})
