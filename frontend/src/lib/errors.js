// Frontend mirror of core/errors.py.
//
// Every error that flows through lib/api.js is normalized into a
// ZiggyApiError instance. UI code then runs `describeError(err)` to get a
// localized, user-safe message — never `err.message`, never the raw
// backend payload, never a stack line.
//
// To add a new error code:
//   1. Add it to core/errors.py (ErrorCode + DEFAULT_MESSAGES + DEFAULT_HTTP_STATUS).
//   2. Add the matching i18n key to en.js / he.js (errors.<code>).
//   3. Add the code → key mapping in CODE_TO_I18N below.
//   4. If the error is recoverable by a retry, add the code to RETRYABLE_CODES.

import { t as i18nT } from './i18n'

// Machine-readable codes. Mirrors core.errors.ErrorCode. Kept as plain
// strings (not symbols) so equality checks survive serialization through
// localStorage, WS frames, etc.
export const ErrorCode = Object.freeze({
  INTERNAL_ERROR:            'internal_error',
  NOT_AUTHENTICATED:         'not_authenticated',
  INSUFFICIENT_PERMISSIONS:  'insufficient_permissions',
  VALIDATION_ERROR:          'validation_error',
  NOT_FOUND:                 'not_found',
  CONFLICT:                  'conflict',
  UPSTREAM_UNAVAILABLE:      'upstream_unavailable',
  UPSTREAM_TIMEOUT:          'upstream_timeout',
  HA_UNAVAILABLE:            'ha_unavailable',
  HA_ENTITY_NOT_FOUND:       'ha_entity_not_found',
  HA_SERVICE_FAILED:         'ha_service_failed',
  DEVICE_UNAVAILABLE:        'device_unavailable',
  DEVICE_COMMAND_FAILED:     'device_command_failed',
  IR_BLASTER_UNREACHABLE:    'ir_blaster_unreachable',
  IR_LEARN_TIMEOUT:          'ir_learn_timeout',
  IR_NOT_CONFIGURED:         'ir_not_configured',
  PAIRING_FAILED:            'pairing_failed',
  PAIRING_TIMEOUT:           'pairing_timeout',
  NOT_CONFIGURED:            'not_configured',
  FEATURE_DISABLED:          'feature_disabled',
  // Subscription kill-switch (Prompt 9 chunk 3). Surfaced when the relay's
  // proxy gate returns 403 with the billing-specific message. Distinct
  // from INSUFFICIENT_PERMISSIONS so the UI can show a "your home still
  // works locally" banner instead of a generic permission error.
  SUBSCRIPTION_INACTIVE:     'subscription_inactive',
  // Frontend-only codes — never produced by the backend.
  REQUEST_TIMEOUT:           'request_timeout',
  NETWORK_OFFLINE:           'network_offline',
})

// Backend code → i18n key. Multiple codes can map to the same key when the
// distinction is operationally meaningful but not user-meaningful (HA
// service failure vs. device command failure both read as "that action
// didn't go through").
const CODE_TO_I18N = {
  [ErrorCode.INTERNAL_ERROR]:           'errors.somethingWentWrong',
  [ErrorCode.NOT_AUTHENTICATED]:        'errors.notAuthenticated',
  [ErrorCode.INSUFFICIENT_PERMISSIONS]: 'errors.noAccess',
  [ErrorCode.VALIDATION_ERROR]:         'errors.invalidInput',
  [ErrorCode.NOT_FOUND]:                'errors.notFound',
  [ErrorCode.CONFLICT]:                 'errors.conflict',
  [ErrorCode.UPSTREAM_UNAVAILABLE]:     'errors.serviceUnavailable',
  [ErrorCode.UPSTREAM_TIMEOUT]:         'errors.timeout',
  [ErrorCode.HA_UNAVAILABLE]:           'errors.homeUnavailable',
  [ErrorCode.HA_ENTITY_NOT_FOUND]:      'errors.deviceNotFound',
  [ErrorCode.HA_SERVICE_FAILED]:        'errors.deviceActionFailed',
  [ErrorCode.DEVICE_UNAVAILABLE]:       'errors.deviceUnavailable',
  [ErrorCode.DEVICE_COMMAND_FAILED]:    'errors.deviceActionFailed',
  [ErrorCode.IR_BLASTER_UNREACHABLE]:   'errors.irBlasterUnreachable',
  [ErrorCode.IR_LEARN_TIMEOUT]:         'errors.irLearnTimeout',
  [ErrorCode.IR_NOT_CONFIGURED]:        'errors.irNotConfigured',
  [ErrorCode.PAIRING_FAILED]:           'errors.pairingFailed',
  [ErrorCode.PAIRING_TIMEOUT]:          'errors.pairingTimeout',
  [ErrorCode.NOT_CONFIGURED]:           'errors.notConfigured',
  [ErrorCode.FEATURE_DISABLED]:         'errors.featureDisabled',
  [ErrorCode.SUBSCRIPTION_INACTIVE]:    'errors.subscriptionInactive',
  [ErrorCode.REQUEST_TIMEOUT]:          'errors.requestTimeout',
  [ErrorCode.NETWORK_OFFLINE]:          'errors.networkOffline',
}

