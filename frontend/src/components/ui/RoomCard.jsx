import { motion } from 'framer-motion'
import { Trash2 } from 'lucide-react'
import { Badge } from './Badge'
import { getRoomPhoto } from '../../lib/roomPhotos'

const PRESENCE_DOT = {
  occupied: 'bg-emerald-400',
  empty: 'bg-zinc-400',
  uncertain: 'bg-amber-400',
}

const ANOMALY_COLORS = {
  critical: 'bg-red-500',
  warning: 'bg-amber-400',
}

/**
 * RoomCard — shared between Rooms.jsx (management) and HomeMap.jsx (visualizer).
 *
 * Props:
 *   room          — { id, name, entityCount, activeCount }
 *   onClick       — called when card body is tapped
 *   onDelete      — (room) => void, shown when provided
 *   onEditPhoto   — (room) => void, shown when provided
 *   presenceState — 'occupied' | 'empty' | 'uncertain' | null (null = no sensor)
 *   summary       — string e.g. "3 on · 71°F" (null = hidden)
 *   anomalies     — array of { rule_id, severity } (empty = no badge)
 *   onSnooze      — (ruleId) => void, called when anomaly badge tapped
 */
export function RoomCard({
  room,
  onClick,
  onDelete,
  onEditPhoto,
  presenceState = null,
  summary = null,
  anomalies = [],
  onSnooze,
}) {
  const photo = getRoomPhoto(room)
  const topAnomaly = anomalies[0] ?? null
  const anomalyColor = topAnomaly ? (ANOMALY_COLORS[topAnomaly.severity] ?? ANOMALY_COLORS.warning) : null

  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      className="relative overflow-hidden rounded-2xl cursor-pointer aspect-[4/3] shadow-card dark:shadow-card-dark group"
    >
      <img src={photo} alt={room.name} className="absolute inset-0 w-full h-full object-cover" onClick={onClick} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" onClick={onClick} />

      {/* Top-right: anomaly badge (always visible) + management buttons (hover only) */}
      <div className="absolute top-2 right-2 flex gap-1 items-start">
        {/* Anomaly badge — tap to snooze */}
        {topAnomaly && (
          <button
            onClick={(e) => { e.stopPropagation(); onSnooze?.(topAnomaly.rule_id) }}
            title={`Anomaly: ${topAnomaly.rule_id}${anomalies.length > 1 ? ` +${anomalies.length - 1}` : ''} — tap to snooze`}
            className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold text-white ${anomalyColor} animate-pulse`}
          >
            ⚠{anomalies.length > 1 ? ` ×${anomalies.length}` : ''}
          </button>
        )}

        {/* Management buttons — only shown when callbacks are provided, visible on hover/focus */}
        {(onEditPhoto || onDelete) && (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            {onEditPhoto && (
              <button
                onClick={(e) => { e.stopPropagation(); onEditPhoto(room) }}
                title="Change photo"
                className="p-1.5 rounded-lg bg-black/50 text-white/80 hover:text-white hover:bg-black/70 active:scale-95 transition-all"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(room) }}
                title="Delete room"
                className="p-1.5 rounded-lg bg-black/50 text-white/80 hover:text-red-400 hover:bg-black/70 active:scale-95 transition-all"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Top-left: presence dot — only when sensor data is available */}
      {presenceState && (
        <div className="absolute top-2 left-2">
          <span
            className={`block w-2.5 h-2.5 rounded-full border-2 border-white/80 ${PRESENCE_DOT[presenceState] ?? 'bg-zinc-400'} ${presenceState === 'occupied' ? 'animate-pulse' : ''}`}
            title={presenceState}
          />
        </div>
      )}

      {/* Bottom: room name, counts, summary */}
      <div className="absolute bottom-0 left-0 right-0 p-3" onClick={onClick}>
        <div className="flex items-end justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-white font-semibold text-sm leading-tight">{room.name}</p>
            {summary ? (
              <p className="text-white/70 text-xs mt-0.5 truncate">{summary}</p>
            ) : (
              <p className="text-white/60 text-xs mt-0.5">
                {room.entityCount} device{room.entityCount !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          {room.activeCount > 0 && (
            <Badge variant="success" className="text-[10px] shrink-0 ml-2">{room.activeCount} on</Badge>
          )}
        </div>
      </div>
    </motion.div>
  )
}
