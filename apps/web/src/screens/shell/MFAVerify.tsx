import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi }      from '../../api'
import { useAuthStore } from '../../store'

export function MFAVerify() {
  const navigate      = useNavigate()
  const verifyMFA     = useAuthStore(s => s.verifyMFA)
  const hasAcceptedTC = useAuthStore(s => s.hasAcceptedTC)

  const [code,    setCode]    = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 6)
    setCode(val)
    setError(null)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (code.length < 6) return
    setLoading(true)
    setError(null)
    try {
      await authApi.verifyMFA({ code })
      verifyMFA()
      navigate(hasAcceptedTC ? '/projects' : '/terms')
    } catch {
      setError('Invalid code. Enter any 6-digit number for the prototype.')
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div
        className="w-full max-w-[400px] rounded-xl border border-slate-200 bg-white p-10"
        style={{ boxShadow: '0 4px 24px rgba(15,23,42,0.08)' }}
      >

        {/* Header — identical to SignIn */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-blue-600">
            <span className="font-mono text-sm font-bold text-white">C</span>
          </div>
          <div>
            <p className="text-lg font-bold leading-tight text-slate-900">ClinWrite.AI</p>
            <p className="text-xs leading-tight text-slate-400">AI-Native Authoring for Life Sciences</p>
          </div>
        </div>

        {/* Divider */}
        <div className="my-6 border-t border-slate-200" />

        {/* Title */}
        <div className="mb-6">
          <h1 className="text-lg font-bold text-slate-900">Two-factor authentication</h1>
          <p className="mt-1.5 text-[13px] text-slate-500">
            Enter the 6-digit code from your authenticator app
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col">

          {/* Code input */}
          <div>
            <label className="block text-[13px] font-medium text-slate-600" htmlFor="code">
              Authentication code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={handleChange}
              placeholder="000000"
              autoComplete="one-time-code"
              autoFocus
              className="mt-1.5 h-12 w-full rounded-lg border border-slate-200 px-4 text-center font-mono text-xl font-semibold tracking-[0.25em] text-slate-900 outline-none placeholder:text-slate-300 focus:border-blue-600 focus:shadow-focus transition-colors"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">
              {error}
            </p>
          )}

          {/* Verify button */}
          <button
            type="submit"
            disabled={loading || code.length < 6}
            className="mt-6 h-10 w-full rounded-lg bg-blue-600 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? 'Verifying…' : 'Verify code'}
          </button>

        </form>

        {/* Back link */}
        <p className="mt-4 text-center">
          <button
            type="button"
            onClick={() => navigate('/sign-in')}
            className="text-[13px] text-slate-500 hover:text-slate-900 transition-colors"
          >
            ← Back to sign in
          </button>
        </p>

        {/* Footer */}
        <p className="mt-6 text-center font-mono text-[11px] text-slate-400">
          Protected by 21 CFR Part 11 compliant authentication
        </p>

      </div>
    </div>
  )
}
