// Leaving wall mode.
//
// The only way out used to be an undocumented 2-second press on the logo,
// confirmed with window.confirm — invisible if you didn't know, and on a
// touch screen the browser's own long-press handling could cancel the
// pointer before the timer fired. A device you cannot get out of wall mode
// without clearing site storage is a trap. So there is now a visible exit,
// confirmed in-app, behind the tablet's PIN when one is set.

import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { ExitWallSheet, ExitWallButton } from '../WallChrome'

afterEach(cleanup)

describe('ExitWallSheet', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<ExitWallSheet open={false} onCancel={() => {}} onConfirm={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('asks before leaving and only leaves on the explicit confirm', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<ExitWallSheet open onCancel={onCancel} onConfirm={onConfirm} />)
    expect(screen.getByText('Stop using this device as a wall dashboard?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Exit wall mode' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('ExitWallButton', () => {
  it('is a labelled, visible control', () => {
    const onExit = vi.fn()
    render(<ExitWallButton onExit={onExit} />)
    const btn = screen.getByRole('button', { name: 'Exit wall mode' })
    fireEvent.click(btn)
    expect(onExit).toHaveBeenCalledTimes(1)
  })
})
