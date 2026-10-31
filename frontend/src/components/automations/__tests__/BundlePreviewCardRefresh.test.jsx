import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

// Accepting a chat bundle created the rule, but the Actions page kept its
// cached list and showed nothing until a reload (Canary, 2026-10-31). The
// card now refreshes the automation store after Accept and after Undo.

vi.mock('../../../lib/api', () => ({
  applyAutomationBundle: vi.fn(async () => ({ ok: true, errors: [], bundle_id: 'b1', created: [{ kind: 'automation', id: 'a1' }] })),
  deleteAutomationBundle: vi.fn(async () => ({ ok: true })),
}))

import BundlePreviewCard from '../BundlePreviewCard'
import { useAutomationStore } from '../../../stores/automationStore'

const bundle = {
  bundle_id: 'b1', language: 'en', title: 'Garden watering schedule', summary: 'Water unless it rains.',
  artifacts: { automations: [{
    name: 'Water garden if no rain', source: 'custom',
    trigger: { type: 'time', time: '06:00', days: ['sun', 'tue', 'thu', 'sat'] },
    conditions: [{ type: 'weather', check: 'rain_today', is: false }],
    actions: [{ type: 'call_service', entity_id: 'switch.valve', service: 'turn_on' }],
  }] },
}

let fetchSpy
beforeEach(() => {
  fetchSpy = vi.fn(async () => {})
  useAutomationStore.setState({ fetchAutomations: fetchSpy })
  vi.spyOn(performance, 'now').mockReturnValue(1e9)   // past the 400 ms double-tap guard
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('BundlePreviewCard refreshes the automations list', () => {
  it('after Accept', async () => {
    render(<BundlePreviewCard bundle={bundle} />)
    performance.now.mockReturnValue(2e9)
    fireEvent.click(screen.getByRole('button', { name: /Accept/ }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith({ force: true }))
  })

  it('after Undo', async () => {
    render(<BundlePreviewCard bundle={bundle} />)
    performance.now.mockReturnValue(2e9)
    fireEvent.click(screen.getByRole('button', { name: /Accept/ }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    fireEvent.click(await screen.findByRole('button', { name: /Undo/ }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))
  })
})
