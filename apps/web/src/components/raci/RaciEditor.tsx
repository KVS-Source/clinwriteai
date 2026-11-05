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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { PlatformUser } from '@platform/types'
import {
  raciApi,
  type AssignableUser,
  type DocumentRaciRow,
  type RaciLetter,
} from '../../api/raci'
import { ApiError } from '../../api/client'
import { platformApi } from '../../platform/api/platformApi'
import { usePlatformStore } from '../../platform/store'
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

const LETTER_LABEL_KEY: Record<RaciLetter, string> = {
  R: 'letter_r',
  A: 'letter_a',
  C: 'letter_c',
  Q: 'letter_q',
  I: 'letter_i',
}

const JUST_ADDED_MS = 6000

// The server's own message when it sent one ("This person has already
// completed their part…"), not a bare "API error 409".
function errorText(e: unknown, fallback: string, t: TFunction): string {
  if (e instanceof ApiError) {
    const body = e.body as { message?: string; error?: string } | null
    return body?.message ?? body?.error ?? t('component.raci_editor.err_http_suffix', { fallback, status: e.status })
  }
  return e instanceof Error ? e.message : fallback
}

export function RaciEditor({ projectId, documentId, documentStatus, editable: editableProp, onChanged, className }: RaciEditorProps) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<DocumentRaciRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A failed change is reported inside the letter section that was clicked —
  // the panel-level banner sits at the top, out of view once scrolled.
  const [letterError, setLetterError] = useState<{ letter: RaciLetter; message: string } | null>(null)
  const [busyLetter, setBusyLetter] = useState<RaciLetter | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ letter: RaciLetter; name: string } | null>(null)
  // The person just added: their row is highlighted and the section confirms it, then both settle.
  const [justAdded, setJustAdded] = useState<{ letter: RaciLetter; userId: string; name: string } | null>(null)
  useEffect(() => {
    if (!justAdded) return
    const timer = window.setTimeout(() => setJustAdded(null), JUST_ADDED_MS)
    return () => window.clearTimeout(timer)
  }, [justAdded])
  const qc = useQueryClient()

  // Only an admin, an R on the document or its assignee may change RACI (server
  // rule); everyone else gets the read-only view instead of a 403 per click.
  const { data: permission } = useQuery({
    queryKey: ['document-raci-can-edit', documentId],
    queryFn:  () => raciApi.canEdit(documentId),
    staleTime: 30_000,
  })
  const noPermission = permission?.canEdit === false
  const editable = editableProp && !noPermission
  // While a signature chain is in progress the RACI is fixed (server rule): no one can be added and
  // only your own assignment can be removed. Said up front rather than as a refusal per click.
  const chainActive = permission?.chainActive === true
  const myId = usePlatformStore(s => s.currentUser.id)

  // Names for the assigned users (rows carry only the user id).
  const { data: users = [] } = useQuery<PlatformUser[]>({
    queryKey: ['platform-users'],
    queryFn:  () => platformApi.listUsers(),
    staleTime: 60_000,
  })
  const nameOf = useCallback(
    (userId: string) => rows?.find(r => r.userId === userId && r.userName)?.userName ?? users.find(u => u.id === userId)?.name ?? userId,
    [rows, users],
  )

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const list = await raciApi.list(documentId)
      setRows(list)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('component.raci_editor.err_load_raci'))
    }
  }, [documentId, t])

  useEffect(() => { void refresh() }, [refresh])

  const byLetter = useMemo(() => groupActive(rows ?? []), [rows])
  const transitionEval = useMemo(() => buildTransitionEval(rows ?? [], documentStatus), [rows, documentStatus])

  async function addUser(letter: RaciLetter, user: AssignableUser): Promise<boolean> {
    if (!rows) return false
    setBusyLetter(letter)
    setAdding({ letter, name: user.name })
    setJustAdded(null)
    setError(null)
    setLetterError(null)
    try {
      await raciApi.assign(documentId, { userId: user.id, letter })
      await refresh()
      setJustAdded({ letter, userId: user.id, name: user.name })
      onChanged?.()
      return true
    } catch (e: unknown) {
      setLetterError({ letter, message: errorText(e, t('component.raci_editor.err_raci_update'), t) })
      void refresh()
      return false
    } finally {
      setAdding(null)
      setBusyLetter(null)
    }
  }

  return (
    <div className={`flex flex-col gap-5 ${className ?? ''}`}>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{t('component.raci_editor.heading')}</h3>
          <p className="text-xs text-slate-500 mt-1">
            {editable
              ? t('component.raci_editor.sub_editable')
              : noPermission
                ? t('component.raci_editor.sub_read_only_no_permission')
                : t('component.raci_editor.sub_read_only')}
          </p>
        </div>
        <StatusStrip evaluation={transitionEval} showNextStatus />
      </header>

      {chainActive && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status" data-raci-chain-locked>
          {t('component.raci_editor.chain_locked')}
        </div>
      )}

      {error && (
        <div className="px-3 py-2 rounded border border-rose-200 bg-rose-50 text-xs text-rose-700">
          {error}
        </div>
      )}

      {rows === null && !error && (
        <div className="text-xs text-slate-500">{t('component.raci_editor.loading')}</div>
      )}

      {rows && LETTER_ORDER.map(letter => {
        const current = byLetter[letter]
        const selectedIds = current.map(r => r.userId)
        return (
          <section key={letter} className="border border-slate-200 rounded-md p-4">
            <header className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-slate-800">
                <span className="inline-block w-6 text-center text-xs font-mono bg-slate-100 border border-slate-200 rounded mr-2 py-0.5">{letter}</span>
                {t(`component.raci_editor.${LETTER_LABEL_KEY[letter]}`)}
              </h4>
              <span className="text-[11px] text-slate-500">
                {t('component.raci_editor.assigned_count', { count: current.length })}
              </span>
            </header>

            {/* One row per person, with Remove. This list is the record of who is assigned. */}
            {current.length === 0 && (
              <p className="mb-3 text-[12px] italic text-slate-500" data-raci-empty>{t('component.raci_editor.none_assigned')}</p>
            )}
            {current.length > 0 && (
              <ul className="mb-3 space-y-1 text-xs">
                {current.map(row => {
                  const isNew = justAdded?.letter === letter && justAdded.userId === row.userId
                  return (
                  <li
                    key={row.id}
                    className={`flex flex-wrap items-center gap-3 px-2 py-1.5 rounded border transition-colors ${isNew ? 'border-emerald-300 bg-emerald-50' : 'border-slate-100 bg-slate-50/50'}`}
                    data-raci-row={row.id}
                    data-just-added={isNew || undefined}
                  >
                    <span className="shrink-0 text-[12px] font-medium text-slate-800" title={row.userId}>{nameOf(row.userId)}</span>
                    {isNew && (
                      <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">✓ {t('component.user_picker.added')}</span>
                    )}
                    {editable && (!chainActive || row.userId === myId) && (
                      <span className="ml-auto flex items-center gap-2">
                        {confirmingRemove === row.id ? (
                          <>
                            <span className="text-[11px] text-slate-600">{t('component.raci_editor.remove_confirm')}</span>
                            <button
                              type="button"
                              onClick={() => void removeRow(row)}
                              disabled={busyLetter === letter}
                              className="rounded bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                              data-action="confirm-remove-raci"
                            >{t('component.raci_editor.remove')}</button>
                            <button
                              type="button"
                              onClick={() => setConfirmingRemove(null)}
                              className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                              data-action="cancel-remove-raci"
                            >{t('component.raci_editor.cancel')}</button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setLetterError(null); setConfirmingRemove(row.id) }}
                            disabled={busyLetter === letter}
                            aria-label={t('component.raci_editor.remove_aria', { name: nameOf(row.userId) })}
                            className="text-[11px] font-semibold text-rose-700 hover:text-rose-800 disabled:opacity-50"
                            data-action="remove-raci"
                          >{t('component.raci_editor.remove')}</button>
                        )}
                      </span>
                    )}
                  </li>
                  )
                })}
              </ul>
            )}

            {/* Always mounted so screen readers announce the change. */}
            <div role="status" aria-live="polite">
              {adding?.letter === letter && (
                <p className="mb-2 text-[12px] text-slate-600" data-raci-adding>{t('component.raci_editor.adding', { name: adding.name })}</p>
              )}
              {justAdded?.letter === letter && (
                <p className="mb-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800" data-raci-added>
                  {t('component.raci_editor.added_status', { name: justAdded.name, role: t(`component.raci_editor.${LETTER_LABEL_KEY[letter]}`) })}
                </p>
              )}
            </div>

            {letterError?.letter === letter && (
              <div className="mb-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert" data-raci-letter-error>
                {letterError.message}
              </div>
            )}

            <UserPicker
              projectId={projectId}
              letter={letter}
              value={selectedIds}
              onAdd={user => addUser(letter, user)}
              disabled={!editable || chainActive || busyLetter === letter}
              heldElsewhere={heldElsewhere(letter)}
            />
          </section>
        )
      })}
    </div>
  )

  // Users holding a different whole-document letter can't take this one too
  // (one letter per person per document) — the picker greys them out.
  function heldElsewhere(letter: RaciLetter): Map<string, RaciLetter> {
    const out = new Map<string, RaciLetter>()
    for (const l of LETTER_ORDER) {
      if (l === letter) continue
      for (const r of byLetter[l]) if (r.sectionId === null) out.set(r.userId, l)
    }
    return out
  }

  async function removeRow(row: DocumentRaciRow) {
    setBusyLetter(row.letter)
    setError(null)
    setLetterError(null)
    try {
      await raciApi.remove(documentId, row.id)
      setConfirmingRemove(null)
      await refresh()
      // Removing yourself can end your edit rights, and removing the assignee moves the document on.
      qc.invalidateQueries({ queryKey: ['document-raci-can-edit', documentId] })
      qc.invalidateQueries({ queryKey: ['documents', projectId] })
      qc.invalidateQueries({ queryKey: ['document', documentId] })
      onChanged?.()
    } catch (e: unknown) {
      setConfirmingRemove(null)
      setLetterError({ letter: row.letter, message: errorText(e, t('component.raci_editor.err_raci_update'), t) })
      void refresh()
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
