/**
 * HomeMapBuilder — floor plan editor at /map/build
 * Full editing canvas (drag, resize, measure, lock mode).
 * Navigate here from the Home Map view page.
 */
import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, WifiOff } from 'lucide-react'
import { getMapRoomsSummary, snoozeMapAnomaly } from '../lib/api'
import { useT } from '../lib/i18n'

const HomeMapCanvas = lazy(() =>
  import('./HomeMapCanvas').then((m) => ({ default: m.HomeMapCanvas }))
)

const POLL_INTERVAL = 5000

async function fetchSummary() {
  const data = await getMapRoomsSummary()
  return data.rooms ?? []
}

export default function HomeMapBuilder() {
  const t = useT()
  const navigate = useNavigate()
  const [rooms, setRooms]     = useState([])
  const [loading, setLoading] = useState(true)
  const [haError, setHaError] = useState(false)
  const pollRef = useRef(null)

  const load = useCallback(async () => {
    try {
      setRooms(await fetchSummary())
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
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => navigate('/map')}
          className="flex items-center gap-1.5 text-sm text-ink-mute hover:text-ink"
        >
          <ArrowLeft size={15} className="icon-flip-rtl" />
          {t('homeMap.viewMap')}
        </button>
        <motion.h1
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xl font-semibold text-ink"
        >
          {t('homeMap.floorPlanBuilder')}
        </motion.h1>
      </div>

      {haError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-warn-soft text-warn text-xs font-medium mb-4">
          <WifiOff size={13} />
          {t('homeMap.lostConnection')}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl bg-surface-2 animate-pulse" style={{ height: 400 }} />
      ) : (
        <Suspense fallback={
          <div className="flex items-center justify-center h-48 text-ink-mute text-sm">{t('homeMap.loadingCanvas')}</div>
        }>
          <HomeMapCanvas rooms={rooms} viewOnly={false} />
        </Suspense>
      )}
    </div>
  )
}
