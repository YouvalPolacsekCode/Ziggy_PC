import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, RefreshCw, Play } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useUIStore } from '../stores/uiStore'
import { getScenes, activateScene } from '../lib/api'
import { cn } from '../lib/utils'

export default function Scenes() {
  const { addToast } = useUIStore()
  const [scenes, setScenes] = useState([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [activating, setActivating] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await getScenes()
      setScenes(res.scenes || [])
    } catch {
      addToast('Failed to load scenes', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const handleActivate = async (scene) => {
    setActivating(scene.entity_id)
    try {
      await activateScene(scene.entity_id)
      addToast(`"${scene.name}" activated`, 'success')
    } catch {
      addToast('Failed to activate scene', 'error')
    } finally {
      setActivating(null)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6 pb-8">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Scenes</h1>
          <p className="text-sm text-zinc-400 dark:text-zinc-600 mt-0.5">
            {scenes.length} scene{scenes.length !== 1 ? 's' : ''} from Home Assistant
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw size={16} className={cn(refreshing && 'animate-spin')} />
        </Button>
      </div>

      {loading && (
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 rounded-2xl bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && scenes.length === 0 && (
        <div className="text-center py-20 text-zinc-400 dark:text-zinc-600">
          <Sparkles size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No scenes found</p>
          <p className="text-xs mt-1">Create scenes in Home Assistant to see them here</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {scenes.map((scene) => (
          <motion.button
            key={scene.entity_id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => handleActivate(scene)}
            disabled={activating === scene.entity_id}
            className={cn(
              'relative flex flex-col items-start gap-2 p-4 rounded-2xl text-left transition-all',
              'bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800',
              'hover:border-violet-200 dark:hover:border-violet-800/60 hover:shadow-md',
              'active:scale-[0.97]',
              activating === scene.entity_id && 'opacity-60'
            )}
          >
            <div className="w-9 h-9 rounded-xl bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center">
              {activating === scene.entity_id ? (
                <RefreshCw size={16} className="text-violet-500 animate-spin" />
              ) : (
                <Sparkles size={16} className="text-violet-500" />
              )}
            </div>
            <div className="flex-1 min-w-0 w-full">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                {scene.name}
              </p>
              <p className="text-[10px] text-zinc-400 truncate mt-0.5">{scene.entity_id}</p>
            </div>
            <div className="absolute top-3 right-3">
              <Play size={12} className="text-zinc-300 dark:text-zinc-600" />
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  )
}
