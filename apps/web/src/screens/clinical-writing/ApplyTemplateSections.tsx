// Shown in the editor for a document with no sections (older ones were created before the template
// skeleton). Its authors and the project's PMs can add the template's empty headings; the API checks this
// too. Everyone else is told the document is empty and who can fix it.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import { documentsApi } from '../../api/documents'
import i18n from '../../i18n'

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const code = (err.body as { error?: string } | null)?.error
    if (code === 'no_template') return i18n.t('page.document_editor.apply_template_err_no_template')
    if (code === 'template_apply_forbidden') return i18n.t('page.document_editor.apply_template_err_forbidden')
    if (code === 'signature_bound') return i18n.t('page.document_editor.apply_template_err_signature')
  }
  return i18n.t('page.document_editor.apply_template_err_generic')
}

export function ApplyTemplateSections({ documentId, status, canApply }: { documentId: string; status: string; canApply: boolean }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const apply = useMutation({
    mutationFn: () => documentsApi.applyTemplateSections(documentId),
    onSuccess: () => {
      // "Already has sections" means someone else got there first: the refresh shows them either way.
      void qc.invalidateQueries({ queryKey: ['document', documentId] })
      void qc.invalidateQueries({ queryKey: ['document-audit', documentId] })
    },
    onError: (err) => {
      if (err instanceof ApiError && (err.body as { error?: string } | null)?.error === 'already_has_sections') {
        void qc.invalidateQueries({ queryKey: ['document', documentId] })
      }
    },
  })
  const signatureBound = status === 'pending-signature' || status === 'signed'

  return (
    <div className="flex max-w-md flex-col items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-5" data-empty-document>
      <p className="text-sm font-bold text-slate-900">{t('page.document_editor.apply_template_title')}</p>
      {canApply && !signatureBound ? (
        <>
          <p className="text-[13px] text-slate-600">{t('page.document_editor.apply_template_body')}</p>
          <button
            type="button"
            onClick={() => apply.mutate()}
            disabled={apply.isPending}
            className="mt-1 rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            data-action="apply-template-sections"
          >
            {apply.isPending ? t('page.document_editor.apply_template_applying') : t('page.document_editor.apply_template_action')}
          </button>
          {apply.isError && <p className="text-[12px] text-red-700" role="alert" data-apply-template-error>{errorText(apply.error)}</p>}
        </>
      ) : (
        <p className="text-[13px] text-slate-600" data-apply-template-unavailable>
          {signatureBound ? t('page.document_editor.apply_template_err_signature') : t('page.document_editor.apply_template_ask')}
        </p>
      )}
    </div>
  )
}
