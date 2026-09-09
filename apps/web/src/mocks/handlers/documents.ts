import { http, HttpResponse, delay } from 'msw'
import documents from '../../data/documents.json'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api'

export const documentHandlers = [
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
