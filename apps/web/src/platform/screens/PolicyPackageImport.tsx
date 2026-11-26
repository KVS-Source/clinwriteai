// Import a policy package signed by GenBioCa (docs/policy-packages.md): today, a document type's AI build plan.
// The admin picks the .cwplan file (or pastes its text), previews what changes, then imports. Each document type it
// covers gets a new policy version; documents already created keep the version they were created with.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { platformApi, type PolicyPackagePreview } from '../api/platformApi'
import { ApiError } from '../../api/client'

function errMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string; error?: string } | null
    return body?.message ?? body?.error ?? `Request failed (${err.status})`
  }
  return err instanceof Error ? err.message : 'Request failed'
}

export function PolicyPackageImport() {
  const qc = useQueryClient()
  const [draft, setDraft] = useState('')
  const [preview, setPreview] = useState<PolicyPackagePreview | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const reset = (text: string) => { setDraft(text); setPreview(null); setDone(null); previewMut.reset(); importMut.reset() }

  const previewMut = useMutation({
    mutationFn: (pkg: string) => platformApi.previewPolicyPackage(pkg),
    onSuccess:  setPreview,
  })
  const importMut = useMutation({
    mutationFn: (pkg: string) => platformApi.importPolicyPackage(pkg),
    onSuccess:  (r) => {
      setDone(`Imported ${r.packageId} v${r.packageVersion}: ${r.applied.map(a => `${a.docType} policy is now version ${a.version}`).join('; ')}. New documents use it; documents already created keep their version.`)
      setPreview(null)
      setDraft('')
      qc.invalidateQueries({ queryKey: ['document-type-policies'] })
      qc.invalidateQueries({ queryKey: ['document-type-policy'] })
    },
  })

  const onFile = async (file: File | undefined) => {
    if (file) reset((await file.text()).trim())
  }

  return (
    <section data-section="policy-package-import">
      <h3 className="text-[13px] font-semibold text-slate-900">Import a policy package</h3>
      <p className="mt-1 text-[11px] text-slate-500">
        A policy package from GenBioCa sets how the AI drafts a document type: the order sections are drafted in, what
        each section is given from earlier ones, and the drafting rules. It is checked against the GenBioCa key before
        anything changes. Preview it first.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50">
          Choose .cwplan file
          <input type="file" accept=".cwplan,.txt" className="hidden" data-field="policy-package-file" onChange={e => void onFile(e.currentTarget.files?.[0])} />
        </label>
        <span className="text-[11px] text-slate-500">or paste its contents below</span>
      </div>
      <textarea
        value={draft}
        onChange={e => reset(e.target.value)}
        placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9…"
        rows={4}
        className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 font-mono text-[11px] placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
        spellCheck={false}
        autoComplete="off"
        data-field="policy-package"
      />
      {(previewMut.error || importMut.error) && (
        <p className="mt-2 text-[12px] text-rose-700" role="alert">{errMessage(previewMut.error ?? importMut.error)}</p>
      )}
      {done && <p className="mt-2 text-[12px] text-emerald-700" data-import-done>{done}</p>}

      {preview && <PackagePreviewCard preview={preview} />}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          disabled={!draft.trim() || previewMut.isPending}
          onClick={() => previewMut.mutate(draft.trim())}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          data-action="preview-package"
        >
          {previewMut.isPending ? 'Checking…' : 'Preview'}
        </button>
        <button
          type="button"
          disabled={!preview?.ok || importMut.isPending}
          onClick={() => importMut.mutate(draft.trim())}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          data-action="import-package"
        >
          {importMut.isPending ? 'Importing…' : 'Import'}
        </button>
      </div>
    </section>
  )
}

function PackagePreviewCard({ preview }: { preview: PolicyPackagePreview }) {
  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-[12px]" data-package-preview={preview.ok ? 'ok' : 'blocked'}>
      <p className="font-semibold text-slate-900">
        {preview.packageId} · version {preview.packageVersion}
        {preview.issuedAt && <span className="font-normal text-slate-500"> · issued {new Date(preview.issuedAt).toLocaleDateString()}</span>}
      </p>
      {preview.description && <p className="mt-0.5 text-slate-600">{preview.description}</p>}
      {preview.items.map(item => (
        <div key={item.docType} className="mt-3 border-t border-slate-200 pt-2" data-package-item={item.docType}>
          <p className="font-medium text-slate-900">
            {item.docType}: policy {item.currentVersion ? `version ${item.currentVersion} → ${item.newVersion}` : `new, version ${item.newVersion}`}
            {item.template && <span className="font-normal text-slate-500"> · checked against template “{item.template.label}” v{item.template.version}</span>}
          </p>
          {item.stages.length > 0 && (
            <ol className="mt-1 list-decimal pl-5 text-slate-600">
              {item.stages.map(s => <li key={s.label}>{s.label} ({s.sections} section{s.sections === 1 ? '' : 's'})</li>)}
            </ol>
          )}
          {item.errors.map(e => <p key={e} className="mt-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-rose-800" data-package-error>{e}</p>)}
          {item.warnings.map(w => <p key={w} className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800" data-package-warning>{w}</p>)}
        </div>
      ))}
      {!preview.ok && <p className="mt-3 font-medium text-rose-800">Nothing can be imported until the problems above are fixed in a new package.</p>}
    </div>
  )
}
