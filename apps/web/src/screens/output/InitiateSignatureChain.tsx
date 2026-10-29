// Initiate a Part 11 signature chain (FR-A-066) — POST /documents/:id/signature-chains.
// Shown on the E-Signature screen when no active chain exists. The API only
// accepts this once CRM is complete (document status pending_signature) and
// rejects a second active chain; both cases are explained inline.

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { projectsApi } from '../../api'
import { ApiError } from '../../api/client'
import { platformApi } from '../../platform/api/platformApi'
import { useCurrentUser, useInitiateSignatureChain } from '../../hooks'

type Meaning = 'authored' | 'reviewed' | 'approved'
type Candidate = { id: string; name: string; role: string }
// `locked` rows represent mandated team Approvers (RACI='A') — the user
// cannot remove them, change their signer, or change their meaning. They
// may be reordered.
type SignerRow = { signerId: string; meaning: Meaning; locked?: boolean }

const MEANINGS: { value: Meaning; label: string }[] = [
  { value: 'authored', label: 'Authored' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'approved', label: 'Approved' },
]

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as {
      error?: string
      message?: string
      issues?: Array<{ message: string }>
      missingApprovers?: Array<{ userId: string; name: string }>
    } | null
    if (body?.error === 'wrong_status') return 'The chain can only be started once the Comments Resolution Meeting is complete (status: Pending signature).'
    if (body?.error === 'chain_already_active') return 'A signature chain is already active for this document.'
    if (body?.error === 'no_approvers_configured') return 'This project has no team members with RACI=\'A\'. Assign at least one Approver on the project team before starting the signature chain.'
    if (body?.error === 'missing_approvers') {
      const names = body.missingApprovers?.map(a => a.name).join(', ') ?? ''
      return `Every Approver on the project team must sign. Missing: ${names || 'see team roster'}.`
    }
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

  // Mandated signers — every team member with RACI='A' (Approver) must be
  // in the chain with meaning='approved' or the API rejects init with
  // `missing_approvers`. We seed these rows locked, so the user can
  // reorder but not drop them.
  const approverSigners: SignerRow[] = useMemo(() => {
    const team = project.data?.team ?? []
    return team
      .filter(t => t.raci === 'A')
      .map(t => ({ signerId: t.userId, meaning: 'approved' as Meaning, locked: true }))
  }, [project.data])

  // Seed the row list once project data has loaded: all Approvers (locked)
  // plus a convenience "me as author" row that the user can edit/remove.
  // Re-runs if the team changes (e.g. an Approver added mid-session).
  useEffect(() => {
    if (!project.data) return
    setRows(prev => {
      // Keep any user-added rows (non-locked, not already an Approver).
      const approverIds = new Set(approverSigners.map(a => a.signerId))
      const userAdded = prev.filter(r => !r.locked && !approverIds.has(r.signerId))
      if (userAdded.length === 0 && me && !approverIds.has(me.id)) {
        userAdded.push({ signerId: me.id, meaning: 'authored' })
      }
      return [...approverSigners, ...userAdded]
    })
  }, [project.data, approverSigners, me])

  const effectiveRows = rows.length
    ? rows
    : approverSigners.length > 0
      ? approverSigners
      : (me ? [{ signerId: me.id, meaning: 'authored' as Meaning }] : [{ signerId: '', meaning: 'authored' as Meaning }])

  const update = (next: SignerRow[]) => setRows(next)
  const setRow = (i: number, patch: Partial<SignerRow>) => {
    const row = effectiveRows[i]
    if (!row) return
    // Locked rows (team Approvers) can only be reordered — guard here so a
    // stray UI click doesn't silently drop a required signature.
    if (row.locked && (patch.signerId !== undefined || patch.meaning !== undefined)) return
    update(effectiveRows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= effectiveRows.length) return
    const next = [...effectiveRows]
    ;[next[i], next[j]] = [next[j], next[i]]
    update(next)
  }
  const removeRow = (i: number) => {
    const row = effectiveRows[i]
    if (!row || row.locked) return
    update(effectiveRows.filter((_, j) => j !== i))
  }

  const pending = documentStatus === 'pending-signature'
  const duplicate = new Set(effectiveRows.map(r => r.signerId)).size !== effectiveRows.length
  const incomplete = effectiveRows.some(r => !r.signerId)
  const hasAllApprovers = approverSigners.length > 0 &&
    approverSigners.every(a => effectiveRows.some(r => r.signerId === a.signerId && r.meaning === 'approved'))
  const noApprovers = project.data !== undefined && approverSigners.length === 0
  const canSubmit = pending && !duplicate && !incomplete && !noApprovers && hasAllApprovers && !initiate.isPending

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

      {/* Required-Approvers notice — the chain cannot start without every
          team member with RACI='A' present as an 'approved' signer. */}
      {!noApprovers && (
        <p className="rounded-md border border-blue-200 bg-blue-50 p-2 text-[12px] text-blue-800" data-approvers-notice>
          <strong>Required ({approverSigners.length}):</strong> every team Approver (RACI='A') is pre-filled below as an
          <em> Approved</em> signer and can't be removed. You may reorder them, and add Authors or Reviewers alongside.
        </p>
      )}
      {noApprovers && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[12px] text-amber-800" data-no-approvers>
          This project has no team members with RACI='A'. Add at least one Approver on the project team before starting the chain.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {effectiveRows.map((r, i) => (
          <div
            key={i}
            className="flex items-center gap-2"
            data-signer-row={i}
            data-locked={r.locked ? 'true' : 'false'}
          >
            <span className="w-6 flex-none text-center font-mono text-[12px] font-bold text-slate-500">{i + 1}</span>
            <select
              value={r.signerId}
              onChange={e => setRow(i, { signerId: e.currentTarget.value })}
              disabled={r.locked}
              className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 px-2 text-[13px] disabled:bg-slate-50 disabled:text-slate-500"
              data-signer-select
              title={r.locked ? 'Required — team Approver (RACI=A), cannot be changed here. Edit on the Project Settings page.' : undefined}
            >
              <option value="" disabled>Select signer…</option>
              {candidates.map(c => <option key={c.id} value={c.id}>{c.name} · {c.role}</option>)}
            </select>
            <select
              value={r.meaning}
              onChange={e => setRow(i, { meaning: e.currentTarget.value as Meaning })}
              disabled={r.locked}
              className="h-9 w-32 flex-none rounded-md border border-slate-300 px-2 text-[13px] disabled:bg-slate-50 disabled:text-slate-500"
              data-meaning-select
            >
              {MEANINGS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="h-9 w-8 rounded-md border border-slate-200 text-slate-600 disabled:opacity-30" aria-label="Move up">↑</button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === effectiveRows.length - 1} className="h-9 w-8 rounded-md border border-slate-200 text-slate-600 disabled:opacity-30" aria-label="Move down">↓</button>
            <button
              type="button"
              onClick={() => removeRow(i)}
              disabled={r.locked || effectiveRows.length === 1}
              className="h-9 w-8 rounded-md border border-slate-200 text-slate-500 hover:text-red-700 disabled:opacity-30"
              aria-label="Remove signer"
              title={r.locked ? 'Required Approver — remove from the project team to drop this signature.' : undefined}
            >
              {r.locked ? '🔒' : '✕'}
            </button>
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
