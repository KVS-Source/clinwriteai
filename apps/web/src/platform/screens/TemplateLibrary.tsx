// Template Library — admin screen.
//
// One DocumentTemplate row per doc type (ICH E3 CSR, Protocol, IB, …).
// Admins upload a PDF of a completed exemplar; the parser (worker:
// platform.distill_template) extracts the section outline via Claude and
// writes it onto the template row. The New Document wizard then uses
// that outline to seed empty sections into every new document of that
// type, and the AI drafter fills them in.
//
// Mental model mirrors the Doc Type Policies / AI Prompts screens:
//   - List rows on the left (one per doc type)
//   - Right pane: metadata header + sections JSON editor + parser
//   - "+ New" for a doc type with no template yet
//
// English-only copy for now (same scope as AiPrompts / DocumentTypePolicies —
// super-admin facing, Phase 1 i18n is UI chrome).

import { MasterLibraryHeading } from '../components/MasterLibraryHeading'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../api/client'
import {
  platformApi,
  type DocumentTemplateAdmin,
  type DocumentTemplateSection,
} from '../api/platformApi'
import { useAiReadiness, isAiReady, AiReadinessBanner } from '../ai-readiness'

function errMessage(err: unknown, fallback = 'Request failed'): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string; error?: string } | null
    if (body?.message) return body.message
    if (body?.error)   return body.error
    return `${err.status}`
  }
  return err instanceof Error ? err.message : fallback
}

const SLUG_RE = /^[a-zA-Z0-9_.\-§]+$/
function parseSections(text: string): { ok: DocumentTemplateSection[] } | { err: string } {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { ok: [] }
  let parsed: unknown
  try { parsed = JSON.parse(trimmed) }
  catch (err) { return { err: `JSON parse: ${err instanceof Error ? err.message : String(err)}` } }
  if (!Array.isArray(parsed)) return { err: 'Must be a JSON array of sections.' }
  if (parsed.length > 200) return { err: 'Too many sections (max 200).' }
  const out: DocumentTemplateSection[] = []
  const ids = new Set<string>()
  for (const [i, s] of parsed.entries()) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { err: `[${i}] must be an object` }
    const sec = s as Record<string, unknown>
    const id = typeof sec.id === 'string' ? sec.id.trim() : ''
    const number = typeof sec.number === 'string' ? sec.number.trim() : ''
    const title  = typeof sec.title  === 'string' ? sec.title.trim()  : ''
    if (!SLUG_RE.test(id))    return { err: `[${i}].id must be a slug` }
    if (number.length === 0)  return { err: `[${i}].number required` }
    if (title.length === 0)   return { err: `[${i}].title required` }
    if (title.length > 300)   return { err: `[${i}].title exceeds 300 chars` }
    if (ids.has(id))          return { err: `[${i}].id duplicate: ${id}` }
    ids.add(id)
    const usOnly = sec.usOnly === true ? true : undefined
    out.push({ id, number, title, ...(usOnly ? { usOnly: true } : {}) })
  }
  return { ok: out }
}

