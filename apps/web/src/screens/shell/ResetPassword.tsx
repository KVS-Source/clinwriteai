import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { authApi } from '../../api'
import { ApiError } from '../../api/client'
import { AuthCard, AuthError, AuthField, AuthSubmit, PasswordRules, authErrorMessage, passwordMeetsPolicy } from './AuthCard'

// Landing page for the emailed link (/reset-password?token=…). Sets the new
// password via POST /auth/reset-password, which also signs out every other
// session; the user then signs in with it.
export function ResetPassword() {
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
      setError(authErrorMessage(err, 'Could not set the password. Please try again.'))
      setLoading(false)
    }
  }

  if (token.length < 32) {
    return (
      <AuthCard screen="reset-password" title="Link not valid" subtitle="This password link is incomplete. Open it again from your email, or request a new one.">
        <Link to="/forgot-password" className="block h-10 rounded-lg bg-blue-600 text-center text-sm font-semibold leading-10 text-white hover:bg-blue-700">Request a new link</Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard screen="reset-password" title="Choose your password" subtitle="Pick a password you don’t use anywhere else.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <AuthField id="new-password" label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
        <PasswordRules password={password} />
        <AuthField id="confirm-password" label="Confirm new password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        {mismatch && <p className="-mt-2 text-[12px] text-red-600" data-password-mismatch>Passwords don’t match.</p>}

        {error && (
          <AuthError>
            {error}
            {expired && <> <Link to="/forgot-password" className="font-semibold underline">Request a new link</Link>.</>}
          </AuthError>
        )}

        <AuthSubmit loading={loading} label="Set password" loadingLabel="Saving…" disabled={!canSubmit} />
      </form>
    </AuthCard>
  )
}
