import { http, HttpResponse, delay } from 'msw'
import tlf from '../../data/tlf.json'
import meddra from '../../data/meddra.json'
import ichSections from '../../data/ichSections.json'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

// Words per section by status, so the mock report's wordCount matches its hasContent.
const MOCK_WORDS: Record<string, number> = { complete: 420, in_progress: 120, warning: 120 }

// Waivers added in this session; §16.4 starts waived and can be reinstated like any other.
const ichWaivers = new Map<string, { waivedBy: string; waivedByName: string; waivedAt: string; reason: string; versionAtWaiver: string }>([
  ['§16.4', { waivedBy: 'usr-reviewer', waivedByName: 'Reviewer', waivedAt: '2026-10-01T09:00:00.000Z', reason: 'Not a US submission', versionAtWaiver: 'v0.3' }],
])

export const referenceHandlers = [
  http.get(`${BASE}/documents/:documentId/tlf`, async () => {
    await delay(150)
    return HttpResponse.json(tlf)
  }),
  http.get(`${BASE}/meddra/search`, async ({ request }) => {
    const q = new URL(request.url).searchParams.get('q')?.toLowerCase() ?? ''
    await delay(300)
    const results = q.length >= 3
      ? meddra.searchResults.filter(t => t.pt.toLowerCase().includes(q) || t.soc.toLowerCase().includes(q))
      : []
    return HttpResponse.json({ version: meddra.version, results })
  }),
  http.get(`${BASE}/documents/:documentId/ich-e3`, async () => {
    await delay(100)
    // Reshape the fixture to the live API's report: §16.4 is the conditional
    // US-only row; hyphenated statuses become underscored.
    const sections = ichSections.map(s => {
      const conditional = s.section === '§16.4'
      const waiver = ichWaivers.get(s.section)
      const fixtureStatus = s.status.replace('-', '_')
      const wordCount = MOCK_WORDS[fixtureStatus] ?? 0
      return {
        code:       s.section,
        title:      s.title,
        sectionId:  `s${s.section.slice(1).replace('.', '_')}`,
        status:     waiver ? 'waived' : fixtureStatus,
        inDocument: true,
        conditional,
        hasContent: wordCount > 0,
        wordCount,
        ...(conditional && { requirement: 'not-required' as const }),
        ...(waiver && { waiver }),
      }
    })
    const mandatory     = sections.filter(s => !s.conditional)
    const completeCount = mandatory.filter(s => s.status === 'complete').length
    const waivedCount   = mandatory.filter(s => s.status === 'waived').length
    return HttpResponse.json({
      applicable: true, canWaive: true, documentTitle: 'Clinical Study Report',
      completionPercent: Math.round(((completeCount + waivedCount) / mandatory.length) * 100),
      completeSections: completeCount + waivedCount, completeCount, waivedCount,
      totalSections: mandatory.length, sections,
    })
  }),
  http.post(`${BASE}/documents/:documentId/ich-e3/:sectionCode/waive`, async ({ params, request }) => {
    await delay(100)
    const { reason } = await request.json() as { reason: string }
    const waiver = { waivedBy: 'usr-reviewer', waivedByName: 'Reviewer', waivedAt: new Date().toISOString(), reason, versionAtWaiver: 'v0.4' }
    ichWaivers.set(String(params.sectionCode), waiver)
    return HttpResponse.json(waiver)
  }),
  http.delete(`${BASE}/documents/:documentId/ich-e3/:sectionCode/waive`, async ({ params }) => {
    await delay(100)
    ichWaivers.delete(String(params.sectionCode))
    return new HttpResponse(null, { status: 204 })
  }),
]
