import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import type { ReviewComment, ReviewerTab } from '@platform/types'
import { publicationsApi } from '../../api'
import { useReviewStore } from '../../modules/scientific-writing/store'

// --- Static config ---

const CANONICAL_PUB = 'pub-001'
const LOGGED_IN_USER = 'Marcus Webb'

const TAB_LABELS: Record<ReviewerTab, string> = {
  r1: 'Reviewer 1',
  r2: 'Reviewer 2',
  r3: 'Reviewer 3',
  ed: 'Editor',
}

const TAB_ORDER: ReviewerTab[] = ['r1', 'r2', 'r3', 'ed']

// Curated AI drafts (keyed by the numeric-suffix part of the fixture id, e.g. rc-r1c2 → r1c2)
const AI_DRAFTS: Record<string, string> = {
  r1c2: 'We thank Reviewer 1 for this important observation. Subgroup-level confidence intervals for the Asian patient cohort (n = 47) have been added to the revised Figure 2. The hazard ratio in this subgroup was 0.58 (95% CI 0.34–0.99), consistent with the overall population result (HR 0.61; 95% CI 0.48–0.77). We have also added a sentence to the Results noting that the subgroup was not powered for independent inference (Results, lines 268–274).',
  r1c3: 'We thank Reviewer 1 for this suggestion. The Discussion now compares the observed control-arm median PFS of 8.7 months with previously published first-line pembrolizumab monotherapy estimates of 7.7–9.0 months, and notes that our control arm performed within the expected range (Discussion, lines 388–397).',
  r1c4: 'The independent data monitoring committee reviewed the primary analysis on 18 October 2024, before database lock on 22 October 2024. This sequence is now stated in the Methods (lines 231–234).',
  r2c4: 'We have revised the data availability statement to describe the sponsor’s controlled-access mechanism: de-identified individual participant data may be requested through the sponsor’s data request portal, subject to a signed data sharing agreement and review by an independent panel (Data availability, lines 452–460).',
  edc1: 'A marked-up manuscript showing all changes and a clean copy are supplied with this revision. All five authors have reviewed and approved the revised version; approval records are held in the sponsor’s publication management system.',
}

function shortIdOf(commentId: string): string {
  // rc-r1c2 → r1c2
  return commentId.replace(/^rc-/, '')
}

// --- Subcomponents ---

interface TabBarProps {
  active:   ReviewerTab
  counts:   Record<ReviewerTab, number>
  onChange: (tab: ReviewerTab) => void
}
function TabBar({ active, counts, onChange }: TabBarProps) {
  return (
    <div className="flex flex-none gap-0" style={{ borderBottom: '1px solid #E2E8F0' }} data-tab-bar>
      {TAB_ORDER.map(tab => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          data-tab={tab}
          data-active={active === tab || undefined}
          className="flex items-center gap-1.5 text-[13px]"
          style={{
            padding:      '10px 12px',
            borderBottom: `2px solid ${active === tab ? '#0D9488' : 'transparent'}`,
            color:        active === tab ? '#0F766E' : '#64748B',
            fontWeight:   active === tab ? 600 : 500,
          }}
        >
          {TAB_LABELS[tab]}
          <span className="font-mono text-[11px] font-medium" style={{ color: '#94A3B8' }}>({counts[tab]})</span>
        </button>
      ))}
    </div>
  )
}

