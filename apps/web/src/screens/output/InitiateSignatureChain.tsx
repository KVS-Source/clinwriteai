// Initiate a Part 11 signature chain (FR-A-066) — POST /documents/:id/signature-chains.
// Shown on the E-Signature screen when no active chain exists. The API only
// accepts this once CRM is complete (document status pending_signature) and
// rejects a second active chain; both cases are explained inline.
//
// The chain is pre-filled from the document's RACI: everyone named as Author (R), Reviewer (C), Approver (A)
// or Informed (I) gets a row, signing with the meaning of their role. Only the document's Author or
// Approver may start a chain. The starter may remove people and add extra signers; the chain needs at
// least one Approver.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { projectsApi } from '../../api'
import { ApiError } from '../../api/client'
import { assignableUsersApi, projectMembersApi, raciApi } from '../../api/raci'
import { useInitiateSignatureChain } from '../../hooks'
import { useSignatureAccess } from './useSignatureAccess'

type Meaning = 'authored' | 'reviewed' | 'approved' | 'acknowledged'
type Candidate = { id: string; name: string; role: string; email?: string }
// `locked` rows are the people named on the document. Their signer and meaning can't be changed, but
// they can be removed and reordered.
// `source` says where a locked person was named, so the tooltips can point to the right place.
type NamedSource = 'project' | 'document' | 'both'
// `draft` is an added row the starter has not confirmed with the tick yet.
type SignerRow = { signerId: string; meaning: Meaning; locked?: boolean; source?: NamedSource; draft?: boolean }

const MEANING_ROLE: Record<Meaning, string> = { authored: 'Author', reviewed: 'Reviewer', approved: 'Approver', acknowledged: 'Informed' }

// RACI letter -> the meaning that person signs with. Q (QC) never signs.
const LETTER_MEANING: Record<string, Meaning> = { R: 'authored', C: 'reviewed', A: 'approved', I: 'acknowledged' }

// The order of the groups in a chain: Authors, then Reviewers, then Approvers, then Informed. In a
// "by group" chain everyone in a group signs at once, and a group is released when the group before it
// has fully signed.
const SIGNER_ORDER: Meaning[] = ['authored', 'reviewed', 'approved', 'acknowledged']
const groupIndex = (m: Meaning) => { const i = SIGNER_ORDER.indexOf(m); return i === -1 ? SIGNER_ORDER.length : i }
const rowOrder = (r: SignerRow) => (r.draft ? SIGNER_ORDER.length + 1 : groupIndex(r.meaning))

// The order is always by group for now. The choice of order is hidden; the other two kinds are kept
// (commented out) below and in the JSX so they can be switched back on.
type ChainKind = 'grouped' | 'sequential' | 'parallel'
// const CHAIN_KINDS: Array<{ value: ChainKind; label: string }> = [
//   { value: 'grouped',    label: 'By group (Authors, then Reviewers, then Approvers, then Informed)' },
  // { value: 'sequential', label: 'Sequential (one after another)' },
  // { value: 'parallel',   label: 'Parallel (any order)' },
// ]

// Tooltips for a pre-filled row's signer box / remove button, by where the person is named.
function lockHelp(meaning: Meaning, source: NamedSource): { signer: string; lock: string } {
  const role = MEANING_ROLE[meaning]
  const where = source === 'project' ? 'on the project team'
    : source === 'both' ? "both in this document's RACI and on the project team"
    : "in this document's RACI"
  return {
    signer: `Named as ${role} ${where}.`,
    lock:   `Remove this ${role} from the chain. They stay named ${where}.`,
  }
}
const SOURCE_TAG: Record<NamedSource, string> = { project: 'Project team', document: 'Document RACI', both: 'Document RACI + project team' }