// Codes whose underlying failure is usually transient. UI components that
// surface retry buttons (DataState, error toasts) read this set to decide
// whether to offer a retry affordance. Excludes user-fixable failures like
// VALIDATION_ERROR — retrying without changing the input won't help.
const RETRYABLE_CODES = new Set([
  ErrorCode.INTERNAL_ERROR,
  ErrorCode.UPSTREAM_UNAVAILABLE,
  ErrorCode.UPSTREAM_TIMEOUT,
  ErrorCode.HA_UNAVAILABLE,
  ErrorCode.HA_SERVICE_FAILED,
  ErrorCode.DEVICE_UNAVAILABLE,
  ErrorCode.DEVICE_COMMAND_FAILED,
  ErrorCode.IR_BLASTER_UNREACHABLE,
  ErrorCode.IR_LEARN_TIMEOUT,
  ErrorCode.REQUEST_TIMEOUT,
  ErrorCode.NETWORK_OFFLINE,
])

/**
 * Normalized error from the API layer.
 *
 * Properties:
 *   - code:        machine-readable ErrorCode (string)
 *   - userMessage: localized human string the UI may render as-is
 *   - status:      HTTP status (null for client-side errors like offline)
 *   - requestId:   server-issued trace id (when available) — used to correlate
 *                  user reports with backend logs
 *   - details:     opaque diagnostic payload — present only when the user is
 *                  admin AND opted in via X-Ziggy-Debug. UI must never render
 *                  this for normal users.
 *   - retryable:   boolean — whether a "Try again" affordance makes sense
 */
export class ZiggyApiError extends Error {
  constructor({ code, userMessage, status = null, requestId = null, details = null }) {
    super(userMessage || code)
    this.name = 'ZiggyApiError'
    this.code = code
    this.userMessage = userMessage
    this.status = status
    this.requestId = requestId
    this.details = details
    this.retryable = RETRYABLE_CODES.has(code)
    // Marker so duck-typing across module boundaries (HMR, lazy chunks) works
    // even when the prototype chain doesn't match `instanceof`.
    this.isZiggyError = true
  }
}

export function isZiggyApiError(err) {
  return !!(err && (err instanceof ZiggyApiError || err.isZiggyError))
}

/**
 * Look up the localized user-facing message for an error code. Falls back to
 * the generic "something went wrong" string when the code is unknown — never
 * returns the raw code or undefined.
 */
export function messageForCode(code) {
  const key = CODE_TO_I18N[code] || 'errors.somethingWentWrong'
  return i18nT(key)
}

/**
 * Universal error → display interpretation. Accepts ANYTHING the rest of the
 * app might throw — a ZiggyApiError, a native fetch TypeError, an
 * AbortError, a plain Error, or even a string — and returns a normalized
 * shape the UI can render without further checks.
 *
 *   { message, code, retryable, requestId }
 *
 * Callers should prefer this over `err.message` everywhere a user sees text.
 */
export function describeError(err) {
  if (isZiggyApiError(err)) {
    // Trust the backend's user-facing message when present (it's already
    // been sanitized and translated). Otherwise fall back to our i18n
    // dictionary keyed off the code.
    return {
      message:   err.userMessage || messageForCode(err.code),
      code:      err.code,
      retryable: err.retryable,
      requestId: err.requestId,
    }
  }
  // AbortController-driven timeout
  if (err?.name === 'AbortError') {
    return {
      message:   messageForCode(ErrorCode.REQUEST_TIMEOUT),
      code:      ErrorCode.REQUEST_TIMEOUT,
      retryable: true,
      requestId: null,
    }
  }
  // Native fetch network failure surfaces as TypeError with a "Failed to
  // fetch" / "Load failed" message. Treat as offline.
  if (err instanceof TypeError) {
    return {
      message:   messageForCode(ErrorCode.NETWORK_OFFLINE),
      code:      ErrorCode.NETWORK_OFFLINE,
      retryable: true,
      requestId: null,
    }
  }
  // Last resort. Note we deliberately DROP err.message — that's where raw
  // technical text would have leaked in the old world.
  return {
    message:   messageForCode(ErrorCode.INTERNAL_ERROR),
    code:      ErrorCode.INTERNAL_ERROR,
    retryable: false,
    requestId: null,
  }
}

/**
 * Build a ZiggyApiError from a parsed `{error: {...}}` envelope. Used by
 * lib/api.js after it reads the response body. Tolerant of partially-formed
 * envelopes (older backends, proxy errors) — falls back to the generic
 * INTERNAL_ERROR shape rather than throwing during error handling.
 */
export function ziggyErrorFromEnvelope(envelope, { status = null } = {}) {
  const e = envelope?.error || {}
  const code = (typeof e.code === 'string' && e.code) || ErrorCode.INTERNAL_ERROR
  // Trust backend-supplied message when it exists; otherwise look up by code.
  const userMessage = (typeof e.message === 'string' && e.message)
    ? e.message
    : messageForCode(code)
  return new ZiggyApiError({
    code,
    userMessage,
    status,
    requestId: e.request_id || null,
    details:   e.details || null,
  })
}
