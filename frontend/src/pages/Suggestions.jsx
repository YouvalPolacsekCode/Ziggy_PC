import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Lightbulb, CheckCircle2, XCircle, Clock, ChevronDown,
  ChevronUp, RefreshCw, Zap, RotateCcw, History,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { useSuggestionStore } from '../stores/suggestionStore'
import { useUIStore } from '../stores/uiStore'
import { cn } from '../lib/utils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_META = {
  time_based: { label: 'Time-based', color: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300', emoji: '⏰' },
  sequence:   { label: 'Sequence',   color: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',   emoji: '🔁' },
  group:      { label: 'Group',      color: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', emoji: '📦' },
}

const STATUS_META = {
  pending:     { label: 'Pending',     color: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
  accepted:    { label: 'Accepted',    color: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  rejected:    { label: 'Rejected',    color: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
  snoozed:     { label: 'Snoozed',     color: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' },
  implemented: { label: 'Implemented', color: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
}

function confidenceColor(conf) {
  if (conf >= 0.8) return 'text-emerald-600 dark:text-emerald-400'
  if (conf >= 0.6) return 'text-amber-600 dark:text-amber-400'
  return 'text-zinc-400'
}

function ConfidenceBar({ value }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            value >= 0.8 ? 'bg-emerald-400' : value >= 0.6 ? 'bg-amber-400' : 'bg-zinc-300 dark:bg-zinc-600'
          )}
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className={cn('text-[11px] font-semibold tabular-nums shrink-0', confidenceColor(value))}>
        {Math.round(value * 100)}%
      </span>
    </div>
  )
}

// ─── Suggestion card ──────────────────────────────────────────────────────────

function SuggestionCard({ suggestion, onAccept, onReject, onSnooze }) {
  const [expanded, setExpanded] = useState(false)
  const [acting, setActing] = useState(null)
  const meta = TYPE_META[suggestion.pattern_type] || TYPE_META.time_based
  const isPending = suggestion.status === 'pending'

  const act = async (fn, label) => {
    setActing(label)
    try { await fn() } finally { setActing(null) }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.2 }}
    >
      <Card className={cn('p-4', !isPending && 'opacity-60')}>
        {/* Top row */}
        <div className="flex items-start gap-3">
          <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-lg', meta.color)}>
            {meta.emoji}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 leading-snug">
              {suggestion.user_message}
            </p>

            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', meta.color)}>
                {meta.label}
              </span>
              {suggestion.trigger?.type === 'time' && suggestion.trigger.value && (
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                  ⏰ {suggestion.trigger.value}
                </span>
              )}
              <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', STATUS_META[suggestion.status]?.color)}>
                {STATUS_META[suggestion.status]?.label || suggestion.status}
              </span>
            </div>

            {/* Confidence bar */}
            <div className="mt-2.5">
              <ConfidenceBar value={suggestion.confidence} />
            </div>
          </div>
        </div>

        {/* Expandable reasoning */}
        {suggestion.reasoning && (
          <div className="mt-3">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              Why did Ziggy suggest this?
            </button>
            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 pl-3 border-l-2 border-zinc-200 dark:border-zinc-700">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{suggestion.reasoning}</p>
                    {suggestion.trigger && (
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-1">
                        Trigger: <span className="font-mono">{suggestion.trigger.type}
                        {suggestion.trigger.value ? ` · ${suggestion.trigger.value}` : ''}</span>
                      </p>
                    )}
                    {suggestion.safety_note && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                        ⚠️ {suggestion.safety_note}
                      </p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Action buttons — only for pending */}
        {isPending && (
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => act(onAccept, 'accept')}
              disabled={!!acting}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 disabled:opacity-50 transition-colors"
            >
              <CheckCircle2 size={13} />
              {acting === 'accept' ? 'Accepting…' : 'Accept'}
            </button>
            <button
              onClick={() => act(() => onSnooze(3), 'snooze')}
              disabled={!!acting}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors"
              title="Remind me in 3 days"
            >
              <Clock size={13} />
              {acting === 'snooze' ? '…' : '3d'}
            </button>
            <button
              onClick={() => act(onReject, 'reject')}
              disabled={!!acting}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-50 transition-colors"
              title="Don't suggest this again"
            >
              <XCircle size={13} />
              {acting === 'reject' ? '…' : 'Reject'}
            </button>
          </div>
        )}

        {/* Accepted state — show actions that would be created */}
        {suggestion.status === 'accepted' && suggestion.actions?.length > 0 && (
          <div className="mt-3 pl-3 border-l-2 border-emerald-200 dark:border-emerald-800">
            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold uppercase tracking-wide mb-1">
              Actions queued
            </p>
            {suggestion.actions.map((a, i) => (
              <p key={i} className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {a.intent?.replace(/_/g, ' ')}
                {a.params?.room ? ` · ${a.params.room.replace(/_/g, ' ')}` : ''}
              </p>
            ))}
          </div>
        )}
      </Card>
    </motion.div>
  )
}

// ─── Empty states ─────────────────────────────────────────────────────────────

function EmptyPending({ onAnalyze, analyzing }) {
  return (
    <div className="text-center py-16 text-zinc-400 dark:text-zinc-600">
      <Lightbulb size={40} className="mx-auto mb-3 opacity-30" />
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">No pending suggestions</p>
      <p className="text-xs mt-1 max-w-xs mx-auto">
        Ziggy learns from your daily actions. After a few days of use, patterns will appear here.
      </p>
      <Button
        variant="secondary"
        size="sm"
        className="mt-4"
        onClick={onAnalyze}
        disabled={analyzing}
      >
        <RefreshCw size={13} className={analyzing ? 'animate-spin' : ''} />
        {analyzing ? 'Analyzing…' : 'Run analysis now'}
      </Button>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TABS = ['Pending', 'History']

export default function Suggestions() {
  const { suggestions, loading, analyzing, fetch, accept, reject, snooze, runAnalysis } = useSuggestionStore()
  const { addToast } = useUIStore()
  const [tab, setTab] = useState('Pending')

  useEffect(() => { fetch() }, [])

  const pending = suggestions.filter((s) => s.status === 'pending')
  const history = suggestions.filter((s) => s.status !== 'pending')

  const handleAccept = async (id) => {
    try {
      await accept(id)
      addToast('Suggestion accepted', 'success')
    } catch {
      addToast('Failed to accept suggestion', 'error')
    }
  }

  const handleReject = async (id) => {
    try {
      await reject(id)
      addToast('Suggestion dismissed', 'success')
    } catch {
      addToast('Failed to reject suggestion', 'error')
    }
  }

  const handleSnooze = async (id, days) => {
    try {
      await snooze(id, days)
      addToast(`Snoozed for ${days} days`, 'success')
    } catch {
      addToast('Failed to snooze', 'error')
    }
  }

  const handleAnalyze = async () => {
    try {
      const result = await runAnalysis()
      if (result?.new_count > 0) {
        addToast(`Found ${result.new_count} new suggestion${result.new_count !== 1 ? 's' : ''}`, 'success')
      } else {
        addToast('Analysis complete — no new patterns yet', 'success')
      }
    } catch {
      addToast('Analysis failed', 'error')
    }
  }

  const displayed = tab === 'Pending' ? pending : history

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6 pb-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Suggestions</h1>
          <p className="text-sm text-zinc-400 dark:text-zinc-600 mt-0.5">
            {pending.length > 0
              ? `${pending.length} pending · Ziggy learned these from your habits`
              : 'Ziggy watches your habits and suggests automations'}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleAnalyze}
          disabled={analyzing}
          title="Run pattern analysis now"
        >
          <RefreshCw size={13} className={analyzing ? 'animate-spin' : ''} />
          {analyzing ? 'Analyzing…' : 'Analyze'}
        </Button>
      </div>

      {/* Stats row */}
      {suggestions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-4 gap-2 mb-5"
        >
          {[
            { label: 'Pending',  value: pending.length,                                          icon: <Lightbulb size={14} />,    color: 'text-violet-500' },
            { label: 'Accepted', value: suggestions.filter(s => s.status === 'accepted').length, icon: <CheckCircle2 size={14} />, color: 'text-emerald-500' },
            { label: 'Snoozed',  value: suggestions.filter(s => s.status === 'snoozed').length,  icon: <Clock size={14} />,        color: 'text-amber-500' },
            { label: 'Rejected', value: suggestions.filter(s => s.status === 'rejected').length, icon: <XCircle size={14} />,      color: 'text-red-400' },
          ].map(({ label, value, icon, color }) => (
            <Card key={label} className="p-3 text-center">
              <div className={cn('flex items-center justify-center mb-1', color)}>{icon}</div>
              <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{value}</p>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-600">{label}</p>
            </Card>
          ))}
        </motion.div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-zinc-100 dark:bg-zinc-800/60 p-1 rounded-xl w-fit">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150',
              tab === t
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            )}
          >
            {t}
            {t === 'Pending' && pending.length > 0 && (
              <span className="ml-1.5 bg-violet-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                {pending.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Loading skeletons */}
      {loading && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 rounded-2xl bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && displayed.length === 0 && tab === 'Pending' && (
        <EmptyPending onAnalyze={handleAnalyze} analyzing={analyzing} />
      )}

      {!loading && displayed.length === 0 && tab === 'History' && (
        <div className="text-center py-16 text-zinc-400 dark:text-zinc-600">
          <History size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No history yet</p>
        </div>
      )}

      {/* Cards */}
      {!loading && (
        <AnimatePresence mode="popLayout">
          <div className="flex flex-col gap-3">
            {displayed.map((s) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                onAccept={() => handleAccept(s.id)}
                onReject={() => handleReject(s.id)}
                onSnooze={(days) => handleSnooze(s.id, days)}
              />
            ))}
          </div>
        </AnimatePresence>
      )}

      {/* How it works — shown when empty & no suggestions at all */}
      {!loading && suggestions.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-8"
        >
          <Card className="p-5 bg-gradient-to-br from-violet-50 to-zinc-50 dark:from-violet-900/10 dark:to-zinc-900 border-violet-100 dark:border-violet-900/30">
            <p className="text-xs font-semibold uppercase tracking-wider text-violet-500 dark:text-violet-400 mb-3">
              How it works
            </p>
            <div className="flex flex-col gap-3">
              {[
                { icon: <Zap size={14} />, text: 'Ziggy silently logs every action you take' },
                { icon: <RotateCcw size={14} />, text: 'Every day at 9:00 AM it scans for repeated patterns' },
                { icon: <Lightbulb size={14} />, text: 'Patterns are turned into automation suggestions' },
                { icon: <CheckCircle2 size={14} />, text: 'You review and approve — nothing is created silently' },
              ].map(({ icon, text }, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-lg bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
                    {icon}
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">{text}</p>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  )
}
