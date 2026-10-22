import { http, HttpResponse, delay } from 'msw'
import documents from '../../data/documents.json'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

// Source-document library (mock of GET /projects/:id/source-documents). Same
// query semantics as the API: q / state / sort / dir / page / pageSize.
const SOURCE_SAMPLES = [
  { id: 'src-1', title: 'Informed Consent Form v2', fileName: 'ICF-English-v2.docx', fileSizeBytes: 38_400, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', documentType: 'icf', documentTypeSource: 'document', state: 'linked', virusScanStatus: 'passed', documentId: 'DOC-008', documentTitle: 'Informed Consent Form v2', uploadedBy: { id: 'user-il', name: 'Ms Priya Nair', email: 'p.nair@genbioca.com' }, uploadedAt: '2026-10-14T09:43:00Z' },
  { id: 'src-2', title: 'VELORA-301 Protocol v3.2', fileName: 'GBC-4471_Protocol_v3.2_FINAL.pdf', fileSizeBytes: 2_516_582, contentType: 'application/pdf', documentType: 'protocol', documentTypeSource: 'document', state: 'linked', virusScanStatus: 'passed', documentId: 'DOC-001', documentTitle: 'VELORA-301 Protocol v3.2', uploadedBy: { id: 'user-cl', name: 'Dr Elena Vasquez', email: 'e.vasquez@genbioca.com' }, uploadedAt: '2026-10-12T11:05:00Z' },
  { id: 'src-3', title: 'lab-listing-wk26', fileName: 'lab-listing-wk26.xlsx', fileSizeBytes: 187_392, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', documentType: null, documentTypeSource: null, state: 'pending', virusScanStatus: 'passed', documentId: null, documentTitle: null, uploadedBy: { id: 'user-rw', name: 'Dr Sarah Chen', email: 's.chen@genbioca.com' }, uploadedAt: '2026-10-20T15:30:00Z' },
  { id: 'src-4', title: 'crf-page-0042', fileName: 'crf-page-0042.png', fileSizeBytes: 640_000, contentType: 'image/png', documentType: null, documentTypeSource: null, state: 'pending', virusScanStatus: 'passed', documentId: null, documentTitle: null, uploadedBy: { id: 'user-ma', name: 'Dr Rebecca Morton', email: 'r.morton@genbioca.com' }, uploadedAt: '2026-10-21T08:12:00Z' },
] as const

function sourceDocumentPage(url: URL) {
  const q = (url.searchParams.get('q') ?? '').toLowerCase()
  const state = url.searchParams.get('state') ?? 'all'
  const sort = url.searchParams.get('sort') ?? 'uploaded'
  const dir = url.searchParams.get('dir') === 'asc' ? 1 : -1
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1))
  const pageSize = Number(url.searchParams.get('pageSize') ?? 50)
  const keyOf: Record<string, (r: (typeof SOURCE_SAMPLES)[number]) => string | number> = {
    title: r => r.title, file: r => r.fileName, type: r => r.documentType ?? '', state: r => r.state,
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
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length, page, pageSize,
    summary: {
      files: SOURCE_SAMPLES.length,
      linked: SOURCE_SAMPLES.filter(r => r.state === 'linked').length,
      pending: SOURCE_SAMPLES.filter(r => r.state === 'pending').length,
      rejected: 0,
    },
  }
}

export const documentHandlers = [
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
    return HttpResponse.json({ uploadId: `upload-${crypto.randomUUID()}`, fileName: 'GBC-4471_Protocol_v3.2_FINAL.pdf', fileSizeMB: 2.4, virusScanStatus: 'passed', classification: { documentType: 'protocol', typeConfidence: 97, studyTitle: 'VELORA-301', studyConfidence: 99, version: 'v3.2', versionConfidence: 94, therapeuticArea: 'Oncology', taConfidence: 99, frameworks: ['ICH E6(R3)', 'ICH E8(R1)', '21 CFR Part 11'] } })
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
