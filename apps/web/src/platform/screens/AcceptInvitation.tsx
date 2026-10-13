// Accept invitation (AC-PM-007) — public page reached from the one-time
// invite link: /accept-invitation?token=...
//
// The invitee reviews the invitation, accepts the T&C, then signs in via
// SSO. The account is activated at sign-in, once SSO confirms the signer
// owns the invited email (see apps/api/src/auth/invitation-routes.ts).

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { describeApiError } from '../../api'
import { api, apiConfig } from '../../api/client'

interface InvitationPreview {
  valid: boolean
  reason?: string
  email?: string
  name?: string
  role?: string
  expiresAt?: string
}

const REASON_TEXT: Record<string, string> = {
  expired: 'This invitation has expired. Ask your administrator to resend it.',
  revoked: 'This invitation is no longer valid. Ask your administrator for a new one.',
  accepted: 'This invitation has already been used. Sign in to continue.',
  user_not_invited: 'This invitation is no longer valid. Contact your administrator.',
  not_found: 'This invitation link is not valid.',
}

export function AcceptInvitation() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [agreed, setAgreed] = useState(false)

  const preview = useQuery<InvitationPreview>({
    queryKey: ['invitation-preview', token],
    queryFn: () => api.get<InvitationPreview>(`/auth/invitations/preview?token=${encodeURIComponent(token)}`, { on401: 'throw' }),
    enabled: token.length > 0,
    retry: false,
  })

  const accept = useMutation({
    mutationFn: () => api.post<{ ok: true }>('/auth/invitations/accept', { token, acceptTerms: true }, { on401: 'throw' }),
    onSuccess: () => window.location.assign(apiConfig.loginUrl),
  })

  const data = preview.data
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6" data-screen="accept-invitation">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6">
        <h1 className="text-[20px] font-bold text-slate-900">Accept your invitation</h1>

        {(!token || preview.isError || (data && !data.valid)) && (
          <p className="mt-4 rounded-md bg-red-50 p-3 text-[13px] text-red-800" data-error>
            {REASON_TEXT[data?.reason ?? 'not_found'] ?? REASON_TEXT.not_found}
          </p>
        )}
        {token && preview.isLoading && <p className="mt-4 text-[13px] text-slate-500">Checking invitation…</p>}

        {data?.valid && (
          <>
            <p className="mt-2 text-[13px] text-slate-600">
              {data.name}, you have been invited to ClinWrite as <strong>{data.role}</strong>.
            </p>
            <p className="mt-1 text-[12px] text-slate-500">
              Sign in with <strong>{data.email}</strong> to finish. This link expires{' '}
              {data.expiresAt ? new Date(data.expiresAt).toLocaleDateString() : 'soon'}.
            </p>
            <label className="mt-4 flex items-start gap-2 text-[13px] text-slate-700">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} data-input="accept-terms" />
              <span>I accept the <a href="/terms" className="underline">Terms &amp; Conditions</a>.</span>
            </label>
            {accept.isError && (
              <p className="mt-3 rounded-md bg-red-50 p-2 text-[12px] text-red-800" data-error>
                {describeApiError(accept.error).message}
              </p>
            )}
            <button
              type="button"
              onClick={() => accept.mutate()}
              disabled={!agreed || accept.isPending}
              className="mt-4 w-full rounded-md bg-slate-800 px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
              data-action="accept-invitation"
            >
              {accept.isPending ? 'Continuing…' : 'Accept & continue to sign in'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
