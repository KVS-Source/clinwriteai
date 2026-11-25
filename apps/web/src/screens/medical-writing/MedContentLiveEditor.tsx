// MedContentLiveEditor — the functional section editor for medical
// content items (Module C mirror of ManuscriptLiveEditor).
//
// Sits alongside the richer ContentEditor (slide-centric, cosmetic
// surfaces). This screen is the working surface for M-C.2 + M-C.3 +
// M-C.4 end-to-end: real section fetch, real save, real section-lock
// lifecycle, real AI initial-draft trigger with aiDraftState polling,
// per-section AI suggest (Draft / Tighten / Explain).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import {
  medContentApi,
  type MedContentSectionRow,
  type MedSectionLockHolder,
  type MedContentSectionCommentRow,
} from '../../modules/medical-writing/api/medContent'
import { MedContentAiDebugButton } from '../../components/ai-drafter/MedContentAiDebugPanel'

function errMessage(err: unknown, fallback = 'Request failed'): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string; error?: string } | null
    if (body?.message) return body.message
    if (body?.error)   return body.error
    return String(err.status)
  }
  return err instanceof Error ? err.message : fallback
}

const FLAG_PALETTE: Record<string, string> = {
  'completeness:too_short':      'bg-rose-100 text-rose-800',
  'ai:guideline_gap':            'bg-amber-100 text-amber-800',
  'ai:unsupported_claim':        'bg-rose-100 text-rose-800',
  'ai:template_mismatch':        'bg-amber-100 text-amber-800',
  'ai:coherence_issue':          'bg-amber-100 text-amber-800',
  'ai:self_critique':            'bg-slate-100 text-slate-700',
  'pre_mlr:must_fix':            'bg-rose-100 text-rose-800',
  'pre_mlr:should_fix':          'bg-amber-100 text-amber-800',
  'fk:below_threshold':          'bg-amber-100 text-amber-800',
  'fair_balance:missing_safety': 'bg-rose-100 text-rose-800',
}

function flagChipClass(code: string): string {
  return FLAG_PALETTE[code] ?? 'bg-slate-100 text-slate-700'
}

function flagLabel(code: string): string {
  switch (code) {
    case 'completeness:too_short':      return 'Too short'
    case 'ai:guideline_gap':            return 'Guideline gap'
    case 'ai:unsupported_claim':        return 'Unsupported claim'
    case 'ai:template_mismatch':        return 'Template mismatch'
    case 'ai:coherence_issue':          return 'Coherence'
    case 'ai:self_critique':            return 'Review'
    case 'pre_mlr:must_fix':            return 'Pre-MLR must-fix'
    case 'pre_mlr:should_fix':          return 'Pre-MLR should-fix'
    case 'fk:below_threshold':          return 'FK readability'
    case 'fair_balance:missing_safety': return 'Missing safety'
    default:                            return code
  }
}

function confidenceColor(confidence: number | null): string {
  if (confidence === null) return 'bg-slate-100 text-slate-500 italic'
  if (confidence >= 85)    return 'bg-emerald-100 text-emerald-800'
  if (confidence >= 60)    return 'bg-amber-100 text-amber-800'
  return 'bg-rose-100 text-rose-800'
}

// ---- main screen -----------------------------------------------------------

