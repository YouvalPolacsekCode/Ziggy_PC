import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sun, Moon, User, Lock, LogOut, Mic, MicOff, RefreshCw,
  Plus, Trash2, Wifi, Shield, Users,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
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
  getGeneralSettings, patchGeneralSettings,
  getAuthStatus, changePassword,
  getUsers, createUser, updateUser, deleteUser,
} from '../lib/api'
import AdminSettings from './AdminSettings'

const TIMEZONES = [
  'UTC', 'Asia/Jerusalem', 'Europe/London', 'Europe/Paris',
  'Europe/Berlin', 'America/New_York', 'America/Chicago',
  'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney',
]
const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'he', label: 'עברית (Hebrew)' },
]

const ROLE_LABELS = {
  super_admin: { label: 'Super Admin', color: 'var(--warn)' },
  admin:       { label: 'Admin',       color: 'var(--accent)' },
  user:        { label: 'User',        color: 'var(--ok)' },
  guest:       { label: 'Guest',       color: 'var(--ink-faint)' },
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function SectionTitle({ children }) {
  return <p className="z-eyebrow" style={{ marginBottom: 10, paddingLeft: 2 }}>{children}</p>
}

function SettingRow({ icon: Icon, label, subtitle, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {Icon && <Icon size={16} style={{ flexShrink: 0, color: 'var(--ink-faint)' }} />}
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{label}</p>
          {subtitle && <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

const METRIC_COLORS = { CPU: 'var(--info)', RAM: 'var(--accent)', Disk: 'var(--ok)' }

function MetricBar({ label, value }) {
  const tint = METRIC_COLORS[label] || 'var(--info)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', fontFamily: '"IBM Plex Mono", monospace' }}>{value}%</span>
      </div>
      <div style={{ height: 4, background: 'var(--bg-2)', borderRadius: 999, overflow: 'hidden' }}>
        <motion.div
          style={{ height: '100%', borderRadius: 999, background: tint }}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}

// ─── Add User Modal ───────────────────────────────────────────────────────────

function AddUserModal({ open, onClose, onAdd }) {
  const [form, setForm] = useState({ username: '', password: '', role: 'user' })
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const { addToast } = useUIStore()

  const handleSubmit = async () => {
    if (!form.username.trim()) { setErr('Username required'); return }
    if (form.password.length < 4) { setErr('Password must be at least 4 characters'); return }
    setSaving(true)
    try {
      const user = await createUser({ username: form.username.trim(), password: form.password, role: form.role })
      addToast(`User '${user.username}' created`, 'success')
      onAdd(user)
      setForm({ username: '', password: '', role: 'user' })
      setErr(''); onClose()
    } catch (e) {
      setErr(e.message || 'Failed to create user')
    } finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add User">
      <div className="flex flex-col gap-4">
        <Input
          label="Username" placeholder="jane"
          value={form.username}
          onChange={(e) => { setForm((s) => ({ ...s, username: e.target.value })); setErr('') }}
        />
        <Input
          label="Password" type="password" placeholder="••••••••"
          value={form.password}
          onChange={(e) => { setForm((s) => ({ ...s, password: e.target.value })); setErr('') }}
        />
        <Select
          label="Role"
          value={form.role}
          onChange={(e) => setForm((s) => ({ ...s, role: e.target.value }))}
          options={[
            { value: 'user',        label: 'User — device control, tasks, automations' },
            { value: 'admin',       label: 'Admin — plus feature flags & room aliases' },
            { value: 'super_admin', label: 'Super Admin — full system access' },
            { value: 'guest',       label: 'Guest — read-only' },
          ]}
        />
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex gap-3 pt-1">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button variant="primary" className="flex-1" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Creating…' : 'Create user'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Users panel (super_admin only) ──────────────────────────────────────────

function UsersPanel({ currentUsername }) {
  const { addToast } = useUIStore()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [updatingRole, setUpdatingRole] = useState(null)

  const load = async () => {
    try { setUsers(await getUsers()) } catch {}
  }

  useEffect(() => { load().finally(() => setLoading(false)) }, [])

  const handleDelete = async (username) => {
    if (!window.confirm(`Delete user '${username}'? This cannot be undone.`)) return
    setDeleting(username)
    try {
      await deleteUser(username)
      setUsers((u) => u.filter((x) => x.username !== username))
      addToast(`User '${username}' deleted`, 'success')
    } catch (e) { addToast(e.message || 'Failed to delete', 'error') }
    finally { setDeleting(null) }
  }

  const handleRoleChange = async (username, role) => {
    setUpdatingRole(username)
    try {
      await updateUser(username, { role })
      setUsers((u) => u.map((x) => x.username === username ? { ...x, role } : x))
      addToast('Role updated', 'success')
    } catch (e) { addToast(e.message || 'Failed to update role', 'error') }
    finally { setUpdatingRole(null) }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120 }}>
        <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingLeft: 2 }}>
          <p className="z-eyebrow">Users</p>
          <Button size="sm" variant="ghost" onClick={() => setShowAdd(true)} className="gap-1">
            <Plus size={12} /> Add user
          </Button>
        </div>
        <Card>
          {users.length === 0 ? (
            <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-faint)', padding: '24px 0' }}>No users found</p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {users.map((u) => {
                const roleInfo = ROLE_LABELS[u.role] || ROLE_LABELS.user
                const isSelf = u.username.toLowerCase() === currentUsername?.toLowerCase()
                return (
                  <div key={u.username} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                    <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <User size={14} style={{ color: 'var(--ink-faint)' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{u.username}</p>
                        {isSelf && (
                          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 999, background: 'var(--bg-2)', color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600 }}>
                            YOU
                          </span>
                        )}
                      </div>
                    </div>

                    {isSelf ? (
                      <span style={{ fontSize: 11, fontWeight: 600, color: roleInfo.color, fontFamily: '"IBM Plex Mono", monospace' }}>
                        {roleInfo.label}
                      </span>
                    ) : (
                      <select
                        value={u.role}
                        disabled={updatingRole === u.username}
                        onChange={(e) => handleRoleChange(u.username, e.target.value)}
                        style={{
                          fontSize: 11, fontWeight: 600, color: roleInfo.color,
                          background: 'var(--bg-2)', border: '0.5px solid var(--line)',
                          borderRadius: 7, padding: '4px 8px', cursor: 'pointer',
                          fontFamily: '"IBM Plex Mono", monospace',
                        }}
                      >
                        {Object.entries(ROLE_LABELS).map(([val, { label }]) => (
                          <option key={val} value={val}>{label}</option>
                        ))}
                      </select>
                    )}

                    {!isSelf && (
                      <button
                        onClick={() => handleDelete(u.username)}
                        disabled={deleting === u.username}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, borderRadius: 6, flexShrink: 0 }}
                        className="hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      <AddUserModal open={showAdd} onClose={() => setShowAdd(false)} onAdd={(u) => setUsers((prev) => [...prev, u])} />
    </div>
  )
}

// ─── Tab bar ─────────────────────────────────────────────────────────────────

const ROLE_ORDER_FE = { guest: 0, user: 1, admin: 2, super_admin: 3 }

function hasRole(userRole, minRole) {
  return (ROLE_ORDER_FE[userRole] ?? 0) >= (ROLE_ORDER_FE[minRole] ?? 999)
}

function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: '0.5px solid var(--line)' }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '8px 14px', fontSize: 13, fontWeight: 500,
            color: active === tab.id ? 'var(--ink)' : 'var(--ink-faint)',
            borderBottom: active === tab.id ? '2px solid var(--ink)' : '2px solid transparent',
            marginBottom: -1, transition: 'color 0.12s',
            display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'inherit',
          }}
        >
          {tab.icon && <tab.icon size={13} />}
          {tab.label}
        </button>
      ))}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Settings() {
  const { theme, toggleTheme, addToast } = useUIStore()
  const { logout, role, setRole } = useAuthStore()

  const [loading, setLoading]     = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState('general')

  const [status, setStatus]   = useState(null)
  const [username, setUsername] = useState('')

  const [general, setGeneral]   = useState({ language: 'en', timezone: 'UTC' })
  const [savingGeneral, setSavingGeneral] = useState(false)

  const [voice, setVoice]       = useState({})
  const [savingVoice, setSavingVoice] = useState(false)

  const [showChangePw, setShowChangePw] = useState(false)
  const [pwForm, setPwForm]   = useState({ username: '', password: '', confirm: '' })
  const [pwError, setPwError] = useState('')
  const [savingPw, setSavingPw] = useState(false)

  const isAdmin      = hasRole(role, 'admin')
  const isSuperAdmin = hasRole(role, 'super_admin')

  const TABS = [
    { id: 'general', label: 'General' },
    ...(isAdmin      ? [{ id: 'admin', label: 'Admin',  icon: Shield }] : []),
    ...(isSuperAdmin ? [{ id: 'users', label: 'Users',  icon: Users  }] : []),
  ]

  const loadAll = () => {
    getStatus().then(setStatus).catch(() => {})
    getVoiceSettings().then(v => setVoice(v || {})).catch(() => {})
    getGeneralSettings().then(g => setGeneral({ language: 'en', timezone: 'UTC', ...g })).catch(() => {})
    getAuthStatus().then(auth => {
      setUsername(auth?.username || '')
      setPwForm(f => ({ ...f, username: auth?.username || '' }))
      if (auth?.role) setRole(auth.role)
    }).catch(() => {})
  }

  useEffect(() => { loadAll() }, [])

  const handleRefresh = () => {
    setRefreshing(true)
    loadAll()
    setTimeout(() => setRefreshing(false), 1000)
  }

  const saveGeneral = async () => {
    setSavingGeneral(true)
    try { await patchGeneralSettings(general); addToast('Saved', 'success') }
    catch { addToast('Failed to save', 'error') }
    finally { setSavingGeneral(false) }
  }

  const saveVoice = async () => {
    setSavingVoice(true)
    try { await patchVoiceSettings(voice); addToast('Voice settings saved', 'success') }
    catch { addToast('Failed to save', 'error') }
    finally { setSavingVoice(false) }
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
    } catch (e) { setPwError(e.message || 'Failed to update password') }
    finally { setSavingPw(false) }
  }

  const sys = status?.system

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 20px 48px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>System · local</p>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}>Settings</h1>
        </div>
        {activeTab === 'general' && (
          <button onClick={handleRefresh} disabled={refreshing} style={{ background: 'transparent', border: '0.5px solid var(--line)', borderRadius: 8, color: 'var(--ink-faint)', padding: 7, cursor: 'pointer' }}>
            <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        )}
      </div>

      {/* Tabs — only shown when admin/super_admin tabs are available */}
      {TABS.length > 1 && <TabBar tabs={TABS} active={activeTab} onChange={setActiveTab} />}

      {/* ── General tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'general' && (
        <>
          {/* Appearance */}
          <div style={{ marginBottom: 22 }}>
            <SectionTitle>Appearance</SectionTitle>
            <Card>
              <SettingRow icon={theme === 'dark' ? Moon : Sun} label={theme === 'dark' ? 'Dark mode' : 'Light mode'} subtitle="Switch app theme">
                <Toggle checked={theme === 'dark'} onCheckedChange={toggleTheme} />
              </SettingRow>
            </Card>
          </div>

          {/* Language & Region */}
          <div style={{ marginBottom: 22 }}>
            <SectionTitle>Language & Region</SectionTitle>
            <Card>
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Select label="Language" value={general.language} onChange={(e) => setGeneral((s) => ({ ...s, language: e.target.value }))} options={LANGUAGES} />
                <Select label="Timezone" value={general.timezone} onChange={(e) => setGeneral((s) => ({ ...s, timezone: e.target.value }))} options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))} />
                <button onClick={saveGeneral} disabled={savingGeneral} className="z-btn-primary" style={{ width: '100%' }}>
                  {savingGeneral ? 'Saving…' : 'Save'}
                </button>
              </div>
            </Card>
          </div>

          {/* Account */}
          <div style={{ marginBottom: 22 }}>
            <SectionTitle>Account</SectionTitle>
            <Card>
              <div>
                <SettingRow icon={User} label="Signed in" subtitle={username || 'Local account'}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {role && (
                      <span style={{
                        fontSize: 9.5, padding: '2px 7px', borderRadius: 999,
                        background: 'var(--bg-2)', color: ROLE_LABELS[role]?.color || 'var(--ink-faint)',
                        fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600, textTransform: 'uppercase',
                      }}>
                        {ROLE_LABELS[role]?.label || role}
                      </span>
                    )}
                    <span style={{
                      fontSize: 9.5, padding: '2px 7px', borderRadius: 999,
                      background: 'var(--bg-2)', color: 'var(--ink-faint)',
                      fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600, textTransform: 'uppercase',
                    }}>Local</span>
                  </div>
                </SettingRow>

                <div style={{ borderTop: '0.5px solid var(--line)' }}>
                  <button
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                    onClick={() => { setShowChangePw(v => !v); setPwError('') }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Lock size={16} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
                      <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>Change password</p>
                    </div>
                    <span style={{ color: 'var(--ink-faint)', transform: showChangePw ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                    </span>
                  </button>
                  <AnimatePresence>
                    {showChangePw && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
                        <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <Input label="Username" placeholder="your username" value={pwForm.username} onChange={e => setPwForm(s => ({ ...s, username: e.target.value }))} />
                          <Input label="New password" type="password" placeholder="••••••••" value={pwForm.password} onChange={e => setPwForm(s => ({ ...s, password: e.target.value }))} />
                          <Input label="Confirm password" type="password" placeholder="••••••••" value={pwForm.confirm} onChange={e => setPwForm(s => ({ ...s, confirm: e.target.value }))} error={pwError} />
                          <button onClick={handleChangePassword} disabled={savingPw} className="z-btn-primary" style={{ width: '100%' }}>
                            {savingPw ? 'Saving…' : 'Update password'}
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div style={{ borderTop: '0.5px solid var(--line)' }}>
                  <button onClick={logout} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--accent)' }}>
                    <LogOut size={16} style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 500 }}>Sign out</span>
                  </button>
                </div>
              </div>
            </Card>
          </div>

          {/* Voice */}
          <div style={{ marginBottom: 22 }}>
            <SectionTitle>Voice</SectionTitle>
            <Card>
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Mic size={16} style={{ color: voice.enabled !== false ? 'var(--accent)' : 'var(--ink-faint)' }} />
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>Voice assistant</p>
                      <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }}>Microphone & text-to-speech</p>
                    </div>
                  </div>
                  <Toggle checked={voice.enabled !== false} onCheckedChange={(v) => setVoice((s) => ({ ...s, enabled: v }))} />
                </div>

                <AnimatePresence>
                  {voice.enabled !== false && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ display: 'flex', flexDirection: 'column', gap: 16, overflow: 'hidden' }}>
                      <div className="flex items-center justify-between pt-4 border-t border-zinc-100 dark:border-zinc-800">
                        <div className="flex items-center gap-3">
                          {voice.wakeword_enabled ? <Mic size={17} className="text-violet-400" /> : <MicOff size={17} className="text-zinc-400" />}
                          <div>
                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Wake word</p>
                            <p className="text-xs text-zinc-400">{voice.wakeword_model || 'hey_mycroft'}</p>
                          </div>
                        </div>
                        <Toggle checked={!!voice.wakeword_enabled} onCheckedChange={(v) => setVoice((s) => ({ ...s, wakeword_enabled: v }))} />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm text-zinc-700 dark:text-zinc-300">Detection sensitivity</p>
                          <span className="text-xs font-semibold text-zinc-500">{(voice.wakeword_threshold || 0.65).toFixed(2)}</span>
                        </div>
                        <Slider value={(voice.wakeword_threshold || 0.65) * 100} onValueChange={(v) => setVoice((s) => ({ ...s, wakeword_threshold: v / 100 }))} min={30} max={95} />
                        <div className="flex justify-between mt-1">
                          <span className="text-[10px] text-zinc-400">Sensitive</span>
                          <span className="text-[10px] text-zinc-400">Strict</span>
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm text-zinc-700 dark:text-zinc-300">Listen timeout</p>
                          <span className="text-xs font-semibold text-zinc-500">{voice.active_timeout_s || 90}s</span>
                        </div>
                        <Slider value={voice.active_timeout_s || 90} onValueChange={(v) => setVoice((s) => ({ ...s, active_timeout_s: v }))} min={10} max={120} />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm text-zinc-700 dark:text-zinc-300">Speech speed</p>
                          <span className="text-xs font-semibold text-zinc-500">{(voice.speed || 1.0).toFixed(1)}×</span>
                        </div>
                        <Slider value={(voice.speed || 1.0) * 100} onValueChange={(v) => setVoice((s) => ({ ...s, speed: parseFloat((v / 100).toFixed(2)) }))} min={70} max={150} />
                        <div className="flex justify-between mt-1">
                          <span className="text-[10px] text-zinc-400">Slower</span>
                          <span className="text-[10px] text-zinc-400">Faster</span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button onClick={saveVoice} disabled={savingVoice} className="z-btn-primary" style={{ width: '100%' }}>
                  {savingVoice ? 'Saving…' : 'Save voice settings'}
                </button>
              </div>
            </Card>
          </div>

          {/* System metrics */}
          {sys && (
            <div style={{ marginBottom: 22 }}>
              <SectionTitle>System</SectionTitle>
              <Card>
                <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <MetricBar label="CPU"  value={Math.round(sys.cpu_percent  || 0)} />
                  <MetricBar label="RAM"  value={Math.round(sys.ram_percent  || 0)} />
                  <MetricBar label="Disk" value={Math.round(sys.disk_percent || 0)} />
                  <div className="flex items-center gap-3 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                    <Wifi size={15} className="text-zinc-400" />
                    <span className="text-xs text-zinc-500">
                      {status.ws_clients || 0} WebSocket client{status.ws_clients !== 1 ? 's' : ''} connected
                    </span>
                    <Badge variant={status.ok ? 'success' : 'danger'} className="ml-auto text-[10px]">
                      {status.ok ? 'HA connected' : 'HA offline'}
                    </Badge>
                  </div>
                </div>
              </Card>
            </div>
          )}

        </>
      )}

      {/* ── Admin tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'admin' && isAdmin && <AdminSettings />}

      {/* ── Users tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'users' && isSuperAdmin && <UsersPanel currentUsername={username} />}

    </div>
  )
}
