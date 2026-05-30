/**
 * HomeMap — floor plan viewer at /map
 * View-only canvas, auto-fits to show the whole house.
 * Edit Layout → /map/build
 */
import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { WifiOff, Pencil } from 'lucide-react'
import { getMapRoomsSummary } from '../lib/api'
import { useT } from '../lib/i18n'

const HomeMapCanvas = lazy(() =>
  import('./HomeMapCanvas').then((m) => ({ default: m.HomeMapCanvas }))
)

const POLL_INTERVAL = 5000

export default function HomeMap() {
  const t = useT()
  const navigate = useNavigate()
  const [rooms, setRooms]     = useState([])
  const [loading, setLoading] = useState(true)
  const [haError, setHaError] = useState(false)
  const pollRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const data = await getMapRoomsSummary()
      setRooms(data.rooms ?? [])
      setHaError(false)
    } catch {
      setHaError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    pollRef.current = setInterval(load, POLL_INTERVAL)
    return () => clearInterval(pollRef.current)
  }, [load])

  return (
    <div className="max-w-3xl mx-auto px-4 pt-5 pb-8">
      <div className="flex items-center justify-between mb-5">
        <motion.h1
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-semibold text-ink"
        >
          {t('homeMap.title')}
        </motion.h1>
        <button
          onClick={() => navigate('/map/build')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-surface-2 text-ink-2 hover:bg-line transition-all"
        >
          <Pencil size={12} /> {t('homeMap.editLayout')}
        </button>
      </div>

      {haError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-warn-soft text-warn text-xs font-medium mb-4">
          <WifiOff size={13} />
          {t('homeMap.lostConnection')}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl bg-surface-2 animate-pulse" style={{ height: 480 }} />
      ) : (
        <Suspense fallback={
          <div className="flex items-center justify-center h-48 text-ink-faint text-sm">{t('homeMap.loadingMap')}</div>
        }>
          <HomeMapCanvas rooms={rooms} viewOnly={true} />
        </Suspense>
      )}
    </div>
  )
}
