// Section Templates — admin screen (migration 91).
//
// Per-section formatting rules authored in natural language — admins
// write the same prose the AI sees on every draft + rewrite. No JSON
// schema to understand, no translation step, no renderer parity to
// guard.
//
// Lifecycle (mirror of AiPromptRecord): draft → approved → retired.
// Documents snapshot the approved rules onto each section at create
// time so later admin approvals don't retroactively restyle in-flight
// sections.

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MasterLibraryHeading } from '../components/MasterLibraryHeading'
import { ApiError } from '../../api/client'
import {
  platformApi,
  type SectionTemplate,
} from '../api/platformApi'
import { DOCUMENT_TYPE_KEY, documentTypeLabel } from '../../utils/documentLabels'
import { SlidePanel } from '../../components/ui/SlidePanel'

const DOC_TYPES = Object.keys(DOCUMENT_TYPE_KEY)

// Starter prose seeded into the editor for net-new drafts. Shows the
// shape the AI follows well (short, concrete, one rule per line) and
// gives the admin something to edit rather than a blank textarea.
const STARTER_RULES = `Font: Times New Roman, 11pt, black.
Paragraphs: justified alignment, 1.15 line height, 6pt space after.
Lists: numbered ("1."), one item per line.
Tables: 0.5pt solid black borders, gray (#E7E6E6) bold header row, 4pt cell padding.
References: superscript style, no separator.`

function errMessage(err: unknown, fallback = 'Request failed'): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string; error?: string } | null
    if (body?.message) return body.message
    if (body?.error)   return body.error
    return `${err.status}`
  }
  return err instanceof Error ? err.message : fallback
}

