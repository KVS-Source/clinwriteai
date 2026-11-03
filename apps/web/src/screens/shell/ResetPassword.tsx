import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { authApi } from '../../api'
import { ApiError } from '../../api/client'
import { AuthCard, AuthError, AuthField, AuthSubmit, PasswordRules, authErrorMessage, passwordMeetsPolicy } from './AuthCard'

// Landing page for the emailed link (/reset-password?token=…). Sets the new
// password via POST /auth/reset-password, which also signs out every other
// session; the user then signs in with it.
export function ResetPassword() {
  const { t }    = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [expired,  setExpired]  = useState(false)

  const mismatch = confirm.length > 0 && confirm !== password
  const canSubmit = passwordMeetsPolicy(password) && confirm === password

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      await authApi.resetPassword(token, password)
      navigate('/sign-in?reset=1', { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) setExpired(true)
      setError(authErrorMessage(err, t('page.reset_password.err_generic')))
      setLoading(false)
    }
  }

  if (token.length < 32) {
    return (
      <AuthCard screen="reset-password" title={t('page.reset_password.link_invalid_title')} subtitle={t('page.reset_password.link_invalid_subtitle')}>
        <Link to="/forgot-password" className="block h-10 rounded-lg bg-blue-600 text-center text-sm font-semibold leading-10 text-white hover:bg-blue-700">{t('page.reset_password.request_new_link')}</Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard screen="reset-password" title={t('page.reset_password.title')} subtitle={t('page.reset_password.subtitle')}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <AuthField id="new-password" label={t('page.reset_password.new_password_label')} type="password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
        <PasswordRules password={password} />
        <AuthField id="confirm-password" label={t('page.reset_password.confirm_label')} type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        {mismatch && <p className="-mt-2 text-[12px] text-red-600" data-password-mismatch>{t('page.reset_password.mismatch')}</p>}

        {error && (
          <AuthError>
            {error}
            {expired && <> <Link to="/forgot-password" className="font-semibold underline">{t('page.reset_password.err_expired_link_suffix')}</Link>.</>}
          </AuthError>
        )}

        <AuthSubmit loading={loading} label={t('page.reset_password.submit')} loadingLabel={t('page.reset_password.submitting')} disabled={!canSubmit} />
      </form>
    </AuthCard>
  )
}
