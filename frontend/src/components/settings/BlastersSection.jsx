import { useEffect, useState } from 'react'
import { Radio, Pencil, Trash2, RefreshCw, Wifi, WifiOff, Check, X } from 'lucide-react'
import {
  listIrBlasters, patchIrBlaster, deleteIrBlaster, discoverIrBlasters,
} from '../../lib/api'
import { useUIStore } from '../../stores/uiStore'
import { cn } from '../../lib/utils'

// ─── Status chip ─────────────────────────────────────────────────────────────
// Derived field from the registry: online (< 60s since last contact), stale
// (< 5 min), unreachable (older / never). Surfaced as a small inline chip
// so the user can scan a list of blasters and immediately spot the dead one.

const STATUS_META = {
  online:      { label: 'Online',      tint: 'var(--ok)',   Icon: Wifi    },
  stale:       { label: 'Stale',       tint: 'var(--warn)', Icon: Wifi    },
  unreachable: { label: 'Unreachable', tint: 'var(--err)',  Icon: WifiOff },
}

function StatusChip({ status }) {
  const meta = STATUS_META[status] || STATUS_META.unreachable
  const Icon = meta.Icon
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
      textTransform: 'uppercase', color: meta.tint,
      padding: '2px 7px', borderRadius: 999,
      background: `color-mix(in srgb, ${meta.tint} 14%, transparent)`,
    }}>
      <Icon size={9} />
      {meta.label}
    </span>
  )
}

// ─── Inline rename input ─────────────────────────────────────────────────────

function InlineRename({ value, onSave, onCancel }) {
  const [val, setVal] = useState(value || '')
  const handleSave = () => {
    const trimmed = val.trim()
    if (!trimmed || trimmed === value) { onCancel(); return }
    onSave(trimmed)
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
      <input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave()
          else if (e.key === 'Escape') onCancel()
        }}
        dir="auto"
        style={{
          flex: 1, minWidth: 0,
          height: 28, padding: '0 8px', borderRadius: 8, fontSize: 13,
          background: 'var(--surface-2)', border: '0.5px solid var(--accent)',
          color: 'var(--ink)', fontFamily: 'inherit', outline: 'none',
        }}
      />
      <button onClick={handleSave} title="Save"
        style={{ padding: 4, borderRadius: 6, background: 'var(--accent)', color: 'var(--on-accent)',
                 border: 'none', cursor: 'pointer', display: 'flex' }}>
        <Check size={12} />
      </button>
      <button onClick={onCancel} title="Cancel"
        style={{ padding: 4, borderRadius: 6, background: 'transparent', color: 'var(--ink-mute)',
                 border: '0.5px solid var(--line)', cursor: 'pointer', display: 'flex' }}>
        <X size={12} />
      </button>
    </div>
  )
}

// ─── Delete confirmation modal-like inline panel ─────────────────────────────

function DeleteConfirm({ blaster, onConfirm, onCancel }) {
  const [cascade, setCascade] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const deviceCount = blaster.device_count || 0
  return (
    <div style={{
      marginTop: 8, padding: 12, borderRadius: 10,
      background: 'color-mix(in srgb, var(--err) 8%, var(--surface-2))',
      border: '0.5px solid color-mix(in srgb, var(--err) 30%, var(--line))',
    }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
        Delete "{blaster.name}"?
      </p>
      <p style={{ fontSize: 11, color: 'var(--ink-mute)', lineHeight: 1.5, marginBottom: 10 }}>
        {deviceCount > 0
          ? `${deviceCount} IR device${deviceCount === 1 ? '' : 's'} currently route through this blaster.`
          : 'No IR devices are attached.'}
      </p>
      {deviceCount > 0 && (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 10,
                        fontSize: 11.5, color: 'var(--ink-2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)}
                 style={{ marginTop: 2 }} />
          <span>
            Also delete the {deviceCount} attached IR device{deviceCount === 1 ? '' : 's'}.
            {' '}<span style={{ color: 'var(--ink-faint)' }}>Otherwise they'll be orphaned — visible but unable to send.</span>
          </span>
        </label>
      )}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} disabled={deleting}
          style={{ padding: '6px 12px', borderRadius: 8, background: 'transparent',
                   color: 'var(--ink-2)', border: '0.5px solid var(--line)',
                   fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}>Cancel</button>
        <button
          onClick={async () => { setDeleting(true); try { await onConfirm(cascade) } finally { setDeleting(false) } }}
          disabled={deleting}
          style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--err)',
                   color: '#fff', border: 'none', fontSize: 12, fontWeight: 600,
                   fontFamily: 'inherit', cursor: 'pointer', opacity: deleting ? 0.6 : 1 }}>
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </div>
  )
}

// ─── One row per blaster ─────────────────────────────────────────────────────

