// RaciEditor — the modal/panel an R opens to assign, remove, or
// reassign RACI on their document.
//
// Composes the shipped primitives:
//   - raciApi (list / assign / remove)
//   - UserPicker (per-letter capability-filtered search)
//   - StatusStrip (cohort progress for the current stage)
//
// Design: docs/roles-and-permissions.md §5a "The R owns the document".
// Every letter is multi-select; multiple users can hold the same letter.
// The lead R is the audience; a PM gets a read-only view (parent should
// pass editable=false).
//
// This is deliberately a flat panel component (not a Dialog) so the
// parent can decide where to render it: inside a dialog, a drawer, or
// inline on the document detail page. The parent owns open/close.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  raciApi,
  type DocumentRaciRow,
  type RaciLetter,
} from '../../api/raci'
import { UserPicker } from './UserPicker'
import { StatusStrip } from './StatusStrip'

export interface RaciEditorProps {
  projectId: string
  documentId: string
  /** Current status of the document — used to compute the StatusStrip. */
  documentStatus: string
  /** If false, the picker is disabled and only existing rows are visible. */
  editable: boolean
  /** Called after any mutation so the parent can refetch its own data. */
  onChanged?: () => void
  className?: string
}

const LETTER_ORDER: RaciLetter[] = ['R', 'A', 'C', 'Q', 'I']

const LETTER_LABEL: Record<RaciLetter, string> = {
  R: 'Responsible (authors)',
  A: 'Accountable (approvers)',
  C: 'Consulted (reviewers)',
  Q: 'QC (release)',
  I: 'Informed',
}

// Options the server accepts in signatureMeaning. Shown in a dropdown next to
// the "Requires e-signature" checkbox when a row is marked signatureRequired=true.
const SIGNATURE_MEANINGS = [
  'Author attestation',
  'Medical approval',
  'Regulatory approval',
  'Final signatory',
  'QC release',
] as const
type SignatureMeaning = typeof SIGNATURE_MEANINGS[number]

const DEFAULT_SIG_MEANING: Record<RaciLetter, SignatureMeaning> = {
  R: 'Author attestation',
  A: 'Medical approval',
  C: 'Medical approval',
  Q: 'QC release',
  I: 'Author attestation', // unused — I rows never require signatures
}

