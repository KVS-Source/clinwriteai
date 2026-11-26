// Settings → Licensing tab (migration 92).
//
// Shows the current install's licence (re-verified on every GET —
// response is fresh truth) and lets IT admins paste a new signed JWT
// issued by GenBioCa HQ. Writes are IT-admin-only on the server; the
// UI surfaces the structured failure reason when a token won't verify.
//
// Important display rule: `modules` + `features` here come from the
// signed claim, NOT from the DB snapshot. If the row is tampered the
// server returns state='invalid' and modules=[] — never silently falls
// back to the snapshot.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { platformApi, type LicenseView, type LicenseState } from '../api/platformApi'
import { ApiError } from '../../api/client'
import { PolicyPackageImport } from './PolicyPackageImport'

const STATE_LABEL: Record<LicenseState, string> = {
  active:               'Active',
  expired:              'Expired',
  invalid:              'Invalid',
  dev_mode_unlicensed:  'Dev mode (no licence)',
  auto_dev_unlicensed:  'Demo mode (no licence)',
  unlicensed:           'No licence imported',
}

const STATE_COLOR: Record<LicenseState, { bg: string; fg: string; dot: string }> = {
  active:               { bg: 'bg-emerald-50', fg: 'text-emerald-900', dot: 'bg-emerald-500' },
  expired:              { bg: 'bg-amber-50',   fg: 'text-amber-900',   dot: 'bg-amber-500' },
  invalid:              { bg: 'bg-rose-50',    fg: 'text-rose-900',    dot: 'bg-rose-500' },
  dev_mode_unlicensed:  { bg: 'bg-slate-50',   fg: 'text-slate-700',   dot: 'bg-slate-400' },
  auto_dev_unlicensed:  { bg: 'bg-sky-50',     fg: 'text-sky-900',     dot: 'bg-sky-500' },
  unlicensed:           { bg: 'bg-slate-50',   fg: 'text-slate-700',   dot: 'bg-slate-400' },
}

function errMessage(err: unknown, fallback = 'Request failed'): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string; error?: string } | null
    if (body?.message) return body.message
    if (body?.error)   return body.error
    return `${err.status}`
  }
  return err instanceof Error ? err.message : fallback
}

export function LicensingTab() {
  const qc = useQueryClient()
  const licenseQ = useQuery({
    queryKey: ['license'],
    queryFn:  () => platformApi.getLicense(),
  })
  const [importDraft, setImportDraft] = useState('')
  const [importMessage, setImportMessage] = useState<string | null>(null)

  const importMut = useMutation({
    mutationFn: (token: string) => platformApi.importLicense(token),
    onSuccess:  (view) => {
      setImportDraft('')
      setImportMessage(view.customerName
        ? `Imported licence for ${view.customerName} — modules ${view.modules.join(', ') || '(none)'}.`
        : `Imported licence.`,
      )
      qc.invalidateQueries({ queryKey: ['license'] })
    },
    onError: () => { setImportMessage(null) },
  })

  return (
    <div className="flex flex-col gap-6" data-tab="licensing">
      <header>
        <h2 className="text-[16px] font-semibold text-slate-900">Licensing</h2>
        <p className="mt-1 text-[12px] text-slate-500">
          This install&rsquo;s signed licence token from GenBioCa. Modules and features are
          authorised by what&rsquo;s inside the signed token &mdash; changes to the database
          don&rsquo;t widen access. To update, paste a new token GenBioCa issued for this
          install id.
        </p>
      </header>

      {licenseQ.isLoading && <p className="text-[13px] text-slate-500">Loading licence…</p>}
      {licenseQ.error && <p className="text-[13px] text-rose-700">{errMessage(licenseQ.error, 'Could not load licence')}</p>}

      {licenseQ.data && <LicenseCard view={licenseQ.data} />}

      <section>
        <h3 className="text-[13px] font-semibold text-slate-900">Import a new licence</h3>
        <p className="mt-1 text-[11px] text-slate-500">
          Paste the token GenBioCa issued below. It will be verified against the embedded
          GenBioCa public key before being saved. A failed verification does not touch
          the existing licence.
        </p>
        <textarea
          value={importDraft}
          onChange={e => { setImportDraft(e.target.value); setImportMessage(null) }}
          placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9…"
          rows={6}
          className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 font-mono text-[11px] placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
          spellCheck={false}
          autoComplete="off"
        />
        {importMut.error && (
          <p className="mt-2 text-[12px] text-rose-700">{errMessage(importMut.error, 'Import failed')}</p>
        )}
        {importMessage && (
          <p className="mt-2 text-[12px] text-emerald-700">{importMessage}</p>
        )}
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={!importDraft.trim() || importMut.isPending}
            onClick={() => importMut.mutate(importDraft.trim())}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {importMut.isPending ? 'Verifying…' : 'Import licence'}
          </button>
        </div>
      </section>

      <PolicyPackageImport />

      {licenseQ.data?.publicKeySource === 'dev_fallback' && (
        <aside className="rounded-md border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-900">
          <p className="font-medium">Dev fallback public key in use</p>
          <p className="mt-1">
            <code>LICENSE_PUBLIC_KEY</code> env var is not set, so the embedded dev
            public key is being used. This is fine for local development but MUST be
            replaced with the real GenBioCa public key in any deployed environment.
          </p>
        </aside>
      )}
    </div>
  )
}

function LicenseCard({ view }: { view: LicenseView }) {
  const palette = STATE_COLOR[view.state]
  return (
    <section className={`rounded-lg border border-slate-200 ${palette.bg} p-4`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${palette.dot}`} />
            <span className={`text-[13px] font-semibold ${palette.fg}`}>{STATE_LABEL[view.state]}</span>
          </div>
          <p className="mt-1 text-[14px] font-semibold text-slate-900">
            {view.customerName ?? '—'}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-500">
            install id: {view.installId ?? '—'}
          </p>
        </div>
        {view.daysToExpiry !== null && (
          <div className="text-right text-[11px] text-slate-600">
            {view.daysToExpiry >= 0
              ? <>Expires in <strong>{view.daysToExpiry}</strong> day{view.daysToExpiry === 1 ? '' : 's'}</>
              : <>Expired <strong>{Math.abs(view.daysToExpiry)}</strong> day{Math.abs(view.daysToExpiry) === 1 ? '' : 's'} ago</>}
            {view.expiry && <p className="mt-0.5">{new Date(view.expiry).toLocaleDateString()}</p>}
          </div>
        )}
      </div>

      {view.invalidDetail && (
        <p className="mt-3 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800">
          <strong>{view.invalidReason ?? 'invalid'}:</strong> {view.invalidDetail}
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
        <div>
          <dt className="font-medium text-slate-700">Modules</dt>
          <dd className="mt-0.5 text-slate-600">
            {view.modules.length > 0 ? view.modules.join(', ') : <span className="text-slate-400">none</span>}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-700">Features</dt>
          <dd className="mt-0.5 text-slate-600">
            {view.features.length > 0 ? view.features.join(', ') : <span className="text-slate-400">none</span>}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-700">Issued at</dt>
          <dd className="mt-0.5 text-slate-600">{view.issuedAt ? new Date(view.issuedAt).toLocaleString() : '—'}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-700">Imported</dt>
          <dd className="mt-0.5 text-slate-600">
            {view.importedAt ? new Date(view.importedAt).toLocaleString() : '—'}
            {view.importedBy && <span className="ml-1 font-mono text-[10px] text-slate-400">by {view.importedBy}</span>}
          </dd>
        </div>
      </dl>
    </section>
  )
}
