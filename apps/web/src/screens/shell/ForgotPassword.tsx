import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { authApi } from '../../api'
import { AuthCard, AuthError, AuthField, AuthNotice, AuthSubmit, authErrorMessage } from './AuthCard'

// Email a set / reset password link (POST /auth/forgot-password). The API
// answers the same way whether or not the email exists, so the screen does
// too. ?first=1 is the "first time — set your password" wording of the same
// flow: an account with no password yet gets the same link.
export function ForgotPassword() {
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
      setError(authErrorMessage(err, 'Could not send the link. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCard
      screen={firstTime ? 'first-password' : 'forgot-password'}
      title={firstTime ? 'Set your password' : 'Reset your password'}
      subtitle={firstTime
        ? 'Enter your work email and we’ll send you a link to choose your password.'
        : 'Enter your work email and we’ll send you a link to choose a new password.'}
    >
      {sent ? (
        <div className="flex flex-col gap-4">
          <AuthNotice>{sent}</AuthNotice>
          <p className="text-[12px] text-slate-500">Didn’t get it? Check your spam folder, or ask your administrator for a temporary password.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <AuthField id="email" label="Email address" type="email" value={email} onChange={setEmail} autoComplete="username" autoFocus placeholder="name@company.com" />
          {error && <AuthError>{error}</AuthError>}
          <AuthSubmit loading={loading} label="Email me a link" loadingLabel="Sending…" />
        </form>
      )}

      <p className="mt-5 text-center text-[13px]">
        <Link to="/sign-in" className="font-medium text-blue-600 hover:text-blue-700" data-link="back-to-sign-in">← Back to sign in</Link>
      </p>
    </AuthCard>
  )
}
