import { useEffect, useState } from 'react'
import { Radio, Pencil, Trash2, RefreshCw, Check, X } from 'lucide-react'
import {
  listIrBlasters, patchIrBlaster, deleteIrBlaster, discoverIrBlasters,
} from '../../lib/api'
import { useUIStore } from '../../stores/uiStore'
import { useT } from '../../lib/i18n'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'

// ─── Status chip ─────────────────────────────────────────────────────────────
// Derived field from the registry: online (< 60s since last contact), stale
// (< 5 min), unreachable (older / never). Surfaced as a small inline chip
// so the user can scan a list of hubs and immediately spot the dead one.

const STATUS_META = {
  online:      { key: 'irHubs.status.online',      text: 'var(--ok-text)',   dot: 'z-dot-ok'   },
  stale:       { key: 'irHubs.status.stale',       text: 'var(--warn-text)', dot: 'z-dot-warn' },
  unreachable: { key: 'irHubs.status.unreachable', text: 'var(--err-text)',  dot: 'z-dot-err'  },
}

function StatusChip({ status }) {
  const t = useT()
  const meta = STATUS_META[status] || STATUS_META.unreachable
  return (
    <span className="z-chip" style={{ color: meta.text }}>
      <span className={`z-dot ${meta.dot}`} />
      {t(meta.key)}
    </span>
  )
}

// Borderless 44×44 target for a row-level icon action.
const ghostIcon = {
  width: 40, height: 40, borderRadius: 'var(--r-ctl)', background: 'transparent',
  border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center',
  justifyContent: 'center', flexShrink: 0, padding: 0,
  transition: 'background var(--dur-press) var(--ease-standard)',
}

// ─── Inline rename input ─────────────────────────────────────────────────────

function InlineRename({ value, onSave, onCancel }) {
  const t = useT()
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
      <button onClick={handleSave} title={t('common.save')} aria-label={t('common.save')} className="z-icon-btn">
        <Check size={18} />
      </button>
      <button onClick={onCancel} title={t('common.cancel')} aria-label={t('common.cancel')} className="z-icon-btn">
        <X size={18} />
      </button>
    </div>
  )
}

// ─── Delete confirmation — inline panel ──────────────────────────────────────

function DeleteConfirm({ blaster, onConfirm, onCancel }) {
  const t = useT()
  const [cascade, setCascade] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const deviceCount = blaster.device_count || 0
  return (
    <div style={{
      marginTop: 8, padding: 12, borderRadius: 'var(--r-ctl)',
      background: 'color-mix(in srgb, var(--err) 8%, var(--surface-2))',
      border: '0.5px solid color-mix(in srgb, var(--err) 30%, var(--line))',
    }}>
      <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }} dir="auto">
        {t('irHubs.deleteTitle', { name: blaster.name })}
      </p>
      <p style={{ fontSize: 13, color: 'var(--ink-mute)', lineHeight: 1.5, marginBottom: 12 }}>
        {deviceCount > 0
          ? (deviceCount === 1 ? t('irHubs.routesThroughOne') : t('irHubs.routesThroughMany', { n: deviceCount }))
          : t('irHubs.noDevicesAttached')}
      </p>
      {deviceCount > 0 && (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12, minHeight: 40,
                        fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)}
                 style={{ marginTop: 2, width: 20, height: 20, flexShrink: 0 }} />
          <span>
            {deviceCount === 1 ? t('irHubs.alsoDeleteOne') : t('irHubs.alsoDeleteMany', { n: deviceCount })}
            {' '}<span style={{ color: 'var(--ink-mute)' }}>{t('irHubs.orphanNote')}</span>
          </span>
        </label>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} disabled={deleting} className="z-btn-secondary">{t('common.cancel')}</button>
        <Button
          variant="danger"
          onClick={async () => { setDeleting(true); try { await onConfirm(cascade) } finally { setDeleting(false) } }}
          disabled={deleting}
        >
          {deleting ? t('common.deleting') : t('common.delete')}
        </Button>
      </div>
    </div>
  )
}

// ─── One row per hub ─────────────────────────────────────────────────────────

