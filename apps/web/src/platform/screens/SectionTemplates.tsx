// Section Templates — admin screen (migration 90).
//
// Per-section formatting JSON that flows into every AI call so Claude
// preserves the authored styling (font, paragraph, list, table,
// references) on every rewrite. Versioned per (docType, sectionKey)
// with the same draft → approved → retired workflow as AiPromptRecord.
//
// Admins:
//   - List all approved rows grouped by docType.
//   - Open a (docType, sectionKey) to see the current approved + any
//     live draft side-by-side.
//   - Start a new draft (net-new section OR new version of existing).
//   - Edit draft JSON in place with inline schema help.
//   - Approve a draft: the previously-approved row flips to retired +
//     supersededBy = this row id, atomically on the server.
//   - Retire a row (operator cleanup).
//
// The format JSON is edited as raw JSON here — server validates against
// the full Zod schema (apps/api/.../section-template/schema.ts). A
// starter format is provided for net-new drafts so admins aren't
// staring at `{}`.

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MasterLibraryHeading } from '../components/MasterLibraryHeading'
import { ApiError } from '../../api/client'
import {
  platformApi,
  type SectionTemplate,
  type SectionTemplateFormat,
} from '../api/platformApi'
import { DOCUMENT_TYPE_KEY, documentTypeLabel } from '../../utils/documentLabels'
import { SlidePanel } from '../../components/ui/SlidePanel'

const DOC_TYPES = Object.keys(DOCUMENT_TYPE_KEY)

const STARTER_FORMAT: SectionTemplateFormat = {
  font:       { family: 'Times New Roman', size: 11, color: '#000000' },
  paragraph:  { alignment: 'justify', lineHeight: 1.15, spaceAfter: 6 },
  list:       { type: 'numbered', marker: '1.' },
  table:      { borderStyle: 'solid', borderWidth: 0.5, borderColor: '#000000', headerRow: { fill: '#E7E6E6', fontWeight: 'bold' }, cellPadding: 4 },
  references: { style: 'superscript' },
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

function parseFormatJson(text: string): { ok: SectionTemplateFormat } | { err: string } {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { ok: {} }
  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { err: 'Must be a JSON object.' }
    }
    return { ok: parsed as SectionTemplateFormat }
  } catch (err) {
    return { err: `JSON parse: ${err instanceof Error ? err.message : String(err)}` }
  }
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
          Per-section formatting rules (font, paragraph, list, table) AI sees on every draft
          + rewrite. Documents snapshot the approved row at create time, so later approvals
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
            rules into AI calls. Sections without a template still work — AI just doesn&rsquo;t
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
  const [json, setJson] = useState(() => JSON.stringify(STARTER_FORMAT, null, 2))
  const [jsonError, setJsonError] = useState<string | null>(null)

  const createMut = useMutation({
    mutationFn: async () => {
      const parsed = parseFormatJson(json)
      if ('err' in parsed) { setJsonError(parsed.err); throw new Error(parsed.err) }
      setJsonError(null)
      return platformApi.createSectionTemplateDraft({ docType, sectionKey: sectionKey.trim(), formatJson: parsed.ok })
    },
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
        <label className="block text-[12px] font-medium text-slate-700" htmlFor="st-json">Format JSON</label>
        <textarea
          id="st-json"
          value={json}
          onChange={e => setJson(e.target.value)}
          rows={18}
          className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 font-mono text-[12px]"
        />
        {jsonError && <p className="mt-1 text-[11px] text-rose-700">{jsonError}</p>}
        <p className="mt-1 text-[11px] text-slate-500">
          Top-level keys: <code>page</code>, <code>font</code>, <code>paragraph</code>, <code>heading</code>,
          <code>list</code>, <code>table</code>, <code>references</code>, <code>numbering</code>, <code>notes</code>.
          Every field optional. Server validates the shape.
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

  const [json, setJson] = useState<string | null>(null)
  const effectiveDraft = draft
  const activeText = json
    ?? (effectiveDraft ? JSON.stringify(effectiveDraft.formatJson, null, 2) : approved ? JSON.stringify(approved.formatJson, null, 2) : JSON.stringify({}, null, 2))

  const [jsonError, setJsonError] = useState<string | null>(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['section-template-versions', props.docType, props.sectionKey] })
    props.onChanged()
  }

  const createDraftMut = useMutation({
    mutationFn: async () => {
      const parsed = parseFormatJson(activeText)
      if ('err' in parsed) { setJsonError(parsed.err); throw new Error(parsed.err) }
      setJsonError(null)
      return platformApi.createSectionTemplateDraft({
        docType:    props.docType,
        sectionKey: props.sectionKey,
        formatJson: parsed.ok,
      })
    },
    onSuccess: () => { setJson(null); invalidate() },
  })

  const saveDraftMut = useMutation({
    mutationFn: async () => {
      if (!effectiveDraft) throw new Error('no draft')
      const parsed = parseFormatJson(activeText)
      if ('err' in parsed) { setJsonError(parsed.err); throw new Error(parsed.err) }
      setJsonError(null)
      return platformApi.updateSectionTemplateDraft(effectiveDraft.id, { formatJson: parsed.ok })
    },
    onSuccess: () => { setJson(null); invalidate() },
  })

  const approveMut = useMutation({
    mutationFn: () => {
      if (!effectiveDraft) throw new Error('no draft to approve')
      return platformApi.approveSectionTemplate(effectiveDraft.id)
    },
    onSuccess: invalidate,
  })

  const retireMut = useMutation({
    mutationFn: async (reason: string) => {
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
        <label className="block text-[12px] font-medium text-slate-700" htmlFor="st-edit-json">Format JSON</label>
        <textarea
          id="st-edit-json"
          value={activeText}
          onChange={e => setJson(e.target.value)}
          rows={22}
          className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 font-mono text-[12px]"
        />
        {jsonError && <p className="mt-1 text-[11px] text-rose-700">{jsonError}</p>}
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
