import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { authApi } from '../../api'
import { safeReturnTo } from '../../config/auth'
import { AuthCard, AuthError, AuthField, AuthNotice, AuthSubmit, authErrorMessage } from './AuthCard'

// Password sign-in (POST /auth/password-login). On success the API has set
// the session cookie; a temporary password goes to /set-password first,
// everyone else back to where they were heading (?return_to) or home. A
// full page load (not navigate) so the session sync re-runs as the new user.
export function SignIn() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const returnTo = safeReturnTo(params.get('return_to'))
  const justReset      = params.get('reset') === '1'
  const justRegistered = params.get('registered') === '1'

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await authApi.passwordLogin({ email: email.trim(), password })
      window.location.assign(res.mustChangePassword ? '/set-password' : (returnTo ?? '/home'))
    } catch (err) {
      setError(authErrorMessage(err, t('page.sign_in.generic_error')))
      setLoading(false)
    }
  }

  return (
    <AuthCard
      screen="sign-in"
      title={t('page.sign_in.title')}
      subtitle={<span className="font-mono text-[11px] text-blue-600">{t('page.sign_in.subtitle')}</span>}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {justReset && <AuthNotice>{t('page.sign_in.reset_notice')}</AuthNotice>}
        {justRegistered && <AuthNotice>{t('page.sign_in.registered_notice')}</AuthNotice>}

        <AuthField
          id="email"
          label={t('page.sign_in.email_label')}
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="username"
          autoFocus
          placeholder={t('page.sign_in.email_placeholder')}
        />

        <div>
          <AuthField
            id="password"
            label={t('page.sign_in.password_label')}
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
          <div className="mt-1.5 text-right">
            <Link to="/forgot-password" className="text-[12px] font-medium text-blue-600 hover:text-blue-700" data-link="forgot-password">
              {t('page.sign_in.forgot_password_link')}
            </Link>
          </div>
        </div>

        {error && <AuthError>{error}</AuthError>}

        <AuthSubmit
          loading={loading}
          label={t('page.sign_in.submit')}
          loadingLabel={t('page.sign_in.submitting')}
        />
      </form>

      <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[12px] leading-relaxed text-slate-600" data-first-login-help>
        <p className="font-semibold text-slate-700">{t('page.sign_in.first_time_heading')}</p>
        <p className="mt-0.5">
          <Trans
            i18nKey="page.sign_in.first_time_body"
            components={{
              firstLoginLink: (
                <Link
                  to="/forgot-password?first=1"
                  className="font-medium text-blue-600 hover:text-blue-700"
                  data-link="first-login"
                />
              ),
            }}
          />
        </p>
      </div>
    </AuthCard>
  )
}
