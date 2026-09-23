// Settings → Memory shows what Ziggy knows about the household, not the hub's
// plumbing. `home_assistant` (the bridge URL) lives in the same store and was
// rendered as a "Home → assistant" fact with the raw URL as its value.

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('../../lib/i18n', () => ({ useT: () => (k) => k, t: (k) => k }))
vi.mock('../../stores/uiStore', () => ({ useUIStore: () => ({ addToast: vi.fn() }) }))
vi.mock('../../lib/api', () => ({
  getMemory: vi.fn(() => Promise.resolve({ memory: [
    { key: 'home_assistant', value: { url: 'http://homeassistant.local:8123/' } },
    { key: 'home_city', value: 'Binyamina' },
    { key: 'my dog', value: 'Mika' },
    { key: '_scratch', value: 'x' },
  ] })),
  sendIntent: vi.fn(),
}))

import { MemoryPanel, isInternalMemoryKey } from '../Memory'

describe('MemoryPanel', () => {
  it('never renders the bridge URL or underscore-prefixed records', async () => {
    render(<MemoryPanel />)
    // Facts are grouped by key prefix; "my dog" lands in "general" (shown
    // first), "home_city" and the bridge record both under "home".
    await waitFor(() => expect(screen.getByText('Mika')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'home' }))
    await waitFor(() => expect(screen.getByText('Binyamina')).toBeInTheDocument())
    expect(screen.queryByText(/homeassistant\.local/)).not.toBeInTheDocument()
    expect(screen.queryByText(/8123/)).not.toBeInTheDocument()
    expect(screen.queryByText(/assistant/i)).not.toBeInTheDocument()
    expect(screen.queryByText('x')).not.toBeInTheDocument()
    // The profile row must not offer a group made only of hidden records.
    expect(screen.queryByRole('button', { name: '_scratch' })).not.toBeInTheDocument()
  })

  it('classifies internal keys', () => {
    expect(isInternalMemoryKey('home_assistant')).toBe(true)
    expect(isInternalMemoryKey('_anything')).toBe(true)
    expect(isInternalMemoryKey('home_city')).toBe(false)
    expect(isInternalMemoryKey(undefined)).toBe(true)
  })
})