export function MedContentLiveEditor() {
  const { contentId } = useParams()
  const qc = useQueryClient()

  const itemQ = useQuery({
    queryKey: ['med-content', contentId],
    queryFn:  () => medContentApi.get(contentId!),
    enabled:  !!contentId,
    refetchInterval: (query) => {
      const state = (query.state.data as { aiDraftState?: string } | undefined)?.aiDraftState
      return state === 'drafting' || state === 'validating' ? 4_000 : false
    },
  })

  const sectionsQ = useQuery({
    queryKey: ['med-content-sections', contentId],
    queryFn:  () => medContentApi.getSections(contentId!),
    enabled:  !!contentId,
    refetchInterval: () => {
      const item = qc.getQueryData<{ aiDraftState?: string }>(['med-content', contentId])
      return (item?.aiDraftState === 'drafting' || item?.aiDraftState === 'validating') ? 4_000 : false
    },
  })

  const locksQ = useQuery({
    queryKey: ['med-content-locks', contentId],
    queryFn:  () => medContentApi.listSectionLocks(contentId!),
    enabled:  !!contentId,
    refetchInterval: 20_000,
  })

  const sections = sectionsQ.data?.sections ?? []
  const item = itemQ.data as { id: string; title: string; aiDraftState?: string; aiInstructions?: string | null } | undefined
  const aiDraftState = item?.aiDraftState ?? 'idle'
  const locksBySection = useMemo(() => {
    const m = new Map<string, MedSectionLockHolder>()
    for (const l of locksQ.data?.locks ?? []) m.set(l.sectionId, l.holder)
    return m
  }, [locksQ.data])

  const [aiInstructionsDraft, setAiInstructionsDraft] = useState('')
  useEffect(() => { setAiInstructionsDraft(item?.aiInstructions ?? '') }, [item?.aiInstructions])

  const startDraft = useMutation({
    mutationFn: () => medContentApi.startAiInitialDraft(contentId!, {
      aiInstructions: aiInstructionsDraft.trim() || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['med-content', contentId] })
    },
  })

  if (!contentId) {
    return <p className="p-6 text-[13px] text-rose-700">Missing contentId in route.</p>
  }

  return (
    <div className="flex flex-col gap-4 p-6" data-screen="med-content-live-editor">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Live editor
          </p>
          <h1 className="text-[20px] font-semibold text-slate-900">
            {item?.title ?? 'Loading…'}
          </h1>
          <p className="mt-0.5 text-[12px] text-slate-500">
            Edit section content, save on blur, acquire a section lock on focus. AI drafter + 85%
            validation loop sit above.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <AiDraftStateBadge state={aiDraftState} />
            {contentId && <MedContentAiDebugButton contentItemId={contentId} />}
          </div>
          <button
            type="button"
            onClick={() => startDraft.mutate()}
            disabled={startDraft.isPending || aiDraftState === 'drafting' || aiDraftState === 'validating'}
            className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            data-action="start-ai-draft"
            title={
              aiDraftState === 'drafting'   ? 'Drafter is already running.' :
              aiDraftState === 'validating' ? 'Validation loop is running.'  :
              'Enqueue med_content.ai_initial_draft for this item.'
            }
          >
            {startDraft.isPending
              ? 'Enqueuing…'
              : aiDraftState === 'complete'
                ? 'Redraft with AI'
                : 'Draft with AI'}
          </button>
          {startDraft.error && (
            <p className="max-w-[260px] rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-right text-[11px] text-rose-700">
              {errMessage(startDraft.error, 'Enqueue failed')}
            </p>
          )}
        </div>
      </header>

      <section className="rounded-md border border-slate-200 bg-slate-50 p-3" data-ai-instructions>
        <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          AI instructions (optional · persisted)
        </p>
        <textarea
          value={aiInstructionsDraft}
          onChange={e => setAiInstructionsDraft(e.currentTarget.value)}
          rows={3}
          maxLength={2000}
          placeholder="Tone, language, structure hints the drafter should respect — e.g. “target audience: UK HCPs; 6th-grade reading level for patient-facing summary.”"
          className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-[12px] leading-relaxed"
          data-field="ai-instructions"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          Flows into every section draft + section rewrite. Cleared by clicking Draft with AI with
          an empty box above.
        </p>
      </section>

      {sectionsQ.isLoading && <p className="text-[13px] text-slate-500">Loading sections…</p>}
      {sectionsQ.error && (
        <p className="text-[13px] text-rose-700">{errMessage(sectionsQ.error, 'Could not load sections')}</p>
      )}

      {!sectionsQ.isLoading && sections.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-center text-[13px] text-slate-500">
          No sections for this content item yet. The create flow should have seeded v0.1 — if you
          see this, either the item predates the section rewrite or the create route hit the
          no-policy / no-template fallback but the sections still didn't land.
        </p>
      )}

      {sections.map(section => (
        <SectionEditor
          key={section.id}
          contentId={contentId}
          section={section}
          lockHolder={locksBySection.get(section.sectionId) ?? null}
        />
      ))}
    </div>
  )
}