function BlasterRow({ blaster, onRename, onDelete }) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const deviceCount = blaster.device_count || 0
  return (
    <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 'var(--r-ctl)',
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
              <p dir="auto" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)',
                                     overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                     minWidth: 0 }}>
                {blaster.name}
              </p>
              <StatusChip status={blaster.status} />
            </div>
            {/* Room + device count are product facts. The IP is kept because a
                hub that moved on DHCP is the one failure a person can fix by
                looking at this line; the MAC is not, so it is gone. */}
            <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">
              {[
                blaster.room && blaster.room.replace(/_/g, ' '),
                blaster.ip && <span key="ip" className="z-code">{blaster.ip}</span>,
                deviceCount === 1 ? t('irHubs.devicesOne') : t('irHubs.devicesMany', { n: deviceCount }),
              ].filter(Boolean).map((part, i) => <span key={i}>{i > 0 && ' · '}{part}</span>)}
            </p>
          </div>
        )}

        {!editing && !confirmingDelete && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button onClick={() => setEditing(true)} title={t('common.rename')} aria-label={t('common.rename')}
              style={{ ...ghostIcon, color: 'var(--ink-mute)' }}>
              <Pencil size={18} />
            </button>
            <button onClick={() => setConfirmingDelete(true)} title={t('common.delete')} aria-label={t('common.delete')}
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

// `onChanged` lets a host page (Devices keeps its own hub count for the
// collapsible header) refresh after a rename, delete or re-scan.
export default function BlastersSection({ onChanged } = {}) {
  const t = useT()
  const [blasters, setBlasters] = useState([])
  const [loading, setLoading]   = useState(true)
  const [discovering, setDiscovering] = useState(false)
  const { addToast } = useUIStore()

  const load = async () => {
    try {
      const res = await listIrBlasters()
      const list = Array.isArray(res) ? res : (res?.blasters || [])
      setBlasters(list)
    } catch (e) {
      addToast(e.message || t('irHubs.loadFailed'), 'error')
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
      addToast(t('irHubs.renamed'), 'success')
      load(); onChanged?.()
    } catch (e) {
      addToast(e.message || t('irHubs.renameFailed'), 'error')
    }
  }

  const handleDelete = async (id, cascade) => {
    try {
      const res = await deleteIrBlaster(id, cascade)
      const removed = res?.cascaded_devices || 0
      addToast(
        removed > 0
          ? (removed === 1 ? t('irHubs.deletedWithOne') : t('irHubs.deletedWithMany', { n: removed }))
          : t('irHubs.deleted'),
        'success',
      )
      load(); onChanged?.()
    } catch (e) {
      addToast(e.message || t('irHubs.deleteFailed'), 'error')
    }
  }

  const handleRediscover = async () => {
    setDiscovering(true)
    try {
      await discoverIrBlasters({ refresh: true })
      addToast(t('irHubs.scanDone'), 'success')
      load(); onChanged?.()
    } catch (e) {
      addToast(e.message || t('irHubs.scanFailed'), 'error')
    } finally {
      setDiscovering(false)
    }
  }

  const count = blasters.length
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
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
              {count === 0 ? t('irHubs.countZero') : count === 1 ? t('irHubs.countOne') : t('irHubs.countMany', { n: count })}
            </p>
            <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 2 }}>
              {t('irHubs.headerDesc')}
            </p>
          </div>
          <button
            onClick={handleRediscover}
            disabled={discovering}
            title={t('irHubs.scan')}
            aria-label={t('irHubs.scan')}
            className="z-icon-btn"
            style={{ cursor: discovering ? 'default' : 'pointer' }}
          >
            <RefreshCw size={18} className={discovering ? 'z-spin' : undefined} />
          </button>
        </div>

        {/* List */}
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: 'var(--ink-mute)' }}>
            {t('common.loading')}
          </div>
        ) : blasters.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <p style={{ fontSize: 15, color: 'var(--ink)', marginBottom: 4 }}>
              {t('irHubs.emptyTitle')}
            </p>
            <p style={{ fontSize: 13, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
              {t('irHubs.emptyBody')}
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
