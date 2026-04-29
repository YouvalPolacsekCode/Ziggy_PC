import { useState, useEffect, useRef } from 'react'
import { Search, ChevronDown } from 'lucide-react'
import { getEntities, getRooms } from '../../lib/api'
import { domainIcon, slugToTitle } from '../../lib/utils'
import { cn } from '../../lib/utils'

// Actions available per HA domain
export const DOMAIN_ACTIONS = {
  light: [
    { value: 'turn_on', label: 'Turn On' },
    { value: 'turn_off', label: 'Turn Off' },
    { value: 'toggle', label: 'Toggle' },
    { value: 'set_brightness_50', label: 'Set Brightness 50%' },
    { value: 'set_brightness_100', label: 'Set Brightness 100%' },
  ],
  switch: [
    { value: 'turn_on', label: 'Turn On' },
    { value: 'turn_off', label: 'Turn Off' },
    { value: 'toggle', label: 'Toggle' },
  ],
  climate: [
    { value: 'turn_on', label: 'Turn On' },
    { value: 'turn_off', label: 'Turn Off' },
    { value: 'set_temperature', label: 'Set Temperature' },
    { value: 'set_hvac_mode_cool', label: 'Mode: Cool' },
    { value: 'set_hvac_mode_heat', label: 'Mode: Heat' },
    { value: 'set_hvac_mode_auto', label: 'Mode: Auto' },
  ],
  cover: [
    { value: 'open_cover', label: 'Open' },
    { value: 'close_cover', label: 'Close' },
    { value: 'toggle', label: 'Toggle' },
  ],
  media_player: [
    { value: 'media_play', label: 'Play' },
    { value: 'media_pause', label: 'Pause' },
    { value: 'media_stop', label: 'Stop' },
    { value: 'volume_up', label: 'Volume Up' },
    { value: 'volume_down', label: 'Volume Down' },
    { value: 'turn_on', label: 'Turn On' },
    { value: 'turn_off', label: 'Turn Off' },
  ],
  lock: [
    { value: 'lock', label: 'Lock' },
    { value: 'unlock', label: 'Unlock' },
  ],
  fan: [
    { value: 'turn_on', label: 'Turn On' },
    { value: 'turn_off', label: 'Turn Off' },
    { value: 'toggle', label: 'Toggle' },
  ],
  scene: [
    { value: 'turn_on', label: 'Activate Scene' },
  ],
  script: [
    { value: 'turn_on', label: 'Run Script' },
  ],
  input_boolean: [
    { value: 'turn_on', label: 'Turn On' },
    { value: 'turn_off', label: 'Turn Off' },
    { value: 'toggle', label: 'Toggle' },
  ],
}

export function getActionsForDomain(domain) {
  return DOMAIN_ACTIONS[domain] || [
    { value: 'turn_on', label: 'Turn On' },
    { value: 'turn_off', label: 'Turn Off' },
    { value: 'toggle', label: 'Toggle' },
  ]
}

