// Template Library — admin screen.
//
// One DocumentTemplate row per doc type (ICH E3 CSR, Protocol, IB, …).
// Admins upload a PDF of a completed exemplar; the parser (worker:
// platform.distill_template) extracts the section outline via Claude and
// writes it onto the template row. The New Document wizard then uses
// that outline to seed empty sections into every new document of that
// type, and the AI drafter fills them in.
//
// Laid out like Master Documents: a search box + Framework filter + reset + "New template" above a sortable,
// paged table (one row per doc type). A row opens the template in a right-hand panel (metadata, parser,
// sections JSON editor); "New template" opens the create form in the same panel.
//
// English-only copy for now (same scope as AiPrompts / DocumentTypePolicies —
// super-admin facing, Phase 1 i18n is UI chrome).

import { MasterLibraryHeading } from '../components/MasterLibraryHeading'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../api/client'
import { SlidePanel } from '../../components/ui/SlidePanel'
import { SortIcon } from '../../components/ui/SortIcon'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { MultiSelect } from '../components/MultiSelect'
import { PLATFORM_ACCENT } from '@platform/types'
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

type SortKey = 'name-asc' | 'name-desc' | 'sections-asc' | 'sections-desc' | 'recent' | 'oldest'
const PAGE_SIZES = [10, 20, 50]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function formatDay(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
const filterControl = 'h-10 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[12px] text-slate-800'
const sectionCountOf = (t: DocumentTemplateAdmin) => (t.sections as DocumentTemplateSection[]).length

export function TemplateLibrary() {
  const qc = useQueryClient()
  const { data: templates = [], isLoading, error } = useQuery({
    queryKey: ['document-templates-admin'],
    queryFn:  () => platformApi.listDocumentTemplatesAdmin(),
  })
  const { data: readiness } = useAiReadiness()
  const aiReady = isAiReady(readiness)

  // Filters, sort and paging — the same controls as Master Documents (here they run in the browser: the list is small).
  const [search,     setSearch]     = useState('')
  const [frameworks, setFrameworks] = useState<string[]>([])
  const [sort,       setSort]       = useState<SortKey>('name-asc')
  const [page,       setPage]       = useState(1)
  const [pageSize,   setPageSize]   = useState(PAGE_SIZES[0]!)

  // The panel: a template opened for editing, or the "New template" form.
  const [openId,   setOpenId]   = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const selected = templates.find(t => t.id === openId) ?? null
  const closePanel = () => { setOpenId(null); setCreating(false) }

  const frameworkOptions = useMemo(
    () => Array.from(new Set(templates.map(t => t.framework).filter(Boolean))).sort((x, y) => x.localeCompare(y)),
    [templates],
  )

  const filtersDirty = search.trim() !== '' || frameworks.length > 0
  const resetFilters = () => { setSearch(''); setFrameworks([]) }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = templates.filter(t => {
      if (frameworks.length > 0 && !frameworks.includes(t.framework)) return false
      if (q && ![t.label, t.type, t.description, t.framework].some(v => (v ?? '').toLowerCase().includes(q))) return false
      return true
    })
    const by: Record<SortKey, (x: DocumentTemplateAdmin, y: DocumentTemplateAdmin) => number> = {
      'name-asc':      (x, y) => x.label.localeCompare(y.label),
      'name-desc':     (x, y) => y.label.localeCompare(x.label),
      'sections-asc':  (x, y) => sectionCountOf(x) - sectionCountOf(y),
      'sections-desc': (x, y) => sectionCountOf(y) - sectionCountOf(x),
      'recent':        (x, y) => new Date(y.updatedAt).getTime() - new Date(x.updatedAt).getTime(),
      'oldest':        (x, y) => new Date(x.updatedAt).getTime() - new Date(y.updatedAt).getTime(),
    }
    return [...rows].sort(by[sort])
  }, [templates, search, frameworks, sort])

  useEffect(() => { setPage(1) }, [search, frameworks, sort, pageSize])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows  = filtered.slice((Math.min(page, pageCount) - 1) * pageSize, Math.min(page, pageCount) * pageSize)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['document-templates-admin'] })

  const sortFor = (asc: SortKey, desc: SortKey): 'asc' | 'desc' | null => sort === asc ? 'asc' : sort === desc ? 'desc' : null
  const SortHead = ({ label, asc, desc }: { label: string; asc: SortKey; desc: SortKey }) => (
    <th className="px-4 py-3 text-left" aria-sort={sort === asc ? 'ascending' : sort === desc ? 'descending' : 'none'}>
      <button type="button" onClick={() => setSort(sort === asc ? desc : asc)} data-sort={asc}
        className="inline-flex items-center gap-1.5 uppercase tracking-widest hover:text-slate-800">
        {label}<SortIcon state={sortFor(asc, desc)} />
      </button>
    </th>
  )
  const PlainHead = ({ label }: { label: string }) => <th className="px-4 py-3 text-left uppercase tracking-widest">{label}</th>

  return (
    <div className="bg-slate-50" data-screen="template-library">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1600, padding: '20px 24px 48px' }}>
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

        {/* Filters — search, Framework, reset and New template, in one row like Master Documents. */}
        <div className="[container-type:inline-size]" data-filter-panel>
          <div className="flex flex-wrap items-center gap-3 [@container_(min-width:700px)]:flex-nowrap">
            <input
              type="search" value={search} onChange={e => setSearch(e.currentTarget.value)}
              placeholder="Search templates" aria-label="Search templates" data-filter-search
              className={`${filterControl} basis-full min-w-0 [@container_(min-width:700px)]:min-w-[180px] [@container_(min-width:700px)]:flex-[2_1_0%] [@container_(min-width:700px)]:basis-auto`}
            />
            <div data-filter-framework className="min-w-[160px] flex-[1_1_160px] [@container_(min-width:700px)]:flex-[1_1_0%]">
              <MultiSelect label="Framework" allLabel="All frameworks"
                options={frameworkOptions.map(fw => ({ value: fw, label: fw }))} value={frameworks} onChange={setFrameworks}
                optionAttr="data-framework-option" className={filterControl} />
            </div>
            <button
              type="button" onClick={resetFilters} disabled={!filtersDirty}
              title={filtersDirty ? 'Reset filters' : 'Filters are at their defaults'} aria-label="Reset filters"
              className="flex h-10 w-10 flex-none items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white"
              data-action="reset-filters"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
                <path d="M2.5 2.5v2.8h2.8" />
              </svg>
            </button>
            <button
              type="button" onClick={() => { setOpenId(null); setCreating(true) }}
              className="h-10 flex-none rounded-md px-4 text-[13px] font-semibold text-white"
              style={{ backgroundColor: PLATFORM_ACCENT.primary }}
              data-action="new-template"
            >+ New template</button>
          </div>
        </div>

        {error && <p className="rounded-md bg-red-50 p-3 text-[12px] text-red-800" role="alert" data-state="error">{errMessage(error, 'Could not load templates')}</p>}

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-results-list>
          <table className="w-full border-collapse text-[13px]">
            <thead className="border-b border-slate-200 bg-slate-50 font-mono text-[10px] font-semibold text-slate-500">
              <tr>
                <SortHead label="Template" asc="name-asc" desc="name-desc" />
                <PlainHead label="Doc type" />
                <PlainHead label="Framework" />
                <SortHead label="Sections" asc="sections-asc" desc="sections-desc" />
                <PlainHead label="Version" />
                <SortHead label="Updated" asc="oldest" desc="recent" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[12px] text-slate-500" data-state="loading">Loading templates…</td></tr>
              )}
              {!isLoading && !error && pageRows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[12px] text-slate-500" data-state="empty">
                  {filtersDirty ? 'No templates match these filters.' : 'No templates authored yet. Use + New template to add one.'}
                  {filtersDirty && (
                    <div><button type="button" onClick={resetFilters} className="mt-2 font-semibold text-slate-700 underline">Reset filters</button></div>
                  )}
                </td></tr>
              )}
              {pageRows.map(tpl => {
                const isActive = tpl.id === openId
                return (
                  <tr key={tpl.id} onClick={() => { setCreating(false); setOpenId(tpl.id) }} tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCreating(false); setOpenId(tpl.id) } }}
                    data-template-id={tpl.id} data-template-active={isActive || undefined} data-panel-trigger aria-current={isActive || undefined}
                    className="cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                    style={{ backgroundColor: isActive ? PLATFORM_ACCENT.bgTint : undefined }}>
                    <td className="px-4 py-3 font-semibold text-slate-900">{tpl.label}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-slate-700">{tpl.type}</td>
                    <td className="px-4 py-3 text-slate-700">{tpl.framework || '—'}</td>
                    <td className="px-4 py-3 text-slate-700">{sectionCountOf(tpl)}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-slate-700">v{tpl.version}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[12px] text-slate-700">{formatDay(tpl.updatedAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3" data-pagination>
            <select className="h-9 rounded-md border border-slate-300 bg-white px-2 text-[13px]" value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))} aria-label="Rows per page" data-page-size>
              {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <div className="flex items-center gap-3 font-mono text-[12px] text-slate-600">
              <span>Page {Math.min(page, pageCount)} of {pageCount} · {filtered.length} {filtered.length === 1 ? 'template' : 'templates'}</span>
              <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} data-action="prev-page"
                className="h-9 rounded-md border border-slate-300 px-3 text-[13px] text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">‹ Previous</button>
              <button type="button" onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={page >= pageCount} data-action="next-page"
                className="h-9 rounded-md border border-slate-300 px-3 text-[13px] text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Next ›</button>
            </div>
          </div>
        </section>
      </div>

      {/* Right-hand panel: the template's details and editor, or the New template form. Not closed by an
          outside click, so a half-edited sections list isn't lost by accident. */}
      <SlidePanel open={creating || !!selected} onClose={closePanel}
        title={creating ? 'New template' : selected?.label ?? ''}
        subtitle={selected && !creating && (
          <span className="mt-1 block truncate font-mono text-[11px] text-slate-500" data-active-meta>
            {selected.type} · v{selected.version} · {sectionCountOf(selected)} section{sectionCountOf(selected) === 1 ? '' : 's'} · Updated {formatDay(selected.updatedAt)}
          </span>
        )}
        storageKey="template-detail" defaultWidth={760} belowTopBar expandable>
        <div className="px-5 py-5" data-detail-panel>
          {creating
            ? <NewTemplateForm aiReady={aiReady} onCreated={(id) => { invalidate(); setCreating(false); setOpenId(id) }} />
            : selected && <TemplateEditor key={selected.id} template={selected} aiReady={aiReady} onChanged={invalidate} onRetired={closePanel} />}
        </div>
      </SlidePanel>
    </div>
  )
}

