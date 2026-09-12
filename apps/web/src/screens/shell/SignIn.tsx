import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi }      from '../../api'
import { useAuthStore } from '../../store'

export function SignIn() {
  const navigate = useNavigate()
  const login    = useAuthStore(s => s.login)

  const [email,    setEmail]    = useState('marcus.webb@genbiocat.com')
  const [password, setPassword] = useState('password')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await authApi.login({ email, password })
      login(res.user as Parameters<typeof login>[0])
      navigate('/mfa')
    } catch {
      setError('Invalid email or password. Try marcus.webb@genbiocat.com')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4" data-screen="sign-in">
      <div
        className="w-full max-w-[400px] rounded-xl border border-slate-200 bg-white p-10"
        style={{ boxShadow: '0 4px 24px rgba(15,23,42,0.08)' }}
      >

        {/* Header */}
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

        {/* Form title */}
        <div className="mb-6">
          <h1 className="text-lg font-bold text-slate-900">Sign in to your account</h1>
          <p className="mt-1 font-mono text-[11px] text-blue-600">Clinical Writing Module</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">

          {/* Email */}
          <div>
            <label className="block text-[13px] font-medium text-slate-600" htmlFor="email">
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="marcus.webb@genbiocat.com"
              required
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-600 focus:shadow-focus transition-colors"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-[13px] font-medium text-slate-600" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-600 focus:shadow-focus transition-colors"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">
              {error}
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="mt-2 h-10 w-full rounded-lg bg-blue-600 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>

        </form>

        {/* Footer */}
        <p className="mt-6 text-center font-mono text-[11px] text-slate-400">
          Protected by 21 CFR Part 11 compliant authentication
        </p>

      </div>
    </div>
  )
}
