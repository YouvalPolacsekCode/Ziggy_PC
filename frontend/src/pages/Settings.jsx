import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Server, Wifi, Cpu, HardDrive, MemoryStick, Sun, Moon, Mic, MicOff, RefreshCw } from 'lucide-react'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Slider } from '../components/ui/Slider'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { useUIStore } from '../stores/uiStore'
import { getStatus, getVoiceSettings, patchVoiceSettings } from '../lib/api'
import { cn } from '../lib/utils'

function MetricBar({ label, value, color = 'bg-violet-500' }) {
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

function SectionTitle({ children }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 mb-3 px-1">
      {children}
    </h2>
  )
}

export default function Settings() {
  const { theme, toggleTheme, addToast } = useUIStore()
  const [status, setStatus] = useState(null)
  const [voice, setVoice] = useState({})
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const loadData = async () => {
    try {
      const [s, v] = await Promise.all([getStatus(), getVoiceSettings()])
      setStatus(s)
      setVoice(v)
    } catch {}
  }

  useEffect(() => { loadData() }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadData()
    setRefreshing(false)
  }

  const handleSaveVoice = async () => {
    setSaving(true)
    try {
      await patchVoiceSettings(voice)
      addToast('Voice settings saved', 'success')
    } catch {
      addToast('Failed to save', 'error')
    } finally {
      setSaving(false)
    }
  }

  const sys = status?.system
  const config = status?.config

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6 pb-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Settings</h1>
        <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw size={16} className={cn(refreshing && 'animate-spin')} />
        </Button>
      </div>

      {/* Appearance */}
      <div className="mb-6">
        <SectionTitle>Appearance</SectionTitle>
        <Card>
          <div className="flex items-center justify-between px-4 py-4">
            <div className="flex items-center gap-3">
              {theme === 'dark' ? <Moon size={18} className="text-zinc-500" /> : <Sun size={18} className="text-zinc-500" />}
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {theme === 'dark' ? 'Dark mode' : 'Light mode'}
                </p>
                <p className="text-xs text-zinc-400">Switch app theme</p>
              </div>
            </div>
            <Toggle checked={theme === 'dark'} onCheckedChange={toggleTheme} />
          </div>
        </Card>
      </div>

      {/* System status */}
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
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* HA Config */}
      {config && (
        <div className="mb-6">
          <SectionTitle>Home Assistant</SectionTitle>
          <Card>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              <div className="flex items-center justify-between px-4 py-3">
                <p className="text-xs text-zinc-500">URL</p>
                <p className="text-xs font-mono text-zinc-700 dark:text-zinc-300 truncate max-w-[60%] text-right">
                  {config.ha_url || 'Not configured'}
                </p>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <p className="text-xs text-zinc-500">Status</p>
                <Badge variant={status.ok ? 'success' : 'danger'} className="text-[10px]">
                  {status.ok ? 'Connected' : 'Disconnected'}
                </Badge>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Voice settings */}
      <div className="mb-6">
        <SectionTitle>Voice</SectionTitle>
        <Card>
          <CardBody className="pt-4 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {voice.wakeword_enabled ? (
                  <Mic size={18} className="text-violet-500" />
                ) : (
                  <MicOff size={18} className="text-zinc-400" />
                )}
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Wake word</p>
                  <p className="text-xs text-zinc-400">
                    {voice.wakeword_model || 'Not set'}
                  </p>
                </div>
              </div>
              <Toggle
                checked={!!voice.wakeword_enabled}
                onCheckedChange={(v) => setVoice((s) => ({ ...s, wakeword_enabled: v }))}
              />
            </div>

            {voice.wakeword_enabled && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="flex flex-col gap-4"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">Detection threshold</p>
                    <span className="text-xs font-semibold text-zinc-500">
                      {(voice.wakeword_threshold || 0.7).toFixed(2)}
                    </span>
                  </div>
                  <Slider
                    value={(voice.wakeword_threshold || 0.7) * 100}
                    onValueChange={(v) => setVoice((s) => ({ ...s, wakeword_threshold: v / 100 }))}
                    min={30}
                    max={95}
                  />
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-zinc-400">Sensitive</span>
                    <span className="text-[10px] text-zinc-400">Strict</span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">Listen timeout</p>
                    <span className="text-xs font-semibold text-zinc-500">
                      {voice.active_timeout_s || 30}s
                    </span>
                  </div>
                  <Slider
                    value={voice.active_timeout_s || 30}
                    onValueChange={(v) => setVoice((s) => ({ ...s, active_timeout_s: v }))}
                    min={10}
                    max={120}
                  />
                </div>
              </motion.div>
            )}

            <Button
              variant="primary"
              onClick={handleSaveVoice}
              disabled={saving}
              className="w-full"
            >
              {saving ? 'Saving…' : 'Save voice settings'}
            </Button>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
