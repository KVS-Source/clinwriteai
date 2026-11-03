// Accept invitation (AC-PM-007) — public page reached from the one-time
// invite link: /accept-invitation?token=...
//
// The invitee reviews the invitation, accepts the T&C, then signs in via
// SSO. The account is activated at sign-in, once SSO confirms the signer
// owns the invited email (see apps/api/src/auth/invitation-routes.ts).

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
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

const REASON_KEYS: Record<string, string> = {
  expired:          'page.accept_invitation.reason_expired',
  revoked:          'page.accept_invitation.reason_revoked',
  accepted:         'page.accept_invitation.reason_accepted',
  user_not_invited: 'page.accept_invitation.reason_user_not_invited',
  not_found:        'page.accept_invitation.reason_not_found',
}

export function AcceptInvitation() {
  const { t } = useTranslation()
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
  const reasonKey = REASON_KEYS[data?.reason ?? 'not_found'] ?? REASON_KEYS.not_found
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6" data-screen="accept-invitation">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6">
        <h1 className="text-[20px] font-bold text-slate-900">{t('page.accept_invitation.title')}</h1>

        {(!token || preview.isError || (data && !data.valid)) && (
          <p className="mt-4 rounded-md bg-red-50 p-3 text-[13px] text-red-800" data-error>
            {t(reasonKey)}
          </p>
        )}
        {token && preview.isLoading && <p className="mt-4 text-[13px] text-slate-500">{t('page.accept_invitation.checking')}</p>}

        {data?.valid && (
          <>
            <p className="mt-2 text-[13px] text-slate-600">
              {t('page.accept_invitation.greeting_prefix', { name: data.name })} <strong>{data.role}</strong>{t('page.accept_invitation.greeting_suffix')}
            </p>
            <p className="mt-1 text-[12px] text-slate-500">
              {t('page.accept_invitation.signin_hint_prefix')} <strong>{data.email}</strong>{' '}
              {t('page.accept_invitation.signin_hint_suffix', { date: data.expiresAt ? new Date(data.expiresAt).toLocaleDateString() : t('page.accept_invitation.soon') })}
            </p>
            <label className="mt-4 flex items-start gap-2 text-[13px] text-slate-700">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} data-input="accept-terms" />
              <span>{t('page.accept_invitation.accept_terms_prefix')} <a href="/terms" className="underline">{t('page.accept_invitation.terms_link_text')}</a>{t('page.accept_invitation.accept_terms_suffix')}</span>
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
              {accept.isPending ? t('page.accept_invitation.continuing') : t('page.accept_invitation.accept_continue')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
