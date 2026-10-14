import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Comment, CommentSeverity } from '@platform/types'
import { PLATFORM_USER_ROLE_LABEL, type PlatformUserRole } from '@platform/types'
import { documentsApi, describeApiError } from '../api'
import { useCurrentUser } from '../hooks'

// "Add comment" form for the Comments panel (PRD FR-A-052, AC-A-034/035):
//   - section tag and severity (Major / Minor / Query) are MANDATORY — the form
//     cannot be submitted without both (severity has no default on purpose);
//   - reviewer identity and timestamp are captured by the system, never typed;
//   - the CMT-### id is assigned by the server and shown once the comment is saved.

export interface ComposerSection { id: string; number: string; title: string }

interface Props {
  documentId:       string
  sections:         ComposerSection[]
  defaultSectionId: string | null
  onClose:          () => void
  onPosted?:        (comment: Comment) => void
}

const SEVERITIES: { key: CommentSeverity; label: string; on: { bg: string; fg: string; border: string } }[] = [
  { key: 'major', label: 'Major', on: { bg: '#FEE2E2', fg: '#B91C1C', border: '#DC2626' } },
  { key: 'minor', label: 'Minor', on: { bg: '#FFFBEB', fg: '#B45309', border: '#D97706' } },
  { key: 'query', label: 'Query', on: { bg: '#EFF6FF', fg: '#1D4ED8', border: '#2563EB' } },
]

export const COMMENT_MAX = 2000
// Section numbers usually already carry their "§" ("§7"); don't double it ("§§7").
export const withSectionMark = (number: string) => (number.startsWith('§') ? number : `§${number}`)
export const sectionRefOf = (s: ComposerSection) => withSectionMark(s.number)

export function CommentComposer({ documentId, sections, defaultSectionId, onClose, onPosted }: Props) {
  const qc = useQueryClient()
  const { data: me } = useCurrentUser()
  const initialSection = sections.find(s => s.id === defaultSectionId)?.id ?? sections[0]?.id ?? ''

  const [sectionId, setSectionId] = useState(initialSection)
  const [severity,  setSeverity]  = useState<CommentSeverity | null>(null)
  const [text,      setText]      = useState('')
  const [touched,   setTouched]   = useState(false)

  // Follow the editor's section until the user picks one themselves.
  const [pickedSection, setPickedSection] = useState(false)
  useEffect(() => { if (!pickedSection && initialSection) setSectionId(initialSection) }, [initialSection, pickedSection])

  const section = sections.find(s => s.id === sectionId)
  const roleLabel = me ? (PLATFORM_USER_ROLE_LABEL[me.role as PlatformUserRole] ?? me.role) : ''

  const post = useMutation({
    mutationFn: () => documentsApi.addComment(documentId, {
      sectionRef: sectionRefOf(section!),
      text:       text.trim(),
      severity:   severity!,
    }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['comments', documentId] })
      qc.invalidateQueries({ queryKey: ['document-audit', documentId] })
      onPosted?.(created)
      onClose()
    },
  })

  const missing = !section ? 'section' : !severity ? 'severity' : !text.trim() ? 'comment' : null
  const submit = () => {
    setTouched(true)
    if (missing || post.isPending) return
    post.mutate()
  }

  return (
    <div
      className="mb-3 flex flex-col gap-2.5 rounded-lg border bg-white p-3"
      style={{ borderColor: '#2563EB', boxShadow: '0 0 0 3px rgba(37,99,235,0.12)' }}
      data-comment-composer
    >
      {/* Identity is read-only: it's whoever the server will record the comment under. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-5 w-5 flex-none items-center justify-center rounded-full font-mono text-[10px] font-bold" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }} data-composer-initials>
          {me?.initials ?? ''}
        </div>
        <p className="text-[13px] font-bold" data-composer-author>{me?.name ?? '…'}</p>
        {roleLabel && <p className="font-mono text-[10px] tracking-wider text-slate-500">{roleLabel}</p>}
        <div className="flex-1" />
        <p className="text-[11px] text-slate-500">Draft</p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-slate-700">Section tag (required)</span>
        <select
          value={sectionId}
          onChange={e => { setSectionId(e.target.value); setPickedSection(true) }}
          className="h-8 rounded border border-slate-300 bg-white px-2 text-[12px]"
          data-composer-section
        >
          {sections.length === 0 && <option value="">No sections available</option>}
          {sections.map(s => <option key={s.id} value={s.id}>{sectionRefOf(s)} {s.title}</option>)}
        </select>
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-slate-700">Severity (required)</span>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Severity">
          {SEVERITIES.map(sv => {
            const on = severity === sv.key
            return (
              <button
                key={sv.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setSeverity(sv.key)}
                data-severity={sv.key}
                className="rounded-full px-3 py-0.5 text-[11px] font-semibold"
                style={on
                  ? { backgroundColor: sv.on.bg, color: sv.on.fg, border: `1px solid ${sv.on.border}` }
                  : { backgroundColor: '#FFFFFF', color: '#475569', border: '1px solid #E2E8F0' }}
              >{sv.label}</button>
            )
          })}
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-slate-700">Comment (required)</span>
        <textarea
          rows={3}
          value={text}
          maxLength={COMMENT_MAX}
          onChange={e => setText(e.target.value)}
          placeholder={section ? `Write a comment for ${sectionRefOf(section)}…` : 'Write a comment…'}
          className="w-full resize-y rounded border border-slate-300 p-2 text-[13px] outline-none focus:border-blue-600"
          data-composer-text
          autoFocus
        />
      </label>

      {touched && missing && (
        <p className="text-[11px] font-semibold" style={{ color: '#DC2626' }} role="alert" data-composer-missing={missing}>
          {missing === 'severity' ? 'Choose a severity: Major, Minor or Query.'
            : missing === 'section' ? 'Choose the section this comment is about.'
            : 'Write the comment before posting.'}
        </p>
      )}
      {post.isError && (
        <p className="text-[11px] font-semibold" style={{ color: '#DC2626' }} role="alert">
          Could not post comment: {describeApiError(post.error).message}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} disabled={post.isPending} className="text-xs font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-50">Cancel</button>
        <button
          type="button"
          onClick={submit}
          disabled={post.isPending}
          data-action="post-comment"
          className="rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >{post.isPending ? 'Posting…' : 'Post comment'}</button>
      </div>
    </div>
  )
}
