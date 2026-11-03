// Accept invitation (AC-PM-007) — public page reached from the one-time
// invite link: /accept-invitation?token=...
//
// The invitee reviews the invitation, accepts the T&C, and sets their own
// password. Registering activates the account in one step (invited → active)
// so they can sign in with email + password — see
// apps/api/src/auth/invitation-routes.ts (POST /auth/invitations/register).

import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { authApi } from '../../api'
import { api } from '../../api/client'
import {
  AuthCard, AuthError, AuthField, AuthSubmit, PasswordRules,
  authErrorMessage, passwordMeetsPolicy,
} from '../../screens/shell/AuthCard'

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
  const { t }    = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [agreed,   setAgreed]   = useState(false)

  const preview = useQuery<InvitationPreview>({
    queryKey: ['invitation-preview', token],
    queryFn: () => api.get<InvitationPreview>(`/auth/invitations/preview?token=${encodeURIComponent(token)}`, { on401: 'throw' }),
    enabled: token.length > 0,
    retry: false,
  })

  const register = useMutation({
    mutationFn: () => authApi.registerFromInvite(token, password),
    onSuccess: () => navigate('/sign-in?registered=1', { replace: true }),
  })

  const data = preview.data
  const mismatch  = confirm.length > 0 && confirm !== password
  const canSubmit = passwordMeetsPolicy(password) && confirm === password && agreed

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (canSubmit && !register.isPending) register.mutate()
  }

  // Invalid link / preview failed — one clear dead-end with a route back.
  if (!token || preview.isError || (data && !data.valid)) {
    const reasonKey = REASON_KEYS[data?.reason ?? 'not_found'] ?? REASON_KEYS.not_found
    return (
      <AuthCard screen="accept-invitation" title={t('page.accept_invitation.title')} subtitle="">
        <AuthError>{t(reasonKey)}</AuthError>
        <Link to="/sign-in" className="mt-4 block h-10 rounded-lg bg-blue-600 text-center text-sm font-semibold leading-10 text-white hover:bg-blue-700">
          {t('page.accept_invitation.go_to_sign_in')}
        </Link>
      </AuthCard>
    )
  }

  if (token && preview.isLoading) {
    return (
      <AuthCard screen="accept-invitation" title={t('page.accept_invitation.title')} subtitle="">
        <p className="text-[13px] text-slate-500">{t('page.accept_invitation.checking')}</p>
      </AuthCard>
    )
  }

  return (
    <AuthCard screen="accept-invitation" title={t('page.accept_invitation.title')} subtitle={t('page.accept_invitation.subtitle_register')}>
      {data?.valid && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-[13px] text-slate-600" data-invite-greeting>
            {t('page.accept_invitation.greeting_prefix', { name: data.name })}<strong>{data.role}</strong>{t('page.accept_invitation.greeting_suffix')}
          </p>

          {/* Email is fixed by the invitation — shown read-only so the user
              knows which address they'll sign in with. */}
          <div>
            <label className="mb-1 block text-[13px] font-medium text-slate-600">{t('page.accept_invitation.email_label')}</label>
            <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700" data-invite-email>{data.email}</div>
          </div>

          <AuthField id="new-password" label={t('page.accept_invitation.password_label')} type="password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
          <PasswordRules password={password} />
          <AuthField id="confirm-password" label={t('page.accept_invitation.confirm_label')} type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          {mismatch && <p className="-mt-2 text-[12px] text-red-600" data-password-mismatch>{t('page.accept_invitation.mismatch')}</p>}

          <label className="flex items-start gap-2 text-[13px] text-slate-700">
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5" data-input="accept-terms" />
            <span>{t('page.accept_invitation.accept_terms_prefix')}<a href="/terms" className="underline">{t('page.accept_invitation.terms_link_text')}</a>{t('page.accept_invitation.accept_terms_suffix')}</span>
          </label>

          {register.isError && <AuthError>{authErrorMessage(register.error, t('page.accept_invitation.err_register'))}</AuthError>}

          <AuthSubmit loading={register.isPending} label={t('page.accept_invitation.register_submit')} loadingLabel={t('page.accept_invitation.registering')} disabled={!canSubmit} />
        </form>
      )}
    </AuthCard>
  )
}
