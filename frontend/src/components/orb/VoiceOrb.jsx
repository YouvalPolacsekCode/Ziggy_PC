import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '../../lib/utils'

// Orb states: idle | listening | thinking | speaking
export function VoiceOrb({ state = 'idle', size = 160, onClick }) {
  const isActive = state !== 'idle'
  const isListening = state === 'listening'
  const isThinking = state === 'thinking'
  const isSpeaking = state === 'speaking'

  return (
    <div
      className="relative flex items-center justify-center cursor-pointer select-none"
      style={{ width: size, height: size }}
      onClick={onClick}
    >
      {/* Outer pulse rings — only when active */}
      <AnimatePresence>
        {isListening && (
          <>
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="absolute rounded-full border border-violet-500/30"
                style={{ width: size, height: size }}
                initial={{ scale: 1, opacity: 0.5 }}
                animate={{ scale: 2.2, opacity: 0 }}
                transition={{
                  duration: 2,
                  delay: i * 0.6,
                  repeat: Infinity,
                  ease: 'easeOut',
                }}
              />
            ))}
          </>
        )}
        {isSpeaking && (
          <>
            {[0, 1].map((i) => (
              <motion.div
                key={i}
                className="absolute rounded-full border border-cyan-400/30"
                style={{ width: size, height: size }}
                initial={{ scale: 1, opacity: 0.6 }}
                animate={{ scale: 1.8, opacity: 0 }}
                transition={{
                  duration: 1.2,
                  delay: i * 0.4,
                  repeat: Infinity,
                  ease: 'easeOut',
                }}
              />
            ))}
          </>
        )}
      </AnimatePresence>

      {/* Ambient glow */}
      <motion.div
        className="absolute rounded-full blur-2xl"
        style={{ width: size * 1.2, height: size * 1.2 }}
        animate={{
          background: isListening
            ? 'radial-gradient(circle, rgba(124,58,237,0.5) 0%, transparent 70%)'
            : isSpeaking
            ? 'radial-gradient(circle, rgba(6,182,212,0.4) 0%, transparent 70%)'
            : isThinking
            ? 'radial-gradient(circle, rgba(99,102,241,0.4) 0%, transparent 70%)'
            : 'radial-gradient(circle, rgba(124,58,237,0.25) 0%, transparent 70%)',
          scale: isActive ? 1.15 : 1,
        }}
        transition={{ duration: 0.5 }}
      />

      {/* Main sphere */}
      <motion.div
        className="relative rounded-full overflow-hidden"
        style={{ width: size, height: size }}
        animate={{
          scale: isListening ? [1, 1.06, 1] : isSpeaking ? [1, 1.04, 1.08, 1] : [1, 1.03, 1],
          rotate: isThinking ? 360 : 0,
        }}
        transition={{
          scale: {
            duration: isListening ? 1.2 : isSpeaking ? 0.8 : 5,
            repeat: Infinity,
            ease: 'easeInOut',
          },
          rotate: isThinking
            ? { duration: 3, repeat: Infinity, ease: 'linear' }
            : { duration: 0 },
        }}
      >
        {/* Base gradient — the liquid glass effect */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: 'radial-gradient(circle at 35% 35%, #d4bbff 0%, #9333ea 25%, #7c3aed 45%, #4f46e5 65%, #0ea5e9 85%, #06b6d4 100%)',
          }}
        />

        {/* Shimmer rotate layer */}
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background: 'conic-gradient(from 0deg, transparent 0%, rgba(255,255,255,0.15) 25%, transparent 50%, rgba(255,255,255,0.08) 75%, transparent 100%)',
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
        />

        {/* Glass shine highlight */}
        <div
          className="absolute rounded-full"
          style={{
            top: '10%',
            left: '15%',
            width: '45%',
            height: '35%',
            background: 'radial-gradient(ellipse, rgba(255,255,255,0.55) 0%, transparent 70%)',
            filter: 'blur(2px)',
          }}
        />

        {/* Inner depth */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: 'radial-gradient(circle at 70% 75%, rgba(0,0,0,0.25) 0%, transparent 60%)',
          }}
        />

        {/* State-based inner glow */}
        <motion.div
          className="absolute inset-0 rounded-full"
          animate={{
            background: isListening
              ? 'radial-gradient(circle at 50% 50%, rgba(167,139,250,0.4) 0%, transparent 60%)'
              : isSpeaking
              ? 'radial-gradient(circle at 50% 50%, rgba(34,211,238,0.35) 0%, transparent 60%)'
              : 'radial-gradient(circle at 50% 50%, rgba(167,139,250,0.15) 0%, transparent 60%)',
          }}
          transition={{ duration: 0.4 }}
        />
      </motion.div>

      {/* Mic icon overlay — subtle */}
      <motion.div
        className="absolute flex items-center justify-center pointer-events-none"
        animate={{ opacity: state === 'idle' ? 0.35 : 0 }}
        transition={{ duration: 0.3 }}
      >
        <svg width={size * 0.22} height={size * 0.22} viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"
            fill="white"
            opacity="0.9"
          />
          <path
            d="M19 10v1a7 7 0 0 1-14 0v-1"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.9"
          />
          <line x1="12" y1="18" x2="12" y2="22" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.9" />
        </svg>
      </motion.div>
    </div>
  )
}