interface CommentCardProps {
  comment:      ReviewComment
  isActive:     boolean
  isDone:       boolean
  onClick:      () => void
}
function CommentCard({ comment, isActive, isDone, onClick }: CommentCardProps) {
  const excerpt = comment.commentText.length > 120
    ? `${comment.commentText.slice(0, 120).trim()}…`
    : comment.commentText

  let rule = 'transparent'
  let bg   = '#FFFFFF'
  let border = '1px solid #E2E8F0'
  let pillBg = '#F1F5F9'
  let pillFg = '#64748B'
  let pillLabel = 'Not started'
  let tagFg = '#94A3B8'

  if (isDone) {
    rule = '#16A34A'
    bg   = '#F0FDF4'
    border = '1px solid #BBF7D0'
    pillBg = '#F0FDF4'
    pillFg = '#15803D'
    pillLabel = 'Responded ✓'
    tagFg = '#15803D'
  } else if (isActive) {
    rule = '#0D9488'
    bg   = '#F0FDFA'
    border = '1px solid #99F6E4'
    pillBg = '#F0FDFA'
    pillFg = '#0F766E'
    pillLabel = 'Drafting…'
    tagFg = '#0F766E'
  }

  const tagPrefix = comment.reviewerTab === 'ed' ? 'ED' : comment.reviewerTab.toUpperCase()

  return (
    <button
      type="button"
      onClick={onClick}
      data-comment-card={comment.id}
      data-comment-state={isDone ? 'done' : isActive ? 'active' : 'pending'}
      className="flex flex-col gap-1.5 rounded-md text-left transition-colors"
      style={{
        backgroundColor: bg,
        border,
        borderLeft:      `3px solid ${rule}`,
        padding:         '10px 12px',
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[9px] font-medium uppercase tracking-widest" style={{ color: tagFg, letterSpacing: '0.1em' }}>
          {tagPrefix} · COMMENT {comment.commentNumber}
        </span>
        <span
          className="rounded-full text-[10px] font-semibold"
          style={{ padding: '2px 7px', backgroundColor: pillBg, color: pillFg }}
        >
          {pillLabel}
        </span>
      </div>
      <p className="text-[13px] leading-relaxed" style={{ color: '#475569' }}>{excerpt}</p>
    </button>
  )
}

// --- Main ---

export function PeerReviewResponse() {
  const { publicationId } = useParams()
  const pubId             = publicationId ?? CANONICAL_PUB
  const qc                = useQueryClient()

  const activeTab      = useReviewStore(s => s.activeTab)
  const setActiveTab   = useReviewStore(s => s.setActiveTab)
  const activeCommentId = useReviewStore(s => s.activeCommentId)
  const setActiveComment = useReviewStore(s => s.setActiveComment)
  const setStoreComments = useReviewStore(s => s.setComments)

  const [drafts,      setDrafts]      = useState<Record<string, string>>({})
  const [aiFlags,     setAiFlags]     = useState<Record<string, boolean>>({})
  const [doneMap,     setDoneMap]     = useState<Record<string, boolean>>({})
  const [previewOpen, setPreviewOpen] = useState(false)
  const [toast,       setToast]       = useState<string | null>(null)

  // Fetch rounds → get first (latest)
  const { data: rounds = [] } = useQuery({
    queryKey: ['review-rounds', pubId],
    queryFn:  () => publicationsApi.getReviewRounds(pubId),
  })
  const round = rounds[0]

  // Fetch comments once we know roundId
  const { data: fetchedComments = [] } = useQuery({
    queryKey: ['review-comments', round?.id],
    queryFn:  () => publicationsApi.getReviewComments(round!.id),
    enabled:  !!round?.id,
  })

  // Seed drafts + doneMap from fixture responses
  useEffect(() => {
    if (fetchedComments.length === 0) return
    setStoreComments(fetchedComments)
    setDrafts(prev => {
      const next = { ...prev }
      for (const c of fetchedComments) {
        if (next[c.id] === undefined) next[c.id] = c.responseText ?? ''
      }
      return next
    })
    setDoneMap(prev => {
      const next = { ...prev }
      for (const c of fetchedComments) {
        if (next[c.id] === undefined) next[c.id] = c.status === 'responded'
      }
      return next
    })
  }, [fetchedComments, setStoreComments])

  const comments = fetchedComments

  // Default active comment on tab switch → first non-done in tab
  useEffect(() => {
    if (comments.length === 0) return
    const inTab = comments.filter(c => c.reviewerTab === activeTab)
    if (inTab.length === 0) return
    if (activeCommentId && inTab.some(c => c.id === activeCommentId)) return
    const firstPending = inTab.find(c => !doneMap[c.id]) ?? inTab[0]
    setActiveComment(firstPending.id)
  }, [comments, activeTab, doneMap, activeCommentId, setActiveComment])

  // Toast auto-clear
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(t)
  }, [toast])

  // Derived
  const doneCount    = useMemo(() => comments.filter(c => doneMap[c.id]).length, [comments, doneMap])
  const progressPct  = comments.length > 0 ? Math.round((doneCount / comments.length) * 100) : 0
  const letterVer    = `v1.${doneCount}`
  const submitDisabled = doneCount < comments.length || comments.length === 0

  const counts: Record<ReviewerTab, number> = useMemo(() => {
    const c: Record<ReviewerTab, number> = { r1: 0, r2: 0, r3: 0, ed: 0 }
    for (const cm of comments) c[cm.reviewerTab] = (c[cm.reviewerTab] ?? 0) + 1
    return c
  }, [comments])

  const tabComments = useMemo(
    () => comments.filter(c => c.reviewerTab === activeTab),
    [comments, activeTab],
  )

  // Mutations
  const patchDraftMut = useMutation({
    mutationFn: (args: { commentId: string; text: string }) =>
      publicationsApi.submitReviewResponse(round!.id, args.commentId, {
        responseText: args.text,
        respondedBy:  LOGGED_IN_USER,
        status:       'in-progress',
      }),
  })

  const aiDraftMut = useMutation({
    mutationFn: (commentId: string) => publicationsApi.aiDraftResponse(round!.id, commentId),
    onSuccess:  (data, commentId) => {
      const draft = AI_DRAFTS[shortIdOf(commentId)] ?? data.responseText
      setDrafts(prev => ({ ...prev, [commentId]: draft }))
      setAiFlags(prev => ({ ...prev, [commentId]: true }))
      setToast('AI draft applied. Review and edit before marking complete.')
    },
  })

  const completeMut = useMutation({
    mutationFn: (args: { commentId: string; done: boolean }) =>
      publicationsApi.submitReviewResponse(round!.id, args.commentId, {
        responseText: drafts[args.commentId] ?? '',
        respondedBy:  LOGGED_IN_USER,
        status:       args.done ? 'responded' : 'in-progress',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review-comments', round?.id] }),
  })

  const handleDraftChange = (commentId: string, text: string) => {
    setDrafts(prev => ({ ...prev, [commentId]: text }))
    setAiFlags(prev => ({ ...prev, [commentId]: false })) // user edit clears AI badge
  }

  const handleDraftBlur = (commentId: string) => {
    if (round?.id && drafts[commentId]) {
      patchDraftMut.mutate({ commentId, text: drafts[commentId] })
    }
  }

  const handleAIDraft = (commentId: string) => {
    // Optimistic: apply draft locally immediately
    const draft = AI_DRAFTS[shortIdOf(commentId)] ?? 'We thank the reviewer for this comment. The manuscript has been revised accordingly.'
    setDrafts(prev => ({ ...prev, [commentId]: draft }))
    setAiFlags(prev => ({ ...prev, [commentId]: true }))
    setToast('AI draft applied. Review and edit before marking complete.')
    if (round?.id) aiDraftMut.mutate(commentId)
  }

  const handleMarkComplete = (commentId: string) => {
    setDoneMap(prev => ({ ...prev, [commentId]: true }))
    completeMut.mutate({ commentId, done: true })
    setToast(`Response to ${shortIdOf(commentId).toUpperCase()} marked complete.`)
  }

  const handleReopen = (commentId: string) => {
    setDoneMap(prev => ({ ...prev, [commentId]: false }))
    completeMut.mutate({ commentId, done: false })
  }

  const handleSubmitLetter = () => {
    setToast(`Response letter ${letterVer} submitted to ${round?.journalSubmissionRef ?? 'the journal'}. Audit trail updated.`)
  }

  // --- Render ---

  return (
    <div className="flex h-full flex-col bg-slate-50" data-screen="peer-review-response">

      {/* Header sub-bar */}
      <div className="flex flex-none flex-col gap-3" style={{ padding: '20px 32px 16px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#FFFFFF' }}>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-bold tracking-tight" style={{ margin: 0 }}>Peer review response</h1>
            <p className="font-mono text-xs font-medium" style={{ color: '#64748B' }} data-header-subtitle>
              NEJM submission #{round?.journalSubmissionRef ?? 'NEJM-2026-28471'} · Round {round?.roundNumber ?? 1} · {round?.reviewerCount ?? 3} reviewers
            </p>
          </div>
          <div className="flex flex-none gap-2">
            <button
              type="button"
              data-upload-manuscript
              className="rounded-md bg-white text-[13px] font-semibold"
              style={{ height: 36, padding: '0 14px', border: '1px solid #0D9488', color: '#0F766E' }}
            >
              Upload revised manuscript
            </button>
            <button
              type="button"
              onClick={handleSubmitLetter}
              disabled={submitDisabled}
              data-submit-letter
              className="rounded-md text-[13px] font-semibold"
              style={{
                height:          36,
                padding:         '0 14px',
                backgroundColor: submitDisabled ? '#F1F5F9' : '#0D9488',
                color:           submitDisabled ? '#94A3B8' : '#FFFFFF',
                cursor:          submitDisabled ? 'not-allowed' : 'pointer',
                border:          'none',
              }}
            >
              Submit response letter →
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex flex-col gap-1.5" data-progress>
          <div className="flex items-baseline justify-between">
            <p className="font-mono text-[11px] font-medium" style={{ color: '#64748B' }}>
              {doneCount} / {comments.length} comments responded
            </p>
            <p className="font-mono text-[11px] font-medium" style={{ color: '#0F766E' }}>
              Letter {letterVer}
            </p>
          </div>
          <div className="h-1 overflow-hidden rounded-[2px]" style={{ backgroundColor: '#E2E8F0' }}>
            <div className="h-full transition-all" style={{ width: `${progressPct}%`, backgroundColor: '#0D9488' }} />
          </div>
        </div>
      </div>

      {/* Two-col body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left: comment list */}
        <div className="flex w-[340px] flex-none flex-col" style={{ borderRight: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' }} data-comment-panel>
          <TabBar active={activeTab} counts={counts} onChange={setActiveTab} />
          <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-y-auto p-3">
            {tabComments.map(comment => (
              <CommentCard
                key={comment.id}
                comment={comment}
                isActive={activeCommentId === comment.id}
                isDone={!!doneMap[comment.id]}
                onClick={() => setActiveComment(comment.id)}
              />
            ))}
            {tabComments.length === 0 && (
              <p className="text-xs" style={{ color: '#94A3B8', padding: 12 }}>No comments in this tab.</p>
            )}
          </div>
        </div>

        {/* Right: response editor */}
        <div className="flex flex-1 min-w-0 flex-col overflow-y-auto" data-response-panel>
          <div className="flex flex-col gap-3" style={{ maxWidth: 780, padding: '24px 32px 48px', width: '100%' }}>

            {/* Letter header */}
            <div className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-4" data-letter-header>
              <p className="text-[15px] font-bold">Response to Reviewers — VELORA-301 Manuscript</p>
              <p className="text-xs" style={{ color: '#64748B' }}>
                {round?.journalSubmissionRef ?? 'NEJM-2026-28471'} · Round {round?.roundNumber ?? 1}
              </p>
              <p className="font-mono text-[11px] font-medium" style={{ color: '#0F766E' }}>{letterVer}</p>
            </div>

            {/* Section cards — for active tab only */}
            {tabComments.map(comment => {
              const isActive = activeCommentId === comment.id
              const isDone   = !!doneMap[comment.id]
              const draftText = drafts[comment.id] ?? ''
              const isAi      = !!aiFlags[comment.id]

              let border  = '1px solid #E2E8F0'
              let bgHead  = '#F8FAFC'
              let pillBg  = '#F1F5F9'
              let pillFg  = '#64748B'
              let pillLabel = 'Not started'
              if (isDone) {
                border    = '1px solid #BBF7D0'
                bgHead    = '#F0FDF4'
                pillBg    = '#F0FDF4'
                pillFg    = '#15803D'
                pillLabel = 'Responded'
              } else if (isActive) {
                border    = '1px solid #99F6E4'
                bgHead    = '#F0FDFA'
                pillBg    = '#F0FDFA'
                pillFg    = '#0F766E'
                pillLabel = 'Drafting'
              }

              return (
                <div
                  key={comment.id}
                  className="overflow-hidden rounded-lg bg-white"
                  style={{ border }}
                  data-section-card={comment.id}
                  data-section-state={isDone ? 'done' : isActive ? 'active' : 'pending'}
                >
                  <button
                    type="button"
                    onClick={() => setActiveComment(isActive ? '' : comment.id)}
                    className="flex w-full items-center gap-2 text-left"
                    style={{ padding: '12px 14px', backgroundColor: bgHead }}
                    data-section-toggle={comment.id}
                  >
                    <span className="font-mono text-[10px] font-medium uppercase tracking-widest" style={{ color: '#0F766E' }}>
                      {comment.reviewerTab === 'ed' ? 'ED' : comment.reviewerTab.toUpperCase()} · COMMENT {comment.commentNumber}
                    </span>
                    <div className="flex-1" />
                    {isDone && <span className="text-xs font-bold" style={{ color: '#15803D' }}>✓</span>}
                    <span className="rounded-full text-[10px] font-semibold" style={{ padding: '2px 7px', backgroundColor: pillBg, color: pillFg }}>
                      {pillLabel}
                    </span>
                    <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform: isActive ? 'rotate(0)' : 'rotate(-90deg)' }}>
                      <polygon points="1,3 9,3 5,8" fill="#64748B" />
                    </svg>
                  </button>

                  {isActive && (
                    <div className="flex flex-col gap-3 p-4">
                      {/* Reviewer quote */}
                      <div
                        className="rounded-md italic text-xs leading-relaxed"
                        style={{ backgroundColor: '#F8FAFC', padding: '10px 12px', color: '#475569', border: '1px solid #E2E8F0' }}
                      >
                        "{comment.commentText}"
                      </div>

                      {/* Response header row */}
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold">Your response</p>
                        {isAi && (
                          <span
                            className="rounded font-mono font-medium"
                            style={{ fontSize: 9, padding: '2px 6px', backgroundColor: '#DBEAFE', color: '#1D4ED8', letterSpacing: '0.08em' }}
                            data-ai-badge={comment.id}
                          >
                            AI
                          </span>
                        )}
                        <div className="flex-1" />
                        <button
                          type="button"
                          onClick={() => handleAIDraft(comment.id)}
                          disabled={aiDraftMut.isPending}
                          data-ai-draft={comment.id}
                          className="flex items-center gap-1.5 rounded-md bg-white text-xs font-semibold"
                          style={{ padding: '5px 10px', border: '1px solid #0D9488', color: '#0F766E' }}
                        >
                          <svg width="10" height="10" viewBox="0 0 14 14">
                            <polygon points="7,1.2 8.6,5.4 12.8,7 8.6,8.6 7,12.8 5.4,8.6 1.2,7 5.4,5.4" fill="currentColor" />
                          </svg>
                          Draft with AI
                        </button>
                      </div>

                      {/* Textarea */}
                      <textarea
                        value={draftText}
                        onChange={(e) => handleDraftChange(comment.id, e.target.value)}
                        onBlur={() => handleDraftBlur(comment.id)}
                        rows={6}
                        placeholder="Draft your response to this comment…"
                        data-response-textarea={comment.id}
                        data-ai-styled={isAi || undefined}
                        className="w-full resize-y rounded-md text-[13px] outline-none"
                        style={{
                          padding:         '10px 12px',
                          backgroundColor: isAi ? '#F0F7FF' : '#FFFFFF',
                          border:          isAi ? '1px solid #BFDBFE' : '1px solid #0D9488',
                          borderLeft:      isAi ? '3px solid #93C5FD' : undefined,
                          lineHeight:      1.6,
                          color:           '#1E293B',
                        }}
                      />

                      {isAi && (
                        <p className="font-mono text-[11px] leading-relaxed" style={{ color: '#94A3B8' }}>
                          AI-assisted draft grounded in the revised manuscript and TLF package. Accepting records AI provenance to the audit trail.
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-3">
                        <button type="button" className="text-xs font-semibold" style={{ color: '#0F766E' }}>Link to revised manuscript section →</button>
                        <button type="button" className="text-xs font-semibold" style={{ color: '#0F766E' }}>Link to TLF Table 14.2.1 →</button>
                      </div>

                      {/* Footer actions */}
                      <div className="flex items-center gap-3" style={{ borderTop: '1px solid #F1F5F9', paddingTop: 12 }}>
                        {!draftText.trim() && !isDone && (
                          <p className="text-xs" style={{ color: '#94A3B8' }}>Draft a response before marking this comment complete.</p>
                        )}
                        {draftText.trim() && !isDone && (
                          <button
                            type="button"
                            onClick={() => handleMarkComplete(comment.id)}
                            data-mark-complete={comment.id}
                            className="rounded-md text-xs font-semibold text-white"
                            style={{ padding: '8px 14px', backgroundColor: '#0D9488' }}
                          >
                            Mark as complete
                          </button>
                        )}
                        {isDone && (
                          <>
                            <p className="text-xs font-semibold" style={{ color: '#15803D' }}>
                              ✓ Responded · {comment.respondedBy ?? LOGGED_IN_USER}
                            </p>
                            <div className="flex-1" />
                            <button
                              type="button"
                              onClick={() => handleReopen(comment.id)}
                              data-reopen={comment.id}
                              className="text-xs font-semibold text-slate-500"
                            >
                              Reopen
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Preview full letter */}
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-letter-preview-card>
              <button
                type="button"
                onClick={() => setPreviewOpen(v => !v)}
                data-letter-preview-toggle
                className="flex w-full items-center gap-2 text-left"
                style={{ padding: '12px 16px' }}
              >
                <p className="min-w-0 flex-1 text-[13px] font-bold">Preview full letter</p>
                <span className="font-mono text-[11px] font-medium" style={{ color: '#64748B' }}>
                  {doneCount} of {comments.length} assembled
                </span>
                <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform: previewOpen ? 'rotate(0)' : 'rotate(-90deg)' }}>
                  <polygon points="1,3 9,3 5,8" fill="#64748B" />
                </svg>
              </button>
              {previewOpen && (
                <div
                  className="flex flex-col gap-3"
                  style={{ padding: '16px 24px 24px', borderTop: '1px solid #E2E8F0', fontFamily: '"Times New Roman", Times, serif' }}
                  data-letter-preview-body
                >
                  <p className="text-sm" style={{ color: '#475569' }}>28 October 2026</p>
                  <p className="text-sm">Dear Editors,</p>
                  <p className="text-sm leading-relaxed">
                    Thank you for the opportunity to revise our manuscript. We have addressed each reviewer comment in turn and marked the changes in the revised text. Our point-by-point responses follow.
                  </p>
                  {comments.filter(c => doneMap[c.id]).map(c => (
                    <div key={c.id} className="flex flex-col gap-1.5">
                      <p className="text-sm font-bold">
                        {c.reviewerTab === 'ed' ? 'Editor' : `Reviewer ${c.reviewerTab.slice(1)}`} · Comment {c.commentNumber}
                      </p>
                      <p className="text-xs italic" style={{ color: '#475569' }}>{c.commentText}</p>
                      <p className="text-sm leading-relaxed">{drafts[c.id] ?? c.responseText}</p>
                    </div>
                  ))}
                  <p className="text-sm" style={{ marginTop: 8 }}>Yours sincerely,</p>
                  <p className="text-sm">{LOGGED_IN_USER}, on behalf of all authors</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <div
          className="fixed left-1/2 z-50 flex -translate-x-1/2 items-center gap-2.5 rounded-lg text-[13px] text-white"
          style={{
            bottom: 20, maxWidth: 580,
            backgroundColor: '#1E293B',
            padding: '12px 16px',
            boxShadow: '0 12px 28px rgba(15,23,42,0.24)',
          }}
          data-review-toast
        >
          <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: '#0D9488' }} />
          <span className="leading-relaxed">{toast}</span>
        </div>
      )}
    </div>
  )
}
