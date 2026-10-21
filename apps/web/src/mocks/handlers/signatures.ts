import { http, HttpResponse, delay } from 'msw'
import signatureChain from '../../data/signatureChain.json'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

// Mirrors apps/api/src/modules/clinical-writing/signatures/routes.ts so mock
// mode exercises the same endpoints and shapes as the real API:
//   GET  /documents/:id/signature-chains · POST /documents/:id/signature-chains
//   POST /signature-records/:id/sign      · POST /signature-chains/:id/cancel
// Chains live in memory per document; the fixture seeds a demo chain on first
// read. The mock /auth/me user is Marcus Webb (user-MW), whose step is awaiting.

type Meaning = 'authored' | 'reviewed' | 'approved'
type MockRecord = {
  id: string; chainId: string; signerId: string; signerName: string; signerRole: string
  step: number; meaning: Meaning; status: 'queued' | 'awaiting' | 'signed'; scopeSections: string[]
  documentHash: string | null; versionAtSigning: string | null; credentialHash: string | null
  timestampUtc: string | null; localTime: string | null; timeSource: string | null; authMethod: string | null
}
type MockChain = {
  id: string; documentId: string; chainType: 'sequential' | 'parallel'
  status: 'initiated' | 'in_progress' | 'complete' | 'cancelled'
  initiatedBy: string; initiatedAt: string; completedAt: string | null
  cancelledAt: string | null; cancelReason: string | null; records: MockRecord[]
}

const chainsByDoc = new Map<string, MockChain[]>()

function seedChain(documentId: string): MockChain {
  const chainId = `chain-${documentId}-seed`
  return {
    id: chainId, documentId, chainType: 'sequential', status: 'in_progress',
    initiatedBy: 'user-SC', initiatedAt: '2024-10-28T15:00:00Z', completedAt: null, cancelledAt: null, cancelReason: null,
    records: (signatureChain as Array<Record<string, string | number | undefined>>).map(r => ({
      id: String(r.id), chainId, signerId: `user-${String(r.initials)}`, signerName: String(r.signer), signerRole: String(r.role),
      step: Number(r.step), meaning: r.meaning as Meaning, status: r.status as MockRecord['status'], scopeSections: [],
      documentHash: (r.documentHash as string | undefined) ?? null, versionAtSigning: (r.version_at_signing as string | undefined) ?? null,
      credentialHash: null, timestampUtc: (r.timestamp as string | undefined) ?? null, localTime: null,
      timeSource: r.timestamp ? 'ClinWrite.AI time server · NTP stratum 2' : null, authMethod: (r.authMethod as string | undefined) ?? null,
    })),
  }
}

const chainsFor = (documentId: string) => {
  if (!chainsByDoc.has(documentId)) chainsByDoc.set(documentId, [seedChain(documentId)])
  return chainsByDoc.get(documentId)!
}
const findRecord = (recordId: string) => {
  for (const chains of chainsByDoc.values()) for (const c of chains) {
    const r = c.records.find(x => x.id === recordId)
    if (r) return { chain: c, record: r }
  }
  return null
}

export const signatureHandlers = [
  http.get(`${BASE}/documents/:documentId/signature-chains`, async ({ params }) => {
    await delay(150)
    return HttpResponse.json(chainsFor(String(params.documentId)))
  }),

  http.post(`${BASE}/documents/:documentId/signature-chains`, async ({ params, request }) => {
    await delay(300)
    const documentId = String(params.documentId)
    const chains = chainsFor(documentId)
    if (chains.some(c => c.status === 'initiated' || c.status === 'in_progress')) {
      return HttpResponse.json({ error: 'chain_already_active' }, { status: 409 })
    }
    const body = await request.json() as { chainType?: 'sequential' | 'parallel'; signers: Array<{ signerId: string; signerName: string; signerRole: string; meaning: Meaning; scopeSections?: string[] }> }
    const chainType = body.chainType ?? 'sequential'
    const chainId = `chain-${documentId}-${Date.now()}`
    const chain: MockChain = {
      id: chainId, documentId, chainType, status: 'initiated', initiatedBy: 'user-MW', initiatedAt: new Date().toISOString(),
      completedAt: null, cancelledAt: null, cancelReason: null,
      records: body.signers.map((s, i) => ({
        id: `sig-${Date.now()}-${i}`, chainId, ...s, scopeSections: s.scopeSections ?? [], step: i + 1,
        status: chainType === 'parallel' || i === 0 ? 'awaiting' : 'queued',
        documentHash: null, versionAtSigning: null, credentialHash: null, timestampUtc: null, localTime: null, timeSource: null, authMethod: null,
      })),
    }
    chains.unshift(chain)
    return HttpResponse.json(chain, { status: 201 })
  }),

  http.post(`${BASE}/signature-records/:recordId/sign`, async ({ params, request }) => {
    await delay(500)
    const found = findRecord(String(params.recordId))
    if (!found) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    const { chain, record } = found
    const body = await request.json() as { credentialProof?: string; localTime?: string; timeSource?: string }
    if (!body.credentialProof || body.credentialProof.length < 8) {
      return HttpResponse.json({ error: 'validation', issues: [{ message: 'credential proof required (§11.200)' }] }, { status: 400 })
    }
    if (record.signerId !== 'user-MW') return HttpResponse.json({ error: 'wrong_signer' }, { status: 403 })
    if (record.status === 'signed') return HttpResponse.json({ error: 'already_signed' }, { status: 409 })
    if (record.status !== 'awaiting') return HttpResponse.json({ error: 'not_awaiting' }, { status: 409 })
    if (chain.status === 'complete' || chain.status === 'cancelled') return HttpResponse.json({ error: 'chain_closed' }, { status: 409 })

    Object.assign(record, {
      status: 'signed', timestampUtc: new Date().toISOString(), localTime: body.localTime ?? null,
      timeSource: body.timeSource ?? null, authMethod: 'password re-auth (mock)', documentHash: 'mock-sha256', versionAtSigning: 'v0.4',
    })
    chain.status = 'in_progress'
    if (chain.chainType === 'sequential') {
      const next = chain.records.find(r => r.status === 'queued')
      if (next) next.status = 'awaiting'
    }
    if (chain.records.every(r => r.status === 'signed')) {
      chain.status = 'complete'
      chain.completedAt = new Date().toISOString()
    }
    return HttpResponse.json(record)
  }),

  http.post(`${BASE}/signature-chains/:chainId/cancel`, async ({ params, request }) => {
    await delay(200)
    const body = await request.json() as { cancelReason?: string }
    for (const chains of chainsByDoc.values()) {
      const chain = chains.find(c => c.id === params.chainId)
      if (!chain) continue
      if (!body.cancelReason) return HttpResponse.json({ error: 'validation' }, { status: 400 })
      Object.assign(chain, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancelReason: body.cancelReason })
      return HttpResponse.json(chain)
    }
    return HttpResponse.json({ error: 'not_found' }, { status: 404 })
  }),
]
