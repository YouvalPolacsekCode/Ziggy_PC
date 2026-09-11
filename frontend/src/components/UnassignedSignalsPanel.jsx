import { useEffect, useState, useCallback } from 'react'
import { Radio, Trash2, Send, RefreshCw } from 'lucide-react'
import { Modal } from './ui/Modal'
import {
  getIrUnassignedSignals,
  assignIrUnassignedSignal,
  dismissIrUnassignedSignal,
  clearIrUnassignedSignals,
  getIrDevices,
} from '../lib/api'
import { useUIStore } from '../stores/uiStore'
import { useT, t as i18nT } from '../lib/i18n'

function _fmtAgo(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const diffSec = Math.round(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function SignalRow({ signal, devices, onAssigned, onDismissed }) {
  const t = useT()
  const [deviceId, setDeviceId] = useState('')
  const [commandName, setCommandName] = useState('')
  const [busy, setBusy] = useState(false)
  const { addToast } = useUIStore()

  const device = devices.find((d) => d.id === deviceId)
  const commandOptions = device ? Object.keys(device.commands || {}) : []
  const learnedSet = new Set(device?.learned_commands || [])

  const handleAssign = async () => {
    if (!deviceId || !commandName.trim()) {
      addToast(t('unassignedSig.pickDeviceAndCmd'), 'error')
      return
    }
    setBusy(true)
    try {
      await assignIrUnassignedSignal(signal.id, deviceId, commandName.trim())
      addToast(t('unassignedSig.boundTo', { device: device?.name, cmd: commandName }), 'success')
      onAssigned()
    } catch (e) {
      addToast(e.message || t('unassignedSig.assignFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleDismiss = async () => {
    setBusy(true)
    try {
      await dismissIrUnassignedSignal(signal.id)
      onDismissed()
    } catch (e) {
      addToast(e.message || t('unassignedSig.dismissFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      padding: 12, borderRadius: 11, border: '0.5px solid var(--line)',
      background: 'var(--surface)', marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 9,
          background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Radio size={14} style={{ color: 'var(--accent)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>
            {t('unassignedSig.unknownSignal')} {signal.count > 1 ? `×${signal.count}` : ''}
          </p>
          <p className="z-mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)', margin: 0 }}>
            {_fmtAgo(signal.last_seen_at || signal.received_at)}
            {signal.fingerprint ? ` · fp ${signal.fingerprint.slice(0, 8)}` : ''}
            {signal.pulse_count ? ` · ${signal.pulse_count} pulses` : ''}
            {signal.blaster_host ? ` · ${signal.blaster_host}` : ''}
          </p>
        </div>
        <button
          onClick={handleDismiss}
          disabled={busy}
          title={t('unassignedSig.dismissTitle')}
          style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'transparent', border: '0.5px solid var(--line)',
            color: 'var(--ink-faint)', cursor: busy ? 'wait' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <select
          value={deviceId}
          onChange={(e) => { setDeviceId(e.target.value); setCommandName('') }}
          style={{
            flex: '1 1 140px', minWidth: 0,
            padding: '7px 9px', borderRadius: 9, fontSize: 12,
            background: 'var(--surface-2)', border: '0.5px solid var(--line)',
            color: 'var(--ink)',
          }}
        >
          <option value="">{t('unassignedSig.pickDevice')}</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} {d.room ? `· ${d.room.replace(/_/g, ' ')}` : ''}
            </option>
          ))}
        </select>

        <input
          list={`cmd-${signal.id}`}
          value={commandName}
          onChange={(e) => setCommandName(e.target.value)}
          placeholder={t('unassignedSig.commandPlaceholder')}
          disabled={!deviceId}
          style={{
            flex: '1 1 120px', minWidth: 0,
            padding: '7px 9px', borderRadius: 9, fontSize: 12,
            background: 'var(--surface-2)', border: '0.5px solid var(--line)',
            color: 'var(--ink)',
          }}
        />
        {device && (
          <datalist id={`cmd-${signal.id}`}>
            {commandOptions.map((c) => (
              <option key={c} value={c}>
                {learnedSet.has(c) ? '(already learned)' : ''}
              </option>
            ))}
          </datalist>
        )}

        <button
          onClick={handleAssign}
          disabled={busy || !deviceId || !commandName.trim()}
          style={{
            padding: '7px 13px', borderRadius: 9, fontSize: 12, fontWeight: 600,
            background: 'var(--ink)', color: 'var(--bg)', border: 'none',
            cursor: busy || !deviceId ? 'not-allowed' : 'pointer',
            opacity: busy || !deviceId || !commandName.trim() ? 0.5 : 1,
            display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          <Send size={11} /> Bind
        </button>
      </div>
    </div>
  )
}

export default function UnassignedSignalsPanel({ open, onClose, refreshSignal }) {
  const t = useT()
  const [signals, setSignals] = useState([])
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(false)
  const { addToast } = useUIStore()

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [sigs, devs] = await Promise.all([
        getIrUnassignedSignals(),
        getIrDevices(),
      ])
      setSignals(Array.isArray(sigs) ? sigs : [])
      setDevices(Array.isArray(devs) ? devs : [])
    } catch (e) {
      addToast(e.message || t('unassignedSig.failedLoad'), 'error')
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => { if (open) refresh() }, [open, refreshSignal, refresh])

  const handleClearAll = async () => {
    try {
      const r = await clearIrUnassignedSignals()
      addToast(t('unassignedSig.cleared', { n: r.removed ?? 0 }), 'success')
      refresh()
    } catch (e) {
      addToast(e.message || t('unassignedSig.clearFailed'), 'error')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('unassignedSig.title')} maxWidth={560}>
      <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 14, lineHeight: 1.5 }}>
        {t('unassignedSig.help')}
      </p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button
          onClick={refresh}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '6px 12px', borderRadius: 9, fontSize: 11.5, fontWeight: 500,
            background: 'var(--surface-2)', border: '0.5px solid var(--line)',
            color: 'var(--ink-mute)', cursor: 'pointer',
          }}
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          {t('common.refresh')}
        </button>
        {signals.length > 0 && (
          <button
            onClick={handleClearAll}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '6px 12px', borderRadius: 9, fontSize: 11.5, fontWeight: 500,
              background: 'transparent', border: '0.5px solid var(--line)',
              color: 'var(--warn)', cursor: 'pointer',
            }}
          >
            {t('unassignedSig.clearAll')}
          </button>
        )}
      </div>

      {loading && signals.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--ink-faint)', textAlign: 'center', padding: 20 }}>
          {t('common.loading')}
        </p>
      )}

      {!loading && signals.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 12px', color: 'var(--ink-faint)' }}>
          <Radio size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
          <p style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 600 }}>{t('unassignedSig.noneTitle')}</p>
          <p style={{ fontSize: 11, marginTop: 4 }}>
            {t('unassignedSig.noneHint')}
          </p>
        </div>
      )}

      {signals.map((s) => (
        <SignalRow
          key={s.id}
          signal={s}
          devices={devices}
          onAssigned={refresh}
          onDismissed={refresh}
        />
      ))}
    </Modal>
  )
}