const MEANINGS: { value: Meaning; label: string }[] = [
  { value: 'authored',     label: 'Will sign as: Author' },
  { value: 'reviewed',     label: 'Will sign as: Reviewer' },
  { value: 'approved',     label: 'Will sign as: Approver' },
  { value: 'acknowledged', label: 'Will sign as: Informed' },
]

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as {
      error?: string
      message?: string
      issues?: Array<{ message: string }>
    } | null
    if (body?.error === 'wrong_status') return 'The chain can only be started once the Comments Resolution Meeting is complete (status: Pending signature).'
    if (body?.error === 'chain_already_active') return 'A signature chain is already active for this document.'
    if (body?.error === 'start_forbidden') return "Only the document's Author (R) or Approver (A) can start the signature chain."
    if (body?.error === 'approver_required') return 'The signature chain needs at least one Approver. Add an Approver to the chain.'
    if (body?.issues?.[0]?.message) return body.issues[0].message
    if (body?.message) return body.message
  }
  return 'Could not start the signature chain. Please try again.'
}

// What to tell the user when no chain can start yet, by document status (UI form, hyphen-case).
const BLOCKED_HINT: Record<string, string> = {
  'not-started':     'This document has not been started yet. Write it and submit it for review first.',
  'in-authoring':    'This document is still being written. Submit it for review first.',
  'in-review':       'The document is in review. Start the Comments Resolution Meeting and resolve all comments to continue.',
  'crm-in-progress': 'The Comments Resolution Meeting is in progress. Complete it to move the document to signature.',
  'signed':          'This document is already signed. See the Final Document tab.',
}

// The signer search for rows the starter adds: type at least 3 characters, then pick from the active users
// who are not already in the chain. (The pre-filled rows are fixed, so they keep their plain boxes.)
const SEARCH_MIN_CHARS = 3

