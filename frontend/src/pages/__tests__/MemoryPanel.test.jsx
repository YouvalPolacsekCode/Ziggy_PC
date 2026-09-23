// Settings → Memory shows what Ziggy knows about the household, not the hub's
// plumbing. `home_assistant` (the bridge URL) lives in the same store and was
// rendered as a "Home → assistant" fact with the raw URL as its value.

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('../../lib/i18n', () => ({ useT: () => (k) => k, t: (k) => k }))
vi.mock('../../stores/uiStore', () => ({ useUIStore: () => ({ addToast: vi.fn() }) }))
vi.mock('../../lib/api', () => ({
  getMemory: vi.fn(() => Promise.resolve({ memory: [
    { key: 'home_assistant', value: { url: 'http://homeassistant.local:8123/' } },
    { key: 'home_city', value: 'Binyamina' },
    { key: 'language', value: 'English' },
    { key: 'my dog', value: 'Mika' },
    { key: 'wife', value: 'Adi' },
    { key: '_scratch', value: 'x' },
  ] })),
  sendIntent: vi.fn(),
}))

import { MemoryPanel, isInternalMemoryKey } from '../Memory'

describe('MemoryPanel', () => {
  it('never renders the bridge URL or underscore-prefixed records', async () => {
    render(<MemoryPanel />)
    // Only what a person told Ziggy is a memory. Plumbing (the bridge URL)
    // and onboarding answers Settings owns (city, language) are hidden.
    await waitFor(() => expect(screen.getByText('Mika')).toBeInTheDocument())
    expect(screen.getByText('Adi')).toBeInTheDocument()
    expect(screen.queryByText('Binyamina')).not.toBeInTheDocument()
    expect(screen.queryByText('English')).not.toBeInTheDocument()
    expect(screen.queryByText(/homeassistant\.local/)).not.toBeInTheDocument()
    expect(screen.queryByText(/8123/)).not.toBeInTheDocument()
    expect(screen.queryByText('x')).not.toBeInTheDocument()
    // No profile chip for a group made only of hidden records.
    expect(screen.queryByRole('button', { name: 'home' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '_scratch' })).not.toBeInTheDocument()
  })

  it('classifies internal keys', () => {
    expect(isInternalMemoryKey('home_assistant')).toBe(true)
    expect(isInternalMemoryKey('_anything')).toBe(true)
    expect(isInternalMemoryKey('home_city')).toBe(true)
    expect(isInternalMemoryKey('my dog')).toBe(false)
    expect(isInternalMemoryKey(undefined)).toBe(true)
  })
})
