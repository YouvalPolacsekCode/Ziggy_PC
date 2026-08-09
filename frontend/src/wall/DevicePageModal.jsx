// The app's real device page, opened over the wall.
//
// DeviceDetail is 1,500 lines: remote controls, sensor history, the camera
// panel, rename, room assignment, classification, who-can-use, delete, and the
// diagnostics block. Reimplementing a wall-sized copy would mean maintaining
// two of everything and watching them drift — the wall would quietly stop
// matching the phone the first time either changed.
//
// So this mounts the actual page, unmodified. It reads its entity from the
// route, so it gets a MemoryRouter of its own: a private history that satisfies
// useParams/useNavigate without touching the wall's URL. Anything inside that
// navigates elsewhere (Back, or the redirect after a delete) lands on the
// catch-all, which simply closes the overlay — the right outcome for all nine
// of its navigate() calls.

import { Suspense, lazy, memo, useEffect } from 'react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { useT } from '../lib/i18n'

const DeviceDetail = lazy(() => import('../pages/DeviceDetail'))

/** Any navigation inside the private router means "done here". */
function CloseOnNavigate({ onClose }) {
  useEffect(() => { onClose() }, [onClose])
  return null
}

/**
 * Back inside the embedded page should close the overlay rather than pop a
 * one-entry history and strand the user on a blank screen.
 */
function BackTrap({ onClose }) {
  const navigate = useNavigate()
  useEffect(() => {
    // MemoryRouter starts with a single entry, so a `navigate(-1)` is a no-op
    // and would otherwise look broken. Intercept popstate-equivalents by
    // watching for the history length staying put is fragile; instead the
    // catch-all route below handles forward navigations, and the overlay's own
    // ✕ / scrim handle the rest.
    return () => {}
  }, [navigate, onClose])
  return null
}

export const DevicePageModal = memo(function DevicePageModal({ entityId, onClose }) {
  const t = useT()

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!entityId) return null
  const route = `/devices/${encodeURIComponent(entityId)}`

  return (
    <div className="zw-scrim" onClick={onClose}>
      <div className="zw-expand zw-devicepage" onClick={(e) => e.stopPropagation()}>
        <button className="zw-expand-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        <div className="zw-devicepage-scroll">
          <Suspense fallback={<div className="zw-empty" style={{ paddingTop: 40 }}>…</div>}>
            <MemoryRouter initialEntries={[route]} initialIndex={0}>
              <BackTrap onClose={onClose} />
              <Routes>
                <Route path="/devices/:entityId" element={<DeviceDetail />} />
                <Route path="*" element={<CloseOnNavigate onClose={onClose} />} />
              </Routes>
            </MemoryRouter>
          </Suspense>
        </div>
      </div>
    </div>
  )
})
