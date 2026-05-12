import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { RoomCard } from '../RoomCard'

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, ...p }) => <div {...p}>{children}</div> },
}))

// Mock roomPhotos to return a stable URL
vi.mock('../../../lib/roomPhotos', () => ({
  getRoomPhoto: () => 'https://example.com/photo.jpg',
}))

const baseRoom = { id: 'bedroom', name: 'Bedroom', entityCount: 3, activeCount: 2 }

describe('RoomCard', () => {
  it('renders room name', () => {
    render(<RoomCard room={baseRoom} />)
    expect(screen.getByText('Bedroom')).toBeInTheDocument()
  })

  it('renders summary string when provided', () => {
    render(<RoomCard room={baseRoom} summary="3 on · 71°" />)
    expect(screen.getByText('3 on · 71°')).toBeInTheDocument()
  })

  it('renders device count when no summary', () => {
    render(<RoomCard room={baseRoom} />)
    expect(screen.getByText('3 devices')).toBeInTheDocument()
  })

  it('renders presence dot when occupied', () => {
    const { container } = render(<RoomCard room={baseRoom} presenceState="occupied" />)
    const dot = container.querySelector('.bg-emerald-400')
    expect(dot).toBeInTheDocument()
  })

  it('renders yellow dot when uncertain', () => {
    const { container } = render(<RoomCard room={baseRoom} presenceState="uncertain" />)
    const dot = container.querySelector('.bg-amber-400')
    expect(dot).toBeInTheDocument()
  })

  it('renders no presence dot when presenceState is null', () => {
    const { container } = render(<RoomCard room={baseRoom} presenceState={null} />)
    expect(container.querySelector('.bg-emerald-400')).toBeNull()
    expect(container.querySelector('.bg-zinc-400')).toBeNull()
  })

  it('renders anomaly badge when anomalies present', () => {
    render(
      <RoomCard
        room={baseRoom}
        anomalies={[{ rule_id: 'ANOM-04', severity: 'warning' }]}
      />
    )
    expect(screen.getByTitle(/ANOM-04/)).toBeInTheDocument()
  })

  it('renders no anomaly badge when anomalies empty', () => {
    render(<RoomCard room={baseRoom} anomalies={[]} />)
    expect(screen.queryByTitle(/ANOM/)).toBeNull()
  })

  it('calls onSnooze with rule_id when anomaly badge tapped', () => {
    const onSnooze = vi.fn()
    render(
      <RoomCard
        room={baseRoom}
        anomalies={[{ rule_id: 'ANOM-04', severity: 'warning' }]}
        onSnooze={onSnooze}
      />
    )
    fireEvent.click(screen.getByTitle(/ANOM-04/))
    expect(onSnooze).toHaveBeenCalledWith('ANOM-04')
  })

  it('renders active count badge when activeCount > 0', () => {
    render(<RoomCard room={baseRoom} />)
    expect(screen.getByText('2 on')).toBeInTheDocument()
  })

  it('does not render active badge when activeCount is 0', () => {
    render(<RoomCard room={{ ...baseRoom, activeCount: 0 }} />)
    expect(screen.queryByText(/on$/)).toBeNull()
  })
})
