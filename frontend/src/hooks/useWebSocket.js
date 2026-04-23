import { useEffect, useRef, useState, useCallback } from 'react'

const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const WS_URL = `${proto}//${window.location.host}/ws`

export function useWebSocket() {
  const ws = useRef(null)
  const [messages, setMessages] = useState([])
  const [connected, setConnected] = useState(false)
  const reconnectTimer = useRef(null)
  const retryCount = useRef(0)

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return

    const socket = new WebSocket(WS_URL)
    ws.current = socket

    socket.onopen = () => {
      setConnected(true)
      retryCount.current = 0
      clearTimeout(reconnectTimer.current)
    }

    socket.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data)
        setMessages(prev => [...prev.slice(-199), { ...data, ts: Date.now() }])
      } catch { /* ignore non-JSON pings */ }
    }

    socket.onclose = () => {
      setConnected(false)
      const delay = Math.min(3000 * 2 ** retryCount.current, 30000)
      retryCount.current += 1
      reconnectTimer.current = setTimeout(connect, delay)
    }

    socket.onerror = () => socket.close()
  }, [])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      ws.current?.close()
    }
  }, [connect])

  return { messages, connected }
}
