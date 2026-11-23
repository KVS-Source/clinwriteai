// "Approve & E-sign" — an Approver's (A) approval and Part 11 signature in one action, from the Approver
// View, once every Reviewer has finished (the document is awaiting signature and its chain
// signs Approvers first). Two pop-ups, one after the other:
//   1. Approve the document: what they are signing (the meaning) and an optional comment.
//   2. Confirm your identity: their login password (§11.200 re-authentication).
// Confirm signs their record (POST /signature-records/:id/sign); the server records it as their approval
// too. When the last Approver signs, the Authors, Reviewers and Informed are released and notified.
// Rejecting is the sibling button, ReturnToAuthoring, which needs a comment.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { signaturesApi, type SignatureRecord } from '../../api/signatures'
import { ApiError } from '../../api/client'

type Step = 'closed' | 'approve' | 'identity'

export function ApproveAndSign({ documentId, record, onSigned }: {
  documentId: string
  /** This Approver's record in the running chain: awaiting (can sign) or signed (already done). */
  record: SignatureRecord
  /** `returnedToAuthoring`: this was the last Approver to finish and another had returned the document, so it went back. */
  onSigned: (returnedToAuthoring: boolean) => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>('closed')
  const [comment, setComment] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const signMut = useMutation({
    mutationFn: () => signaturesApi.signRecord(record.id, {
      password,
      localTime:  new Date().toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }),
      deviceInfo: navigator.userAgent.slice(0, 200),
      ...(comment.trim() ? { approvalComment: comment.trim() } : {}),
    }),
    onSuccess: (res) => {
      setStep('closed')
      setComment('')
      setPassword('')
      for (const key of [['signature-chains', documentId], ['signature-chain', documentId], ['document', documentId], ['document-raci', documentId], ['comments', documentId], ['documents']]) {
        qc.invalidateQueries({ queryKey: key })
      }
      onSigned(!!(res as { returnedToAuthoring?: boolean }).returnedToAuthoring)
    },
    onError: () => setPassword(''),
  })

  const signed = record.status === 'signed'
  const errorMessage = signMut.isError
    ? ((signMut.error as ApiError | null)?.body as { message?: string } | null)?.message ?? t('page.reviewer_view.approve_sign_failed')
    : null
  const close = () => { if (!signMut.isPending) { setStep('closed'); setPassword(''); signMut.reset() } }

  return (
    <>
      <button
        type="button"
        onClick={() => { signMut.reset(); setStep('approve') }}
        disabled={signed || record.status !== 'awaiting'}
        data-action="approve-and-sign"
        className="whitespace-nowrap rounded-md border px-3.5 py-2 text-[13px] font-semibold transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        style={{ backgroundColor: '#F0FDF4', color: '#15803D', borderColor: '#BBF7D0' }}
      >
        {signed ? t('page.reviewer_view.approve_sign_done') : t('page.reviewer_view.approve_sign')}
      </button>

      {/* 1. Approve the document */}
      {step === 'approve' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="approve-sign-title" data-approve-dialog>
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <h2 id="approve-sign-title" className="text-[15px] font-bold text-slate-900">{t('page.reviewer_view.approve_sign_title')}</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{t('page.reviewer_view.approve_sign_explainer')}</p>
            {/* Part 11: the meaning of the signature is shown before signing. */}
            <div className="mt-3 rounded-md border-2 border-blue-600 bg-blue-50 p-2.5" data-meaning="approved">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">{t('page.e_signature.meaning_label')}</p>
              <p className="mt-0.5 text-[13px] font-bold text-blue-700">{t('page.e_signature.meaning_approved')}</p>
            </div>
            <label htmlFor="approve-sign-comment" className="mt-4 block text-[12px] font-semibold text-slate-700">
              {t('page.reviewer_view.approve_document_comment_label')}
            </label>
            <textarea
              id="approve-sign-comment"
              value={comment}
              onChange={e => setComment(e.currentTarget.value)}
              rows={4}
              maxLength={2000}
              autoFocus
              placeholder={t('page.reviewer_view.approve_document_comment_placeholder')}
              className="mt-1 w-full resize-none rounded-md border border-slate-300 px-2.5 py-2 text-[13px] text-slate-900 outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100"
              data-input="approve-comment"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={close} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
                {t('button.cancel')}
              </button>
              <button
                type="button"
                onClick={() => setStep('identity')}
                className="rounded-md bg-green-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-green-700"
                data-action="confirm-approve"
              >
                {t('page.reviewer_view.approve_sign_continue')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Confirm your identity */}
      {step === 'identity' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="identity-title" data-identity-dialog>
          <form
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
            onSubmit={e => { e.preventDefault(); if (password && !signMut.isPending) signMut.mutate() }}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="identity-title" className="flex items-center gap-2 text-[17px] font-bold text-slate-900">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                {t('page.reviewer_view.identity_title')}
              </h2>
              <button type="button" onClick={close} aria-label={t('button.cancel')} className="rounded p-1 text-slate-500 hover:bg-slate-100">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{t('page.reviewer_view.identity_subtitle')}</p>

            <label htmlFor="identity-password" className="mt-5 block text-[13px] font-medium text-slate-800">{t('page.e_signature.password_label')}</label>
            <div className="relative mt-1.5">
              <input
                id="identity-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={e => setPassword(e.currentTarget.value)}
                className="h-10 w-full rounded-lg border-2 border-indigo-500 px-3 pr-10 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                data-credential-input
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={t(showPassword ? 'page.reviewer_view.identity_hide_password' : 'page.reviewer_view.identity_show_password')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-slate-700"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
                  {!showPassword && <line x1="3" y1="3" x2="21" y2="21" />}
                </svg>
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{t('page.reviewer_view.identity_signing_as', { meaning: t('page.e_signature.meaning_approved') })}</p>
            {errorMessage && <p className="mt-2 rounded-md bg-red-50 px-2.5 py-1.5 text-[12px] text-red-700" role="alert" data-sign-error>{errorMessage}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={close} disabled={signMut.isPending} className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">
                {t('button.cancel')}
              </button>
              <button
                type="submit"
                disabled={!password || signMut.isPending}
                className="rounded-lg bg-indigo-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
                data-action="confirm-sign"
              >
                {signMut.isPending ? t('page.reviewer_view.identity_signing') : t('page.reviewer_view.identity_confirm')}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
