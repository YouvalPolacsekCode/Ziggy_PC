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

import { Suspense, lazy, memo, useCallback, useEffect } from 'react'
import { useT } from '../lib/i18n'

const DeviceDetail = lazy(() => import('../pages/DeviceDetail'))

export const DevicePageModal = memo(function DevicePageModal({ entityId, onClose, onOpenDevice }) {
  const t = useT()

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
          <Suspense fallback={<div className="zw-empty" style={{ paddingTop: 40 }}>…</div>}>
            <DeviceDetail key={entityId} entityId={entityId} onExit={onExit} />
          </Suspense>
        </div>
      </div>
    </div>
  )
})
