import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { authApi } from '../../api'
import { AuthCard, AuthError, AuthField, AuthNotice, AuthSubmit, authErrorMessage } from './AuthCard'

// Email a set / reset password link (POST /auth/forgot-password). The API
// answers the same way whether or not the email exists, so the screen does
// too. ?first=1 is the "first time — set your password" wording of the same
// flow: an account with no password yet gets the same link.
export function ForgotPassword() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const firstTime = params.get('first') === '1'

  const [email,   setEmail]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [sent,    setSent]    = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await authApi.forgotPassword(email.trim())
      setSent(res.message)
    } catch (err) {
      setError(authErrorMessage(err, t('page.forgot_password.err_generic')))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCard
      screen={firstTime ? 'first-password' : 'forgot-password'}
      title={firstTime ? t('page.forgot_password.title_first') : t('page.forgot_password.title_reset')}
      subtitle={firstTime
        ? t('page.forgot_password.subtitle_first')
        : t('page.forgot_password.subtitle_reset')}
    >
      {sent ? (
        <div className="flex flex-col gap-4">
          <AuthNotice>{sent}</AuthNotice>
          <p className="text-[12px] text-slate-500">{t('page.forgot_password.didnt_get_it')}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <AuthField id="email" label={t('page.forgot_password.email_label')} type="email" value={email} onChange={setEmail} autoComplete="username" autoFocus placeholder={t('page.forgot_password.email_placeholder')} />
          {error && <AuthError>{error}</AuthError>}
          <AuthSubmit loading={loading} label={t('page.forgot_password.submit')} loadingLabel={t('page.forgot_password.submitting')} />
        </form>
      )}

      <p className="mt-5 text-center text-[13px]">
        <Link to="/sign-in" className="font-medium text-blue-600 hover:text-blue-700" data-link="back-to-sign-in">{t('page.forgot_password.back_to_sign_in')}</Link>
      </p>
    </AuthCard>
  )
}
