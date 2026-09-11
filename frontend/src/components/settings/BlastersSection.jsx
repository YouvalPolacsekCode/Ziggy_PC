import { useEffect, useState } from 'react'
import { Radio, Pencil, Trash2, RefreshCw, Check, X } from 'lucide-react'
import {
  listIrBlasters, patchIrBlaster, deleteIrBlaster, discoverIrBlasters,
} from '../../lib/api'
import { useUIStore } from '../../stores/uiStore'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'

// ─── Status chip ─────────────────────────────────────────────────────────────
// Derived field from the registry: online (< 60s since last contact), stale
// (< 5 min), unreachable (older / never). Surfaced as a small inline chip
// so the user can scan a list of blasters and immediately spot the dead one.

const STATUS_META = {
  online:      { label: 'Online',      text: 'var(--ok-text)',   dot: 'z-dot-ok'   },
  stale:       { label: 'Stale',       text: 'var(--warn-text)', dot: 'z-dot-warn' },
  unreachable: { label: 'Unreachable', text: 'var(--err-text)',  dot: 'z-dot-err'  },
}

function StatusChip({ status }) {
  const meta = STATUS_META[status] || STATUS_META.unreachable
  return (
    <span className="z-chip" style={{ color: meta.text }}>
      <span className={`z-dot ${meta.dot}`} />
      {meta.label}
    </span>
  )
}

// Borderless 44×44 target for a row-level icon action.
const ghostIcon = {
  width: 44, height: 44, borderRadius: 'var(--r-ctl)', background: 'transparent',
  border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center',
  justifyContent: 'center', flexShrink: 0, padding: 0,
  transition: 'background var(--dur-press) var(--ease-standard)',
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave()
            else if (e.key === 'Escape') onCancel()
          }}
          dir="auto"
        />
      </div>
      <button onClick={handleSave} title="Save" aria-label="Save" className="z-icon-btn">
        <Check size={18} />
      </button>
      <button onClick={onCancel} title="Cancel" aria-label="Cancel" className="z-icon-btn">
        <X size={18} />
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
      marginTop: 8, padding: 16, borderRadius: 'var(--r-ctl)',
      background: 'color-mix(in srgb, var(--err) 8%, var(--surface-2))',
      border: '0.5px solid color-mix(in srgb, var(--err) 30%, var(--line))',
    }}>
      <p style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
        Delete "{blaster.name}"?
      </p>
      <p style={{ fontSize: 15, color: 'var(--ink-mute)', lineHeight: 1.5, marginBottom: 12 }}>
        {deviceCount > 0
          ? `${deviceCount} IR device${deviceCount === 1 ? '' : 's'} currently route through this blaster.`
          : 'No IR devices are attached.'}
      </p>
      {deviceCount > 0 && (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12, minHeight: 44,
                        fontSize: 15, color: 'var(--ink-2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)}
                 style={{ marginTop: 2, width: 20, height: 20, flexShrink: 0 }} />
          <span>
            Also delete the {deviceCount} attached IR device{deviceCount === 1 ? '' : 's'}.
            {' '}<span style={{ color: 'var(--ink-mute)' }}>Otherwise they'll be orphaned — visible but unable to send.</span>
          </span>
        </label>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} disabled={deleting} className="z-btn-secondary">Cancel</button>
        <Button
          variant="danger"
          onClick={async () => { setDeleting(true); try { await onConfirm(cascade) } finally { setDeleting(false) } }}
          disabled={deleting}
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </Button>
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
    <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 56 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 'var(--r-ctl)',
          background: 'var(--surface-2)', color: 'var(--ink-mute)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Radio size={20} strokeWidth={1.75} />
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
              <p dir="auto" style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)',
                                     overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                     minWidth: 0 }}>
                {blaster.name}
              </p>
              <StatusChip status={blaster.status} />
            </div>
            <p className="z-mono" style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 2,
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
            <button onClick={() => setEditing(true)} title="Rename" aria-label="Rename"
              style={{ ...ghostIcon, color: 'var(--ink-mute)' }}>
              <Pencil size={18} />
            </button>
            <button onClick={() => setConfirmingDelete(true)} title="Delete" aria-label="Delete"
              style={{ ...ghostIcon, color: 'var(--err-text)' }}>
              <Trash2 size={18} />
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
        background: 'var(--surface)', border: '0.5px solid var(--line)', borderRadius: 'var(--r-card)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                      padding: '12px 16px', borderBottom: '0.5px solid var(--line)' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>
              {blasters.length === 0 ? 'No blasters' : `${blasters.length} blaster${blasters.length === 1 ? '' : 's'}`}
            </p>
            <p style={{ fontSize: 15, color: 'var(--ink-mute)', marginTop: 2 }}>
              IR-blaster hardware paired to Ziggy. Status refreshes every 30s.
            </p>
          </div>
          <button
            onClick={handleRediscover}
            disabled={discovering}
            title="Scan LAN for new blasters"
            aria-label="Scan LAN for new blasters"
            className="z-icon-btn"
            style={{ cursor: discovering ? 'default' : 'pointer' }}
          >
            <RefreshCw size={18} className={discovering ? 'z-spin' : undefined} />
          </button>
        </div>

        {/* List */}
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 15, color: 'var(--ink-mute)' }}>
            Loading…
          </div>
        ) : blasters.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <p style={{ fontSize: 17, color: 'var(--ink)', marginBottom: 4 }}>
              No blasters paired yet.
            </p>
            <p style={{ fontSize: 15, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
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
