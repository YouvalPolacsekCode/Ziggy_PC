import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shield, RefreshCw, Server, Bot, Key, Wifi, Sliders, Bug,
  Brain, BookMarked, Plus, Trash2, AlertTriangle, Check,
} from 'lucide-react'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Slider } from '../components/ui/Slider'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { useUIStore } from '../stores/uiStore'
import {
  getHaSettings, patchHaSettings,
  getTelegramSettings, patchTelegramSettings,
  getIntegrationsSettings, patchIntegrationsSettings,
  getMqttSettings, patchMqttSettings,
  getFeaturesSettings, patchFeaturesSettings,
  getDebugSettings, patchDebugSettings,
  getOllamaSettings, patchOllamaSettings,
  getPatternLearningSettings, patchPatternLearningSettings,
  getRoomAliases, patchRoomAliases,
} from '../lib/api'
import { cn } from '../lib/utils'

// ─── Shared primitives ────────────────────────────────────────────────────────

function SectionTitle({ icon: Icon, children, restart }) {
  return (
    <div className="flex items-center gap-2 mb-3 px-1">
      {Icon && <Icon size={14} className="text-zinc-400" />}
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 flex-1">
        {children}
      </h2>
      {restart && (
        <span className="text-[10px] text-amber-500 font-medium flex items-center gap-1">
          <AlertTriangle size={10} />
          Restart required
        </span>
      )}
    </div>
  )
}