export function TemplateLibrary() {
  const qc = useQueryClient()
  const { data: templates = [], isLoading, error } = useQuery({
    queryKey: ['document-templates-admin'],
    queryFn:  () => platformApi.listDocumentTemplatesAdmin(),
  })
  const { data: readiness } = useAiReadiness()
  const aiReady = isAiReady(readiness)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedId && templates.length > 0) setSelectedId(templates[0]!.id)
  }, [templates, selectedId])

  const selected = templates.find(t => t.id === selectedId) ?? null

  const invalidate = () => qc.invalidateQueries({ queryKey: ['document-templates-admin'] })

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5" data-screen="template-library">
      <MasterLibraryHeading>
        <h1 className="text-[20px] font-semibold text-slate-900">Template Library</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">
          One template per doc type: the section outline the New Document wizard seeds + the AI drafter
          fills in. Upload a PDF of a completed exemplar and the parser extracts the sections into JSON.
        </p>
      </MasterLibraryHeading>

      <AiReadinessBanner
        readiness={readiness}
        context="Creating or parsing a template is blocked until an AI engine is configured — the drafter is what populates these sections."
      />

      {isLoading && <p className="text-[13px] text-slate-500">Loading templates…</p>}
      {error && <p className="text-[13px] text-rose-700">{errMessage(error, 'Could not load templates')}</p>}

      {!isLoading && !error && (
        <div className="flex min-h-0 flex-1 gap-4">
          <TemplateList
            templates={templates}
            selected={selectedId}
            onSelect={setSelectedId}
          />
          <div className="flex-1 overflow-y-auto">
            {selected
              ? <TemplateEditor key={selected.id} template={selected} aiReady={aiReady} onChanged={invalidate} />
              : <NewTemplateForm aiReady={aiReady} onCreated={(id) => { invalidate(); setSelectedId(id) }} />}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- list ---------------------------------------------------------------

function TemplateList({
  templates, selected, onSelect,
}: {
  templates: DocumentTemplateAdmin[]
  selected:  string | null
  onSelect:  (id: string | null) => void
}) {
  return (
    <aside className="w-72 shrink-0 overflow-y-auto rounded-md border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          Templates ({templates.length})
        </p>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
          data-action="new-template"
        >
          + New
        </button>
      </div>
      {templates.length === 0 && (
        <p className="p-3 text-[12px] text-slate-500">
          No templates authored yet. Use <strong>+ New</strong> to add one.
        </p>
      )}
      <ul>
        {templates.map(t => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onSelect(t.id)}
              className={`w-full border-b border-slate-100 px-3 py-2 text-left text-[13px] hover:bg-slate-50 ${
                selected === t.id ? 'bg-blue-50/60 font-semibold text-blue-800' : 'text-slate-800'
              }`}
              data-template-id={t.id}
            >
              <div className="flex items-baseline justify-between">
                <span>{t.label}</span>
                <span className="font-mono text-[10px] text-slate-500">v{t.version}</span>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between text-[11px] text-slate-500">
                <span className="font-mono">{t.type}</span>
                <span>{(t.sections as DocumentTemplateSection[]).length} sections</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

// ---- editor -------------------------------------------------------------

function TemplateEditor({
  template, aiReady, onChanged,
}: {
  template:  DocumentTemplateAdmin
  aiReady:   boolean
  onChanged: () => void
}) {
  const [label,        setLabel]        = useState(template.label)
  const [description,  setDescription]  = useState(template.description)
  const [framework,    setFramework]    = useState(template.framework)
  const [sectionsText, setSectionsText] = useState(JSON.stringify(template.sections ?? [], null, 2))
  const [pdfFile,      setPdfFile]      = useState<File | null>(null)
  const [actionError,  setActionError]  = useState<string | null>(null)
  const [actionInfo,   setActionInfo]   = useState<string | null>(null)

  const parse = useMemo(() => parseSections(sectionsText), [sectionsText])
  const sectionsOk = 'ok' in parse

  const save = useMutation({
    mutationFn: () => platformApi.updateDocumentTemplate(template.id, {
      label,
      description,
      framework,
      sections: sectionsOk ? (parse as { ok: DocumentTemplateSection[] }).ok : undefined,
    }),
    onSuccess: () => { setActionInfo('Template saved.'); setActionError(null); onChanged() },
    onError:   (err: unknown) => { setActionError(errMessage(err, 'Save failed')); setActionInfo(null) },
  })

  const retire = useMutation({
    mutationFn: () => platformApi.retireDocumentTemplate(template.id),
    onSuccess: () => { setActionInfo('Template retired.'); setActionError(null); onChanged() },
    onError:   (err: unknown) => { setActionError(errMessage(err, 'Retire failed')); setActionInfo(null) },
  })

  const parseFile = useMutation({
    mutationFn: () => {
      if (!pdfFile) throw new Error('Pick a PDF first')
      return platformApi.parseTemplateFile(pdfFile, { templateId: template.id })
    },
    onSuccess: (res) => {
      setActionInfo(`Parser enqueued for ${res.fileName} — the sections will populate in a few moments. (job ${res.jobId})`)
      setActionError(null)
      setPdfFile(null)
    },
    onError:   (err: unknown) => { setActionError(errMessage(err, 'Parser enqueue failed')); setActionInfo(null) },
  })

  const sectionCount = (template.sections as DocumentTemplateSection[]).length

  return (
    <div className="flex flex-col gap-4" data-editor={template.id}>
      <header className="flex items-baseline justify-between border-b border-slate-200 pb-2">
        <div>
          <h2 className="text-[16px] font-semibold text-slate-900">
            {template.label} <span className="ml-2 font-mono text-[11px] text-slate-500">v{template.version}</span>
          </h2>
          <p className="text-[12px] text-slate-500">
            <span className="font-mono">{template.type}</span>{' · '}
            {sectionCount} section{sectionCount === 1 ? '' : 's'}{' · '}
            Updated {new Date(template.updatedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending || !sectionsOk || !aiReady}
            title={!aiReady ? 'AI is not set up — configure an AI engine first.' : undefined}
            className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            data-action="save"
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!window.confirm(`Retire template "${template.label}"? The New Document wizard will stop offering this type until a replacement lands.`)) return
              retire.mutate()
            }}
            disabled={retire.isPending}
            className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            data-action="retire"
          >
            Retire
          </button>
        </div>
      </header>

      {actionError && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{actionError}</p>}
      {actionInfo  && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">{actionInfo}</p>}

      <Field label="Parse a PDF exemplar" help="Upload a completed / final document of this type. The parser extracts its section outline into JSON below. Overwrites the current sections on success.">
        <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3" data-parse-upload>
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={e => setPdfFile(e.currentTarget.files?.[0] ?? null)}
              className="flex-1 text-[12px]"
              data-field="template-pdf-file"
            />
            <button
              type="button"
              onClick={() => parseFile.mutate()}
              disabled={parseFile.isPending || !pdfFile || !aiReady}
              title={!aiReady ? 'AI is not set up — the parser needs an AI engine.' : undefined}
              className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              data-action="parse-file"
            >
              {parseFile.isPending ? 'Uploading + parsing…' : 'Upload + parse'}
            </button>
          </div>
          {pdfFile && (
            <p className="text-[11px] text-slate-600">
              Selected <span className="font-mono">{pdfFile.name}</span>{' · '}
              {(pdfFile.size / (1024 * 1024)).toFixed(2)} MB
            </p>
          )}
          <p className="text-[11px] text-slate-500">
            PDF only, up to 50 MB. The parser extracts <code>[id, number, title, usOnly?]</code> per section.
          </p>
        </div>
      </Field>

      <Field label="Sections (JSON)" help={`One row per heading. ${sectionsOk ? 'Valid.' : (parse as { err: string }).err}`}>
        <textarea
          value={sectionsText}
          onChange={e => setSectionsText(e.currentTarget.value)}
          rows={16}
          className={`w-full resize-y rounded-md border px-3 py-2 font-mono text-[12px] ${sectionsOk ? 'border-slate-300' : 'border-rose-400 bg-rose-50'}`}
          data-field="sections-json"
        />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Label" help="Human-readable name shown in the New Document wizard dropdown.">
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.currentTarget.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-[13px]"
            data-field="label"
          />
        </Field>
        <Field label="Description" help="One-line hint shown under the dropdown.">
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.currentTarget.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-[13px]"
            data-field="description"
          />
        </Field>
        <Field label="Framework" help="e.g. 'ICH E3', 'ICH E6(R3)'.">
          <input
            type="text"
            value={framework}
            onChange={e => setFramework(e.currentTarget.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-[13px]"
            data-field="framework"
          />
        </Field>
      </div>
    </div>
  )
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-slate-800">{label}</span>
      {help && <span className="text-[11px] text-slate-500">{help}</span>}
      {children}
    </label>
  )
}

// ---- new --------------------------------------------------------------

function NewTemplateForm({ aiReady, onCreated }: { aiReady: boolean; onCreated: (templateId: string) => void }) {
  // Two modes: parse a PDF to populate sections automatically, or create
  // a bare template with no sections. Both need the four metadata fields.
  const [mode,        setMode]        = useState<'parse' | 'bare'>('parse')
  const [docType,     setDocType]     = useState('')
  const [label,       setLabel]       = useState('')
  const [description, setDescription] = useState('')
  const [framework,   setFramework]   = useState('')
  const [pdfFile,     setPdfFile]     = useState<File | null>(null)
  const [error,       setError]       = useState<string | null>(null)

  const metaReady = docType.trim() && label.trim() && description.trim() && framework.trim()

  const create = useMutation({
    mutationFn: () => platformApi.createDocumentTemplate({
      type:        docType.trim().replace(/-/g, '_'),
      label:       label.trim(),
      description: description.trim(),
      framework:   framework.trim(),
      sections:    [],
    }),
    onSuccess: (row) => { setError(null); onCreated(row.id) },
    onError:   (err: unknown) => setError(errMessage(err, 'Create failed')),
  })

  const parse = useMutation({
    mutationFn: () => {
      if (!pdfFile) throw new Error('Pick a PDF first')
      return platformApi.parseTemplateFile(pdfFile, {
        type:        docType.trim().replace(/-/g, '_'),
        label:       label.trim(),
        description: description.trim(),
        framework:   framework.trim(),
      })
    },
    onSuccess: (res) => { setError(null); onCreated(res.templateId) },
    onError:   (err: unknown) => setError(errMessage(err, 'Parse failed')),
  })

  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-white p-4" data-new-template>
      <h2 className="text-[14px] font-semibold text-slate-900">New template</h2>
      <p className="mt-0.5 text-[12px] text-slate-500">
        Start a template either by uploading a PDF exemplar (sections auto-extracted)
        or by filling in metadata only (sections edited by hand).
      </p>

      <div className="mt-3 flex gap-2">
        {(['parse', 'bare'] as const).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-md border px-3 py-1.5 text-[12px] font-semibold ${
              mode === m ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
            data-mode={m}
          >
            {m === 'parse' ? 'Upload + parse PDF' : 'Empty template'}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p>}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <input
          type="text"
          value={docType}
          onChange={e => setDocType(e.currentTarget.value)}
          placeholder="doc type (e.g. protocol)"
          className="rounded-md border border-slate-300 px-3 py-1.5 font-mono text-[12px]"
          data-field="new-type"
        />
        <input
          type="text"
          value={label}
          onChange={e => setLabel(e.currentTarget.value)}
          placeholder="Label (e.g. Protocol)"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-[13px]"
          data-field="new-label"
        />
        <input
          type="text"
          value={description}
          onChange={e => setDescription(e.currentTarget.value)}
          placeholder="One-line description"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-[13px]"
          data-field="new-description"
        />
        <input
          type="text"
          value={framework}
          onChange={e => setFramework(e.currentTarget.value)}
          placeholder="Framework (e.g. ICH E6(R3))"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-[13px]"
          data-field="new-framework"
        />
      </div>

      {mode === 'parse' && (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={e => setPdfFile(e.currentTarget.files?.[0] ?? null)}
            className="text-[12px]"
            data-field="new-pdf"
          />
          {pdfFile && <p className="text-[11px] text-slate-600">Selected <span className="font-mono">{pdfFile.name}</span> · {(pdfFile.size / (1024 * 1024)).toFixed(2)} MB</p>}
        </div>
      )}

      <div className="mt-3 flex justify-end">
        {mode === 'parse' ? (
          <button
            type="button"
            onClick={() => parse.mutate()}
            disabled={parse.isPending || !metaReady || !pdfFile || !aiReady}
            title={!aiReady ? 'AI is not set up — configure an AI engine first.' : undefined}
            className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            data-action="create-parse"
          >
            {parse.isPending ? 'Creating + parsing…' : 'Create + parse PDF'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={create.isPending || !metaReady || !aiReady}
            title={!aiReady ? 'AI is not set up — configure an AI engine first.' : undefined}
            className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            data-action="create-bare"
          >
            {create.isPending ? 'Creating…' : 'Create empty template'}
          </button>
        )}
      </div>
    </div>
  )
}
