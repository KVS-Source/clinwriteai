// Shared chrome for the sign-in screens (sign in, forgot / reset / set
// password): the ClinWrite card, its header, and the password-policy
// checklist. The policy mirrors apps/api/src/auth/password.ts — the server
// re-checks on every password-set call, this only gives live feedback.

import type { ReactNode } from 'react'
import { ApiError } from '../../api/client'

export function AuthCard({ title, subtitle, screen, children }: {
  title: string
  subtitle?: ReactNode
  screen: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4" data-screen={screen}>
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

        <div className="my-6 border-t border-slate-200" />

        <div className="mb-6">
          <h1 className="text-lg font-bold text-slate-900">{title}</h1>
          {subtitle && <div className="mt-1 text-[13px] leading-relaxed text-slate-500">{subtitle}</div>}
        </div>

        {children}

        <p className="mt-6 text-center font-mono text-[11px] text-slate-400">
          Protected by 21 CFR Part 11 compliant authentication
        </p>
      </div>
    </div>
  )
}

export function AuthField({ id, label, type = 'text', value, onChange, autoComplete, autoFocus, placeholder }: {
  id: string
  label: string
  type?: 'text' | 'email' | 'password'
  value: string
  onChange: (v: string) => void
  autoComplete?: string
  autoFocus?: boolean
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-slate-600" htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        placeholder={placeholder}
        required
        className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-600 focus:shadow-focus transition-colors"
      />
    </div>
  )
}

export function AuthError({ children }: { children: ReactNode }) {
  return <div className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600" role="alert" data-auth-error>{children}</div>
}

export function AuthNotice({ children }: { children: ReactNode }) {
  return <div className="rounded-lg bg-blue-50 px-3 py-2 text-[13px] text-blue-800" role="status" data-auth-notice>{children}</div>
}

export function AuthSubmit({ loading, label, loadingLabel, disabled }: { loading: boolean; label: string; loadingLabel: string; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="mt-2 h-10 w-full rounded-lg bg-blue-600 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {loading ? loadingLabel : label}
    </button>
  )
}

// --- Password policy (mirror of the server's validatePasswordPolicy) ---

const PASSWORD_RULES: Array<{ label: string; ok: (pw: string) => boolean }> = [
  { label: 'At least 12 characters',  ok: pw => pw.length >= 12 },
  { label: 'An uppercase letter',     ok: pw => /[A-Z]/.test(pw) },
  { label: 'A lowercase letter',      ok: pw => /[a-z]/.test(pw) },
  { label: 'A number',                ok: pw => /[0-9]/.test(pw) },
  { label: 'A symbol (e.g. ! @ # -)', ok: pw => /[^A-Za-z0-9]/.test(pw) },
]

export const passwordMeetsPolicy = (pw: string) => pw.length <= 128 && PASSWORD_RULES.every(r => r.ok(pw))

export function PasswordRules({ password }: { password: string }) {
  return (
    <ul className="-mt-1 flex flex-col gap-0.5 text-[12px]" data-password-rules>
      {PASSWORD_RULES.map(rule => {
        const ok = rule.ok(password)
        return (
          <li key={rule.label} className={ok ? 'text-green-700' : 'text-slate-500'} data-rule-ok={ok || undefined}>
            <span aria-hidden className="mr-1.5 inline-block w-3">{ok ? '✓' : '·'}</span>{rule.label}
          </li>
        )
      })}
    </ul>
  )
}

/** The message to show for a failed auth call — the server's own words when it sent some. */
export function authErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string; issues?: Array<{ message: string }> } | null
    if (body?.issues?.length) return body.issues.map(i => i.message).join(' ')
    if (body?.message) return body.message
    if (err.status === 429) return 'Too many attempts. Wait a minute and try again.'
  } else {
    return 'Could not reach the server. Check your connection and try again.'
  }
  return fallback
}