export function SectionTemplates() {
  const qc = useQueryClient()
  const approvedQ = useQuery({
    queryKey: ['section-templates-approved'],
    queryFn:  () => platformApi.listSectionTemplates(),
  })
  const rows = useMemo(() => approvedQ.data?.templates ?? [], [approvedQ.data])

  const [newPanelOpen, setNewPanelOpen] = useState(false)
  const [editOf, setEditOf] = useState<{ docType: string; sectionKey: string } | null>(null)
  const [search, setSearch] = useState('')

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['section-templates-approved'] })
    qc.invalidateQueries({ queryKey: ['section-template-versions'] })
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      r.docType.toLowerCase().includes(q) ||
      r.sectionKey.toLowerCase().includes(q) ||
      documentTypeLabel(r.docType).toLowerCase().includes(q),
    )
  }, [rows, search])

  // Group by docType for scannable layout.
  const grouped = useMemo(() => {
    const m = new Map<string, SectionTemplate[]>()
    for (const r of filtered) {
      const bucket = m.get(r.docType) ?? []
      bucket.push(r)
      m.set(r.docType, bucket)
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5" data-screen="section-templates">
      <MasterLibraryHeading>
        <h1 className="text-[20px] font-semibold text-slate-900">Section Templates</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">
          Per-section formatting rules AI follows on every draft + rewrite. Write them in
          plain English &mdash; what you author here is what the model sees verbatim.
          Documents snapshot the approved rules at create time, so later approvals
          don&rsquo;t retroactively restyle in-flight sections.
        </p>
      </MasterLibraryHeading>

      <div className="flex items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search doc type or section key…"
          className="min-w-[280px] flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setNewPanelOpen(true)}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700"
        >
          + New section template
        </button>
      </div>

      {approvedQ.isLoading && <p className="text-[13px] text-slate-500">Loading templates…</p>}
      {approvedQ.error && <p className="text-[13px] text-rose-700">{errMessage(approvedQ.error, 'Could not load templates')}</p>}

      {!approvedQ.isLoading && !approvedQ.error && grouped.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center">
          <p className="text-[13px] text-slate-600">No approved section templates yet.</p>
          <p className="mt-1 text-[12px] text-slate-500">
            Start one for a (doc type, section) pair and approve it to begin flowing format
            rules into AI calls. Sections without a template still work &mdash; AI just doesn&rsquo;t
            see any formatting hints.
          </p>
        </div>
      )}

      {grouped.map(([docType, templates]) => (
        <div key={docType} className="rounded-lg border border-slate-200 bg-white">
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
            <div>
              <h2 className="text-[14px] font-semibold text-slate-900">{documentTypeLabel(docType)}</h2>
              <p className="font-mono text-[11px] text-slate-500">{docType}</p>
            </div>
            <span className="text-[12px] text-slate-500">{templates.length} section{templates.length === 1 ? '' : 's'}</span>
          </header>
          <ul className="divide-y divide-slate-100">
            {templates.sort((a, b) => a.sectionKey.localeCompare(b.sectionKey)).map(t => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setEditOf({ docType: t.docType, sectionKey: t.sectionKey })}
                  className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-slate-50"
                >
                  <div>
                    <p className="font-mono text-[13px] text-slate-900">{t.sectionKey}</p>
                    <p className="mt-0.5 text-[12px] text-slate-500">v{t.version} · approved {t.approvedAt ? new Date(t.approvedAt).toLocaleDateString() : '—'}</p>
                  </div>
                  <span className="text-[12px] text-blue-600">Edit →</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <SlidePanel
        open={newPanelOpen}
        onClose={() => setNewPanelOpen(false)}
        title="New section template"
        subtitle="Start a draft for a (doc type, section key) pair."
        storageKey="clinwrite.sectionTemplates.newPanel.width"
        defaultWidth={720}
        minWidth={520}
        maxWidth={1100}
        expandable
      >
        <NewTemplateForm
          onCreated={(docType, sectionKey) => {
            invalidateAll()
            setNewPanelOpen(false)
            setEditOf({ docType, sectionKey })
          }}
          onCancel={() => setNewPanelOpen(false)}
        />
      </SlidePanel>

      <SlidePanel
        open={!!editOf}
        onClose={() => setEditOf(null)}
        title={editOf ? `${documentTypeLabel(editOf.docType)} / ${editOf.sectionKey}` : 'Section template'}
        subtitle={editOf ? <span className="font-mono text-[11px]">{editOf.docType} · {editOf.sectionKey}</span> : undefined}
        storageKey="clinwrite.sectionTemplates.editPanel.width"
        defaultWidth={820}
        minWidth={520}
        maxWidth={1200}
        expandable
      >
        {editOf && (
          <TemplateEditor
            docType={editOf.docType}
            sectionKey={editOf.sectionKey}
            onChanged={invalidateAll}
            onClose={() => setEditOf(null)}
          />
        )}
      </SlidePanel>
    </div>
  )
}

// ---------------------------------------------------------------- NewForm

function NewTemplateForm(props: {
  onCreated: (docType: string, sectionKey: string) => void
  onCancel:  () => void
}) {
  const [docType, setDocType] = useState<string>(DOC_TYPES[0] ?? '')
  const [sectionKey, setSectionKey] = useState('')
  const [rules, setRules] = useState(STARTER_RULES)

  const createMut = useMutation({
    mutationFn: () =>
      platformApi.createSectionTemplateDraft({
        docType,
        sectionKey: sectionKey.trim(),
        formatRules: rules,
      }),
    onSuccess: (row) => props.onCreated(row.docType, row.sectionKey),
  })

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="block text-[12px] font-medium text-slate-700" htmlFor="st-doctype">Doc type</label>
        <select
          id="st-doctype"
          value={docType}
          onChange={e => setDocType(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px]"
        >
          {DOC_TYPES.map(t => (
            <option key={t} value={t}>{documentTypeLabel(t)} ({t})</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-[12px] font-medium text-slate-700" htmlFor="st-key">Section key</label>
        <input
          id="st-key"
          type="text"
          value={sectionKey}
          onChange={e => setSectionKey(e.target.value)}
          placeholder="e.g. s6_2, methods, intro"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 font-mono text-[13px]"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          The stable key that identifies this section inside its doc type. Allowed characters:
          letters, digits, <code>_</code>, <code>.</code>, <code>-</code>, <code>§</code>.
        </p>
      </div>

      <div>
        <label className="block text-[12px] font-medium text-slate-700" htmlFor="st-rules">Formatting rules (plain English)</label>
        <textarea
          id="st-rules"
          value={rules}
          onChange={e => setRules(e.target.value)}
          rows={16}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 font-mono text-[12px]"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          Write short, concrete rules the AI should follow. One rule per line is easiest to
          read &mdash; e.g. &ldquo;Font: Times New Roman 11pt, black.&rdquo; or
          &ldquo;Lists: numbered, one item per line.&rdquo; This exact text is injected into
          every AI call for this (doc type, section) pair.
        </p>
      </div>

      {createMut.error && (
        <p className="text-[12px] text-rose-700">{errMessage(createMut.error, 'Could not create draft')}</p>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!sectionKey.trim() || createMut.isPending}
          onClick={() => createMut.mutate()}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {createMut.isPending ? 'Creating…' : 'Create draft'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Editor

function TemplateEditor(props: {
  docType:    string
  sectionKey: string
  onChanged:  () => void
  onClose:    () => void
}) {
  const qc = useQueryClient()
  const versionsQ = useQuery({
    queryKey: ['section-template-versions', props.docType, props.sectionKey],
    queryFn:  () => platformApi.listSectionTemplateVersions(props.docType, props.sectionKey),
  })
  const versions = versionsQ.data?.versions ?? []
  const draft    = versions.find(v => v.status === 'draft') ?? null
  const approved = versions.find(v => v.status === 'approved') ?? null

  const [rules, setRules] = useState<string | null>(null)
  const effectiveDraft = draft
  const activeText = rules
    ?? effectiveDraft?.formatRules
    ?? approved?.formatRules
    ?? ''

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['section-template-versions', props.docType, props.sectionKey] })
    props.onChanged()
  }

  const createDraftMut = useMutation({
    mutationFn: () => platformApi.createSectionTemplateDraft({
      docType:     props.docType,
      sectionKey:  props.sectionKey,
      formatRules: activeText,
    }),
    onSuccess: () => { setRules(null); invalidate() },
  })

  const saveDraftMut = useMutation({
    mutationFn: () => {
      if (!effectiveDraft) throw new Error('no draft')
      return platformApi.updateSectionTemplateDraft(effectiveDraft.id, { formatRules: activeText })
    },
    onSuccess: () => { setRules(null); invalidate() },
  })

  const approveMut = useMutation({
    mutationFn: () => {
      if (!effectiveDraft) throw new Error('no draft to approve')
      return platformApi.approveSectionTemplate(effectiveDraft.id)
    },
    onSuccess: invalidate,
  })

  const retireMut = useMutation({
    mutationFn: (reason: string) => {
      const target = effectiveDraft ?? approved
      if (!target) throw new Error('nothing to retire')
      return platformApi.retireSectionTemplate(target.id, reason)
    },
    onSuccess: invalidate,
  })

  if (versionsQ.isLoading) return <p className="text-[13px] text-slate-500">Loading…</p>
  if (versionsQ.error)     return <p className="text-[13px] text-rose-700">{errMessage(versionsQ.error, 'Could not load versions')}</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-[12px]">
        <div>
          <p className="font-medium text-slate-700">Approved</p>
          {approved
            ? <p className="text-slate-600">v{approved.version} · {approved.approvedAt ? new Date(approved.approvedAt).toLocaleString() : '—'}</p>
            : <p className="text-slate-400">None</p>}
        </div>
        <div>
          <p className="font-medium text-slate-700">Draft</p>
          {draft
            ? <p className="text-slate-600">v{draft.version} · updated {new Date(draft.updatedAt).toLocaleString()}</p>
            : <p className="text-slate-400">None</p>}
        </div>
      </div>

      <div>
        <label className="block text-[12px] font-medium text-slate-700" htmlFor="st-edit-rules">Formatting rules</label>
        <textarea
          id="st-edit-rules"
          value={activeText}
          onChange={e => setRules(e.target.value)}
          rows={22}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 font-mono text-[12px]"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          Plain English, one rule per line. Injected verbatim into every AI call for this
          section.
        </p>
      </div>

      {(createDraftMut.error || saveDraftMut.error || approveMut.error || retireMut.error) && (
        <p className="text-[12px] text-rose-700">
          {errMessage(createDraftMut.error ?? saveDraftMut.error ?? approveMut.error ?? retireMut.error)}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
        {effectiveDraft ? (
          <>
            <button
              type="button"
              onClick={() => saveDraftMut.mutate()}
              disabled={saveDraftMut.isPending}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {saveDraftMut.isPending ? 'Saving…' : 'Save draft'}
            </button>
            <button
              type="button"
              onClick={() => approveMut.mutate()}
              disabled={approveMut.isPending}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {approveMut.isPending ? 'Approving…' : 'Approve draft'}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => createDraftMut.mutate()}
            disabled={createDraftMut.isPending}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {createDraftMut.isPending ? 'Creating…' : 'Start new draft'}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            const reason = window.prompt('Retire reason (recorded in audit):')
            if (reason?.trim()) retireMut.mutate(reason.trim())
          }}
          disabled={retireMut.isPending || (!draft && !approved)}
          className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-[13px] font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          Retire
        </button>
        <button
          type="button"
          onClick={props.onClose}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
        >
          Close
        </button>
      </div>
    </div>
  )
}
