// Guest document review — the page a KOL / sponsor / external SME lands
// on after clicking the magic link in their invitation email.
//
// Public: zero session, zero cookie. The signed JWT in the URL path is
// the sole credential. All API calls go through guestRedemptionApi
// which routes through client.ts's `on401: 'throw'` so we render our
// own error states instead of bouncing to /auth/login.
//
// Design: docs/roles-and-permissions.md §6.1 (flow) + §6.3 (what the
// guest cannot do).
//
// Guest can:
//   - read the current version's sections
//   - see every comment on the doc (per §10 Q2 v1 default)
//   - leave a comment scoped to one section
//
// Guest cannot (enforced by what the backend omits + what we render):
//   - download the document
//   - see prior versions
//   - see other documents or the project
//   - resolve or edit other reviewers' comments
//   - export anything

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import { ApiError } from '../../api/client'
import { documentStatusLabel, documentTypeLabel } from '../../utils/documentLabels'
import { uiLocale } from '../../utils/formatDate'
import {
  guestRedemptionApi,
  type GuestDocumentPayload,
  type GuestVerifyResult,
} from '../../api/raci'

// The invitation's refusal in the guest's language. A refusal this screen doesn't know keeps the server's words.
const GUEST_ERROR_KEY: Record<string, string> = {
  bad_token: 'page.guest_document_review.err_bad_token',
  invitation_not_found: 'page.guest_document_review.err_not_found',
  revoked: 'page.guest_document_review.err_revoked',
  expired: 'page.guest_document_review.err_expired',
  scope_mismatch: 'page.guest_document_review.err_scope_mismatch',
  document_mismatch: 'page.guest_document_review.err_mismatch',
  project_mismatch: 'page.guest_document_review.err_mismatch',
  document_not_found: 'page.guest_document_review.err_document_not_found',
}

function guestErrorText(e: ApiError): string {
  const body = (e.body ?? {}) as { error?: string; message?: string }
  if (body.error === 'token_invalid') {
    return i18n.t(/expired/i.test(body.message ?? '') ? 'page.guest_document_review.err_token_expired' : 'page.guest_document_review.err_token_invalid')
  }
  const key = body.error ? GUEST_ERROR_KEY[body.error] : undefined
  return key ? i18n.t(key) : body.message ?? body.error ?? friendlyFor(e.status)
}

const COMMENT_STATUS_KEY: Record<string, string> = {
  open: 'page.guest_document_review.comment_open',
  resolved: 'page.guest_document_review.comment_resolved',
}

export function GuestDocumentReview() {
  const { t } = useTranslation()
  const { token } = useParams<{ token: string }>()
  const [verify,  setVerify]  = useState<GuestVerifyResult | null>(null)
  const [doc,     setDoc]     = useState<GuestDocumentPayload | null>(null)
  const [error,   setError]   = useState<{ code: number; message: string } | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!token) {
      setError({ code: 400, message: t('page.guest_document_review.missing_token') })
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const v = await guestRedemptionApi.verify(token)
      setVerify(v)
      if (v.scope !== 'document') {
        setError({
          code: 403,
          message: t('page.guest_document_review.wrong_scope'),
        })
        setLoading(false)
        return
      }
      const payload = await guestRedemptionApi.fetchDocument(token)
      setDoc(payload)
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setError({ code: e.status, message: guestErrorText(e) })
      } else {
        setError({ code: 500, message: friendlyFor(500) })
      }
    } finally {
      setLoading(false)
    }
  }, [token, t])

  useEffect(() => { void refresh() }, [refresh])

  if (loading) return <GuestShell><div className="text-sm text-slate-500">{t('status.loading')}</div></GuestShell>

  if (error) {
    return (
      <GuestShell>
        <ErrorCard code={error.code} message={error.message} onRetry={() => void refresh()} />
      </GuestShell>
    )
  }

  if (!doc || !verify) {
    return <GuestShell><ErrorCard code={500} message={t('page.guest_document_review.load_failed')} onRetry={() => void refresh()} /></GuestShell>
  }

  return <ReviewView doc={doc} token={token!} onCommentPosted={() => void refresh()} />
}