function AiDraftStateBadge({ state }: { state: string }) {
  const palette: Record<string, string> = {
    idle:       'bg-slate-100 text-slate-700',
    drafting:   'bg-blue-100 text-blue-800 animate-pulse',
    validating: 'bg-amber-100 text-amber-800 animate-pulse',
    complete:   'bg-emerald-100 text-emerald-800',
  }
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest ${palette[state] ?? 'bg-slate-100 text-slate-700'}`}
      data-ai-draft-state={state}
    >
      AI draft · {state}
    </span>
  )
}

// ---- per-section editor ----------------------------------------------------

function SectionEditor({
  contentId, section, lockHolder,
}: {
  contentId:  string
  section:    MedContentSectionRow
  lockHolder: MedSectionLockHolder | null
}) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState(section.contentHtml)
  const [dirty, setDirty] = useState(false)
  const [lockConflict, setLockConflict] = useState<MedSectionLockHolder | null>(null)
  const [actionInfo, setActionInfo]     = useState<string | null>(null)
  const [actionError, setActionError]   = useState<string | null>(null)
  const heartbeatRef = useRef<number | null>(null)

  const lastServerHtmlRef = useRef(section.contentHtml)
  useEffect(() => {
    if (section.contentHtml !== lastServerHtmlRef.current) {
      lastServerHtmlRef.current = section.contentHtml
      if (!dirty) setDraft(section.contentHtml)
    }
  }, [section.contentHtml, dirty])

  const acquireLock = useMutation({
    mutationFn: () => medContentApi.acquireSectionLock(contentId, section.sectionId),
    onSuccess: () => {
      setLockConflict(null)
      qc.invalidateQueries({ queryKey: ['med-content-locks', contentId] })
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 423) {
        const body = err.body as { holder?: MedSectionLockHolder } | null
        if (body?.holder) setLockConflict(body.holder)
      }
    },
  })

  const releaseLock = useMutation({
    mutationFn: () => medContentApi.releaseSectionLock(contentId, section.sectionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['med-content-locks', contentId] })
    },
  })

  const save = useMutation({
    mutationFn: () => medContentApi.saveSection(contentId, section.sectionId, draft),
    onSuccess: () => {
      setDirty(false)
      lastServerHtmlRef.current = draft
      setActionInfo('Saved.')
      setActionError(null)
      qc.invalidateQueries({ queryKey: ['med-content-sections', contentId] })
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 423) {
        const body = err.body as { holder?: MedSectionLockHolder } | null
        if (body?.holder) setLockConflict(body.holder)
        setActionError('Could not save — someone else holds this section.')
      } else {
        setActionError(errMessage(err, 'Save failed'))
      }
      setActionInfo(null)
    },
  })

  const [suggestIntent, setSuggestIntent] = useState<null | 'tighten' | 'explain' | 'draft_from_source'>(null)
  const aiSuggest = useMutation({
    mutationFn: (intent: 'tighten' | 'explain' | 'draft_from_source') =>
      medContentApi.aiSuggestSection(contentId, section.sectionId, {
        intent,
        currentContent: draft,
      }),
    onMutate:  (intent) => { setSuggestIntent(intent); setActionError(null); setActionInfo(null) },
    onSuccess: (res) => {
      setDraft(res.responseText)
      setDirty(true)
      setSuggestIntent(null)
      setActionInfo(`AI ${suggestIntent ?? 'suggest'} applied — review + save when ready.`)
    },
    onError: (err: unknown) => {
      setSuggestIntent(null)
      setActionError(errMessage(err, 'AI suggest failed'))
    },
  })

  const onFocus = () => {
    acquireLock.mutate()
    if (heartbeatRef.current === null) {
      heartbeatRef.current = window.setInterval(() => {
        acquireLock.mutate()
      }, 60_000) as unknown as number
    }
  }
  const onBlur = () => {
    if (heartbeatRef.current !== null) {
      window.clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
    if (dirty) save.mutate()
    else       releaseLock.mutate()
  }
  useEffect(() => () => {
    if (heartbeatRef.current !== null) {
      window.clearInterval(heartbeatRef.current)
    }
  }, [])

  const isLockedByOther = !!lockConflict || (!!lockHolder && !!lockHolder.userId && !acquireLock.data)

  return (
    <section className="rounded-md border border-slate-200 bg-white p-3" data-section-editor={section.sectionId}>
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-slate-900 text-[13px]">
            §{section.sectionNumber} {section.sectionTitle}
          </p>
          <span className="font-mono text-[10px] text-slate-500">{section.wordCount} words</span>
          <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${confidenceColor(section.aiConfidence)}`}
                data-chip="confidence"
                title="Overall AI confidence from the last validation pass">
            {section.aiConfidence === null ? '— confidence' : `${section.aiConfidence}% confidence`}
          </span>
          {section.aiFlags.map(f => (
            <span key={f} className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${flagChipClass(f)}`}
                  data-flag={f}
                  title={f}>
              {flagLabel(f)}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">unsaved</span>}
          {save.isPending && <span className="text-[11px] text-slate-500">Saving…</span>}
          {lockHolder && (
            <span className="rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 font-mono text-[10px] font-semibold text-rose-800" data-lock-holder>
              Locked by {lockHolder.userId.slice(0, 8)}… ({lockHolder.expiresInSeconds}s)
            </span>
          )}
          <button
            type="button"
            onClick={() => aiSuggest.mutate('draft_from_source')}
            disabled={aiSuggest.isPending}
            className="rounded-md border border-blue-600 bg-white px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
            data-action="ai-draft-from-source"
            title="Draft (or redraft) this section from the attached source PDFs."
          >
            {aiSuggest.isPending && suggestIntent === 'draft_from_source' ? 'Drafting…' : '✦ Draft'}
          </button>
          <button
            type="button"
            onClick={() => aiSuggest.mutate('tighten')}
            disabled={aiSuggest.isPending || !draft.trim()}
            className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            data-action="ai-tighten"
            title="Rewrite the section for clarity, preserving every data point."
          >
            {aiSuggest.isPending && suggestIntent === 'tighten' ? 'Tightening…' : '✦ Tighten'}
          </button>
          <button
            type="button"
            onClick={() => aiSuggest.mutate('explain')}
            disabled={aiSuggest.isPending || !draft.trim()}
            className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            data-action="ai-explain"
            title="Rewrite in plain English, preserving numeric values and references."
          >
            {aiSuggest.isPending && suggestIntent === 'explain' ? 'Explaining…' : '✦ Explain'}
          </button>
        </div>
      </header>

      {isLockedByOther && lockConflict && (
        <p className="mb-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
          Another editor ({lockConflict.userId}) holds this section. Your edits will be rejected
          until their lock expires or they release it.
        </p>
      )}

      <textarea
        value={draft}
        onChange={e => { setDraft(e.currentTarget.value); setDirty(true); setActionInfo(null) }}
        onFocus={onFocus}
        onBlur={onBlur}
        rows={10}
        className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-[12px] leading-relaxed"
        data-field={`content-${section.sectionId}`}
        placeholder={`Section ${section.sectionNumber} content — HTML allowed.`}
      />

      {actionInfo  && <p className="mt-1 text-[11px] text-emerald-700">{actionInfo}</p>}
      {actionError && <p className="mt-1 text-[11px] text-rose-700">{actionError}</p>}
      <p className="mt-1 font-mono text-[10px] text-slate-400">
        {section.lastEditedAt
          ? `Last edited ${new Date(section.lastEditedAt).toLocaleString()} by ${section.lastEditedBy ?? '—'}`
          : 'Never edited'}
      </p>

      <SectionCommentsPanel contentId={contentId} sectionId={section.sectionId} />
    </section>
  )
}

// ---- comments panel --------------------------------------------------------

function SectionCommentsPanel({
  contentId, sectionId,
}: {
  contentId: string
  sectionId: string
}) {
  const qc = useQueryClient()
  const commentsQ = useQuery({
    queryKey: ['med-content-comments', contentId, sectionId],
    queryFn:  () => medContentApi.listComments(contentId, sectionId),
  })
  const [draft, setDraft] = useState('')
  const [severity, setSeverity] = useState<'info' | 'warning' | 'blocking'>('info')
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => medContentApi.createComment(contentId, sectionId, {
      text: draft.trim(),
      severity,
    }),
    onSuccess: () => {
      setDraft(''); setError(null)
      qc.invalidateQueries({ queryKey: ['med-content-comments', contentId, sectionId] })
    },
    onError: (err: unknown) => setError(errMessage(err, 'Comment failed')),
  })
  const resolve = useMutation({
    mutationFn: (commentId: string) => medContentApi.resolveComment(contentId, commentId),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['med-content-comments', contentId, sectionId] }),
  })

  const comments = commentsQ.data?.comments ?? []
  const openCount = comments.filter(c => c.status === 'open').length

  if (commentsQ.isLoading) return <p className="mt-2 text-[11px] text-slate-500">Loading comments…</p>

  return (
    <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2" data-comments-panel>
      <summary className="cursor-pointer text-[11px] font-semibold text-slate-700">
        Comments {comments.length === 0 ? '(none)' : `· ${comments.length} total · ${openCount} open`}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {comments.map(c => <CommentRow key={c.id} comment={c} onResolve={() => resolve.mutate(c.id)} canResolve={!resolve.isPending} />)}
        {comments.length === 0 && <p className="text-[11px] italic text-slate-500">No comments yet. Owner, MLR reviewers, scoped PM + admin may comment.</p>}

        <form
          className="mt-2 flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-2"
          onSubmit={e => { e.preventDefault(); if (draft.trim()) create.mutate() }}
          data-new-comment
        >
          <textarea
            value={draft}
            onChange={e => setDraft(e.currentTarget.value)}
            rows={2}
            placeholder="Add a comment on this section…"
            className="w-full resize-y rounded-md border border-slate-300 px-2 py-1 font-mono text-[11px]"
            data-field="comment-text"
          />
          <div className="flex items-center justify-between">
            <select
              value={severity}
              onChange={e => setSeverity(e.currentTarget.value as 'info' | 'warning' | 'blocking')}
              className="h-7 rounded-md border border-slate-300 bg-white px-2 text-[11px]"
              data-field="comment-severity"
            >
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="blocking">Blocking</option>
            </select>
            <button
              type="submit"
              disabled={create.isPending || !draft.trim()}
              className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              data-action="add-comment"
            >{create.isPending ? 'Posting…' : 'Add comment'}</button>
          </div>
          {error && <p className="text-[10px] text-rose-700">{error}</p>}
        </form>
      </div>
    </details>
  )
}

function CommentRow({
  comment, onResolve, canResolve,
}: {
  comment:    MedContentSectionCommentRow
  onResolve:  () => void
  canResolve: boolean
}) {
  const palette: Record<string, string> = {
    info:     'border-slate-200',
    warning:  'border-amber-300 bg-amber-50/50',
    blocking: 'border-rose-300 bg-rose-50/50',
  }
  return (
    <div className={`rounded-md border ${palette[comment.severity] ?? 'border-slate-200'} bg-white p-2`} data-comment={comment.id}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[11px] text-slate-800">{comment.authorName}</span>
          <span className="font-mono text-[10px] text-slate-500">{new Date(comment.createdAt).toLocaleString()}</span>
          <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase ${
            comment.severity === 'blocking' ? 'bg-rose-100 text-rose-800' :
            comment.severity === 'warning'  ? 'bg-amber-100 text-amber-800' :
                                              'bg-slate-100 text-slate-700'
          }`}>{comment.severity}</span>
          {comment.status === 'resolved' && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[9px] uppercase text-emerald-800">resolved</span>
          )}
        </div>
        {comment.status === 'open' && (
          <button
            type="button"
            onClick={onResolve}
            disabled={!canResolve}
            className="rounded-md border border-emerald-600 bg-white px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            data-action="resolve-comment"
          >Resolve</button>
        )}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-[12px] text-slate-800">{comment.text}</p>
      {comment.resolutionNote && (
        <p className="mt-1 rounded bg-emerald-50 border border-emerald-200 px-2 py-1 text-[11px] text-emerald-900">
          <span className="font-mono text-[10px] font-semibold uppercase">Resolution:</span> {comment.resolutionNote}
        </p>
      )}
    </div>
  )
}
