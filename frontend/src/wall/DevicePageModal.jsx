// The app's real device page, opened over the wall.
//
// DeviceDetail is 1,500 lines: remote controls, sensor history, the camera
// panel, rename, room assignment, classification, who-can-use, delete, and the
// diagnostics block. Reimplementing a wall-sized copy would mean maintaining
// two of everything and watching them drift the first time either changed.
//
// So this mounts the actual page. It takes `entityId` and `onExit` props for
// exactly this purpose — a second <Router> is not an option, React Router v6
// throws on a Router inside a Router.
//
// SIZING. A wall panel is read standing up, often from a step away, and a
// sheet you have to scroll is a sheet whose bottom half nobody finds. Device
// pages vary hugely — a motion sensor is one line, a colour bulb is sliders,
// presets and effects — so a fixed box is wrong in both directions: acres of
// empty white under the sensor, a hidden power button under the bulb. This
// measures the page and does one of two things:
//
//   short page → the box shrinks to hug it.
//   tall page  → the page scales down until it fits on one screen.
//
// Scaling rather than scrolling keeps every control reachable without a
// gesture. It has a floor: past MIN_SCALE the text would stop being readable
// across a room, so beyond that it stops shrinking and scrolls after all.

import { Suspense, lazy, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useT } from '../lib/i18n'

const DeviceDetail = lazy(() => import('../pages/DeviceDetail'))

/** Share of the viewport height the sheet may occupy. */
const MAX_VH = 0.88
/** Below this the page is too small to read from across a room — scroll instead. */
const MIN_SCALE = 0.62

export const DevicePageModal = memo(function DevicePageModal({ entityId, onClose, onOpenDevice }) {
  const t = useT()
  const innerRef = useRef(null)
  // scale 1 + height null = "not measured yet", which renders at natural size.
  const [fit, setFit] = useState({ scale: 1, height: null })

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Re-measure whenever the page's natural height changes: switching to the
  // Info tab, a sensor chart loading, the remote expanding.
  //
  // Observing the INNER element is what makes this stable. A CSS transform
  // doesn't change layout size, so scaling the element never re-triggers the
  // observer that set the scale — no feedback loop.
  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const natural = el.scrollHeight
      if (!natural) return
      const avail = window.innerHeight * MAX_VH
      const scale = Math.min(1, Math.max(MIN_SCALE, avail / natural))
      setFit({ scale, height: Math.min(natural * scale, avail) })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    measure()
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [entityId])

  // Reset between devices so a tall page's scale never briefly squashes the
  // short one that replaces it.
  useLayoutEffect(() => { setFit({ scale: 1, height: null }) }, [entityId])

  // Every "leave this page" inside the embedded page becomes an overlay
  // decision. A sibling device re-targets the same overlay; anything else —
  // Back, or the redirect after a delete — closes it.
  const onExit = useCallback((to) => {
    const m = typeof to === 'string' && to.match(/^\/devices\/(.+)$/)
    if (m) { onOpenDevice?.(decodeURIComponent(m[1])); return }
    onClose()
  }, [onClose, onOpenDevice])

  if (!entityId) return null

  return (
    <div className="zw-scrim" onClick={onClose}>
      <div className="zw-expand zw-devicepage" onClick={(e) => e.stopPropagation()}>
        <button className="zw-expand-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        <div className="zw-devicepage-scroll">
          {/* Takes the scaled height in layout, so the sheet hugs what you see
              rather than the taller thing being drawn inside it. */}
          <div className="zw-devicepage-fit" style={fit.height ? { height: fit.height } : undefined}>
            <div
              className="zw-devicepage-inner"
              ref={innerRef}
              style={fit.scale < 1 ? { transform: `scale(${fit.scale})` } : undefined}
            >
              <Suspense fallback={<div className="zw-empty" style={{ paddingTop: 40 }}>…</div>}>
                <DeviceDetail key={entityId} entityId={entityId} onExit={onExit} />
              </Suspense>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})
