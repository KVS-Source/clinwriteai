import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { authApi } from '../../api'
import { AuthCard, AuthError, AuthField, AuthSubmit, PasswordRules, authErrorMessage, passwordMeetsPolicy } from './AuthCard'

// Choose your own password (POST /auth/change-password).
//
// First sign-in with a temporary password lands here (AuthGuard keeps
// sending a must-change session back) and can only leave by setting one or
// signing out. Opened from the account menu, it's a voluntary change with
// Cancel. Needs a session — without one it goes to /sign-in.
export function SetPassword() {
  const { t }    = useTranslation()
  const navigate = useNavigate()
  const [state, setState] = useState<'loading' | 'first' | 'change'>('loading')
  const [name,  setName]  = useState('')

  const [current,  setCurrent]  = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    let live = true
    authApi.session()
      .then(me => { if (!live) return; setName(me.name ?? ''); setState(me.mustChangePassword ? 'first' : 'change') })
      .catch(() => { if (live) navigate('/sign-in?return_to=%2Fset-password', { replace: true }) })
    return () => { live = false }
  }, [navigate])

  const mismatch  = confirm.length > 0 && confirm !== password
  const canSubmit = current.length > 0 && passwordMeetsPolicy(password) && confirm === password

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      await authApi.changePassword(current, password)
      // Full load so the session sync picks up the cleared must-change flag.
      window.location.assign('/home')
    } catch (err) {
      setError(authErrorMessage(err, t('page.set_password.err_generic')))
      setLoading(false)
    }
  }

  const signOut = async () => {
    await authApi.logout().catch(() => undefined)
    window.location.assign('/sign-in')
  }

  if (state === 'loading') {
    return <div className="flex h-screen items-center justify-center bg-slate-50 text-[13px] text-slate-500" data-session-loading>{t('page.set_password.loading')}</div>
  }

  const first = state === 'first'
  return (
    <AuthCard
      screen="set-password"
      title={first ? t('page.set_password.title_first') : t('page.set_password.title_change')}
      subtitle={first
        ? (name ? t('page.set_password.subtitle_first_with_name', { name }) : t('page.set_password.subtitle_first_no_name'))
        : t('page.set_password.subtitle_change')}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <AuthField
          id="current-password"
          label={first ? t('page.set_password.temporary_password_label') : t('page.set_password.current_password_label')}
          type="password"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          autoFocus
        />
        <AuthField id="new-password" label={t('page.set_password.new_password_label')} type="password" value={password} onChange={setPassword} autoComplete="new-password" />
        <PasswordRules password={password} />
        <AuthField id="confirm-password" label={t('page.set_password.confirm_label')} type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        {mismatch && <p className="-mt-2 text-[12px] text-red-600" data-password-mismatch>{t('page.set_password.mismatch')}</p>}

        {error && <AuthError>{error}</AuthError>}

        <AuthSubmit loading={loading} label={first ? t('page.set_password.submit_first') : t('page.set_password.submit_change')} loadingLabel={t('page.set_password.submitting')} disabled={!canSubmit} />
      </form>

      <p className="mt-5 text-center text-[13px]">
        {first
          ? <button type="button" onClick={signOut} className="font-medium text-slate-500 hover:text-slate-700" data-action="sign-out">{t('page.set_password.sign_out')}</button>
          : <button type="button" onClick={() => navigate(-1)} className="font-medium text-blue-600 hover:text-blue-700" data-action="cancel">{t('page.set_password.cancel')}</button>}
      </p>
    </AuthCard>
  )
}
