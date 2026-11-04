// Part 11 e-signature chain wrappers.
// Shape matches API §9 (apps/api/src/modules/clinical-writing/signatures/routes.ts).

import { api } from './client'

export interface SignatureRecord {
  id: string
  chainId: string
  signerId: string
  signerName: string
  signerRole: string
  step: number
  meaning: 'authored' | 'reviewed' | 'approved' | 'acknowledged'
  status: 'queued' | 'awaiting' | 'signed'
  scopeSections: string[]
  documentHash: string | null
  versionAtSigning: string | null
  timestampUtc: string | null
  localTime: string | null
  timeSource: string | null
  authMethod: string | null
  deviceInfo?: string | null
  networkInfo?: string | null
  // The audit trail entry written when this step was signed (null until signed).
  auditEntryId?: string | null
}

export interface SignatureChain {
  id: string
  documentId: string
  chainType: 'sequential' | 'parallel' | 'grouped'
  status: 'initiated' | 'in_progress' | 'complete' | 'cancelled'
  initiatedBy: string
  initiatedAt: string
  completedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  records: SignatureRecord[]
}

export interface InitiateChainBody {
  chainType?: 'sequential' | 'parallel' | 'grouped'
  signers: Array<{
    signerId: string
    signerName: string
    signerRole: string
    meaning: 'authored' | 'reviewed' | 'approved' | 'acknowledged'
    scopeSections?: string[]
  }>
}

export interface SignRecordBody {
  // Re-authentication at signing: the signer's own login password.
  password: string
  localTime: string
  deviceInfo?: string
}

export const signaturesApi = {
  initiateChain: (documentId: string, body: InitiateChainBody) =>
    api.post<SignatureChain>(`/documents/${documentId}/signature-chains`, body),

  listChains: (documentId: string) =>
    api.get<SignatureChain[]>(`/documents/${documentId}/signature-chains`),

  getChain: (chainId: string) =>
    api.get<SignatureChain>(`/signature-chains/${chainId}`),

  signRecord: (recordId: string, body: SignRecordBody) =>
    api.post<SignatureRecord>(`/signature-records/${recordId}/sign`, body),

  cancelChain: (chainId: string, cancelReason: string) =>
    api.post<SignatureChain>(`/signature-chains/${chainId}/cancel`, { cancelReason }),
}
