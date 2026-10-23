import { http, HttpResponse, delay } from 'msw'
import documents from '../../data/documents.json'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

// Source-document library (mock of GET /projects/:id/source-documents). Same
// query semantics as the API: q / state / sort / dir / page / pageSize.
const SOURCE_SAMPLES = [
  { id: 'src-1', title: 'Informed Consent Form v2', fileName: 'ICF-English-v2.docx', fileSizeBytes: 38_400, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', category: 'icf', categorySource: 'set', origin: 'Sponsor', version: 'v2', state: 'saved', virusScanStatus: 'passed', usedIn: [{ id: 'DOC-008', title: 'Informed Consent Form v2' }], uploadedBy: { id: 'user-il', name: 'Ms Priya Nair', email: 'p.nair@genbioca.com' }, uploadedAt: '2026-10-14T09:43:00Z' },
  { id: 'src-2', title: 'VELORA-301 Protocol v3.2', fileName: 'GBC-4471_Protocol_v3.2_FINAL.pdf', fileSizeBytes: 2_516_582, contentType: 'application/pdf', category: 'protocol', categorySource: 'set', origin: 'Sponsor', version: 'v3.2', state: 'saved', virusScanStatus: 'passed', usedIn: [{ id: 'DOC-001', title: 'VELORA-301 Protocol v3.2' }], uploadedBy: { id: 'user-cl', name: 'Dr Elena Vasquez', email: 'e.vasquez@genbioca.com' }, uploadedAt: '2026-10-12T11:05:00Z' },
  { id: 'src-3', title: 'lab-listing-wk26', fileName: 'lab-listing-wk26.xlsx', fileSizeBytes: 187_392, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', category: 'other', categorySource: 'detected', origin: null, version: null, state: 'saved', virusScanStatus: 'passed', usedIn: [], uploadedBy: { id: 'user-rw', name: 'Dr Sarah Chen', email: 's.chen@genbioca.com' }, uploadedAt: '2026-10-20T15:30:00Z' },
  { id: 'src-4', title: 'crf-page-0042', fileName: 'crf-page-0042.png', fileSizeBytes: 640_000, contentType: 'image/png', category: 'other', categorySource: 'detected', origin: null, version: null, state: 'saved', virusScanStatus: 'passed', usedIn: [], uploadedBy: { id: 'user-ma', name: 'Dr Rebecca Morton', email: 'r.morton@genbioca.com' }, uploadedAt: '2026-10-21T08:12:00Z' },
] as const

const isPreviewable = (t: string) => ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(t)

// Reference links (mock of /documents/:id/references) — in-memory, resets on reload.
const MOCK_REFERENCES: Array<Record<string, unknown>> = []

// A one-page PDF, enough for the viewer to render something.
const TINY_PDF = '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'

function sourceDocumentPage(url: URL) {
  const q = (url.searchParams.get('q') ?? '').toLowerCase()
  const state = url.searchParams.get('state') ?? 'all'
  const sort = url.searchParams.get('sort') ?? 'uploaded'
  const dir = url.searchParams.get('dir') === 'asc' ? 1 : -1
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1))
  const pageSize = Number(url.searchParams.get('pageSize') ?? 50)
  const keyOf: Record<string, (r: (typeof SOURCE_SAMPLES)[number]) => string | number> = {
    title: r => r.title, file: r => r.fileName, category: r => r.category, state: r => r.state,
    size: r => r.fileSizeBytes, uploaded: r => Date.parse(r.uploadedAt),
  }
  const rows = SOURCE_SAMPLES
    .filter(r => (state === 'all' || r.state === state) &&
      (!q || [r.title, r.fileName, r.uploadedBy.name].some(s => s.toLowerCase().includes(q))))
    .sort((a, b) => {
      const x = (keyOf[sort] ?? keyOf.uploaded)(a), y = (keyOf[sort] ?? keyOf.uploaded)(b)
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir
    })
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize).map(r => ({ ...r, previewable: isPreviewable(r.contentType) })),
    total: rows.length, page, pageSize,
    summary: {
      files: SOURCE_SAMPLES.length,
      saved: SOURCE_SAMPLES.filter(r => r.state === 'saved').length,
      rejected: 0,
    },
  }
}

