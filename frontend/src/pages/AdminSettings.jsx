import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shield, RefreshCw, Server, Bot, Key, Wifi, Sliders, Bug,
  Brain, BookMarked, Plus, Trash2, AlertTriangle, Check, Users,
} from 'lucide-react'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Slider } from '../components/ui/Slider'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { useUIStore } from '../stores/uiStore'
import { useAuthStore } from '../stores/authStore'
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
  getUsers, createUser, updateUser, deleteUser,
} from '../lib/api'
import { cn } from '../lib/utils'

// ─── Shared primitives ────────────────────────────────────────────────────────

function SectionTitle({ icon: Icon, children, restart }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
      {Icon && <Icon size={13} style={{ color: 'var(--ink-faint)' }} />}
      <p className="z-eyebrow" style={{ flex: 1 }}>{children}</p>
      {restart && (
        <span style={{ fontSize: 10, color: 'var(--warn)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 3 }}>
          <AlertTriangle size={10} />
          Restart required
        </span>
      )}
    </div>
  )
}

function SettingRow({ label, subtitle, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{label}</p>
        {subtitle && <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</p>}
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
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <p style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{label}</p>
        <div style={{ display: 'flex', gap: 6 }}>
          <input autoFocus type="password" placeholder={placeholder || 'Enter new value…'} value={value} onChange={e => setValue(e.target.value)} onKeyDown={handleKeyDown} className="z-input" style={{ flex: 1, height: 36, padding: '0 12px', fontSize: 13 }} />
          <button onClick={handleSave} disabled={saving} className="z-btn-primary" style={{ padding: '0 12px', borderRadius: 9, height: 36, fontSize: 12 }}>{saving ? '…' : 'Save'}</button>
          <button onClick={() => { setEditing(false); setValue('') }} className="z-btn-secondary" style={{ padding: '0 10px', borderRadius: 9, height: 36, fontSize: 12 }}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{label}</p>
        {configured
          ? <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 2, fontFamily: '"IBM Plex Mono", monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{masked}</p>
          : <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }}>{subtitle || 'Not configured'}</p>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {configured && <Check size={12} style={{ color: 'var(--ok)' }} />}
        <button onClick={() => setEditing(true)} className="z-btn-secondary" style={{ padding: '5px 10px', borderRadius: 8, fontSize: 12 }}>
          {configured ? 'Update' : 'Set'}
        </button>
      </div>
    </div>
  )
}

// ─── Main component (embeddable in Settings tabs) ────────────────────────────

const ROLE_LABELS = { super_admin: 'Super Admin', admin: 'Admin', user: 'User', guest: 'Guest' }
const ROLE_COLORS = { super_admin: 'var(--accent)', admin: '#8b5cf6', user: 'var(--ok)', guest: 'var(--ink-faint)' }

