// Initiate a Part 11 signature chain (FR-A-066) — POST /documents/:id/signature-chains.
// Shown on the E-Signature screen when no active chain exists. The API only
// accepts this once CRM is complete (document status pending_signature) and
// rejects a second active chain; both cases are explained inline.

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { projectsApi } from '../../api'
import { ApiError } from '../../api/client'
import { platformApi } from '../../platform/api/platformApi'
import { useCurrentUser, useInitiateSignatureChain } from '../../hooks'

type Meaning = 'authored' | 'reviewed' | 'approved'
type Candidate = { id: string; name: string; role: string }
type SignerRow = { signerId: string; meaning: Meaning }

const MEANINGS: { value: Meaning; label: string }[] = [
  { value: 'authored', label: 'Authored' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'approved', label: 'Approved' },
]

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; message?: string; issues?: Array<{ message: string }> } | null
    if (body?.error === 'wrong_status') return 'The chain can only be started once the Comments Resolution Meeting is complete (status: Pending signature).'
    if (body?.error === 'chain_already_active') return 'A signature chain is already active for this document.'
    if (body?.issues?.[0]?.message) return body.issues[0].message
    if (body?.message) return body.message
  }
  return 'Could not start the signature chain. Please try again.'
}

interface Props {
  documentId: string
  projectId: string
  /** UI document status (hyphen-case), e.g. 'pending-signature'. */
  documentStatus: string | undefined
}

export function InitiateSignatureChain({ documentId, projectId, documentStatus }: Props) {
  const { data: me } = useCurrentUser()
  const initiate = useInitiateSignatureChain(documentId)

  // Signers must be real accounts — the API only lets the record's signerId
  // sign. Prefer the user directory; fall back to the project team.
  const users = useQuery({ queryKey: ['platform-users'], queryFn: () => platformApi.listUsers(), retry: false })
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => projectsApi.get(projectId), enabled: !!projectId })

  const candidates: Candidate[] = useMemo(() => {
    const active = (users.data ?? []).filter(u => u.status === 'active').map(u => ({ id: u.id, name: u.name, role: u.role }))
    if (active.length) return active.sort((a, b) => a.name.localeCompare(b.name))
    return (project.data?.team ?? []).map(t => ({ id: t.userId, name: t.name, role: t.role }))
  }, [users.data, project.data])

  const [chainType, setChainType] = useState<'sequential' | 'parallel'>('sequential')
  const [rows, setRows] = useState<SignerRow[]>([])

  // Default the first signer to the current user as author.
  const effectiveRows = rows.length ? rows : (me ? [{ signerId: me.id, meaning: 'authored' as Meaning }] : [{ signerId: '', meaning: 'authored' as Meaning }])
  const update = (next: SignerRow[]) => setRows(next)
  const setRow = (i: number, patch: Partial<SignerRow>) => update(effectiveRows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= effectiveRows.length) return
    const next = [...effectiveRows]
    ;[next[i], next[j]] = [next[j], next[i]]
    update(next)
  }

  const pending = documentStatus === 'pending-signature'
  const duplicate = new Set(effectiveRows.map(r => r.signerId)).size !== effectiveRows.length
  const incomplete = effectiveRows.some(r => !r.signerId)
  const canSubmit = pending && !duplicate && !incomplete && !initiate.isPending

  const submit = () => {
    const byId = new Map(candidates.map(c => [c.id, c]))
    initiate.mutate({
      chainType,
      signers: effectiveRows.map(r => {
        const c = byId.get(r.signerId)
        return { signerId: r.signerId, signerName: c?.name ?? r.signerId, signerRole: c?.role ?? 'signer', meaning: r.meaning }
      }),
    })
  }

  if (!pending) {
    return (
      <div className="flex flex-col items-center gap-2 text-center" data-initiate-blocked>
        <p className="font-mono text-sm text-slate-500">No signature chain has been initiated for this document.</p>
        <p className="max-w-md text-xs text-slate-500">
          The chain can be started once review and the Comments Resolution Meeting are complete
          (current status: <span className="font-semibold">{documentStatus ? documentStatus.replace(/-/g, ' ') : '—'}</span>).
        </p>
      </div>
    )
  }

  return (
    <div className="flex w-full max-w-[720px] flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 text-left" data-initiate-chain>
      <div>
        <p className="text-sm font-bold text-slate-900">Initiate signature chain</p>
        <p className="mt-1 text-xs text-slate-500">
          Choose who signs, the meaning of each signature and the order. Signatures cannot be delegated (21 CFR Part 11).
        </p>
      </div>

      <div className="flex items-center gap-4 text-[12px] text-slate-700">
        {(['sequential', 'parallel'] as const).map(t => (
          <label key={t} className="flex items-center gap-1.5">
            <input type="radio" name="chain-type" checked={chainType === t} onChange={() => setChainType(t)} data-chain-type={t} />
            {t === 'sequential' ? 'Sequential (one after another)' : 'Parallel (any order)'}
          </label>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {effectiveRows.map((r, i) => (
          <div key={i} className="flex items-center gap-2" data-signer-row={i}>
            <span className="w-6 flex-none text-center font-mono text-[12px] font-bold text-slate-500">{i + 1}</span>
            <select
              value={r.signerId}
              onChange={e => setRow(i, { signerId: e.currentTarget.value })}
              className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 px-2 text-[13px]"
              data-signer-select
            >
              <option value="" disabled>Select signer…</option>
              {candidates.map(c => <option key={c.id} value={c.id}>{c.name} · {c.role}</option>)}
            </select>
            <select
              value={r.meaning}
              onChange={e => setRow(i, { meaning: e.currentTarget.value as Meaning })}
              className="h-9 w-32 flex-none rounded-md border border-slate-300 px-2 text-[13px]"
              data-meaning-select
            >
              {MEANINGS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="h-9 w-8 rounded-md border border-slate-200 text-slate-600 disabled:opacity-30" aria-label="Move up">↑</button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === effectiveRows.length - 1} className="h-9 w-8 rounded-md border border-slate-200 text-slate-600 disabled:opacity-30" aria-label="Move down">↓</button>
            <button type="button" onClick={() => update(effectiveRows.filter((_, j) => j !== i))} disabled={effectiveRows.length === 1} className="h-9 w-8 rounded-md border border-slate-200 text-slate-500 hover:text-red-700 disabled:opacity-30" aria-label="Remove signer">✕</button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => update([...effectiveRows, { signerId: '', meaning: 'reviewed' }])}
          className="self-start text-[12px] font-semibold text-blue-700 hover:underline"
          data-add-signer
        >+ Add signer</button>
      </div>

      {duplicate && <p className="text-[12px] text-amber-700">Each person can appear only once in the chain.</p>}
      {initiate.isError && <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800" data-initiate-error>{errorText(initiate.error)}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          data-initiate-submit
        >{initiate.isPending ? 'Starting…' : 'Start signature chain'}</button>
      </div>
    </div>
  )
}
