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
import i18n from '../../i18n'
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

// "tenant-admin" → "Tenant Admin", "contributor" → "Contributor".
// A role's name, the same as on the user screens. A legacy role has no translation and shows its own words.
const ROLE_LABEL_KEYS: Record<string, string> = {
  'tenant-admin': 'page.user_management_live.role_label_tenant_admin',
  pm:             'page.user_management_live.role_label_pm',
  contributor:    'page.user_management_live.role_label_contributor',
  auditor:        'page.user_management_live.role_label_auditor',
  guest:          'page.user_management_live.role_label_guest',
}
const formatRole = (role?: string) => {
  const key = role ? ROLE_LABEL_KEYS[role] : undefined
  return key ? i18n.t(key) : (role ?? '').split(/[-_\s]+/).filter(Boolean).map(w => w[0]!.toUpperCase() + w.slice(1)).join(' ')
}

// A value fixed by the invitation, styled like the email box (grey, not editable).
function ReadOnlyField({ label, value, attr }: { label: string; value: string; attr: string }) {
  return (
    <div>
      <label className="mb-1 block text-[13px] font-medium text-slate-600">{label}</label>
      <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700" {...{ [attr]: '' }}>{value}</div>
    </div>
  )
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

  const [name,     setName]     = useState('')
  const [tenantRef, setTenantRef] = useState('')   // optional free text
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
    mutationFn: () => authApi.registerFromInvite(token, name.trim(), password, tenantRef.trim() || undefined),
    onSuccess: () => navigate('/sign-in?registered=1', { replace: true }),
  })

  const data = preview.data
  const mismatch  = confirm.length > 0 && confirm !== password
  // Name, password and confirm password are mandatory (plus the Terms).
  const canSubmit = name.trim().length > 0 && passwordMeetsPolicy(password) && confirm === password && agreed

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
            {t('page.accept_invitation.greeting_prefix', { name: data.name })}<strong>{formatRole(data.role)}</strong>{t('page.accept_invitation.greeting_suffix')}
          </p>

          <AuthField id="invite-name" label={t('page.accept_invitation.name_label')} value={name} onChange={setName} autoComplete="name" placeholder={t('page.accept_invitation.name_placeholder')} autoFocus requiredMark />

          {/* Email and role are fixed by the invitation — shown read-only. */}
          <ReadOnlyField label={t('page.accept_invitation.email_label')} value={data.email ?? ''} attr="data-invite-email" />
          <ReadOnlyField label={t('page.accept_invitation.role_label')} value={formatRole(data.role)} attr="data-invite-role" />

          {/* Optional free text, saved as entered. */}
          <AuthField
            id="invite-tenant"
            label={t('page.accept_invitation.tenant_label')}
            value={tenantRef}
            onChange={setTenantRef}
            autoComplete="off"
            placeholder={t('page.accept_invitation.tenant_placeholder')}
            optional
          />
          <AuthField id="new-password" label={t('page.accept_invitation.password_label')} type="password" value={password} onChange={setPassword} autoComplete="new-password" requiredMark />
          <PasswordRules password={password} />
          <AuthField id="confirm-password" label={t('page.accept_invitation.confirm_label')} type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" requiredMark />
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