function SettingRow({ label, subtitle, children }) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5 gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</p>
        {subtitle && <p className="text-xs text-zinc-400 truncate">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

// ─── Secret field — masked display + inline edit ──────────────────────────────

function SecretField({ label, subtitle, masked, configured, onSave, onRefresh, placeholder }) {
  const { addToast } = useUIStore()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    const trimmed = value.trim()
    if (!trimmed) { setEditing(false); return }
    setSaving(true)
    try {
      await onSave(trimmed)
      addToast('Saved', 'success')
      onRefresh?.()
      setEditing(false)
      setValue('')
    } catch { addToast('Failed to save', 'error') }
    finally { setSaving(false) }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') { setEditing(false); setValue('') }
  }

  if (editing) {
    return (
      <div className="px-4 py-3 flex flex-col gap-2">
        <p className="text-xs text-zinc-500">{label}</p>
        <div className="flex gap-2">
          <input
            autoFocus
            type="password"
            placeholder={placeholder || 'Enter new value…'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className={cn(
              'flex-1 h-9 rounded-xl px-3 text-sm',
              'bg-zinc-50 dark:bg-zinc-800',
              'border border-zinc-200 dark:border-zinc-700',
              'text-zinc-900 dark:text-zinc-100',
              'placeholder:text-zinc-400 dark:placeholder:text-zinc-600',
              'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent',
            )}
          />
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? '…' : 'Save'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setValue('') }}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between px-4 py-3.5 gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</p>
        {configured ? (
          <p className="text-xs font-mono text-zinc-400 truncate">{masked}</p>
        ) : (
          <p className="text-xs text-zinc-400">{subtitle || 'Not configured'}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {configured && <Check size={13} className="text-emerald-500" />}
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          {configured ? 'Update' : 'Set'}
        </Button>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminSettings() {
  const { addToast } = useUIStore()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Section state
  const [ha, setHa] = useState({ url: '', token_masked: '', token_configured: false })
  const [telegram, setTelegram] = useState({ enabled: false, token_masked: '', token_configured: false, allowed_users: [], default_chat_id: null })
  const [integrations, setIntegrations] = useState({})
  const [mqtt, setMqtt] = useState({ host: '', port: 1883, username: '', password: '', password_configured: false })
  const [features, setFeatures] = useState({})
  const [debug, setDebug] = useState({})
  const [ollama, setOllama] = useState({ base_url: '', model: '', timeout: 30 })
  const [patternLearning, setPatternLearning] = useState({})
  const [aliases, setAliases] = useState({ en: {}, he: {} })

  // Per-section saving
  const [saving, setSaving] = useState({})
  const setSav = (key, val) => setSaving((s) => ({ ...s, [key]: val }))

  // Room alias editor state
  const [newAlias, setNewAlias] = useState({ alias: '', room: '' })
  const [aliasFilter, setAliasFilter] = useState('')

  const loadAll = async () => {
    try {
      const [h, tg, integ, mq, feat, dbg, ol, pl, al] = await Promise.all([
        getHaSettings(),
        getTelegramSettings(),
        getIntegrationsSettings(),
        getMqttSettings(),
        getFeaturesSettings(),
        getDebugSettings(),
        getOllamaSettings(),
        getPatternLearningSettings(),
        getRoomAliases(),
      ])
      setHa(h)
      setTelegram({ ...tg, allowed_users: tg.allowed_users || [] })
      setIntegrations(integ)
      setMqtt({ ...mq, password: '' })
      setFeatures(feat)
      setDebug(dbg)
      setOllama(ol)
      setPatternLearning({ enabled: true, llm_synthesis: true, analysis_hour: 9, lookback_days: 30, min_occurrences: 5, max_pending_suggestions: 3, time_window_minutes: 45, sequence_gap_minutes: 5, ...pl })
      setAliases({ en: al?.en || {}, he: al?.he || {} })
    } catch {}
  }

  useEffect(() => { loadAll().finally(() => setLoading(false)) }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadAll()
    setRefreshing(false)
  }

  // Generic section save helper
  const save = async (key, apiFn, payload) => {
    setSav(key, true)
    try {
      await apiFn(payload)
      addToast('Saved', 'success')
    } catch { addToast('Failed to save', 'error') }
    finally { setSav(key, false) }
  }

  // Telegram: allowed users
  const addAllowedUser = () => {
    const id = parseInt(window.prompt('Enter Telegram user ID:'), 10)
    if (!isNaN(id)) setTelegram((s) => ({ ...s, allowed_users: [...s.allowed_users, id] }))
  }
  const removeAllowedUser = (id) => setTelegram((s) => ({ ...s, allowed_users: s.allowed_users.filter((u) => u !== id) }))

  // Room aliases
  const addAlias = () => {
    const { alias, room } = newAlias
    if (!alias.trim() || !room.trim()) return
    setAliases((s) => ({ ...s, en: { ...s.en, [alias.trim().toLowerCase()]: room.trim() } }))
    setNewAlias({ alias: '', room: '' })
  }
  const removeAlias = (key) => setAliases((s) => { const en = { ...s.en }; delete en[key]; return { ...s, en } })
  const saveAliases = () => save('aliases', patchRoomAliases, { en: aliases.en, he: aliases.he })

  const filteredAliases = Object.entries(aliases.en).filter(([k, v]) => {
    const q = aliasFilter.toLowerCase()
    return !q || k.includes(q) || v.includes(q)
  })

  const FEATURE_LABELS = {
    smart_home: { label: 'Smart home', subtitle: 'Device control & HA integration' },
    voice: { label: 'Voice assistant', subtitle: 'Microphone, wake word & TTS' },
    telegram: { label: 'Telegram bot', subtitle: 'Remote control via Telegram' },
    task_tracking: { label: 'Task tracking', subtitle: 'Tasks & reminders' },
    file_management: { label: 'File management', subtitle: 'Create & manage local files' },
    home_map: { label: 'Home Map', subtitle: 'Interactive floor plan in Rooms tab (experimental)' },
    buddy_mode: { label: 'Buddy mode', subtitle: 'Conversational AI personality' },
    ifttt: { label: 'IFTTT', subtitle: 'Webhook triggers' },
    local_storage: { label: 'Local storage', subtitle: 'SQLite / local DB' },
    zigbee_support: { label: 'Zigbee support', subtitle: 'ZHA device pairing' },
  }

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
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <Shield size={20} className="text-amber-500" />
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Admin</h1>
        </div>
        <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw size={16} className={cn(refreshing && 'animate-spin')} />
        </Button>
      </div>
      <p className="text-xs text-zinc-400 mb-6 px-0.5">
        Core configuration. Some changes require restarting Ziggy to take effect.
      </p>

      {/* ── Home Assistant ───────────────────────────────────────────────────── */}
      <div className="mb-6">
        <SectionTitle icon={Server} restart>Home Assistant</SectionTitle>
        <Card>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {/* URL */}
            <div className="px-4 py-3">
              <p className="text-xs text-zinc-500 mb-1.5">URL</p>
              <div className="flex gap-2">
                <input
                  value={ha.url}
                  onChange={(e) => setHa((s) => ({ ...s, url: e.target.value }))}
                  placeholder="http://homeassistant.local:8123/"
                  className={cn(
                    'flex-1 h-9 rounded-xl px-3 text-sm',
                    'bg-zinc-50 dark:bg-zinc-800',
                    'border border-zinc-200 dark:border-zinc-700',
                    'text-zinc-900 dark:text-zinc-100',
                    'placeholder:text-zinc-400',
                    'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent',
                  )}
                />
                <Button
                  size="sm"
                  onClick={() => save('ha-url', patchHaSettings, { url: ha.url })}
                  disabled={saving['ha-url']}
                >
                  {saving['ha-url'] ? '…' : 'Save'}
                </Button>
              </div>
            </div>
            {/* Token */}
            <SecretField
              label="Long-lived token"
              masked={ha.token_masked}
              configured={ha.token_configured}
              placeholder="eyJhbGc…"
              onSave={(v) => patchHaSettings({ token: v })}
              onRefresh={() => getHaSettings().then(setHa)}
            />
          </div>
        </Card>
      </div>

      {/* ── Telegram ────────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <SectionTitle icon={Bot} restart>Telegram</SectionTitle>
        <Card>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {/* Enabled */}
            <SettingRow label="Telegram bot" subtitle="Remote control via Telegram">
              <Toggle
                checked={!!telegram.enabled}
                onCheckedChange={(v) => {
                  const updated = { ...telegram, enabled: v }
                  setTelegram(updated)
                  patchTelegramSettings({ enabled: v }).catch(() => {})
                }}
              />
            </SettingRow>

            {/* Bot token */}
            <SecretField
              label="Bot token"
              masked={telegram.token_masked}
              configured={telegram.token_configured}
              placeholder="8763855823:AAF9…"
              onSave={(v) => patchTelegramSettings({ token: v })}
              onRefresh={() => getTelegramSettings().then(setTelegram)}
            />

            {/* Default chat ID */}
            <div className="px-4 py-3">
              <p className="text-xs text-zinc-500 mb-1.5">Default chat ID</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={telegram.default_chat_id ?? ''}
                  onChange={(e) => setTelegram((s) => ({ ...s, default_chat_id: parseInt(e.target.value) || null }))}
                  placeholder="316341835"
                  className={cn(
                    'flex-1 h-9 rounded-xl px-3 text-sm',
                    'bg-zinc-50 dark:bg-zinc-800',
                    'border border-zinc-200 dark:border-zinc-700',
                    'text-zinc-900 dark:text-zinc-100',
                    'placeholder:text-zinc-400',
                    'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent',
                  )}
                />
                <Button
                  size="sm"
                  onClick={() => save('tg-chat', patchTelegramSettings, { default_chat_id: telegram.default_chat_id })}
                  disabled={saving['tg-chat']}
                >
                  {saving['tg-chat'] ? '…' : 'Save'}
                </Button>
              </div>
            </div>

            {/* Allowed users */}
            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-zinc-500">Allowed user IDs</p>
                <Button size="sm" variant="ghost" onClick={addAllowedUser} className="gap-1">
                  <Plus size={11} /> Add
                </Button>
              </div>
              {telegram.allowed_users.length === 0 ? (
                <p className="text-xs text-zinc-400">No users configured</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {telegram.allowed_users.map((uid) => (
                    <div key={uid} className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg px-2.5 py-1">
                      <span className="text-xs font-mono text-zinc-700 dark:text-zinc-300">{uid}</span>
                      <button onClick={() => removeAllowedUser(uid)} className="text-zinc-400 hover:text-red-500 transition-colors">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {telegram.allowed_users.length > 0 && (
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => save('tg-users', patchTelegramSettings, { allowed_users: telegram.allowed_users })}
                  disabled={saving['tg-users']}
                >
                  {saving['tg-users'] ? 'Saving…' : 'Save allowed users'}
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* ── API Keys ────────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <SectionTitle icon={Key}>API Keys</SectionTitle>
        <Card>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            <SecretField
              label="OpenAI"
              subtitle="Used for intent parsing & AI responses"
              masked={integrations.openai_key_masked}
              configured={integrations.openai_configured}
              placeholder="sk-proj-…"
              onSave={(v) => patchIntegrationsSettings({ openai_key: v })}
              onRefresh={() => getIntegrationsSettings().then(setIntegrations)}
            />
            <SecretField
              label="SerpAPI"
              subtitle="Web search capability"
              masked={integrations.serpapi_key_masked}
              configured={integrations.serpapi_configured}
              placeholder="67b5c8e5…"
              onSave={(v) => patchIntegrationsSettings({ serpapi_key: v })}
              onRefresh={() => getIntegrationsSettings().then(setIntegrations)}
            />
            <SecretField
              label="IFTTT"
              subtitle="Webhook triggers"
              masked={integrations.ifttt_key_masked}
              configured={integrations.ifttt_configured}
              placeholder="Webhook key…"
              onSave={(v) => patchIntegrationsSettings({ ifttt_key: v })}
              onRefresh={() => getIntegrationsSettings().then(setIntegrations)}
            />
          </div>
        </Card>
      </div>

      {/* ── MQTT ────────────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <SectionTitle icon={Wifi} restart>MQTT</SectionTitle>
        <Card>
          <CardBody className="pt-4 flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <p className="text-xs text-zinc-500 mb-1.5">Host</p>
                <input
                  value={mqtt.host}
                  onChange={(e) => setMqtt((s) => ({ ...s, host: e.target.value }))}
                  placeholder="10.100.102.21"
                  className={cn(
                    'w-full h-9 rounded-xl px-3 text-sm',
                    'bg-zinc-50 dark:bg-zinc-800',
                    'border border-zinc-200 dark:border-zinc-700',
                    'text-zinc-900 dark:text-zinc-100',
                    'placeholder:text-zinc-400',
                    'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent',
                  )}
                />
              </div>
              <div>
                <p className="text-xs text-zinc-500 mb-1.5">Port</p>
                <input
                  type="number"
                  value={mqtt.port}
                  onChange={(e) => setMqtt((s) => ({ ...s, port: parseInt(e.target.value) || 1883 }))}
                  className={cn(
                    'w-full h-9 rounded-xl px-3 text-sm',
                    'bg-zinc-50 dark:bg-zinc-800',
                    'border border-zinc-200 dark:border-zinc-700',
                    'text-zinc-900 dark:text-zinc-100',
                    'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent',
                  )}
                />
              </div>
            </div>
            <Input
              label="Username"
              placeholder="ziggy"
              value={mqtt.username}
              onChange={(e) => setMqtt((s) => ({ ...s, username: e.target.value }))}
            />
            <Button
              variant="primary"
              onClick={() => save('mqtt', patchMqttSettings, { host: mqtt.host, port: mqtt.port, username: mqtt.username })}
              disabled={saving['mqtt']}
              className="w-full"
            >
              {saving['mqtt'] ? 'Saving…' : 'Save connection'}
            </Button>
          </CardBody>

          <div className="border-t border-zinc-100 dark:border-zinc-800">
            <SecretField
              label="Password"
              masked={mqtt.password_masked}
              configured={mqtt.password_configured}
              placeholder="MQTT password…"
              onSave={(v) => patchMqttSettings({ password: v })}
              onRefresh={() => getMqttSettings().then((m) => setMqtt({ ...m, password: '' }))}
            />
          </div>
        </Card>
      </div>

      {/* ── Feature Flags ───────────────────────────────────────────────────── */}
      <div className="mb-6">
        <SectionTitle icon={Sliders} restart>Feature Flags</SectionTitle>
        <Card>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {Object.entries(FEATURE_LABELS).map(([key, { label, subtitle }]) => (
              <SettingRow key={key} label={label} subtitle={subtitle}>
                <Toggle
                  checked={!!features[key]}
                  onCheckedChange={(v) => {
                    setFeatures((s) => ({ ...s, [key]: v }))
                    patchFeaturesSettings({ [key]: v }).catch(() => {})
                  }}
                />
              </SettingRow>
            ))}
          </div>
        </Card>
      </div>

      {/* ── Debug ───────────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <SectionTitle icon={Bug}>Debug</SectionTitle>
        <Card>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            <SettingRow label="Verbose logging" subtitle="Log all intent parsing steps">
              <Toggle
                checked={!!debug.verbose_logging}
                onCheckedChange={(v) => {
                  setDebug((s) => ({ ...s, verbose_logging: v }))
                  patchDebugSettings({ verbose_logging: v }).catch(() => {})
                }}
              />
            </SettingRow>
            <SettingRow label="Verbose mode" subtitle="Extra console output">
              <Toggle
                checked={!!debug.verbose}
                onCheckedChange={(v) => {
                  setDebug((s) => ({ ...s, verbose: v }))
                  patchDebugSettings({ verbose: v }).catch(() => {})
                }}
              />
            </SettingRow>
          </div>
        </Card>
      </div>

      {/* ── Ollama ──────────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <SectionTitle icon={Brain}>Ollama (Local LLM)</SectionTitle>
        <Card>
          <CardBody className="pt-4 flex flex-col gap-3">
            <Input
              label="Base URL"
              placeholder="http://localhost:11434/v1"
              value={ollama.base_url || ''}
              onChange={(e) => setOllama((s) => ({ ...s, base_url: e.target.value }))}
            />
            <Input
              label="Model"
              placeholder="qwen2.5:3b"
              value={ollama.model || ''}
              onChange={(e) => setOllama((s) => ({ ...s, model: e.target.value }))}
            />
            <div>
              <p className="text-xs text-zinc-500 mb-1.5">Timeout (seconds)</p>
              <input
                type="number"
                min={5}
                max={300}
                value={ollama.timeout || 30}
                onChange={(e) => setOllama((s) => ({ ...s, timeout: parseInt(e.target.value) || 30 }))}
                className={cn(
                  'w-full h-9 rounded-xl px-3 text-sm',
                  'bg-zinc-50 dark:bg-zinc-800',
                  'border border-zinc-200 dark:border-zinc-700',
                  'text-zinc-900 dark:text-zinc-100',
                  'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent',
                )}
              />
            </div>
            <Button
              variant="primary"
              onClick={() => save('ollama', patchOllamaSettings, ollama)}
              disabled={saving['ollama']}
              className="w-full"
            >
              {saving['ollama'] ? 'Saving…' : 'Save'}
            </Button>
          </CardBody>
        </Card>
      </div>

      {/* ── Pattern Learning ────────────────────────────────────────────────── */}
      <div className="mb-6">
        <SectionTitle icon={Sliders}>Pattern Learning</SectionTitle>
        <Card>
          <CardBody className="pt-4 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Enabled</p>
                <p className="text-xs text-zinc-400">Detect behavioral patterns from events</p>
              </div>
              <Toggle
                checked={!!patternLearning.enabled}
                onCheckedChange={(v) => setPatternLearning((s) => ({ ...s, enabled: v }))}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">LLM synthesis</p>
                <p className="text-xs text-zinc-400">Use AI to generate suggestions from patterns</p>
              </div>
              <Toggle
                checked={!!patternLearning.llm_synthesis}
                onCheckedChange={(v) => setPatternLearning((s) => ({ ...s, llm_synthesis: v }))}
              />
            </div>

            <div className="pt-1 border-t border-zinc-100 dark:divide-zinc-800">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">Analysis hour</p>
                <span className="text-xs font-semibold text-zinc-500">{patternLearning.analysis_hour ?? 9}:00</span>
              </div>
              <Slider
                value={patternLearning.analysis_hour ?? 9}
                onValueChange={(v) => setPatternLearning((s) => ({ ...s, analysis_hour: v }))}
                min={0}
                max={23}
              />
              <p className="text-[10px] text-zinc-400 mt-1">Daily analysis runs at this hour</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">Lookback days</p>
                <span className="text-xs font-semibold text-zinc-500">{patternLearning.lookback_days ?? 30}d</span>
              </div>
              <Slider
                value={patternLearning.lookback_days ?? 30}
                onValueChange={(v) => setPatternLearning((s) => ({ ...s, lookback_days: v }))}
                min={7}
                max={90}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">Min occurrences</p>
                <span className="text-xs font-semibold text-zinc-500">{patternLearning.min_occurrences ?? 5}×</span>
              </div>
              <Slider
                value={patternLearning.min_occurrences ?? 5}
                onValueChange={(v) => setPatternLearning((s) => ({ ...s, min_occurrences: v }))}
                min={2}
                max={20}
              />
              <p className="text-[10px] text-zinc-400 mt-1">Minimum times a pattern must repeat</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">Max pending suggestions</p>
                <span className="text-xs font-semibold text-zinc-500">{patternLearning.max_pending_suggestions ?? 3}</span>
              </div>
              <Slider
                value={patternLearning.max_pending_suggestions ?? 3}
                onValueChange={(v) => setPatternLearning((s) => ({ ...s, max_pending_suggestions: v }))}
                min={1}
                max={10}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">Time window</p>
                <span className="text-xs font-semibold text-zinc-500">{patternLearning.time_window_minutes ?? 45}min</span>
              </div>
              <Slider
                value={patternLearning.time_window_minutes ?? 45}
                onValueChange={(v) => setPatternLearning((s) => ({ ...s, time_window_minutes: v }))}
                min={15}
                max={120}
              />
              <p className="text-[10px] text-zinc-400 mt-1">Events within this window are grouped</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">Sequence gap</p>
                <span className="text-xs font-semibold text-zinc-500">{patternLearning.sequence_gap_minutes ?? 5}min</span>
              </div>
              <Slider
                value={patternLearning.sequence_gap_minutes ?? 5}
                onValueChange={(v) => setPatternLearning((s) => ({ ...s, sequence_gap_minutes: v }))}
                min={1}
                max={60}
              />
            </div>

            <Button
              variant="primary"
              onClick={() => save('pl', patchPatternLearningSettings, patternLearning)}
              disabled={saving['pl']}
              className="w-full"
            >
              {saving['pl'] ? 'Saving…' : 'Save'}
            </Button>
          </CardBody>
        </Card>
      </div>

      {/* ── Room Aliases ────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <SectionTitle icon={BookMarked}>Room Aliases</SectionTitle>
        <Card>
          {/* Search + Add */}
          <div className="px-4 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800 flex flex-col gap-3">
            <input
              value={aliasFilter}
              onChange={(e) => setAliasFilter(e.target.value)}
              placeholder="Search aliases…"
              className={cn(
                'w-full h-9 rounded-xl px-3 text-sm',
                'bg-zinc-50 dark:bg-zinc-800',
                'border border-zinc-200 dark:border-zinc-700',
                'text-zinc-900 dark:text-zinc-100',
                'placeholder:text-zinc-400',
                'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent',
              )}
            />
            <div className="flex gap-2">
              <input
                value={newAlias.alias}
                onChange={(e) => setNewAlias((s) => ({ ...s, alias: e.target.value }))}
                placeholder="Alias (e.g. lounge)"
                className={cn(
                  'flex-1 h-9 rounded-xl px-3 text-sm',
                  'bg-zinc-50 dark:bg-zinc-800',
                  'border border-zinc-200 dark:border-zinc-700',
                  'text-zinc-900 dark:text-zinc-100',
                  'placeholder:text-zinc-400',
                  'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent',
                )}
              />
              <input
                value={newAlias.room}
                onChange={(e) => setNewAlias((s) => ({ ...s, room: e.target.value }))}
                placeholder="Room ID (e.g. living_room)"
                className={cn(
                  'flex-1 h-9 rounded-xl px-3 text-sm',
                  'bg-zinc-50 dark:bg-zinc-800',
                  'border border-zinc-200 dark:border-zinc-700',
                  'text-zinc-900 dark:text-zinc-100',
                  'placeholder:text-zinc-400',
                  'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent',
                )}
              />
              <Button size="sm" onClick={addAlias}>
                <Plus size={13} />
              </Button>
            </div>
          </div>

          {/* Alias list */}
          <div className="max-h-72 overflow-y-auto">
            {filteredAliases.length === 0 ? (
              <p className="text-xs text-zinc-400 text-center py-6">No aliases found</p>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredAliases.map(([alias, room]) => (
                  <div key={alias} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-300 truncate">{alias}</span>
                    <span className="text-zinc-300 dark:text-zinc-600 text-xs">→</span>
                    <Badge variant="default" className="text-[10px] shrink-0">{room}</Badge>
                    <button
                      onClick={() => removeAlias(alias)}
                      className="p-1 text-zinc-400 hover:text-red-500 transition-colors shrink-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-800">
            <Button variant="primary" onClick={saveAliases} disabled={saving['aliases']} className="w-full">
              {saving['aliases'] ? 'Saving…' : `Save aliases (${Object.keys(aliases.en).length})`}
            </Button>
          </div>
        </Card>
      </div>

    </div>
  )
}
