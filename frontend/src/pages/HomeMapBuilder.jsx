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

const HomeMapCanvas = lazy(() =>
  import('./HomeMapCanvas').then((m) => ({ default: m.HomeMapCanvas }))
)

const POLL_INTERVAL = 5000

async function fetchSummary() {
  const data = await getMapRoomsSummary()
  return data.rooms ?? []
}

export default function HomeMapBuilder() {
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
          className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 transition-colors"
        >
          <ArrowLeft size={15} />
          View Map
        </button>
        <motion.h1
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xl font-semibold text-zinc-900 dark:text-zinc-100"
        >
          Floor Plan Builder
        </motion.h1>
      </div>

      {haError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs font-medium mb-4">
          <WifiOff size={13} />
          Lost connection to Home Assistant — showing last known state.
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl bg-zinc-100 dark:bg-zinc-800 animate-pulse" style={{ height: 400 }} />
      ) : (
        <Suspense fallback={
          <div className="flex items-center justify-center h-48 text-zinc-400 text-sm">Loading canvas…</div>
        }>
          <HomeMapCanvas rooms={rooms} viewOnly={false} />
        </Suspense>
      )}
    </div>
  )
}