export const documentHandlers = [
  http.get(`${BASE}/documents/:documentId/sources`, async ({ params }) => {
    await delay(150)
    const items = params.documentId === 'DOC-001' ? [{
      uploadId: 'src-2', title: 'VELORA-301 Protocol v3.2', fileName: 'GBC-4471_Protocol_v3.2_FINAL.pdf', category: 'protocol',
      origin: 'Sponsor', version: 'v3.2', contentType: 'application/pdf', previewable: true, linkedAt: '2026-10-12T11:05:00Z',
      sections: [{ sectionId: 's9', number: '9', title: 'Study Design', references: 1 }, { sectionId: 's11_4', number: '11.4', title: 'Efficacy Results', references: 2 }],
    }] : []
    return HttpResponse.json({ documentId: params.documentId, items })
  }),
  http.get(`${BASE}/projects/:projectId/source-documents`, async ({ request }) => {
    await delay(150)
    return HttpResponse.json(sourceDocumentPage(new URL(request.url)))
  }),
  http.get(`${BASE}/projects/:projectId/source-documents/:uploadId/download`, async ({ params }) => {
    const row = SOURCE_SAMPLES.find(r => r.id === params.uploadId)
    if (!row) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    return new HttpResponse(`Mock source document: ${row.fileName}
`, {
      headers: { 'Content-Type': 'text/plain', 'Content-Disposition': `attachment; filename="${row.fileName}.txt"` },
    })
  }),
  http.get(`${BASE}/projects/:projectId/source-documents/:uploadId/preview`, async ({ params }) => {
    const row = SOURCE_SAMPLES.find(r => r.id === params.uploadId)
    if (!row) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    if (!isPreviewable(row.contentType)) return HttpResponse.json({ error: 'not_previewable', message: 'Only PDF and image files can be viewed here. Download the file instead.' }, { status: 415 })
    return new HttpResponse(TINY_PDF, { headers: { 'Content-Type': 'application/pdf' } })
  }),
  http.get(`${BASE}/documents/:documentId/references`, async ({ params, request }) => {
    const sectionId = new URL(request.url).searchParams.get('sectionId')
    return HttpResponse.json({
      projectId: 'PROJ-AURORA',
      items: MOCK_REFERENCES.filter(r => r.documentId === params.documentId && (!sectionId || r.sectionId === sectionId)),
    })
  }),
  http.post(`${BASE}/documents/:documentId/references`, async ({ params, request }) => {
    const body = await request.json() as { sectionId: string; spanText: string; uploadId: string; page?: number; locator?: string; startOffset?: number; endOffset?: number }
    const src = SOURCE_SAMPLES.find(r => r.id === body.uploadId)
    if (!src) return HttpResponse.json({ error: 'source_not_in_project', message: 'That source document is not part of this project.' }, { status: 422 })
    const row = {
      id: `ref-${MOCK_REFERENCES.length + 1}`, documentId: params.documentId, sectionId: body.sectionId, spanText: body.spanText,
      uploadId: src.id, fileName: src.fileName, contentType: src.contentType, previewable: isPreviewable(src.contentType),
      page: body.page ?? null, locator: body.locator ?? null, startOffset: body.startOffset ?? null, endOffset: body.endOffset ?? null,
      createdBy: { id: 'user-mock', name: 'Demo User' }, createdAt: new Date().toISOString(),
    }
    MOCK_REFERENCES.push(row)
    return HttpResponse.json(row, { status: 201 })
  }),
  http.post(`${BASE}/documents/:documentId/references/:referenceId/remove`, async ({ params }) => {
    const i = MOCK_REFERENCES.findIndex(r => r.id === params.referenceId && r.documentId === params.documentId)
    if (i < 0) return HttpResponse.json({ error: 'not_found', message: 'That reference is not part of this document.' }, { status: 404 })
    MOCK_REFERENCES.splice(i, 1)
    return HttpResponse.json({ id: params.referenceId, removedAt: new Date().toISOString() })
  }),
  http.get(`${BASE}/projects/:projectId/documents`, async () => {
    await delay(200)
    return HttpResponse.json(documents)
  }),
  http.get(`${BASE}/documents/:documentId`, async ({ params }) => {
    await delay(150)
    const doc = documents.find(d => d.id === params.documentId)
    return doc ? HttpResponse.json(doc) : HttpResponse.json({ error: 'Not found' }, { status: 404 })
  }),
  http.post(`${BASE}/projects/:projectId/documents`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(600)
    return HttpResponse.json({ id: `DOC-00${documents.length + 1}`, status: 'not-started', stage: 'study-start-up', therapeuticArea: 'Oncology', version: 'v0.1', updatedAt: new Date().toISOString(), sections: [], ...body }, { status: 201 })
  }),
  http.post(`${BASE}/projects/:projectId/documents/upload`, async () => {
    await delay(1500)
    return HttpResponse.json({ uploadId: `upload-${crypto.randomUUID()}`, fileName: 'GBC-4471_Protocol_v3.2_FINAL.pdf', fileSizeMB: 2.4, virusScanStatus: 'passed', classification: { sourceCategory: 'protocol', sourceCategoryConfidence: 90, version: 'v3.2', versionConfidence: 85, stub: false } })
  }),
  http.delete(`${BASE}/projects/:projectId/source-documents/:uploadId`, async () => new HttpResponse(null, { status: 204 })),
  http.post(`${BASE}/projects/:projectId/source-documents/:uploadId/save`, async ({ request, params }) => {
    const body = await request.json() as { title: string; category: string }
    await delay(300)
    return HttpResponse.json({ id: params.uploadId, title: body.title, category: body.category })
  }),
  http.post(`${BASE}/projects/:projectId/documents/confirm-classification`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(400)
    return HttpResponse.json({ id: `DOC-00${documents.length + 1}`, status: 'not-started', stage: 'study-start-up', version: 'v0.1', updatedAt: new Date().toISOString(), sections: [], ...body }, { status: 201 })
  }),
  http.patch(`${BASE}/documents/:documentId/sections/:sectionId`, async ({ params }) => {
    await delay(300)
    const doc = documents.find(d => d.id === params.documentId)
    return HttpResponse.json({ ...doc, updatedAt: new Date().toISOString(), version: 'v0.4' })
  }),
  http.get(`${BASE}/documents/:documentId/versions`, async () => {
    await delay(150)
    return HttpResponse.json([
      { id: 'ver-4', versionNumber: 'v0.4', label: 'Draft',   createdBy: 'Marcus Webb', createdAt: '2024-10-22T09:14:33Z', isCurrent: true,  contentHash: '3a9f...c4d2' },
      { id: 'ver-3', versionNumber: 'v0.3', label: 'Draft',   createdBy: 'Marcus Webb', createdAt: '2024-10-18T11:05:44Z', isCurrent: false, contentHash: '2b8e...d3c1' },
      { id: 'ver-2', versionNumber: 'v0.2', label: 'Draft',   createdBy: 'Marcus Webb', createdAt: '2024-10-10T08:30:00Z', isCurrent: false, contentHash: '1a7d...b2e0' },
      { id: 'ver-1', versionNumber: 'v0.1', label: 'Initial', createdBy: 'Marcus Webb', createdAt: '2024-10-01T09:00:00Z', isCurrent: false, contentHash: '0c6e...a1d9' },
    ])
  }),
  http.post(`${BASE}/documents/:documentId/restore`, async () => {
    await delay(800)
    const doc = documents[0]
    return HttpResponse.json({ ...doc, version: 'v0.5', updatedAt: new Date().toISOString() }, { status: 201 })
  }),
  http.post(`${BASE}/documents/:documentId/submit-for-review`, async ({ params }) => {
    await delay(500)
    const doc = documents.find(d => d.id === params.documentId)
    return HttpResponse.json({ ...doc, status: 'in-review', updatedAt: new Date().toISOString() })
  }),
]
