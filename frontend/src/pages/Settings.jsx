import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sun, Moon, User, Lock, LogOut, Mic, MicOff, RefreshCw,
  Bell, BellOff, Plus, Trash2, ChevronDown, ChevronUp, Wifi,
} from 'lucide-react'
import { Card, CardBody } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Slider } from '../components/ui/Slider'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { Modal } from '../components/ui/Modal'
import { EntitySelect } from '../components/ui/EntitySelect'
import { useUIStore } from '../stores/uiStore'
import { useAuthStore } from '../stores/authStore'
import {
  getStatus,
  getVoiceSettings, patchVoiceSettings,
  getAlertSettings, patchAlertSettings,
  getAnomalySettings, patchAnomalySettings,
  getGeneralSettings, patchGeneralSettings,
  getAuthStatus, changePassword,
} from '../lib/api'
import { cn } from '../lib/utils'

const TIMEZONES = [
  'UTC',
  'Asia/Jerusalem',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Australia/Sydney',
]

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'he', label: 'עברית (Hebrew)' },
]

// ─── Shared primitives ────────────────────────────────────────────────────────

function SectionTitle({ children }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 mb-3 px-1">
      {children}
    </h2>
  )
}

function SettingRow({ icon: Icon, label, subtitle, iconColor = 'text-zinc-400', children }) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5 gap-4">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && <Icon size={17} className={cn('shrink-0', iconColor)} />}
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</p>
          {subtitle && <p className="text-xs text-zinc-400 truncate">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

function MetricBar({ label, value, color }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{value}%</span>
      </div>
      <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
        <motion.div
          className={cn('h-full rounded-full', color)}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}

// ─── Add Alert Rule Modal ─────────────────────────────────────────────────────

function AddAlertModal({ open, onClose, onAdd }) {
  const [form, setForm] = useState({ entity_id: '', label: '', message: '', trigger_state: 'on' })
  const [err, setErr] = useState('')

  const handleSubmit = () => {
    if (!form.entity_id) { setErr('Select an entity'); return }
    if (!form.label.trim()) { setErr('Enter a label'); return }
    if (!form.message.trim()) { setErr('Enter an alert message'); return }
    onAdd({ ...form })
    setForm({ entity_id: '', label: '', message: '', trigger_state: 'on' })
    setErr('')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Alert Rule">
      <div className="flex flex-col gap-4">
        <EntitySelect
          label="Sensor / Entity"
          value={form.entity_id}
          onChange={(v) => setForm((s) => ({ ...s, entity_id: v }))}
          placeholder="Pick a sensor…"
        />
        <Input
          label="Label"
          placeholder="Front door"
          value={form.label}
          onChange={(e) => setForm((s) => ({ ...s, label: e.target.value }))}
        />
        <Input
          label="Alert message"
          placeholder="Front door opened"
          value={form.message}
          onChange={(e) => setForm((s) => ({ ...s, message: e.target.value }))}
        />
        <Select
          label="Trigger when state is"
          value={form.trigger_state}
          onChange={(e) => setForm((s) => ({ ...s, trigger_state: e.target.value }))}
          options={[
            { value: 'on', label: 'On  (active / open / detected)' },
            { value: 'off', label: 'Off  (inactive / closed)' },
          ]}
        />
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex gap-3 pt-1">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button variant="primary" className="flex-1" onClick={handleSubmit}>Add rule</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Settings() {
  const { theme, toggleTheme, addToast } = useUIStore()
  const { logout } = useAuthStore()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [status, setStatus] = useState(null)
  const [username, setUsername] = useState('')

  const [general, setGeneral] = useState({ language: 'en', timezone: 'UTC' })
  const [savingGeneral, setSavingGeneral] = useState(false)

  const [voice, setVoice] = useState({})
  const [savingVoice, setSavingVoice] = useState(false)

  const [anomaly, setAnomaly] = useState({ enabled: true, quiet_hour_start: 23, quiet_hour_end: 7 })
  const [savingAnomaly, setSavingAnomaly] = useState(false)

  const [alerts, setAlerts] = useState({ enabled: true, cooldown_minutes: 10, sensors: [] })
  const [savingAlerts, setSavingAlerts] = useState(false)
  const [showAddAlert, setShowAddAlert] = useState(false)

  const [showChangePw, setShowChangePw] = useState(false)
  const [pwForm, setPwForm] = useState({ username: '', password: '', confirm: '' })
  const [pwError, setPwError] = useState('')
  const [savingPw, setSavingPw] = useState(false)

  const loadAll = async () => {
    try {
      const [s, v, al, an, g, auth] = await Promise.all([
        getStatus(),
        getVoiceSettings(),
        getAlertSettings(),
        getAnomalySettings(),
        getGeneralSettings(),
        getAuthStatus(),
      ])
      setStatus(s)
      setVoice(v || {})
      setAlerts({ enabled: true, cooldown_minutes: 10, ...al, sensors: al?.sensors || [] })
      setAnomaly({ enabled: true, quiet_hour_start: 23, quiet_hour_end: 7, ...an })
      setGeneral({ language: 'en', timezone: 'UTC', ...g })
      setUsername(auth?.username || '')
      setPwForm((f) => ({ ...f, username: auth?.username || '' }))
    } catch {}
  }

  useEffect(() => { loadAll().finally(() => setLoading(false)) }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadAll()
    setRefreshing(false)
  }

  const saveGeneral = async () => {
    setSavingGeneral(true)
    try {
      await patchGeneralSettings(general)
      addToast('Saved', 'success')
    } catch { addToast('Failed to save', 'error') }
    finally { setSavingGeneral(false) }
  }

  const saveVoice = async () => {
    setSavingVoice(true)
    try {
      await patchVoiceSettings(voice)
      addToast('Voice settings saved', 'success')
    } catch { addToast('Failed to save', 'error') }
    finally { setSavingVoice(false) }
  }

  const saveAnomaly = async () => {
    setSavingAnomaly(true)
    try {
      await patchAnomalySettings(anomaly)
      addToast('Saved', 'success')
    } catch { addToast('Failed to save', 'error') }
    finally { setSavingAnomaly(false) }
  }

  const saveAlerts = async () => {
    setSavingAlerts(true)
    try {
      await patchAlertSettings(alerts)
      addToast('Alert rules saved', 'success')
    } catch { addToast('Failed to save', 'error') }
    finally { setSavingAlerts(false) }
  }

  const handleAddAlertRule = (rule) => {
    setAlerts((s) => ({ ...s, sensors: [...s.sensors, rule] }))
  }

  const handleRemoveAlertRule = (idx) => {
    setAlerts((s) => ({ ...s, sensors: s.sensors.filter((_, i) => i !== idx) }))
  }

  const handleChangePassword = async () => {
    if (!pwForm.username.trim()) { setPwError('Username is required'); return }
    if (pwForm.password.length < 4) { setPwError('At least 4 characters required'); return }
    if (pwForm.password !== pwForm.confirm) { setPwError("Passwords don't match"); return }
    setSavingPw(true)
    try {
      await changePassword({ username: pwForm.username, password: pwForm.password })
      addToast('Password updated', 'success')
      setShowChangePw(false)
      setPwForm((f) => ({ ...f, password: '', confirm: '' }))
      setPwError('')
    } catch (e) {
      setPwError(e.message || 'Failed to update password')
    } finally { setSavingPw(false) }
  }

  const sys = status?.system

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6 pb-28">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Settings</h1>
        <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw size={16} className={cn(refreshing && 'animate-spin')} />
        </Button>
      </div>

      {/* ── Appearance ──────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <SectionTitle>Appearance</SectionTitle>
        <Card>
          <SettingRow
            icon={theme === 'dark' ? Moon : Sun}
            label={theme === 'dark' ? 'Dark mode' : 'Light mode'}
            subtitle="Switch app theme"
          >
            <Toggle checked={theme === 'dark'} onCheckedChange={toggleTheme} />
          </SettingRow>
        </Card>
      </div>

      {/* ── Language & Region ────────────────────────────────────────────────── */}
      <div className="mb-6">
        <SectionTitle>Language & Region</SectionTitle>
        <Card>
          <CardBody className="pt-4 flex flex-col gap-4">
            <Select
              label="Language"
              value={general.language}
              onChange={(e) => setGeneral((s) => ({ ...s, language: e.target.value }))}
              options={LANGUAGES}
            />
            <Select
              label="Timezone"
              value={general.timezone}
              onChange={(e) => setGeneral((s) => ({ ...s, timezone: e.target.value }))}
              options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
            />
            <Button variant="primary" onClick={saveGeneral} disabled={savingGeneral} className="w-full">
              {savingGeneral ? 'Saving…' : 'Save'}
            </Button>
          </CardBody>
        </Card>
      </div>

      {/* ── Account ─────────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <SectionTitle>Account</SectionTitle>
        <Card>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">

            {/* Username row */}
            <SettingRow icon={User} label="Signed in" subtitle={username || 'Local account'} iconColor="text-zinc-400">
              <Badge variant="default" className="text-[10px]">Local</Badge>
            </SettingRow>

            {/* Change password — inline collapsible */}
            <div>
              <button
                className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                onClick={() => { setShowChangePw((v) => !v); setPwError('') }}
              >
                <div className="flex items-center gap-3">
                  <Lock size={17} className="text-zinc-400 shrink-0" />
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Change password</p>
                </div>
                {showChangePw
                  ? <ChevronUp size={15} className="text-zinc-400" />
                  : <ChevronDown size={15} className="text-zinc-400" />}
              </button>

              <AnimatePresence>
                {showChangePw && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 flex flex-col gap-3">
                      <Input
                        label="Username"
                        placeholder="your@email.com"
                        value={pwForm.username}
                        onChange={(e) => setPwForm((s) => ({ ...s, username: e.target.value }))}
                      />
                      <Input
                        label="New password"
                        type="password"
                        placeholder="••••••••"
                        value={pwForm.password}
                        onChange={(e) => setPwForm((s) => ({ ...s, password: e.target.value }))}
                      />
                      <Input
                        label="Confirm password"
                        type="password"
                        placeholder="••••••••"
                        value={pwForm.confirm}
                        onChange={(e) => setPwForm((s) => ({ ...s, confirm: e.target.value }))}
                        error={pwError}
                      />
                      <Button
                        variant="primary"
                        onClick={handleChangePassword}
                        disabled={savingPw}
                        className="w-full"
                      >
                        {savingPw ? 'Saving…' : 'Update password'}
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Sign out */}
            <button
              onClick={logout}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors rounded-b-2xl"
            >
              <LogOut size={17} className="shrink-0" />
              <span className="text-sm font-medium">Sign out</span>
            </button>
          </div>
        </Card>
      </div>

      {/* ── Voice ───────────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <SectionTitle>Voice</SectionTitle>
        <Card>
          <CardBody className="pt-4 flex flex-col gap-5">

            {/* Voice assistant on/off */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Mic size={17} className={voice.enabled !== false ? 'text-violet-500' : 'text-zinc-400'} />
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Voice assistant</p>
                  <p className="text-xs text-zinc-400">Microphone & text-to-speech</p>
                </div>
              </div>
              <Toggle
                checked={voice.enabled !== false}
                onCheckedChange={(v) => setVoice((s) => ({ ...s, enabled: v }))}
              />
            </div>

            <AnimatePresence>
              {voice.enabled !== false && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex flex-col gap-5 overflow-hidden"
                >
                  {/* Wake word */}
                  <div className="flex items-center justify-between pt-4 border-t border-zinc-100 dark:border-zinc-800">
                    <div className="flex items-center gap-3">
                      {voice.wakeword_enabled
                        ? <Mic size={17} className="text-violet-400" />
                        : <MicOff size={17} className="text-zinc-400" />}
                      <div>
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Wake word</p>
                        <p className="text-xs text-zinc-400">{voice.wakeword_model || 'hey_mycroft'}</p>
                      </div>
                    </div>
                    <Toggle
                      checked={!!voice.wakeword_enabled}
                      onCheckedChange={(v) => setVoice((s) => ({ ...s, wakeword_enabled: v }))}
                    />
                  </div>

                  {/* Detection sensitivity */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">Detection sensitivity</p>
                      <span className="text-xs font-semibold text-zinc-500">
                        {(voice.wakeword_threshold || 0.65).toFixed(2)}
                      </span>
                    </div>
                    <Slider
                      value={(voice.wakeword_threshold || 0.65) * 100}
                      onValueChange={(v) => setVoice((s) => ({ ...s, wakeword_threshold: v / 100 }))}
                      min={30}
                      max={95}
                    />
                    <div className="flex justify-between mt-1">
                      <span className="text-[10px] text-zinc-400">Sensitive</span>
                      <span className="text-[10px] text-zinc-400">Strict</span>
                    </div>
                  </div>

                  {/* Listen timeout */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">Listen timeout</p>
                      <span className="text-xs font-semibold text-zinc-500">
                        {voice.active_timeout_s || 90}s
                      </span>
                    </div>
                    <Slider
                      value={voice.active_timeout_s || 90}
                      onValueChange={(v) => setVoice((s) => ({ ...s, active_timeout_s: v }))}
                      min={10}
                      max={120}
                    />
                  </div>

                  {/* TTS speed */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">Speech speed</p>
                      <span className="text-xs font-semibold text-zinc-500">
                        {(voice.speed || 1.0).toFixed(1)}×
                      </span>
                    </div>
                    <Slider
                      value={(voice.speed || 1.0) * 100}
                      onValueChange={(v) => setVoice((s) => ({ ...s, speed: parseFloat((v / 100).toFixed(2)) }))}
                      min={70}
                      max={150}
                    />
                    <div className="flex justify-between mt-1">
                      <span className="text-[10px] text-zinc-400">Slower</span>
                      <span className="text-[10px] text-zinc-400">Faster</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <Button variant="primary" onClick={saveVoice} disabled={savingVoice} className="w-full">
              {savingVoice ? 'Saving…' : 'Save voice settings'}
            </Button>
          </CardBody>
        </Card>
      </div>

      {/* ── Alerts ──────────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <SectionTitle>Alerts</SectionTitle>

        {/* Anomaly detection */}
        <Card className="mb-3">
          <CardBody className="pt-4 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {anomaly.enabled
                  ? <Bell size={17} className="text-amber-500" />
                  : <BellOff size={17} className="text-zinc-400" />}
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Anomaly detection</p>
                  <p className="text-xs text-zinc-400">Lights on when away, doors left open…</p>
                </div>
              </div>
              <Toggle
                checked={!!anomaly.enabled}
                onCheckedChange={(v) => setAnomaly((s) => ({ ...s, enabled: v }))}
              />
            </div>

            <AnimatePresence>
              {anomaly.enabled && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-3">Quiet hours</p>
                    <div className="flex items-end gap-3">
                      <div className="flex-1 flex flex-col gap-1.5">
                        <label className="text-xs text-zinc-500">From</label>
                        <input
                          type="number"
                          min={0}
                          max={23}
                          value={anomaly.quiet_hour_start ?? 23}
                          onChange={(e) =>
                            setAnomaly((s) => ({ ...s, quiet_hour_start: Number(e.target.value) }))
                          }
                          className={cn(
                            'h-10 rounded-xl px-3 text-sm text-center w-full',
                            'bg-zinc-50 dark:bg-zinc-800',
                            'border border-zinc-200 dark:border-zinc-700',
                            'text-zinc-900 dark:text-zinc-100',
                            'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent'
                          )}
                        />
                      </div>
                      <span className="text-zinc-400 pb-2.5">→</span>
                      <div className="flex-1 flex flex-col gap-1.5">
                        <label className="text-xs text-zinc-500">To</label>
                        <input
                          type="number"
                          min={0}
                          max={23}
                          value={anomaly.quiet_hour_end ?? 7}
                          onChange={(e) =>
                            setAnomaly((s) => ({ ...s, quiet_hour_end: Number(e.target.value) }))
                          }
                          className={cn(
                            'h-10 rounded-xl px-3 text-sm text-center w-full',
                            'bg-zinc-50 dark:bg-zinc-800',
                            'border border-zinc-200 dark:border-zinc-700',
                            'text-zinc-900 dark:text-zinc-100',
                            'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent'
                          )}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-zinc-400 mt-2">Motion alerts suppressed during these hours</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <Button variant="primary" onClick={saveAnomaly} disabled={savingAnomaly} className="w-full">
              {savingAnomaly ? 'Saving…' : 'Save'}
            </Button>
          </CardBody>
        </Card>

        {/* Sensor alert rules */}
        <Card>
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Alert rules</p>
              <p className="text-xs text-zinc-400">Notify when a sensor triggers</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowAddAlert(true)} className="gap-1.5">
              <Plus size={13} />
              Add
            </Button>
          </div>

          {alerts.sensors.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-zinc-400">No alert rules yet</div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {alerts.sensors.map((rule, idx) => (
                <div key={idx} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {rule.label}
                    </p>
                    <p className="text-xs text-zinc-400 truncate">{rule.entity_id}</p>
                  </div>
                  <Badge variant="default" className="text-[10px] shrink-0">
                    → {rule.trigger_state}
                  </Badge>
                  <button
                    onClick={() => handleRemoveAlertRule(idx)}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {alerts.sensors.length > 0 && (
            <div className="px-4 pb-4 pt-2">
              <Button variant="primary" onClick={saveAlerts} disabled={savingAlerts} className="w-full">
                {savingAlerts ? 'Saving…' : 'Save alert rules'}
              </Button>
            </div>
          )}
        </Card>
      </div>

      {/* ── System ──────────────────────────────────────────────────────────── */}
      {sys && (
        <div className="mb-6">
          <SectionTitle>System</SectionTitle>
          <Card>
            <CardBody className="pt-4 flex flex-col gap-4">
              <MetricBar label="CPU" value={Math.round(sys.cpu_percent || 0)} color="bg-blue-500" />
              <MetricBar label="RAM" value={Math.round(sys.ram_percent || 0)} color="bg-violet-500" />
              <MetricBar label="Disk" value={Math.round(sys.disk_percent || 0)} color="bg-emerald-500" />
              <div className="flex items-center gap-3 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <Wifi size={15} className="text-zinc-400" />
                <span className="text-xs text-zinc-500">
                  {status.ws_clients || 0} WebSocket client{status.ws_clients !== 1 ? 's' : ''} connected
                </span>
                <Badge
                  variant={status.ok ? 'success' : 'danger'}
                  className="ml-auto text-[10px]"
                >
                  {status.ok ? 'HA connected' : 'HA offline'}
                </Badge>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Add alert rule modal */}
      <AddAlertModal
        open={showAddAlert}
        onClose={() => setShowAddAlert(false)}
        onAdd={handleAddAlertRule}
      />
    </div>
  )
}