function BlasterRow({ blaster, onRename, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const macShort = (blaster.mac || '').slice(-4).toUpperCase()
  return (
    <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 9,
          background: 'color-mix(in srgb, var(--accent) 14%, var(--surface-2))',
          color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Radio size={15} />
        </div>

        {editing ? (
          <InlineRename
            value={blaster.name}
            onSave={(name) => { setEditing(false); onRename(name) }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <p dir="auto" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)',
                                     overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                     minWidth: 0 }}>
                {blaster.name}
              </p>
              <StatusChip status={blaster.status} />
            </div>
            <p className="z-mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 2,
                                            letterSpacing: '0.04em', overflow: 'hidden',
                                            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[
                blaster.model,
                blaster.ip,
                macShort && `MAC ${macShort}`,
                blaster.room && blaster.room.replace(/_/g, ' '),
                `${blaster.device_count || 0} device${blaster.device_count === 1 ? '' : 's'}`,
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
        )}

        {!editing && !confirmingDelete && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button onClick={() => setEditing(true)} title="Rename"
              style={{ padding: 6, borderRadius: 7, background: 'transparent',
                       color: 'var(--ink-mute)', border: 'none', cursor: 'pointer', display: 'flex' }}>
              <Pencil size={13} />
            </button>
            <button onClick={() => setConfirmingDelete(true)} title="Delete"
              style={{ padding: 6, borderRadius: 7, background: 'transparent',
                       color: 'var(--err)', border: 'none', cursor: 'pointer', display: 'flex' }}>
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>

      {confirmingDelete && (
        <DeleteConfirm
          blaster={blaster}
          onConfirm={async (cascade) => { setConfirmingDelete(false); await onDelete(cascade) }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  )
}

// ─── Main section ────────────────────────────────────────────────────────────

export default function BlastersSection() {
  const [blasters, setBlasters] = useState([])
  const [loading, setLoading]   = useState(true)
  const [discovering, setDiscovering] = useState(false)
  const { addToast } = useUIStore()

  const load = async () => {
    try {
      const list = await listIrBlasters()
      setBlasters(list || [])
    } catch (e) {
      addToast(e.message || 'Failed to load blasters', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Initial load + periodic refresh so the status chip stays current
  // without a manual reload. 30s feels lively without hammering the API.
  useEffect(() => {
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [])

  const handleRename = async (id, name) => {
    try {
      await patchIrBlaster(id, { name })
      addToast('Renamed', 'success')
      load()
    } catch (e) {
      addToast(e.message || 'Rename failed', 'error')
    }
  }

  const handleDelete = async (id, cascade) => {
    try {
      const res = await deleteIrBlaster(id, cascade)
      const removed = res?.cascaded_devices || 0
      addToast(
        removed > 0
          ? `Blaster + ${removed} device${removed === 1 ? '' : 's'} deleted`
          : 'Blaster deleted',
        'success',
      )
      load()
    } catch (e) {
      addToast(e.message || 'Delete failed', 'error')
    }
  }

  const handleRediscover = async () => {
    setDiscovering(true)
    try {
      await discoverIrBlasters({ refresh: true })
      addToast('Scan complete', 'success')
      load()
    } catch (e) {
      addToast(e.message || 'Scan failed', 'error')
    } finally {
      setDiscovering(false)
    }
  }

  return (
    <div>
      <div style={{
        background: 'var(--surface)', border: '0.5px solid var(--line)', borderRadius: 14,
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 14px', borderBottom: '0.5px solid var(--line)' }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
              {blasters.length === 0 ? 'No blasters' : `${blasters.length} blaster${blasters.length === 1 ? '' : 's'}`}
            </p>
            <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }}>
              IR-blaster hardware paired to Ziggy. Status refreshes every 30s.
            </p>
          </div>
          <button
            onClick={handleRediscover}
            disabled={discovering}
            title="Scan LAN for new blasters"
            className={cn(discovering && 'animate-spin')}
            style={{
              padding: 7, borderRadius: 9, background: 'var(--surface-2)',
              color: 'var(--ink-mute)', border: '0.5px solid var(--line)',
              cursor: discovering ? 'default' : 'pointer', display: 'flex',
              flexShrink: 0,
            }}
          >
            <RefreshCw size={13} />
          </button>
        </div>

        {/* List */}
        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--ink-faint)' }}>
            Loading…
          </div>
        ) : blasters.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginBottom: 6 }}>
              No blasters paired yet.
            </p>
            <p style={{ fontSize: 11, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
              Pair a Broadlink RM4 (or compatible) via the IR Wizard on the Devices page.
              Once paired, it'll show up here.
            </p>
          </div>
        ) : (
          <div>
            {blasters.map((b) => (
              <BlasterRow
                key={b.id}
                blaster={b}
                onRename={(name) => handleRename(b.id, name)}
                onDelete={(cascade) => handleDelete(b.id, cascade)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
