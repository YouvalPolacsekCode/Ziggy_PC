import { useState, useEffect, useCallback } from 'react'
import { ErrorCode, ZiggyApiError } from '../lib/errors'

// Tiny normalize helper for the in-hook raw `fetch` calls below — keeps
// useApi's error shape identical to lib/api.js so DataState / describeError
// work on it without special-casing.
async function _toError(res) {
  const code = res.status >= 500
    ? ErrorCode.INTERNAL_ERROR
    : res.status === 404 ? ErrorCode.NOT_FOUND
    : res.status === 401 ? ErrorCode.NOT_AUTHENTICATED
    : ErrorCode.VALIDATION_ERROR
  return new ZiggyApiError({ code, status: res.status })
}

export function useApi(path, opts = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  // Store the full error object (not err.message) so consumers passing it
  // to describeError / DataState get the correct code + retryable signal.
  const [error, setError] = useState(null)

  const fetch_ = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(path, opts)
      if (!res.ok) throw await _toError(res)
      setData(await res.json())
      setError(null)
    } catch (e) {
      // Preserve ZiggyApiError instances; wrap anything else (TypeError from
      // a dropped network, AbortError) so DataState can render properly.
      setError(e?.isZiggyError ? e : new ZiggyApiError({ code: ErrorCode.INTERNAL_ERROR }))
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  useEffect(() => { fetch_() }, [fetch_])

  return { data, loading, error, refetch: fetch_ }
}

export async function postIntent(text, source = 'web') {
  const res = await fetch('/api/intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, source }),
  })
  if (!res.ok) throw await _toError(res)
  return res.json()
}

export async function patchVoiceSettings(patch) {
  const res = await fetch('/api/settings/voice', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw await _toError(res)
  return res.json()
}
