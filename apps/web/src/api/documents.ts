import { api } from './client'
import type {
  Document, ChecklistItem, AuditEntry, Comment,
  AISuggestion, SignatureRecord, DocumentVersion, VoiceNote,
  CreateDocumentBody, UpdateSectionBody, CompleteItemBody, WaiveItemBody,
  RestoreSectionsBody, SubmitForReviewBody, AddCommentBody,
  ResolveCommentBody, AISuggestBody, AcceptSuggestionBody,
} from '@platform/types'

// --- Source documents (per-project upload library) ---

export type SourceDocState = 'linked' | 'pending' | 'rejected'
export type SourceDocSort = 'title' | 'file' | 'type' | 'state' | 'size' | 'uploaded'

export interface SourceDocument {
  id: string
  title: string
  fileName: string
  fileSizeBytes: number
  contentType: string
  documentType: string | null
  /** 'document' = the linked document's real type; 'detected' = classifier guess; null = unknown */
  documentTypeSource: 'document' | 'detected' | null
  state: SourceDocState
  virusScanStatus: string
  documentId: string | null
  documentTitle: string | null
  uploadedBy: { id: string; name: string | null; email: string | null }
  uploadedAt: string
}

export interface SourceDocumentPage {
  items: SourceDocument[]
  total: number
  page: number
  pageSize: number
  summary: { files: number; linked: number; pending: number; rejected: number }
}