export default function AdminSettings() {
  const { addToast } = useUIStore()
  const { role: myRole } = useAuthStore()
  const isSuperAdmin = myRole === 'super_admin'

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

  // Users state (super_admin only)
  const [users, setUsers] = useState([])
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' })
  const [usersSaving, setUsersSaving] = useState(false)

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
    if (isSuperAdmin) {
      try { setUsers(await getUsers()) } catch {}
    }
  }

  useEffect(() => { loadAll().finally(() => setLoading(false)) }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadAll()
    setRefreshing(false)
  }

  // User management handlers
  const handleCreateUser = async () => {
    if (!newUser.username.trim() || !newUser.password.trim()) return
    setUsersSaving(true)
    try {
      await createUser(newUser)
      setUsers(await getUsers())
      setNewUser({ username: '', password: '', role: 'user' })
      addToast(`User "${newUser.username}" created`, 'success')
    } catch (e) { addToast(e.message || 'Failed to create user', 'error') }
    finally { setUsersSaving(false) }
  }

  const handleUpdateRole = async (username, role) => {
    try {
      await updateUser(username, { role })
      setUsers((prev) => prev.map((u) => u.username === username ? { ...u, role } : u))
      addToast('Role updated', 'success')
    } catch (e) { addToast(e.message || 'Failed to update role', 'error') }
  }

  const handleDeleteUser = async (username) => {
    if (!window.confirm(`Delete user "${username}"?`)) return
    try {
      await deleteUser(username)
      setUsers((prev) => prev.filter((u) => u.username !== username))
      addToast(`User "${username}" deleted`, 'success')
    } catch (e) { addToast(e.message || 'Failed to delete user', 'error') }
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160 }}>
        <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  return (
    <div>
      {/* Inline toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <p style={{ fontSize: 11, color: 'var(--ink-faint)' }}>Some changes require restarting Ziggy.</p>
        <button onClick={handleRefresh} disabled={refreshing} style={{ background: 'transparent', border: '0.5px solid var(--line)', borderRadius: 8, color: 'var(--ink-faint)', padding: 7, cursor: 'pointer' }}>
          <RefreshCw size={13} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      {/* ── Users (super_admin only) ────────────────────────────────────────── */}
      {isSuperAdmin && (
        <div style={{ marginBottom: 22 }}>
          <SectionTitle icon={Users}>Users</SectionTitle>
          <Card>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {users.map((u) => (
                <div key={u.username} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px' }}>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</span>
                  <select
                    value={u.role}
                    onChange={(e) => handleUpdateRole(u.username, e.target.value)}
                    style={{ fontSize: 11, padding: '3px 6px', borderRadius: 7, border: '0.5px solid var(--line)', background: 'var(--surface)', color: ROLE_COLORS[u.role] || 'var(--ink)', fontWeight: 600, cursor: 'pointer' }}
                  >
                    {Object.entries(ROLE_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleDeleteUser(u.username)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, borderRadius: 6, display: 'flex' }}
                    title="Delete user"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}

              {/* Add new user */}
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 2 }}>Add user</p>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    placeholder="Username"
                    value={newUser.username}
                    onChange={(e) => setNewUser((s) => ({ ...s, username: e.target.value }))}
                    className="z-input"
                    style={{ flex: 2, height: 34, padding: '0 10px', fontSize: 12 }}
                  />
                  <input
                    type="password"
                    placeholder="Password"
                    value={newUser.password}
                    onChange={(e) => setNewUser((s) => ({ ...s, password: e.target.value }))}
                    className="z-input"
                    style={{ flex: 2, height: 34, padding: '0 10px', fontSize: 12 }}
                  />
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser((s) => ({ ...s, role: e.target.value }))}
                    style={{ height: 34, padding: '0 6px', borderRadius: 9, border: '0.5px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 12, cursor: 'pointer' }}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="guest">Guest</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                  <button
                    onClick={handleCreateUser}
                    disabled={usersSaving || !newUser.username.trim() || !newUser.password.trim()}
                    className="z-btn-primary"
                    style={{ height: 34, padding: '0 12px', borderRadius: 9, fontSize: 12, whiteSpace: 'nowrap' }}
                  >
                    {usersSaving ? '…' : 'Add'}
                  </button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ── Home Assistant ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Server} restart>Home Assistant</SectionTitle>
        <Card>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {/* URL */}
            <div className="px-4 py-3">
              <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 6 }}>URL</p>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={ha.url} onChange={e => setHa(s => ({ ...s, url: e.target.value }))} placeholder="http://homeassistant.local:8123/" className="z-input" style={{ flex: 1, height: 36, padding: '0 12px', fontSize: 13 }} />
                <button onClick={() => save('ha-url', patchHaSettings, { url: ha.url })} disabled={saving['ha-url']} className="z-btn-primary" style={{ padding: '0 12px', borderRadius: 9, height: 36, fontSize: 12 }}>
                  {saving['ha-url'] ? '…' : 'Save'}
                </button>
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
      <div style={{ marginBottom: 22 }}>
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
      <div style={{ marginBottom: 22 }}>
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
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Wifi} restart>MQTT</SectionTitle>
        <Card>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
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
          </div>

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
      <div style={{ marginBottom: 22 }}>
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
      <div style={{ marginBottom: 22 }}>
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
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Brain}>Ollama (Local LLM)</SectionTitle>
        <Card>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
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
          </div>
        </Card>
      </div>

      {/* ── Pattern Learning ────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Sliders}>Pattern Learning</SectionTitle>
        <Card>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
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
          </div>
        </Card>
      </div>

      {/* ── Room Aliases ────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
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
