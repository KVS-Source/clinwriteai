import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { authApi } from '../../api'
import { safeReturnTo } from '../../config/auth'
import { AuthCard, AuthError, AuthField, AuthNotice, AuthSubmit, authErrorMessage } from './AuthCard'

// Password sign-in (POST /auth/password-login). On success the API has set
// the session cookie; a temporary password goes to /set-password first,
// everyone else back to where they were heading (?return_to) or home. A
// full page load (not navigate) so the session sync re-runs as the new user.
export function SignIn() {
  const [params] = useSearchParams()
  const returnTo = safeReturnTo(params.get('return_to'))
  const justReset = params.get('reset') === '1'

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
      setError(authErrorMessage(err, 'Sign-in failed. Please try again.'))
      setLoading(false)
    }
  }

  return (
    <AuthCard
      screen="sign-in"
      title="Sign in to your account"
      subtitle={<span className="font-mono text-[11px] text-blue-600">Clinical Writing Module</span>}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {justReset && <AuthNotice>Your password has been updated. Sign in with your new password.</AuthNotice>}

        <AuthField id="email" label="Email address" type="email" value={email} onChange={setEmail} autoComplete="username" autoFocus placeholder="name@company.com" />

        <div>
          <AuthField id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
          <div className="mt-1.5 text-right">
            <Link to="/forgot-password" className="text-[12px] font-medium text-blue-600 hover:text-blue-700" data-link="forgot-password">
              Forgot password?
            </Link>
          </div>
        </div>

        {error && <AuthError>{error}</AuthError>}

        <AuthSubmit loading={loading} label="Sign in" loadingLabel="Signing in…" />
      </form>

      <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[12px] leading-relaxed text-slate-600" data-first-login-help>
        <p className="font-semibold text-slate-700">First time signing in?</p>
        <p className="mt-0.5">
          Use the temporary password your administrator gave you — you’ll choose your own password next.
          No temporary password?{' '}
          <Link to="/forgot-password?first=1" className="font-medium text-blue-600 hover:text-blue-700" data-link="first-login">
            Set your password by email
          </Link>.
        </p>
      </div>
    </AuthCard>
  )
}