export interface SourceDocumentQuery {
  q?: string
  state?: SourceDocState | 'all'
  sort?: SourceDocSort
  dir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export const documentsApi = {
  // Source documents
  listSources: (projectId: string, query: SourceDocumentQuery = {}) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '' && v !== 'all') qs.set(k, String(v))
    const suffix = qs.toString() ? `?${qs}` : ''
    return api.get<SourceDocumentPage>(`/projects/${projectId}/source-documents${suffix}`)
  },
  // Original file, as a Blob. Goes through the shared client so auth, the demo-persona
  // header and error bodies behave like every other call.
  downloadSource: (projectId: string, uploadId: string) =>
    api.download(`/projects/${projectId}/source-documents/${encodeURIComponent(uploadId)}/download`),

  // Documents
  list: (projectId: string) =>
    api.get<Document[]>(`/projects/${projectId}/documents`),
  get: (documentId: string) =>
    api.get<Document>(`/documents/${documentId}`),
  create: (projectId: string, body: CreateDocumentBody) =>
    api.post<Document>(`/projects/${projectId}/documents`, body),
  upload: (projectId: string, formData: FormData) =>
    fetch(`${import.meta.env.VITE_API_URL}/projects/${projectId}/documents/upload`, { method: 'POST', body: formData }).then(r => r.json()),
  confirmClassification: (projectId: string, body: unknown) =>
    api.post<Document>(`/projects/${projectId}/documents/confirm-classification`, body),
  updateSection: (documentId: string, sectionId: string, body: UpdateSectionBody) =>
    api.patch<Document>(`/documents/${documentId}/sections/${sectionId}`, body),
  // Versions
  getVersions: (documentId: string) =>
    api.get<DocumentVersion[]>(`/documents/${documentId}/versions`),
  restoreSections: (documentId: string, body: RestoreSectionsBody) =>
    api.post<Document>(`/documents/${documentId}/restore`, body),
  // Review
  submitForReview: (documentId: string, body: SubmitForReviewBody) =>
    api.post<Document>(`/documents/${documentId}/submit-for-review`, body),
  // Checklist
  getChecklist: (documentId: string) =>
    api.get<ChecklistItem[]>(`/documents/${documentId}/checklist`),
  completeItem: (documentId: string, itemId: string, body: CompleteItemBody) =>
    api.patch<ChecklistItem>(`/documents/${documentId}/checklist/${itemId}/complete`, body),
  waiveItem: (documentId: string, itemId: string, body: WaiveItemBody) =>
    api.patch<ChecklistItem>(`/documents/${documentId}/checklist/${itemId}/waive`, body),
  addChecklistItem: (documentId: string, body: { text: string; framework: string }) =>
    api.post<ChecklistItem>(`/documents/${documentId}/checklist`, body),
  // Comments
  getComments: (documentId: string) =>
    api.get<Comment[]>(`/documents/${documentId}/comments`),
  addComment: (documentId: string, body: AddCommentBody) =>
    api.post<Comment>(`/documents/${documentId}/comments`, body),
  // The UI's ResolutionType is hyphenated ('accept-with-modification'); the API's
  // enum is underscored ('accept_with_modification') and rejects the hyphenated form.
  resolveComment: (documentId: string, commentId: string, body: ResolveCommentBody) =>
    api.patch<Comment>(`/documents/${documentId}/comments/${commentId}/resolve`, {
      ...body, resolutionType: body.resolutionType.replace(/-/g, '_'),
    }),
  // Audit
  getAuditTrail: (documentId: string) =>
    api.get<{ entries: AuditEntry[]; total: number; limit: number; offset: number }>(`/documents/${documentId}/audit`),
  // Voice notes
  getVoiceNotes: (documentId: string) =>
    api.get<VoiceNote[]>(`/documents/${documentId}/voice-notes`),
  addVoiceNote: (documentId: string, body: unknown) =>
    api.post<VoiceNote>(`/documents/${documentId}/voice-notes`, body),
  // AI
  aiSuggest: (documentId: string, body: AISuggestBody) =>
    api.post<AISuggestion>(`/documents/${documentId}/ai-suggest`, body),
  acceptSuggestion: (documentId: string, body: AcceptSuggestionBody) =>
    api.post<Document>(`/documents/${documentId}/ai-accept`, body),
  // Signatures
  // The API at /documents/:id/signature-chains returns SignatureChain[]
  // (each with nested records). The UI consumes a flat SignatureRecord[]
  // of the active chain, so pick the most-recent chain's records here.
  // Prisma denorms are signerName + signerRole; the UI shape uses signer +
  // role + initials — map both here.
  getSignatureChain: async (documentId: string): Promise<SignatureRecord[]> => {
    type ApiRecord = {
      id: string; signerName: string; signerRole: string; meaning: string
      status: string; step: number; timestampUtc?: string | null
      authMethod?: string; documentHash?: string; versionAtDecision?: string
    }
    const chains = await api.get<Array<{ id: string; initiatedAt: string; records: ApiRecord[] }>>(
      `/documents/${documentId}/signature-chains`,
    )
    if (!Array.isArray(chains) || chains.length === 0) return []
    const records = chains[0].records ?? []
    return records.map(r => ({
      id:        r.id,
      signer:    r.signerName,
      initials:  r.signerName.split(/\s+/).slice(0, 2).map(w => (w[0] ?? '').toUpperCase()).join(''),
      role:      r.signerRole,
      meaning:   r.meaning as SignatureRecord['meaning'],
      status:    r.status as SignatureRecord['status'],
      step:      r.step,
      timestamp: r.timestampUtc ?? undefined,
      authMethod: r.authMethod,
      documentHash: r.documentHash,
      version_at_signing: r.versionAtDecision,
    }))
  },
  // Signing goes through the chain API (signaturesApi.signRecord →
  // POST /signature-records/:recordId/sign); POST /documents/:id/sign never existed.
  // Reference tools
  getTLF: (documentId: string) =>
    api.get<{ package: { version: string; validatedBy: string; validatedDate: string }; items: unknown[] }>(`/documents/${documentId}/tlf`),
  getICHE3: (documentId: string) =>
    api.get<{ completionPercent: number; completeSections: number; totalSections: number; sections: unknown[] }>(`/documents/${documentId}/ich-e3`),
  // Presence
  updatePresence: (documentId: string, body: { sectionId: string; status: string }) =>
    api.post<{ activeSessions: unknown[] }>(`/documents/${documentId}/presence`, body),
  endPresence: (documentId: string) =>
    api.delete<void>(`/documents/${documentId}/presence`),
  // QA review
  getQAReview: (documentId: string) =>
    api.get<{ cadenceDays: number; lastReviewedAt: string | null; nextDueAt: string; isOverdue: boolean; daysOverdue: number }>(`/documents/${documentId}/qa-review`),
  logQAReview: (documentId: string, body: { reviewedBy: string; notes?: string }) =>
    api.post<{ auditEntryId: string; nextDueAt: string }>(`/documents/${documentId}/qa-review`, body),
}
