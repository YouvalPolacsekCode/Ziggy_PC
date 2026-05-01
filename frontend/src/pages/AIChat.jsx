import { useRef, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, RotateCcw } from 'lucide-react'
import { VoiceOrb } from '../components/orb/VoiceOrb'
import { sendIntent, sendVoice, sendDirectIntent } from '../lib/api'
import { useQuickAskStore } from '../stores/quickAskStore'
import { useUIStore } from '../stores/uiStore'
import { useChatStore } from '../stores/chatStore'
import { formatTime } from '../lib/utils'
import { cn } from '../lib/utils'
import { useState } from 'react'

const HEBREW_RE = /[\u0590-\u05FF]/
const isHebrew = (text) => HEBREW_RE.test(text)

function Message({ msg }) {
  const isUser = msg.role === 'user'
  const rtl = isHebrew(msg.text)
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}
    >
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-cyan-400 flex-shrink-0 mt-auto mb-1" />
      )}
      <div className={cn(
        'max-w-[78%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed',
        isUser
          ? 'bg-gradient-to-br from-violet-600 to-violet-700 text-white rounded-br-sm shadow-[0_2px_12px_rgba(124,58,237,0.3)]'
          : 'bg-white dark:bg-zinc-700 border border-zinc-100 dark:border-zinc-600 text-zinc-900 dark:text-zinc-100 rounded-bl-sm',
        rtl && 'text-right'
      )}
        dir={rtl ? 'rtl' : 'ltr'}
      >
        <p>{msg.text}</p>
        <p className={cn('text-[10px] mt-1 opacity-40', rtl && 'text-left')}>{formatTime(msg.ts)}</p>
      </div>
    </motion.div>
  )
}

function ThinkingBubble() {
  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-cyan-400 flex-shrink-0 mt-auto mb-1" />
      <div className="bg-white dark:bg-zinc-700 border border-zinc-100 dark:border-zinc-600 px-4 py-3 rounded-2xl rounded-bl-sm flex gap-1.5 items-center">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-violet-400/70 dark:bg-violet-500/60"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 0.8, delay: i * 0.15, repeat: Infinity }}
          />
        ))}
      </div>
    </div>
  )
}

