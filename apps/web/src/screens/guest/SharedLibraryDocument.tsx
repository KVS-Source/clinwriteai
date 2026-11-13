// A Master Library document shared with someone who has no account (e.g. a CEO) — the page the invitation
// email's link opens. Public: no session, no cookie.
//
// The link alone opens nothing. The reader asks for a one-time code, which the API emails to the invited
// address only; the document shows after the code is entered. Someone the link is forwarded to can't get the
// code. The viewing session lives only in this tab (sessionStorage), and the document is shown for reading —
// there is no download button. API: apps/api/src/modules/platform/library/share.ts.

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiConfig } from '../../api/client'
import { PLATFORM_ACCENT } from '@platform/types'

interface ShareInfo {
  title: string
  docType: string
  version: string
  sharedByName: string | null
  sharedAt: string
  expiresAt: string
  emailHint: string
}

type Failure = { status: number; error?: string; message?: string; retryAfterSec?: number; attemptsLeft?: number }

// Plain fetch: no cookie, no persona header, no bounce to sign-in — this page belongs to no account.
async function call<T>(path: string, init?: RequestInit & { session?: string }): Promise<T> {
  const { session, ...rest } = init ?? {}
  const res = await fetch(`${apiConfig.baseUrl}${path}`, {
    credentials: 'omit',
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(rest.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(session ? { 'X-Share-Session': session } : {}),
    },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Omit<Failure, 'status'>
    throw { status: res.status, ...body } as Failure
  }
  return (path.endsWith('/pdf') ? res.blob() : res.json()) as Promise<T>
}

const sessionKey = (token: string) => `clinwrite.shared-library.${token.slice(0, 16)}`
const readSession = (token: string) => { try { return window.sessionStorage.getItem(sessionKey(token)) } catch { return null } }
const writeSession = (token: string, v: string | null) => {
  try { if (v) window.sessionStorage.setItem(sessionKey(token), v); else window.sessionStorage.removeItem(sessionKey(token)) } catch { /* private mode: the session just isn't kept */ }
}

// Refusals this page knows, in the reader's language; anything else keeps the server's words.
const ERROR_KEY: Record<string, string> = {
  link_invalid: 'page.shared_library.err_link_invalid',
  revoked: 'page.shared_library.err_revoked',
  expired: 'page.shared_library.err_expired',
  withdrawn: 'page.shared_library.err_withdrawn',
  too_many_codes: 'page.shared_library.err_too_many_codes',
  code_expired: 'page.shared_library.err_code_expired',
  too_many_attempts: 'page.shared_library.err_too_many_attempts',
  email_failed: 'page.shared_library.err_email_failed',
}

export function SharedLibraryDocument() {
  const { t } = useTranslation()
  const { token = '' } = useParams<{ token: string }>()
  const [info, setInfo] = useState<ShareInfo | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [step, setStep] = useState<'start' | 'code' | 'reading'>('start')
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [session, setSession] = useState<string | null>(() => readSession(token))
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const codeInput = useRef<HTMLInputElement>(null)

  const describe = (f: Failure) => {
    if (f.error === 'wrong_code') return t('page.shared_library.err_wrong_code', { count: f.attemptsLeft ?? 0 })
    if (f.error === 'code_recently_sent') return t('page.shared_library.err_code_recently_sent', { seconds: f.retryAfterSec ?? 60 })
    const key = f.error ? ERROR_KEY[f.error] : undefined
    return key ? t(key) : f.message ?? t('page.shared_library.err_generic')
  }
  const isFatal = (f: Failure) => ['link_invalid', 'revoked', 'expired', 'withdrawn', 'too_many_codes'].includes(f.error ?? '')

  useEffect(() => {
    let cancelled = false
    call<ShareInfo>(`/shared-library/${encodeURIComponent(token)}`)
      .then(d => { if (!cancelled) setInfo(d) })
      .catch((f: Failure) => { if (!cancelled) setFatal(describe(f)) })
    return () => { cancelled = true }
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  // With a session (just verified, or kept in this tab): fetch the document and show it.
  useEffect(() => {
    if (!info || !session) return
    let cancelled = false
    let url: string | null = null
    call<Blob>(`/shared-library/${encodeURIComponent(token)}/pdf`, { session })
      .then(blob => {
        if (cancelled) return
        url = URL.createObjectURL(blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' }))
        setPdfUrl(url); setStep('reading')
      })
      .catch((f: Failure) => {
        if (cancelled) return
        writeSession(token, null); setSession(null); setStep('start')
        if (f.status !== 401) setNotice(describe(f))
      })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [info, session, token]) // eslint-disable-line react-hooks/exhaustive-deps

  async function requestCode() {
    setBusy(true); setNotice(null)
    try {
      const r = await call<{ sentTo: string }>(`/shared-library/${encodeURIComponent(token)}/code`, { method: 'POST' })
      setSentTo(r.sentTo); setCode(''); setStep('code')
      setTimeout(() => codeInput.current?.focus(), 0)
    } catch (f) {
      const failure = f as Failure
      if (isFatal(failure)) setFatal(describe(failure))
      else { setNotice(describe(failure)); if (failure.error === 'code_recently_sent') setStep('code') }
    } finally { setBusy(false) }
  }

  async function verify() {
    if (!/^\d{6}$/.test(code)) { setNotice(t('page.shared_library.code_format')); return }
    setBusy(true); setNotice(null)
    try {
      const r = await call<{ session: string }>(`/shared-library/${encodeURIComponent(token)}/verify`, { method: 'POST', body: JSON.stringify({ code }) })
      writeSession(token, r.session); setSession(r.session)
    } catch (f) {
      const failure = f as Failure
      if (isFatal(failure)) setFatal(describe(failure)); else setNotice(describe(failure))
      if (failure.error === 'too_many_attempts' || failure.error === 'code_expired') setCode('')
    } finally { setBusy(false) }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  if (step === 'reading' && pdfUrl && info) {
    return (
      <div className="flex h-screen flex-col bg-slate-100" data-shared-reader>
        <header className="flex flex-none items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
          <span className="text-[15px] font-bold" style={{ color: PLATFORM_ACCENT.primary }}>ClinWrite</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-slate-900" data-shared-title>{info.title}</p>
            <p className="truncate text-[11px] text-slate-500">
              {info.docType} · {info.version}{info.sharedByName ? ` · ${t('page.shared_library.shared_by', { name: info.sharedByName })}` : ''}
            </p>
          </div>
          <span className="hidden rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-600 sm:inline">{t('page.shared_library.read_only')}</span>
        </header>
        {/* The browser's PDF toolbar (save / print) is hidden: a deterrent only — a determined reader can still
            screenshot or print the page; what stops the link being passed on is the emailed code. */}
        <iframe src={`${pdfUrl}#toolbar=0&navpanes=0`} title={info.title} className="min-h-0 w-full flex-1 border-0 bg-white" data-shared-frame />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm" data-shared-gate>
        <p className="text-[15px] font-bold" style={{ color: PLATFORM_ACCENT.primary }}>ClinWrite</p>
        {fatal ? (
          <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-[13px] text-red-700" data-shared-fatal>{fatal}</p>
        ) : !info ? (
          <p className="mt-4 text-[13px] text-slate-500">{t('page.shared_library.loading')}</p>
        ) : (
          <>
            <h1 className="mt-3 text-[18px] font-bold text-slate-900" data-shared-title>{info.title}</h1>
            <p className="mt-1 text-[12px] text-slate-500">
              {info.docType} · {info.version}
              {info.sharedByName ? ` · ${t('page.shared_library.shared_by', { name: info.sharedByName })}` : ''}
            </p>

            {step === 'start' && (
              <>
                <p className="mt-4 text-[13px] text-slate-700">{t('page.shared_library.code_intro', { email: info.emailHint })}</p>
                <button type="button" onClick={requestCode} disabled={busy} data-action="request-code"
                  className="mt-4 h-10 w-full rounded-md text-[14px] font-semibold text-white disabled:opacity-50" style={{ backgroundColor: PLATFORM_ACCENT.primary }}>
                  {busy ? t('page.shared_library.sending') : t('page.shared_library.send_code')}
                </button>
              </>
            )}

            {step === 'code' && (
              <form className="mt-4 flex flex-col gap-3" onSubmit={e => { e.preventDefault(); void verify() }}>
                <p className="text-[13px] text-slate-700">{t('page.shared_library.code_sent', { email: sentTo || info.emailHint })}</p>
                <input ref={codeInput} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                  onChange={e => setCode(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
                  aria-label={t('page.shared_library.code_label')} placeholder="••••••" data-code-input
                  className="h-12 rounded-md border border-slate-300 text-center font-mono text-[22px] tracking-[0.5em]" />
                <button type="submit" disabled={busy || code.length !== 6} data-action="verify-code"
                  className="h-10 rounded-md text-[14px] font-semibold text-white disabled:opacity-50" style={{ backgroundColor: PLATFORM_ACCENT.primary }}>
                  {busy ? t('page.shared_library.checking') : t('page.shared_library.open_document')}
                </button>
                <button type="button" onClick={requestCode} disabled={busy} className="text-[12px] font-semibold text-slate-600 underline" data-action="resend-code">
                  {t('page.shared_library.resend')}
                </button>
              </form>
            )}

            {notice && <p role="alert" className="mt-3 rounded-md bg-amber-50 p-2.5 text-[12px] text-amber-800" data-shared-notice>{notice}</p>}

            <p className="mt-5 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
              {t('page.shared_library.private_note', { date: fmt(info.expiresAt) })}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
