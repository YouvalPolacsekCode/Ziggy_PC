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

// 44×44 quiet icon target used for the per-signal dismiss.
const ICON_BTN = {
  width: 44, height: 44, borderRadius: 'var(--r-ctl)', flexShrink: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 'none', padding: 0,
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

  const canBind = !busy && !!deviceId && !!commandName.trim()

  return (
    <div className="z-card" style={{ padding: 16, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 'var(--r-ctl)',
          background: 'var(--surface-2)', color: 'var(--ink-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Radio size={20} strokeWidth={1.75} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="z-headline truncate" style={{ margin: 0 }}>
            {t('unassignedSig.unknownSignal')} {signal.count > 1 ? `×${signal.count}` : ''}
          </p>
          <p className="z-footnote z-mono truncate" style={{ margin: 0 }}>
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
          aria-label={t('unassignedSig.dismissTitle')}
          className="hover:bg-surface-2 transition-colors"
          style={{ ...ICON_BTN, color: 'var(--err-text)', cursor: busy ? 'wait' : 'pointer' }}
        >
          <Trash2 size={18} strokeWidth={1.75} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select
          value={deviceId}
          onChange={(e) => { setDeviceId(e.target.value); setCommandName('') }}
          className="z-input"
          style={{ flex: '1 1 160px', minWidth: 0, width: 'auto' }}
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
          className="z-input"
          style={{ flex: '1 1 140px', minWidth: 0, width: 'auto' }}
        />
        {device && (
          <datalist id={`cmd-${signal.id}`}>
            {commandOptions.map((c) => (
              <option key={c} value={c}>
                {learnedSet.has(c) ? `(${t('unassignedSig.alreadyLearned')})` : ''}
              </option>
            ))}
          </datalist>
        )}

        <button
          onClick={handleAssign}
          disabled={!canBind}
          className="z-btn-secondary"
          style={{ cursor: canBind ? 'pointer' : 'not-allowed', opacity: canBind ? 1 : 0.5, flexShrink: 0 }}
        >
          <Send size={16} strokeWidth={1.75} /> {t('unassignedSig.bind')}
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
      <p className="z-subhead" style={{ marginBottom: 16 }}>
        {t('unassignedSig.help')}
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button
          onClick={refresh}
          disabled={loading}
          className="z-btn-secondary"
          style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink-mute)' }}
        >
          {/* 1s linear spin, only while a load is in flight */}
          <RefreshCw size={16} strokeWidth={1.75} className={loading ? 'z-spin' : ''} />
          {t('common.refresh')}
        </button>
        {signals.length > 0 && (
          <button
            onClick={handleClearAll}
            className="z-btn-secondary"
            style={{ fontSize: 15, fontWeight: 500, color: 'var(--err-text)' }}
          >
            {t('unassignedSig.clearAll')}
          </button>
        )}
      </div>

      {loading && signals.length === 0 && (
        <p className="z-subhead" style={{ textAlign: 'center', padding: 20 }}>
          {t('common.loading')}
        </p>
      )}

      {!loading && signals.length === 0 && (
        <div style={{ textAlign: 'center', padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <Radio size={28} strokeWidth={1.75} style={{ color: 'var(--ink-faint)', marginBottom: 8 }} />
          <p style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)', margin: 0 }}>{t('unassignedSig.noneTitle')}</p>
          <p className="z-subhead" style={{ margin: 0 }}>
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
