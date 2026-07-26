// ConfigFlowRunner — native HA config-flow driver UI.
//
// Regression coverage for the Wi-Fi pairing dead-end (Android TV "MIBOX"):
//  1. The auto-submit that drives the flow must fire EXACTLY ONCE per flow id,
//     even under React StrictMode's intentional double-invoke. A second empty
//     submit consumed the one-shot HA discovery flow and produced the opaque
//     "upstream issues" error.
//  2. A "gone" outcome (HA dropped the discovery flow) must offer Rescan and
//     route to onGone — not a dead "Try again" that re-hits the consumed flow.
//  3. A "form" step (e.g. the Android TV PIN) must render an input so the user
//     can actually enter the code shown on the device.

import React, { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

// Mock the API layer the component calls.
const configFlowStep = vi.fn()
const configFlowCancel = vi.fn(() => Promise.resolve({ ok: true }))
vi.mock('../../lib/api', () => ({
  configFlowStep: (...a) => configFlowStep(...a),
  configFlowCancel: (...a) => configFlowCancel(...a),
}))
// i18n → identity so assertions can match on keys.
vi.mock('../../lib/i18n', () => ({ useT: () => (k) => k }))

import ConfigFlowRunner from '../ConfigFlowRunner'

beforeEach(() => {
  configFlowStep.mockReset()
  configFlowCancel.mockClear()
})

describe('ConfigFlowRunner', () => {
  it('auto-submits exactly once per flow id even under StrictMode', async () => {
    configFlowStep.mockResolvedValue({ ok: true, status: 'progress', flow_id: 'f1' })
    render(
      <StrictMode>
        <ConfigFlowRunner flowId="f1" title="MIBOX4" />
      </StrictMode>
    )
    await waitFor(() => expect(configFlowStep).toHaveBeenCalled())
    // The whole bug: a second empty submit consumes the discovery flow.
    expect(configFlowStep).toHaveBeenCalledTimes(1)
    expect(configFlowStep).toHaveBeenCalledWith('f1', {})
  })

  it('offers Rescan (onGone) when HA reports the flow is gone', async () => {
    configFlowStep.mockResolvedValue({ ok: false, status: 'gone', detail: 'x' })
    const onGone = vi.fn()
    render(<ConfigFlowRunner flowId="f2" title="MIBOX4" onGone={onGone} />)

    const rescan = await screen.findByText('wizard.configFlow.rescan')
    fireEvent.click(rescan)
    expect(onGone).toHaveBeenCalledTimes(1)
  })

  it('renders a PIN input when HA asks for a form field', async () => {
    configFlowStep.mockResolvedValue({
      ok: true, status: 'form', flow_id: 'f3', step_id: 'pair',
      fields: [{ name: 'pin', kind: 'text', label: 'Pin', required: true }],
      errors: {},
    })
    render(<ConfigFlowRunner flowId="f3" title="MIBOX4" />)
    await waitFor(() => expect(screen.getByText('Pin')).toBeInTheDocument())
  })
})