// ---- editor -------------------------------------------------------------

function TemplateEditor({
  template, aiReady, onChanged, onRetired,
}: {
  template:  DocumentTemplateAdmin
  aiReady:   boolean
  onChanged: () => void
  onRetired: () => void
}) {
  const [label,        setLabel]        = useState(template.label)
  const [description,  setDescription]  = useState(template.description)
  const [framework,    setFramework]    = useState(template.framework)
  const [sectionsText, setSectionsText] = useState(JSON.stringify(template.sections ?? [], null, 2))
  const [pdfFile,      setPdfFile]      = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Clears the chosen file everywhere: our copy of it AND the name the browser's file box is still showing.
  const clearFile = () => { setPdfFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }
  const [actionError,  setActionError]  = useState<string | null>(null)
  const [actionInfo,   setActionInfo]   = useState<string | null>(null)

  // A success message ("Template saved", "Parser enqueued…") goes away by itself after 4 seconds. Each new message
  // restarts the timer; errors stay until the next action.
  useEffect(() => {
    if (!actionInfo) return
    const id = setTimeout(() => setActionInfo(null), 4000)
    return () => clearTimeout(id)
  }, [actionInfo])

  const [confirmRetire, setConfirmRetire] = useState(false)

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
    onSuccess: () => { setActionInfo('Template retired.'); setActionError(null); onChanged(); onRetired() },
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
      clearFile()
    },
    onError:   (err: unknown) => { setActionError(errMessage(err, 'Parser enqueue failed')); setActionInfo(null) },
  })

  return (
    <div className="flex flex-col gap-4" data-editor={template.id}>
      {/* The title and meta line are in the panel header; this bar keeps the actions. */}
      <header className="flex items-center justify-end gap-3 border-b border-slate-200 pb-3">
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
            onClick={() => setConfirmRetire(true)}
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
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={e => setPdfFile(e.currentTarget.files?.[0] ?? null)}
              className="min-w-0 flex-1 text-[12px]"
              data-field="template-pdf-file"
            />
            {pdfFile && !parseFile.isPending && <ClearFileButton onClick={clearFile} />}
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

      <ConfirmDialog
        open={confirmRetire}
        tone="danger"
        title={`Retire template "${template.label}"?`}
        message="The New Document wizard will stop offering this document type until a replacement is added."
        confirmLabel="Retire"
        busy={retire.isPending}
        onConfirm={() => { setConfirmRetire(false); retire.mutate() }}
        onCancel={() => setConfirmRetire(false)}
      />

      <div className="grid grid-cols-3 items-start gap-3">
        <Field helpBelow label="Label" help="Human-readable name shown in the New Document wizard dropdown.">
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.currentTarget.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-[13px]"
            data-field="label"
          />
        </Field>
        <Field helpBelow label="Description" help="One-line hint shown under the dropdown.">
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.currentTarget.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-[13px]"
            data-field="description"
          />
        </Field>
        <Field helpBelow label="Framework" help="e.g. 'ICH E3', 'ICH E6(R3)'.">
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

// The × next to a chosen file: removes it so another can be picked (or none). The browser's own file box keeps showing the
// old name unless its value is reset too, so callers clear both.
function ClearFileButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      aria-label="Remove the selected file" title="Remove file"
      className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-slate-300 bg-white text-[16px] leading-none text-slate-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
      data-action="clear-pdf"
    >×</button>
  )
}

// helpBelow puts the hint under the input instead of above it. Side-by-side fields use it: hints of different lengths
// wrap onto different numbers of lines, and when they sit above, the inputs end up at different heights.
function Field({ label, help, helpBelow = false, children }: { label: string; help?: string; helpBelow?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-slate-800">{label}</span>
      {help && !helpBelow && <span className="text-[11px] text-slate-500">{help}</span>}
      {children}
      {help && helpBelow && <span className="text-[11px] text-slate-500">{help}</span>}
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const clearFile = () => { setPdfFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }
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
    <div data-new-template>
      <p className="text-[12px] text-slate-500">
        Start a template either by uploading a PDF exemplar (sections auto-extracted)
        or by filling in metadata only (sections edited by hand).
      </p>

      <div className="mt-3 flex gap-2">
        {(['parse', 'bare'] as const).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); if (m !== 'parse') clearFile() }}
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
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={e => setPdfFile(e.currentTarget.files?.[0] ?? null)}
              className="min-w-0 flex-1 text-[12px]"
              data-field="new-pdf"
            />
            {pdfFile && !parse.isPending && <ClearFileButton onClick={clearFile} />}
          </div>
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