export default function AIChat() {
  const location = useLocation()
  const navigate = useNavigate()
  const { addToast } = useUIStore()
  const { messages, addMessage, clearMessages } = useChatStore()
  const { items: quickAsks, fetch: fetchQuickAsks } = useQuickAskStore()
  const [input, setInput] = useState('')
  const [orbState, setOrbState] = useState('idle')
  const [thinking, setThinking] = useState(false)
  const [recording, setRecording] = useState(false)
  const mediaRef = useRef(null)
  const chunksRef = useRef([])
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const sentPrefillRef = useRef(false)

  useEffect(() => { fetchQuickAsks() }, [])

  // Auto-send prefill exactly once — guard against React StrictMode double-invocation
  useEffect(() => {
    if (sentPrefillRef.current) return
    const { quickAsk, prefill } = location.state || {}
    if (quickAsk) {
      sentPrefillRef.current = true
      handleDirectQuickAsk(quickAsk)
      navigate(location.pathname, { replace: true, state: {} })
    } else if (prefill) {
      sentPrefillRef.current = true
      handleSend(prefill)
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  const handleSend = async (text) => {
    const t = (text || input).trim()
    if (!t) return
    setInput('')
    addMessage('user', t)
    setThinking(true)
    setOrbState('thinking')
    try {
      const res = await sendIntent(t)
      addMessage('assistant', res.reply || '…')
      setOrbState('speaking')
      setTimeout(() => setOrbState('idle'), 2500)
    } catch {
      addMessage('assistant', 'Something went wrong. Please try again.')
      setOrbState('idle')
    } finally {
      setThinking(false)
    }
  }

  const handleDirectQuickAsk = async (qa) => {
    addMessage('user', `${qa.icon ? qa.icon + ' ' : ''}${qa.label}`)
    setThinking(true)
    setOrbState('thinking')
    try {
      const res = await sendDirectIntent(qa.intent, qa.params)
      addMessage('assistant', res.reply || '…')
      setOrbState('speaking')
      setTimeout(() => setOrbState('idle'), 2500)
    } catch {
      addMessage('assistant', 'Something went wrong. Please try again.')
      setOrbState('idle')
    } finally {
      setThinking(false)
    }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      mediaRef.current = mr
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        try {
          setThinking(true)
          setOrbState('thinking')
          const res = await sendVoice(blob)
          if (res.transcription) addMessage('user', res.transcription)
          if (res.reply) {
            addMessage('assistant', res.reply)
            setOrbState('speaking')
            setTimeout(() => setOrbState('idle'), 2500)
          } else {
            setOrbState('idle')
          }
        } catch {
          addToast('Voice processing failed', 'error')
          setOrbState('idle')
        } finally {
          setThinking(false)
        }
      }
      mr.start()
      setRecording(true)
      setOrbState('listening')
    } catch {
      addToast('Microphone access denied', 'error')
    }
  }

  const stopRecording = () => {
    mediaRef.current?.stop()
    setRecording(false)
    setOrbState('thinking')
  }

  const handleOrbClick = () => {
    if (recording) stopRecording()
    else if (orbState === 'idle') startRecording()
  }

  const hasMessages = messages.length > 0

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] md:h-screen bg-gradient-to-b from-violet-50/30 dark:from-violet-950/10 to-transparent">
      {/* Orb header */}
      <div className={cn(
        'flex flex-col items-center justify-center transition-all duration-500 pt-6 relative',
        hasMessages ? 'pb-2' : 'flex-1 pb-4'
      )}>
        {/* New chat button */}
        {hasMessages && (
          <button
            onClick={clearMessages}
            className="absolute top-4 right-4 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <RotateCcw size={12} />
            New chat
          </button>
        )}

        <VoiceOrb
          state={orbState}
          size={hasMessages ? 72 : 140}
          onClick={handleOrbClick}
        />

        <AnimatePresence>
          {!hasMessages && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="text-center mt-5 px-8"
            >
              <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
                Hi, I'm Ziggy
              </h1>
              <p className="text-zinc-400 dark:text-zinc-500 text-sm">
                {orbState === 'idle' ? 'Tap the orb to speak, or type below'
                  : orbState === 'listening' ? 'Listening… tap to stop'
                  : orbState === 'thinking' ? 'Thinking…'
                  : 'Speaking…'}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {hasMessages && orbState !== 'idle' && (
            <motion.p
              key={orbState}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-[11px] text-zinc-400 mt-1"
            >
              {orbState === 'listening' ? 'Listening…'
                : orbState === 'thinking' ? 'Thinking…'
                : 'Speaking…'}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Quick suggestions — shown when no messages */}
      <AnimatePresence>
        {!hasMessages && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-4 pb-4 flex flex-wrap gap-2 justify-center"
          >
            {quickAsks.map((qa) => (
              <button
                key={qa.id}
                onClick={() => handleDirectQuickAsk(qa)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 hover:border-violet-400 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-all"
              >
                {qa.icon && <span>{qa.icon}</span>}
                {qa.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      {hasMessages && (
        <div className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-3 scrollbar-thin">
          {messages.map((msg) => <Message key={msg.id} msg={msg} />)}
          {thinking && <ThinkingBubble />}
          <div ref={scrollRef} />
        </div>
      )}

      {/* Input */}
      <div className="px-4 pb-3 pt-2 flex gap-2 border-t border-zinc-200/60 dark:border-zinc-700/50">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="Ask Ziggy anything…"
          dir={isHebrew(input) ? 'rtl' : 'ltr'}
          className={cn(
            'flex-1 h-11 px-4 rounded-2xl text-sm',
            'bg-zinc-100 dark:bg-zinc-800',
            'text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400',
            'border border-zinc-200 dark:border-zinc-700',
            'focus:outline-none focus:ring-2 focus:ring-violet-500/50',
            'transition-all duration-200'
          )}
        />
        <motion.button
          onClick={() => handleSend()}
          disabled={!input.trim()}
          whileTap={{ scale: 0.92 }}
          className={cn(
            'w-11 h-11 rounded-2xl flex items-center justify-center transition-all duration-200',
            input.trim()
              ? 'bg-violet-600 text-white'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-300 dark:text-zinc-600'
          )}
        >
          <Send size={16} />
        </motion.button>
      </div>
    </div>
  )
}