export function RaciEditor({ projectId, documentId, documentStatus, editable, onChanged, className }: RaciEditorProps) {
  const [rows, setRows] = useState<DocumentRaciRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyLetter, setBusyLetter] = useState<RaciLetter | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const list = await raciApi.list(documentId)
      setRows(list)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load RACI')
    }
  }, [documentId])

  useEffect(() => { void refresh() }, [refresh])

  const byLetter = useMemo(() => groupActive(rows ?? []), [rows])
  const transitionEval = useMemo(() => buildTransitionEval(rows ?? [], documentStatus), [rows, documentStatus])

  async function addUser(letter: RaciLetter, selected: string[]) {
    if (!rows) return
    const already = new Set(byLetter[letter].map(r => r.userId))
    const toAdd    = selected.filter(id => !already.has(id))
    const toRemove = byLetter[letter].filter(r => !selected.includes(r.userId))

    setBusyLetter(letter)
    setError(null)
    try {
      for (const userId of toAdd) {
        await raciApi.assign(documentId, { userId, letter })
      }
      for (const row of toRemove) {
        await raciApi.remove(documentId, row.id)
      }
      await refresh()
      onChanged?.()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'RACI update failed')
    } finally {
      setBusyLetter(null)
    }
  }

  return (
    <div className={`flex flex-col gap-5 ${className ?? ''}`}>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">RACI assignments</h3>
          <p className="text-xs text-slate-500 mt-1">
            {editable
              ? 'You own this document — pick who authors, approves, reviews, releases QC, and should be kept informed.'
              : 'Read-only view of the current assignments.'}
          </p>
        </div>
        <StatusStrip evaluation={transitionEval} showNextStatus />
      </header>

      {error && (
        <div className="px-3 py-2 rounded border border-rose-200 bg-rose-50 text-xs text-rose-700">
          {error}
        </div>
      )}

      {rows === null && !error && (
        <div className="text-xs text-slate-500">Loading…</div>
      )}

      {rows && LETTER_ORDER.map(letter => {
        const current = byLetter[letter]
        const selectedIds = current.map(r => r.userId)
        return (
          <section key={letter} className="border border-slate-200 rounded-md p-4">
            <header className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-slate-800">
                <span className="inline-block w-6 text-center text-xs font-mono bg-slate-100 border border-slate-200 rounded mr-2 py-0.5">{letter}</span>
                {LETTER_LABEL[letter]}
              </h4>
              <span className="text-[11px] text-slate-500">
                {current.length} assigned
              </span>
            </header>

            {/* Signature-requirement controls per row. The I letter is
                excluded — "informed" doesn't sign off. The toggle hits
                raciApi.remove + raciApi.assign to swap the row (there is
                no PATCH on document_raci — assignments are immutable
                once written per the audit-chain design, so changing a
                row's signature config = remove + re-add). */}
            {letter !== 'I' && current.length > 0 && (
              <ul className="mb-3 space-y-1 text-xs">
                {current.map(row => (
                  <li
                    key={row.id}
                    className="flex items-center gap-3 px-2 py-1.5 rounded border border-slate-100 bg-slate-50/50"
                  >
                    <span className="font-mono text-[10px] text-slate-500 shrink-0">{row.userId.slice(0, 10)}…</span>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={row.signatureRequired}
                        onChange={() => void toggleSignatureRequired(row)}
                        disabled={!editable || busyLetter === letter}
                      />
                      <span className="select-none">Requires e-signature</span>
                    </label>
                    {row.signatureRequired && (
                      <select
                        value={(row.signatureMeaning as SignatureMeaning | null) ?? DEFAULT_SIG_MEANING[letter]}
                        onChange={e => void updateSignatureMeaning(row, e.target.value as SignatureMeaning)}
                        disabled={!editable || busyLetter === letter}
                        className="ml-auto text-[11px] border border-slate-300 rounded px-1 py-0.5 bg-white"
                      >
                        {SIGNATURE_MEANINGS.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <UserPicker
              projectId={projectId}
              letter={letter}
              value={selectedIds}
              onChange={ids => void addUser(letter, ids)}
              disabled={!editable || busyLetter === letter}
            />
          </section>
        )
      })}
    </div>
  )

  // Swap a row's signature config. document_raci rows are immutable
  // (audit-chain invariant), so we remove + re-add with new flags.
  async function toggleSignatureRequired(row: DocumentRaciRow) {
    const nextSigRequired = !row.signatureRequired
    const nextMeaning = nextSigRequired
      ? (row.signatureMeaning as SignatureMeaning | null) ?? DEFAULT_SIG_MEANING[row.letter]
      : null
    await swapRowSignature(row, nextSigRequired, nextMeaning)
  }

  async function updateSignatureMeaning(row: DocumentRaciRow, meaning: SignatureMeaning) {
    await swapRowSignature(row, true, meaning)
  }

  async function swapRowSignature(
    row: DocumentRaciRow,
    signatureRequired: boolean,
    signatureMeaning: string | null,
  ) {
    setBusyLetter(row.letter)
    setError(null)
    try {
      await raciApi.remove(documentId, row.id)
      await raciApi.assign(documentId, {
        userId: row.userId,
        letter: row.letter,
        sectionId: row.sectionId,
        approvalOrder: row.approvalOrder,
        signatureRequired,
        signatureMeaning: signatureRequired ? signatureMeaning : null,
      })
      await refresh()
      onChanged?.()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Signature update failed')
    } finally {
      setBusyLetter(null)
    }
  }
}

// ---- Helpers ---------------------------------------------------------

function groupActive(rows: DocumentRaciRow[]): Record<RaciLetter, DocumentRaciRow[]> {
  const out: Record<RaciLetter, DocumentRaciRow[]> = { R: [], A: [], C: [], Q: [], I: [] }
  for (const r of rows) {
    if (r.removedAt !== null) continue
    out[r.letter].push(r)
  }
  return out
}

// Mirrors the server-side evaluateStageTransition shape without pulling
// the engine into the web bundle. Letter stages:
//   not_started | in_authoring       → R
//   in_review   | crm_in_progress    → C + Q (parallel-ALL)
//   pending_signature                → A
// `signed` is terminal — no gating cohort.
function buildTransitionEval(rows: DocumentRaciRow[], status: string) {
  const gatesByStatus: Record<string, RaciLetter[]> = {
    not_started:       ['R'],
    in_authoring:      ['R'],
    in_review:         ['C', 'Q'],
    crm_in_progress:   ['C', 'Q'],
    pending_signature: ['A'],
    signed:            [],
  }
  const gating = gatesByStatus[status] ?? []
  if (gating.length === 0) {
    return {
      gatingLetter: null,
      nextStatus: null,
      cohortDone: 0,
      cohortTotal: 0,
      cohortComplete: false,
      rejectedRows: 0,
    }
  }
  const nextByStatus: Record<string, string | null> = {
    not_started:       'in_authoring',
    in_authoring:      'in_review',
    in_review:         'pending_signature',
    crm_in_progress:   'pending_signature',
    pending_signature: 'signed',
  }

  const inGate = new Set<RaciLetter>(gating)
  const cohort = rows.filter(r => r.removedAt === null && inGate.has(r.letter))
  const rejectedRows = cohort.filter(r => r.rejectedAt !== null).length
  const done = cohort.filter(r => {
    const ts = r.letter === 'R' ? r.submittedAt
      : r.letter === 'A' ? r.approvedAt
      : r.reviewedAt  // C + Q share reviewedAt
    if (!ts) return false
    if (r.signatureRequired && !r.signatureId) return false
    return true
  }).length

  return {
    gatingLetter: gating[0] as RaciLetter,
    nextStatus: nextByStatus[status] ?? null,
    cohortDone: done,
    cohortTotal: cohort.length,
    cohortComplete: cohort.length > 0 && done === cohort.length && rejectedRows === 0,
    rejectedRows,
  }
}