export function EntitySelect({ value, onChange, label, placeholder = 'Search entities…', domain: filterDomain }) {
  const [open, setOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState({ top: undefined, bottom: undefined, left: 0, width: 0 })
  const [search, setSearch] = useState('')
  const [entities, setEntities] = useState([])
  const [haRooms, setHaRooms] = useState([])
  const [loading, setLoading] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Calculate fixed position so the dropdown escapes any overflow:hidden parent (e.g. modals)
  const handleOpen = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      setDropdownPos({
        top: spaceBelow >= 280 ? rect.bottom + 4 : undefined,
        bottom: spaceBelow < 280 ? window.innerHeight - rect.top + 4 : undefined,
        left: rect.left,
        width: rect.width,
      })
    }
    setOpen((v) => !v)
  }

  useEffect(() => {
    if (!open || entities.length > 0) return
    const load = async () => {
      setLoading(true)
      try {
        const [entRes, roomsRes] = await Promise.all([
          getEntities(filterDomain || null),
          getRooms(),
        ])
        setEntities(entRes.entities || [])
        setHaRooms(roomsRes.rooms || [])
      } catch {}
      setLoading(false)
    }
    load()
  }, [open])

  // Build entity_id → room name map from HA areas
  const roomEntityMap = {}
  haRooms.forEach((area) => {
    (area.entities || []).forEach((eid) => {
      if (eid) roomEntityMap[eid] = area.name
    })
  })

  // Group entities by room
  const filteredEntities = entities.filter((e) => {
    const q = search.toLowerCase()
    return !q || e.entity_id.toLowerCase().includes(q) || e.friendly_name?.toLowerCase().includes(q)
  })

  const grouped = {}
  filteredEntities.forEach((e) => {
    const room = roomEntityMap[e.entity_id] || 'Other'
    if (!grouped[room]) grouped[room] = []
    grouped[room].push(e)
  })

  // Put rooms first, Other last
  const roomOrder = [
    ...Object.keys(grouped).filter((r) => r !== 'Other').sort(),
    ...(grouped['Other'] ? ['Other'] : []),
  ]

  const selectedEntity = entities.find((e) => e.entity_id === value)

  return (
    <div ref={ref} className="relative flex flex-col gap-1.5">
      {label && (
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</label>
      )}
      <button
        type="button"
        onClick={handleOpen}
        className={cn(
          'h-10 rounded-xl px-3 text-sm text-left flex items-center gap-2',
          'bg-zinc-50 dark:bg-zinc-800',
          'border border-zinc-200 dark:border-zinc-700',
          'text-zinc-900 dark:text-zinc-100',
          'transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500'
        )}
      >
        {selectedEntity ? (
          <>
            <span>{domainIcon(selectedEntity.domain)}</span>
            <span className="flex-1 truncate text-sm">{selectedEntity.friendly_name || value}</span>
            <span className="text-[10px] text-zinc-400 truncate max-w-[90px]">{selectedEntity.domain}</span>
          </>
        ) : value ? (
          <span className="flex-1 truncate text-zinc-500 text-sm">{value}</span>
        ) : (
          <span className="text-zinc-400 text-sm">{placeholder}</span>
        )}
        <ChevronDown size={14} className={cn('ml-auto text-zinc-400 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            bottom: dropdownPos.bottom,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: 9999,
          }}
          className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden"
        >
          <div className="p-2 border-b border-zinc-100 dark:border-zinc-800 flex gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-full h-8 pl-7 pr-3 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-800 border-0 focus:outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
              />
            </div>
            <button
              className="text-[10px] text-zinc-400 hover:text-violet-600 px-2 whitespace-nowrap transition-colors"
              onClick={() => {
                const v = window.prompt('Entity ID:', value || '')
                if (v !== null) { onChange(v); setOpen(false) }
              }}
            >
              Manual
            </button>
          </div>

          <div className="max-h-56 overflow-y-auto scrollbar-thin">
            {loading && (
              <div className="text-center py-4 text-xs text-zinc-400">Loading…</div>
            )}
            {!loading && filteredEntities.length === 0 && (
              <div className="text-center py-4 text-xs text-zinc-400">No entities found</div>
            )}

            {roomOrder.map((room) => (
              <div key={room}>
                <div className="px-3 pt-2.5 pb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">
                    {room}
                  </span>
                </div>
                {grouped[room].map((e) => (
                  <button
                    key={e.entity_id}
                    onClick={() => { onChange(e.entity_id); setOpen(false); setSearch('') }}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
                      'hover:bg-zinc-50 dark:hover:bg-zinc-800',
                      value === e.entity_id && 'bg-violet-50 dark:bg-violet-900/20'
                    )}
                  >
                    <span className="text-base shrink-0">{domainIcon(e.domain)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {e.friendly_name || e.entity_id}
                      </p>
                      <p className="text-[10px] text-zinc-400 truncate">{e.entity_id}</p>
                    </div>
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-full shrink-0',
                      e.state === 'on'
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
                    )}>
                      {e.state}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