function SignerSearch({ value, candidates, takenIds, onPick }: {
  value: string
  candidates: Candidate[]
  /** People already in the chain, who are not offered again. */
  takenIds: Set<string>
  onPick: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = candidates.find(c => c.id === value)
  const q = query.trim().toLowerCase()
  const matches = q.length >= SEARCH_MIN_CHARS
    ? candidates.filter(c => !takenIds.has(c.id) && `${c.name} ${c.email ?? ''} ${c.role}`.toLowerCase().includes(q)).slice(0, 8)
    : []
  const pick = (id: string) => { onPick(id); setQuery(''); setOpen(false) }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        type="text"
        autoComplete="off"
        value={open ? query : selected ? `${selected.name}${selected.email ? ` · ${selected.email}` : ''}` : query}
        onFocus={() => { setOpen(true); setQuery('') }}
        onChange={e => { setQuery(e.currentTarget.value); setOpen(true) }}
        onBlur={() => setOpen(false)}
        onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.blur() }}
        placeholder="Search for a signer"
        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-[13px] outline-none focus:border-blue-600"
        data-signer-search
      />
      {open && q.length > 0 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg" data-signer-results>
          {q.length < SEARCH_MIN_CHARS ? (
            <p className="px-3 py-2 text-[12px] text-slate-500">Type at least {SEARCH_MIN_CHARS} characters to search.</p>
          ) : matches.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-slate-500">No active user matches.</p>
          ) : matches.map(c => (
            <button
              key={c.id}
              type="button"
              onMouseDown={e => { e.preventDefault(); pick(c.id) }}
              className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-slate-50"
              data-signer-result={c.id}
            >
              <span className="text-[13px] font-medium text-slate-900">{c.name}</span>
              {c.email && <span className="text-[11px] text-slate-500">{c.email}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  documentId: string
  projectId: string
  /** UI document status (hyphen-case), e.g. 'pending-signature'. */
  documentStatus: string | undefined
}

export function InitiateSignatureChain({ documentId, projectId, documentStatus }: Props) {
  const initiate = useInitiateSignatureChain(documentId)
  const access = useSignatureAccess(documentId)

  // Signers must be real accounts — the API only lets the record's signerId sign. The people offered are
  // the ones assigned to THIS project (its members and team), so the list differs from project to project.
  const assignable = useQuery({ queryKey: ['assignable-users', projectId, 'raci'], queryFn: () => assignableUsersApi.listForRaci(projectId), enabled: !!projectId, retry: false })
  const members = useQuery({ queryKey: ['project-members', projectId], queryFn: () => projectMembersApi.list(projectId), enabled: !!projectId, retry: false })
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => projectsApi.get(projectId), enabled: !!projectId, retry: false })

  // The document's own RACI. The list also carries removed rows, so keep only the active ones.
  const docRaci = useQuery({ queryKey: ['document-raci', documentId], queryFn: () => raciApi.list(documentId), retry: false })
  const raciRows = useMemo(() => (docRaci.data ?? []).filter(r => !r.removedAt), [docRaci.data])

  // Everyone who can be picked: the people assigned to this project (a project member, or on the project
  // team — those given roles when the project was set up), plus anyone named in this document's RACI. The
  // names of people named in the RACI come from the RACI response itself, so users who can't read other
  // user lists still see them.
  const candidates: Candidate[] = useMemo(() => {
    const assignedIds = new Set([
      ...(members.data ?? []).filter(m => !m.removedAt).map(m => m.userId),
      ...(project.data?.team ?? []).map(t => t.userId),
    ])
    const map = new Map<string, Candidate>()
    if (assignable.isSuccess) {
      for (const u of assignable.data) {
        if (assignedIds.has(u.id)) map.set(u.id, { id: u.id, name: u.name, role: u.projectRole ?? 'Project member', email: u.email })
      }
    } else {
      for (const t of project.data?.team ?? []) map.set(t.userId, { id: t.userId, name: t.name, role: t.role })
    }
    for (const r of raciRows) {
      if (!map.has(r.userId)) map.set(r.userId, { id: r.userId, name: r.userName ?? r.userId, role: MEANING_ROLE[LETTER_MEANING[r.letter] ?? 'reviewed'] })
    }
    // Project-team Approvers are pre-filled too, so their names must be known.
    for (const t of project.data?.team ?? []) if (t.raci === 'A' && !map.has(t.userId)) map.set(t.userId, { id: t.userId, name: t.name, role: t.role })
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [assignable.isSuccess, assignable.data, members.data, project.data, raciRows])

  // Who "+ Add signer" can search: active Clinical Writing users plus this project's own people, PMs
  // included (the API returns both). People already in the chain are left out by SignerSearch's takenIds.
  const activeUsers = useQuery({ queryKey: ['assignable-users', projectId, 'active'], queryFn: () => assignableUsersApi.list(projectId), enabled: !!projectId, retry: false })
  const addableUsers: Candidate[] = useMemo(
    () => (activeUsers.data ?? []).map(u => ({ id: u.id, name: u.name, role: '', email: u.email })),
    [activeUsers.data],
  )

  // Always grouped for now. To bring back the choice of order, use the state below and the radios in the JSX.
  // const [chainType, setChainType] = useState<ChainKind>('grouped')
  const chainType: ChainKind = 'grouped'
  const [rows, setRows] = useState<SignerRow[]>([])
  // Named people the starter took off the chain. They stay off when the RACI is re-read.
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set())

  // The named signers — everyone who must be on the chain, each with the meaning of their role. A person
  // named twice shows once (dual roles are out of scope). Approvers on the project team count too.
  // The API refuses a chain that leaves any of them out (`missing_approvers` / `missing_signers`).
  const namedSigners: SignerRow[] = useMemo(() => {
    const byId = new Map<string, { meaning: Meaning; fromDocument: boolean; fromProject: boolean }>()
    const add = (userId: string, meaning: Meaning, doc: boolean) => {
      const cur = byId.get(userId)
      if (!cur) { byId.set(userId, { meaning, fromDocument: doc, fromProject: !doc }); return }
      if (doc) cur.fromDocument = true; else cur.fromProject = true
      if (SIGNER_ORDER.indexOf(meaning) < SIGNER_ORDER.indexOf(cur.meaning) && doc) cur.meaning = meaning
    }
    for (const r of raciRows) { const m = LETTER_MEANING[r.letter]; if (m) add(r.userId, m, true) }
    for (const t of project.data?.team ?? []) if (t.raci === 'A') add(t.userId, 'approved', false)
    return [...byId.entries()]
      .map(([signerId, v]) => ({
        signerId, meaning: v.meaning, locked: true,
        source: (v.fromDocument && v.fromProject ? 'both' : v.fromDocument ? 'document' : 'project') as NamedSource,
      }))
      .sort((a, b) => SIGNER_ORDER.indexOf(a.meaning) - SIGNER_ORDER.indexOf(b.meaning))
  }, [raciRows, project.data])

  const settled = (q: { isSuccess: boolean; isError: boolean }) => q.isSuccess || q.isError
  const namedLoaded = settled(project) && settled(docRaci)

  // Seed the row list once the RACI has loaded: all named people (locked) first. Anything the starter
  // added (unlocked rows) is kept. Re-runs if the RACI changes while the form is open.
  useEffect(() => {
    if (!namedLoaded) return
    setRows(prev => {
      const prefilled = namedSigners.filter(n => !removedIds.has(n.signerId))
      const namedIds = new Set(namedSigners.map(n => n.signerId))
      // A named person removed and then added back is an added row now, so it stays.
      return [...prefilled, ...prev.filter(r => !r.locked && (!namedIds.has(r.signerId) || removedIds.has(r.signerId)))]
    })
  }, [namedLoaded, namedSigners, removedIds])

  const effectiveRows = rows.length ? rows : namedSigners.filter(n => !removedIds.has(n.signerId))

  // A grouped chain signs group by group, so its rows are kept in group order (the order inside a group is
  // free). An unconfirmed row stays last, so it doesn't jump while its role is being chosen.
  useEffect(() => {
    if (chainType !== 'grouped') return
    setRows(prev => {
      const sorted = prev.map((r, i) => ({ r, i })).sort((a, b) => rowOrder(a.r) - rowOrder(b.r) || a.i - b.i).map(x => x.r)
      return sorted.every((r, i) => r === prev[i]) ? prev : sorted
    })
  }, [chainType, rows])

  const update = (next: SignerRow[]) => setRows(next)
  const setRow = (i: number, patch: Partial<SignerRow>) => {
    const row = effectiveRows[i]
    if (!row) return
    // Pre-filled rows keep their signer and meaning (they can still be removed or reordered).
    if (row.locked && (patch.signerId !== undefined || patch.meaning !== undefined)) return
    update(effectiveRows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }
  // Moving a row is off for now: the groups decide the order.
  // const move = (i: number, dir: -1 | 1) => {
  //   const j = i + dir
  //   if (j < 0 || j >= effectiveRows.length) return
  //   const next = [...effectiveRows]
  //   ;[next[i], next[j]] = [next[j], next[i]]
  //   update(next)
  // }
  const removeRow = (i: number) => {
    const row = effectiveRows[i]
    if (!row) return
    if (row.locked) setRemovedIds(prev => new Set(prev).add(row.signerId))
    update(effectiveRows.filter((_, j) => j !== i))
  }

  // Clicking outside an added row where nobody was chosen closes it.
  const draftRowRef = useRef<HTMLDivElement>(null)
  const emptyDraftOpen = effectiveRows.some(r => r.draft && !r.signerId)
  const unconfirmedPick = effectiveRows.some(r => r.draft && r.signerId)
  useEffect(() => {
    if (!emptyDraftOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (draftRowRef.current?.contains(e.target as Node)) return
      setRows(prev => prev.filter(r => !(r.draft && !r.signerId)))
    }
    window.document.addEventListener('mousedown', onMouseDown)
    return () => window.document.removeEventListener('mousedown', onMouseDown)
  }, [emptyDraftOpen])

  const pending = documentStatus === 'pending-signature'
  const duplicate = new Set(effectiveRows.map(r => r.signerId)).size !== effectiveRows.length
  const incomplete = effectiveRows.some(r => !r.signerId || r.draft)
  const approverCount = effectiveRows.filter(r => r.meaning === 'approved' && r.signerId && !r.draft).length
  const noApprovers = namedLoaded && approverCount === 0
  const canSubmit = pending && access.canStartChain && !duplicate && !incomplete && !noApprovers
    && !initiate.isPending

  const submit = () => {
    const byId = new Map([...addableUsers, ...candidates].map(c => [c.id, c]))
    initiate.mutate({
      chainType,
      signers: effectiveRows.map(r => {
        const c = byId.get(r.signerId)
        const teamRole = project.data?.team?.find(t => t.userId === r.signerId)?.role
        return { signerId: r.signerId, signerName: c?.name ?? r.signerId, signerRole: teamRole ?? MEANING_ROLE[r.meaning], meaning: r.meaning }
      }),
    })
  }

  if (!pending) {
    const hint = BLOCKED_HINT[documentStatus ?? ''] ?? 'A signature chain can only be started once the document is Pending signature.'
    return (
      <div className="flex flex-col items-start gap-2 text-left" data-initiate-blocked>
        <p className="font-mono text-sm text-slate-500">No signature chain has been initiated for this document.</p>
        <p className="max-w-xl text-xs text-slate-500">{hint}</p>
      </div>
    )
  }

  // Don't show the form (or a refusal) until we know who this user is on the document.
  if (!access.ready) return null

  // Only the document's Author (R) or Approver (A) starts a chain.
  if (!access.canStartChain) {
    return (
      <div className="flex flex-col items-start gap-2 text-left" data-start-forbidden>
        <p className="font-mono text-sm text-slate-500">No signature chain has been initiated for this document.</p>
        <p className="max-w-xl text-xs text-slate-500">Only the document's Author (R) or Approver (A) can start the signature chain.</p>
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-4 text-left" data-initiate-chain>
      <div>
        <p className="text-sm font-bold text-slate-900">Initiate signature chain</p>
        <p className="mt-1 text-xs text-slate-500">
          Choose who signs and the meaning of each signature. Signatures cannot be delegated (21 CFR Part 11).
        </p>
      </div>

      {/* The order is always by group, so the choice of order is hidden for now. Kept for later:
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-700">
        {CHAIN_KINDS.map(k => (
          <label key={k.value} className="flex items-center gap-1.5">
            <input type="radio" name="chain-type" checked={chainType === k.value} onChange={() => setChainType(k.value)} data-chain-type={k.value} />
            {k.label}
          </label>
        ))}
      </div>
      */}

      {/* Hidden for now:
      {chainType === 'grouped' && (
        <p className="-mt-2 text-[11px] text-slate-500" data-group-hint>
          Everyone in a group signs at once. The next group is released when the whole group before it has signed.
        </p>
      )}
      */}

      {/* Pre-filled notice — everyone named on the document (Author, Reviewer, Approver, Informed) is
          pre-filled; the starter may remove people. The chain needs at least one Approver. */}
      {namedLoaded && !noApprovers && (
        <p className="rounded-md border border-blue-200 bg-blue-50 p-2 text-[12px] text-blue-800" data-approvers-notice>
          <strong>Pre-filled ({namedSigners.length}):</strong> everyone named on this document as Author, Reviewer, Approver or Informed is
          pre-filled below. You may remove people and add extra signers. The chain needs at least one Approver. Nobody has signed yet — each person signs after the chain starts.
        </p>
      )}
      {noApprovers && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[12px] text-amber-800" data-no-approvers>
          The chain needs at least one Approver. Add one below, or assign one in the document's RACI.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {effectiveRows.map((r, i) => {
          const help = r.locked && r.source ? lockHelp(r.meaning, r.source) : null
          return (
            <div
              key={r.draft ? 'draft' : i}
              ref={r.draft ? draftRowRef : undefined}
              className="flex items-center gap-2"
              data-signer-row={i}
              data-locked={r.locked ? 'true' : 'false'}
            >
              <span className="w-6 flex-none text-center font-mono text-[12px] font-bold text-slate-500">{i + 1}</span>
              {r.locked ? (
                <select
                  value={r.signerId}
                  onChange={e => setRow(i, { signerId: e.currentTarget.value })}
                  disabled={r.locked}
                  className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 px-2 text-[13px] disabled:bg-slate-50 disabled:text-slate-500"
                  data-signer-select
                  title={help?.signer}
                >
                  <option value="" disabled>Select signer…</option>
                  {candidates.map(c => <option key={c.id} value={c.id}>{c.name} · {c.role}</option>)}
                </select>
              ) : !r.draft ? (
                <div className="flex h-9 min-w-0 flex-1 items-center truncate rounded-md border border-slate-300 bg-slate-50 px-2 text-[13px] text-slate-500" data-signer-confirmed>
                  {addableUsers.find(u => u.id === r.signerId)?.name ?? candidates.find(c => c.id === r.signerId)?.name ?? r.signerId}
                </div>
              ) : (
                <SignerSearch
                  value={r.signerId}
                  candidates={addableUsers}
                  takenIds={new Set(effectiveRows.filter((_, j) => j !== i).map(x => x.signerId))}
                  onPick={id => setRow(i, { signerId: id })}
                />
              )}
              {r.locked && r.source && (
                <span className="hidden flex-none whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 sm:inline" data-approver-source={r.source}>{SOURCE_TAG[r.source]}</span>
              )}
              <select
                value={r.meaning}
                onChange={e => setRow(i, { meaning: e.currentTarget.value as Meaning })}
                disabled={r.locked || !r.draft}
                className="h-9 w-52 flex-none rounded-md border border-slate-300 px-2 text-[13px] disabled:bg-slate-50 disabled:text-slate-500"
                data-meaning-select
              >
                {MEANINGS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              {/* The order of the rows is fixed by the groups, so the move arrows are hidden for now:
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0 || chainType === 'grouped'} title={chainType === 'grouped' ? 'A grouped chain signs in group order' : undefined} className="h-9 w-8 rounded-md border border-slate-200 text-slate-600 disabled:opacity-30" aria-label="Move up">↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === effectiveRows.length - 1 || chainType === 'grouped'} title={chainType === 'grouped' ? 'A grouped chain signs in group order' : undefined} className="h-9 w-8 rounded-md border border-slate-200 text-slate-600 disabled:opacity-30" aria-label="Move down">↓</button>
              */}
              {r.draft && (
                <button
                  type="button"
                  onClick={() => setRow(i, { draft: false })}
                  disabled={!r.signerId}
                  className="h-9 w-8 flex-none rounded-md border border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:border-slate-200 disabled:text-slate-400"
                  aria-label="Confirm signer"
                  title={r.signerId ? 'Confirm this signer' : 'Choose a signer first'}
                  data-signer-confirm
                >✓</button>
              )}
              <button
                type="button"
                onClick={() => removeRow(i)}
                disabled={effectiveRows.length === 1}
                className="h-9 w-8 rounded-md border border-slate-200 text-slate-500 hover:text-red-700 disabled:opacity-30"
                aria-label="Remove signer"
                title={help?.lock}
              >
                ✕
              </button>
            </div>
          )
        })}
        <button
          type="button"
          onClick={() => update([...effectiveRows.filter(r => !r.draft), { signerId: '', meaning: 'reviewed', draft: true }])}
          disabled={unconfirmedPick}
          className="self-start text-[12px] font-semibold text-blue-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          data-add-signer
        >+ Add signer</button>
      </div>

      {unconfirmedPick && <p className="text-[12px] text-amber-700" data-confirm-hint>Click the tick to confirm the new signer before starting the chain.</p>}
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
