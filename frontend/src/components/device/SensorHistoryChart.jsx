import { useEffect, useMemo, useState } from 'react'
import { getEntityHistory } from '../../lib/api'

// Hand-rolled SVG line chart — no chart library. The dataset is at most a
// few hundred points per 24h (HA emits state_changed only when the value
// actually changes), so an SVG path is plenty fast and ships zero extra
// bundle weight.
//
// Visual contract:
//   - 280×96 viewBox with 8px insets on the value axis
//   - Single accent-colored polyline (no fill, no dots) — same visual
//     language as the activity sparklines elsewhere in the app
//   - Min / max ticks on the right, "Nh" label on the bottom-left
//   - Faint dashed midline at the data midpoint
//
// The component is intentionally width-fluid via viewBox + preserveAspectRatio
// so it scales to whatever the parent card allots.

const W = 280
const H = 96
const PAD_X = 4
const PAD_Y = 8

function formatValue(v, unit) {
  if (v == null || !Number.isFinite(v)) return '—'
  const fixed = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)
  return unit ? `${fixed}${unit}` : fixed
}

function buildPath(points, minV, maxV, startMs, endMs) {
  if (!points.length) return ''
  const span = Math.max(1, endMs - startMs)
  const range = Math.max(0.001, maxV - minV)
  const xs = (ms) => PAD_X + ((ms - startMs) / span) * (W - 2 * PAD_X)
  const ys = (v)  => PAD_Y + (1 - (v - minV) / range) * (H - 2 * PAD_Y)
  let d = ''
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    d += (i === 0 ? 'M ' : ' L ') + xs(p.ms).toFixed(1) + ' ' + ys(p.v).toFixed(1)
  }
  return d
}

const RANGES = [
  { key: '24h', label: '24h', hours: 24 },
  { key: '7d',  label: '7d',  hours: 24 * 7 },
]

export default function SensorHistoryChart({ entityId, unitFallback }) {
  const [rangeKey, setRangeKey] = useState('24h')
  const range = RANGES.find(r => r.key === rangeKey) || RANGES[0]
  const [points, setPoints] = useState([])
  const [unit, setUnit] = useState(unitFallback || null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(false)
    getEntityHistory(entityId, range.hours)
      .then((r) => {
        if (cancelled) return
        const parsed = (r?.points || [])
          .map(p => ({ ms: Date.parse(p.t), v: p.v }))
          .filter(p => Number.isFinite(p.ms) && Number.isFinite(p.v))
          .sort((a, b) => a.ms - b.ms)
        setPoints(parsed)
        setUnit(r?.unit || unitFallback || null)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(true); setLoading(false)
      })
    return () => { cancelled = true }
  }, [entityId, range.hours, unitFallback])

  const stats = useMemo(() => {
    if (!points.length) return null
    let minV = Infinity, maxV = -Infinity
    for (const p of points) {
      if (p.v < minV) minV = p.v
      if (p.v > maxV) maxV = p.v
    }
    // Pad the range slightly so the line isn't flush with the top/bottom.
    if (minV === maxV) { minV -= 0.5; maxV += 0.5 }
    return {
      minV, maxV,
      startMs: points[0].ms,
      endMs:   points[points.length - 1].ms,
      latest:  points[points.length - 1].v,
    }
  }, [points])

  const path = stats ? buildPath(points, stats.minV, stats.maxV, stats.startMs, stats.endMs) : ''

  return (
    <div style={{
      background: 'var(--surface)',
      border: '0.5px solid var(--line)',
      borderRadius: 16,
      padding: 14,
      marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 12 }}>
        <div style={{
          display: 'inline-flex', gap: 2, padding: 2,
          background: 'var(--surface-2)', borderRadius: 8,
        }}>
          {RANGES.map(r => {
            const active = r.key === rangeKey
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => setRangeKey(r.key)}
                style={{
                  fontFamily: 'inherit',
                  background: active ? 'var(--surface)' : 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  padding: '3px 10px',
                  fontSize: 11,
                  fontWeight: active ? 600 : 500,
                  color: active ? 'var(--ink)' : 'var(--ink-faint)',
                  cursor: 'pointer',
                  boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                {r.label}
              </button>
            )
          })}
        </div>
        {stats && (
          <p style={{ fontSize: 11, color: 'var(--ink-mute)', fontVariantNumeric: 'tabular-nums' }}>
            {formatValue(stats.minV, unit)} – {formatValue(stats.maxV, unit)}
          </p>
        )}
      </div>

      {loading && (
        <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--ink-faint)' }}>
          Loading…
        </div>
      )}
      {!loading && error && (
        <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--ink-faint)' }}>
          History unavailable
        </div>
      )}
      {!loading && !error && !points.length && (
        <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--ink-faint)' }}>
          No data in this window
        </div>
      )}
      {!loading && !error && stats && (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          width="100%"
          height={H}
          style={{ display: 'block' }}
        >
          {/* Midline */}
          <line
            x1={PAD_X} x2={W - PAD_X}
            y1={H / 2} y2={H / 2}
            stroke="var(--line)" strokeWidth="0.5" strokeDasharray="2 3"
          />
          <path
            d={path}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
    </div>
  )
}
