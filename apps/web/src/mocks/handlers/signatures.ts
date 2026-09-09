import { http, HttpResponse, delay } from 'msw'
import signatureChain from '../../data/signatureChain.json'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api'

export const signatureHandlers = [
  http.get(`${BASE}/documents/:documentId/signature-chain`, async () => {
    await delay(150)
    return HttpResponse.json(signatureChain)
  }),
  http.post(`${BASE}/documents/:documentId/sign`, async ({ request }) => {
    const { meaning } = await request.json() as { meaning: string }
    await delay(600)
    return HttpResponse.json({ id: 'SIG-0418-MW', signer: 'Marcus Webb', initials: 'MW', role: 'Lead Clinical Writer', meaning, status: 'signed', step: 2, timestamp: new Date().toISOString(), authMethod: 'password re-auth + TOTP', documentHash: '3a9f...c4d2', version_at_signing: 'v0.4' })
  }),
]