// -----------------------------------------------------------------------
// Review view — stripped doc + comment composer per section.
// -----------------------------------------------------------------------
function ReviewView({ doc, token, onCommentPosted }: {
  doc: GuestDocumentPayload
  token: string
  onCommentPosted: () => void
}) {
  const { t } = useTranslation()
  const commentsBySection = useMemo(() => {
    const out: Record<string, GuestDocumentPayload['comments']> = {}
    for (const c of doc.comments) {
      const key = c.sectionRef
      const bucket = out[key] ?? []
      bucket.push(c)
      out[key] = bucket
    }
    return out
  }, [doc.comments])

  return (
    <GuestShell wide>
      <header className="mb-6 border-b border-slate-200 pb-4">
        <h1 className="text-xl font-semibold text-slate-900">{doc.document.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span className="rounded border border-slate-300 bg-slate-50 px-2 py-0.5 font-mono text-[10px]">
            {documentTypeLabel(doc.document.type.replace(/_/g, '-'), doc.document.type)}
          </span>
          <span>{t('page.guest_document_review.label_status')} <span className="font-semibold text-slate-700">{documentStatusLabel(doc.document.status.replace(/_/g, '-'), doc.document.status)}</span></span>
          <span>{t('page.guest_document_review.label_guest')} <span className="font-semibold text-slate-700">{doc.guest.email}</span></span>
          <span>{t('page.guest_document_review.label_purpose')} <span className="font-semibold text-slate-700">{doc.guest.purpose}</span></span>
          <span>
            {t('page.guest_document_review.label_expires')} <span className="font-semibold text-slate-700">
              {new Date(doc.guest.expiresAt).toLocaleString(uiLocale())}
            </span>
          </span>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {t('page.guest_document_review.intro')}
        </p>
      </header>

      {doc.sections.length === 0 ? (
        <div className="text-sm text-slate-500">
          {t('page.guest_document_review.no_content')}
        </div>
      ) : (
        doc.sections.map(sec => {
          const sectionRef = `§${sec.sectionNumber}`
          const sectionComments = commentsBySection[sectionRef] ?? []
          return (
            <section key={sec.sectionId} className="mb-10 scroll-mt-8" id={`section-${sec.sectionId}`}>
              <h2 className="mb-2 text-base font-semibold text-slate-900">
                <span className="mr-2 text-xs font-mono text-slate-500">{sectionRef}</span>
                {sec.sectionTitle}
              </h2>
              {/* Section HTML is server-trusted (authored by internal Rs);
                  comments below are rendered as plain text (safe). */}
              <div
                className="prose prose-sm max-w-none text-slate-800"
                dangerouslySetInnerHTML={{ __html: sec.contentHtml || `<em>${t('page.guest_document_review.no_section_content')}</em>` }}
              />
              <CommentBlock
                token={token}
                sectionRef={sectionRef}
                comments={sectionComments}
                onPosted={onCommentPosted}
              />
            </section>
          )
        })
      )}
    </GuestShell>
  )
}

// -----------------------------------------------------------------------
// Comment list + composer for one section.
// -----------------------------------------------------------------------
function CommentBlock({ token, sectionRef, comments, onPosted }: {
  token: string
  sectionRef: string
  comments: GuestDocumentPayload['comments']
  onPosted: () => void
}) {
  const { t } = useTranslation()
  const [text, setText]   = useState('')
  const [busy, setBusy]   = useState(false)
  const [err,  setErr]    = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    setBusy(true)
    setErr(null)
    try {
      await guestRedemptionApi.addComment(token, { sectionRef, text: trimmed })
      setText('')
      onPosted()
    } catch (e: unknown) {
      setErr(e instanceof ApiError ? guestErrorText(e) : t('page.guest_document_review.post_failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 border-l-2 border-slate-200 pl-4">
      {comments.length > 0 && (
        <ul className="mb-3 space-y-2">
          {comments.map(c => (
            <li key={c.id} className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold text-slate-700">
                  {c.id.startsWith('G-') ? t('page.guest_document_review.reviewer_external') : t('page.guest_document_review.reviewer_internal')}
                </span>
                <span className="text-slate-400">
                  {new Date(c.createdAt).toLocaleString(uiLocale())} · {COMMENT_STATUS_KEY[c.status] ? t(COMMENT_STATUS_KEY[c.status]!) : c.status}
                </span>
              </div>
              <div className="whitespace-pre-wrap text-slate-800">{c.text}</div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="flex items-start gap-2">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={t('page.guest_document_review.comment_placeholder', { section: sectionRef })}
          rows={2}
          maxLength={5000}
          className="flex-1 rounded border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || text.trim().length === 0}
          className="rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
        >
          {busy ? t('page.guest_document_review.posting') : t('page.guest_document_review.post')}
        </button>
      </form>
      {err && <div className="mt-2 text-xs text-rose-600">{err}</div>}
    </div>
  )
}

// -----------------------------------------------------------------------
// Shell + error presentation
// -----------------------------------------------------------------------
function GuestShell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-slate-100 p-6" data-guest-review data-no-aurora-shell>
      <div className={`mx-auto ${wide ? 'max-w-4xl' : 'max-w-md'} rounded-lg border border-slate-200 bg-white p-8 shadow-sm`}>
        {children}
      </div>
    </div>
  )
}

function ErrorCard({ code, message, onRetry }: { code: number; message: string; onRetry: () => void }) {
  const { t } = useTranslation()
  const title = titleFor(code)
  const colour = code >= 500 ? '#BE123C' : code === 410 ? '#A16207' : '#334155'
  return (
    <div className="text-center" role="alert">
      <div
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-full font-bold text-white"
        style={{ backgroundColor: colour }}
      >
        {code}
      </div>
      <h1 className="mt-4 text-lg font-semibold text-slate-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">{message}</p>
      {code !== 410 && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center rounded border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {t('page.guest_document_review.try_again')}
        </button>
      )}
    </div>
  )
}

function titleFor(code: number): string {
  if (code === 410) return i18n.t('page.guest_document_review.title_410')
  if (code === 404) return i18n.t('page.guest_document_review.title_404')
  if (code === 403) return i18n.t('page.guest_document_review.title_403')
  if (code === 401) return i18n.t('page.guest_document_review.title_401')
  if (code === 400) return i18n.t('page.guest_document_review.title_400')
  return i18n.t('page.guest_document_review.title_other')
}

function friendlyFor(code: number): string {
  if (code === 410) return i18n.t('page.guest_document_review.friendly_410')
  if (code === 404) return i18n.t('page.guest_document_review.friendly_404')
  if (code === 403) return i18n.t('page.guest_document_review.friendly_403')
  if (code === 401) return i18n.t('page.guest_document_review.friendly_401')
  return i18n.t('page.guest_document_review.friendly_other')
}
