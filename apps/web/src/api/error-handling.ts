// Centralised API-error → user-visible-message mapping.
//
// Components that catch an ApiError can pipe it through `describeApiError`
// to get a toast-ready message + severity. Keeps error-rendering logic out
// of individual components so a status-code shape change in the API only
// needs one update.
//
// Status mapping:
//   400 → inline (validation) — Zod issues flattened to the first message
//   401 → ApiClient auto-redirects to login (unless on401:'throw');
//         if thrown, surface as a "session expired, please sign in" toast
//   403 → "You don't have permission for this action."
//   404 → "That resource wasn't found."
//   409 → inline (conflict) — business rule explained in body.error
//   422 → inline (semantic error, e.g. wrong state machine step)
//   429 → toast "Too many requests. Try again in <N>s."
//   5xx → toast "Something went wrong. Our team has been notified. (request-id: <id>)"
//
// request-id: @fastify/sensible emits an `x-request-id` header on every
// error response; this is what SRE greps for in Loki when a user screenshots
// a 500 toast. Caller surfaces it in the UI; this helper formats it.

import { ApiError } from './client'

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical'

export interface DescribedError {
  severity: ErrorSeverity
  // Where to render: toast (ephemeral), inline (next to a form field),
  // dialog (blocking). Caller decides based on their surface.
  surface: 'toast' | 'inline' | 'dialog'
  title: string
  message: string
  // Validation errors — if present, caller can render per-field.
  fieldIssues?: Array<{ path: string; message: string }>
  retryAfterSec?: number
  requestId?: string
}

export function describeApiError(err: unknown, opts: { requestId?: string } = {}): DescribedError {
  if (!(err instanceof ApiError)) {
    return {
      severity: 'error',
      surface: 'toast',
      title: 'Unexpected error',
      message: err instanceof Error ? err.message : 'Something went wrong.',
      requestId: opts.requestId,
    }
  }

  const body = (err.body ?? {}) as Record<string, unknown>
  const errCode = typeof body.error === 'string' ? body.error : undefined
  const bodyMessage = typeof body.message === 'string' ? body.message : undefined
  const requestId = opts.requestId

  switch (err.status) {
    case 400: {
      const issues = Array.isArray(body.issues) ? body.issues as Array<{ path: unknown[]; message: string }> : []
      return {
        severity: 'warning',
        surface: 'inline',
        title: 'Please check your input',
        message: bodyMessage ?? issues[0]?.message ?? 'Validation failed.',
        fieldIssues: issues.map(i => ({
          path: Array.isArray(i.path) ? i.path.join('.') : String(i.path ?? ''),
          message: i.message,
        })),
        requestId,
      }
    }
    case 401:
      return {
        severity: 'warning',
        surface: 'toast',
        title: 'Session expired',
        message: 'Please sign in again to continue.',
        requestId,
      }
    case 403:
      return {
        severity: 'warning',
        surface: 'toast',
        title: 'Not allowed',
        message: bodyMessage ?? `You don't have permission for this action.`,
        requestId,
      }
    case 404:
      return {
        severity: 'warning',
        surface: 'toast',
        title: 'Not found',
        message: bodyMessage ?? `That resource wasn't found or has been removed.`,
        requestId,
      }
    case 409: {
      return {
        severity: 'warning',
        surface: 'inline',
        title: 'Conflict',
        message: bodyMessage ?? `This action conflicts with the current state (${errCode ?? 'conflict'}).`,
        requestId,
      }
    }
    case 422:
      return {
        severity: 'warning',
        surface: 'inline',
        title: 'Cannot complete',
        message: bodyMessage ?? `The operation couldn't be completed in the current state (${errCode ?? 'unprocessable'}).`,
        requestId,
      }
    case 429: {
      const retrySec = typeof body.retryAfter === 'number' ? body.retryAfter : undefined
      return {
        severity: 'warning',
        surface: 'toast',
        title: 'Too many requests',
        message: retrySec
          ? `Rate limit exceeded. Try again in ${retrySec}s.`
          : 'Rate limit exceeded. Try again shortly.',
        retryAfterSec: retrySec,
        requestId,
      }
    }
    default:
      if (err.status >= 500) {
        return {
          severity: 'critical',
          surface: 'toast',
          title: 'Something went wrong',
          message: requestId
            ? `Our team has been notified. (request-id: ${requestId})`
            : 'Our team has been notified. Please try again shortly.',
          requestId,
        }
      }
      return {
        severity: 'error',
        surface: 'toast',
        title: `HTTP ${err.status}`,
        message: bodyMessage ?? 'Unexpected response from server.',
        requestId,
      }
  }
}
