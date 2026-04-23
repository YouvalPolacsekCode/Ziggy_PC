import { useEffect, useRef, useState, useCallback } from 'react'

const WS_URL = `ws://${window.location.hostname}:8001/ws`

export function useWebSocket() {
  const ws = useRef(null)
  const [messages, setMessages] = useState([])
  const [connected, setConnected] = useState(false)
  const reconnectTimer = useRef(null)

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return

    const socket = new WebSocket(WS_URL)
    ws.current = socket

    socket.onopen = () => {
      setConnected(true)
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
      reconnectTimer.current = setTimeout(connect, 3000)
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
