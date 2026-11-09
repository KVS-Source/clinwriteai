// AI readiness — one hook, one banner, one truth.
//
// Every screen that gates on "is AI configured?" reads from here. The
// hook is a plain react-query wrapper on GET /ai/readiness so a single
// cached value feeds the wizard + both admin AI screens. The banner is
// the standard surfacing: amber bar + "Set up AI" link to the admin
// AI engine config.
//
// Defaults on failure: `configured: false, blockers: ['unknown']`. If
// /ai/readiness is unreachable the UI should assume AI is not usable —
// a false positive is worse than an extra banner.

import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { platformApi, type AiReadiness } from './api/platformApi'

export function useAiReadiness() {
  return useQuery<AiReadiness>({
    queryKey: ['ai-readiness'],
    queryFn:  () => platformApi.getAiReadiness(),
    staleTime: 30_000,                         // 30 s — admins setting up AI shouldn't wait long to see the banner clear
    retry: false,
    // On failure, don't let callers mistake a network blip for "AI is ready".
    // The hook's `data` stays undefined; consumers treat undefined as "unknown"
    // and should default to the safer "not configured" state.
  })
}

/** True iff the readiness query has resolved AND configured === true. */
export function isAiReady(r: AiReadiness | undefined): boolean {
  return r?.configured === true
}

export function AiReadinessBanner({
  context,
  readiness,
}: {
  // One-line "why this matters for this screen" copy. Shows up after the
  // headline so admins know what will NOT work.
  context:   string
  readiness: AiReadiness | undefined
}) {
  if (!readiness || readiness.configured) return null
  const blockers = readiness.blockers.length > 0 ? readiness.blockers.join(', ') : 'credentials'
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-[13px]"
      data-ai-readiness-banner
      role="status"
    >
      <div>
        <p className="font-semibold text-amber-900">AI is not set up on this platform</p>
        <p className="mt-0.5 text-amber-800">
          {context} Missing: <span className="font-mono text-[12px]">{blockers}</span>
        </p>
      </div>
      <Link
        to={readiness.setupPath}
        className="shrink-0 rounded-md border border-amber-600 bg-amber-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-amber-700"
        data-action="setup-ai"
      >
        Set up AI →
      </Link>
    </div>
  )
}
