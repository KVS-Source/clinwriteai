import { api } from './client'
import type {
  Document, ChecklistItem, AuditEntry, Comment,
  AISuggestion, SignatureRecord, DocumentVersion, DocumentStage, VoiceNote,
  CreateDocumentBody, UpdateSectionBody, CompleteItemBody, WaiveItemBody,
  RestoreSectionsBody, SubmitForReviewBody, AddCommentBody,
  ResolveCommentBody, AISuggestBody, AcceptSuggestionBody,
} from '@platform/types'

// --- Source documents (per-project upload library) ---

export type SourceDocState = 'saved' | 'rejected'
export type SourceDocSort = 'title' | 'file' | 'category' | 'state' | 'scan' | 'usedIn' | 'size' | 'uploaded'

export interface SourceDocument {
  id: string
  title: string
  fileName: string
  fileSizeBytes: number
  contentType: string
  /** PDF / raster image — can be opened in the viewer panel */
  previewable: boolean
  /** Source category key (see utils/sourceCategories.ts) */
  category: string
  /** 'set' = chosen when saved to the library; 'detected' = filename guess for an unsaved/legacy file */
  categorySource: 'set' | 'detected'
  origin: string | null
  version: string | null
  state: SourceDocState
  virusScanStatus: string
  /** Documents written from this source */
  usedIn: Array<{ id: string; title: string }>
  uploadedBy: { id: string; name: string | null; email: string | null }
  uploadedAt: string
}

export interface SourceDocumentPage {
  items: SourceDocument[]
  total: number
  page: number
  pageSize: number
  summary: { files: number; saved: number; rejected: number }
}

export interface SourceDocumentQuery {
  q?: string
  state?: SourceDocState | 'all'
  sort?: SourceDocSort
  dir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

// --- Reference links (document text -> source document), FR-A-022 ---

export interface SourceReference {
  id: string
  documentId: string
  sectionId: string
  spanText: string
  uploadId: string
  fileName: string | null
  contentType: string | null
  previewable: boolean
  page: number | null
  locator: string | null
  /** range in the section's whitespace-collapsed text; null on older references (located by text) */
  startOffset: number | null
  endOffset: number | null
  createdBy: { id: string; name: string | null }
  createdAt: string
}

// A source a document is based on, with the sections that cite it.
export interface DocumentSourceLink {
  uploadId: string
  title: string
  fileName: string
  category: string
  origin: string | null
  version: string | null
  contentType: string
  previewable: boolean
  linkedAt: string
  sections: Array<{ sectionId: string; number: string | null; title: string; references: number }>
}

export interface CreateSourceReferenceBody {
  sectionId: string
  spanText: string
  uploadId: string
  page?: number
  locator?: string
  startOffset?: number
  endOffset?: number
}

export interface SaveSourceBody {
  title: string
  category: string
  origin?: string
  version?: string
  overrides?: string[]
}

export const documentsApi = {
  // Sources a document is based on
  listDocumentSources: (documentId: string) =>
    api.get<{ documentId: string; items: DocumentSourceLink[] }>(`/documents/${documentId}/sources`),
  // Reference links
  listReferences: (documentId: string, sectionId?: string) =>
    api.get<{ projectId: string; items: SourceReference[] }>(
      `/documents/${documentId}/references${sectionId ? `?sectionId=${encodeURIComponent(sectionId)}` : ''}`),
  createReference: (documentId: string, body: CreateSourceReferenceBody) =>
    api.post<SourceReference>(`/documents/${documentId}/references`, body),
  // Withdraw a link — the API keeps the original record and logs the removal
  removeReference: (documentId: string, referenceId: string, reason?: string) =>
    api.post<{ id: string; removedAt: string }>(`/documents/${documentId}/references/${encodeURIComponent(referenceId)}/remove`, reason ? { reason } : {}),
  // PDF / image bytes for the viewer panel. `fromDocumentId` puts the view on that document's audit trail.
  previewSource: (projectId: string, uploadId: string, fromDocumentId?: string) =>
    api.download(`/projects/${projectId}/source-documents/${encodeURIComponent(uploadId)}/preview${fromDocumentId ? `?documentId=${encodeURIComponent(fromDocumentId)}` : ''}`),

  // Source documents
  listSources: (projectId: string, query: SourceDocumentQuery = {}) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '' && v !== 'all') qs.set(k, String(v))
    const suffix = qs.toString() ? `?${qs}` : ''
    return api.get<SourceDocumentPage>(`/projects/${projectId}/source-documents${suffix}`)
  },
  // Original file, as a Blob. Goes through the shared client so auth, the demo-persona
  // header and error bodies behave like every other call.
  downloadSource: (projectId: string, uploadId: string, fromDocumentId?: string) =>
    api.download(`/projects/${projectId}/source-documents/${encodeURIComponent(uploadId)}/download${fromDocumentId ? `?documentId=${encodeURIComponent(fromDocumentId)}` : ''}`),

  // Documents
  list: (projectId: string) =>
    api.get<Document[]>(`/projects/${projectId}/documents`),
  get: (documentId: string) =>
    api.get<Document>(`/documents/${documentId}`),
  create: (projectId: string, body: CreateDocumentBody) =>
    api.post<Document>(`/projects/${projectId}/documents`, body),
  upload: (projectId: string, formData: FormData) =>
    fetch(`${import.meta.env.VITE_API_URL}/projects/${projectId}/documents/upload`, { method: 'POST', body: formData }).then(r => r.json()),
  // Throw away an upload the user never saved to the library (cancelled the upload form).
  discardSource: (projectId: string, uploadId: string) =>
    api.delete<void>(`/projects/${projectId}/source-documents/${encodeURIComponent(uploadId)}`),
  saveSource: (projectId: string, uploadId: string, body: SaveSourceBody) =>
    api.post<{ id: string; title: string; category: string }>(
      `/projects/${projectId}/source-documents/${encodeURIComponent(uploadId)}/save`, body),
  confirmClassification: (projectId: string, body: unknown) =>
    api.post<Document>(`/projects/${projectId}/documents/confirm-classification`, body),
  updateSection: (documentId: string, sectionId: string, body: UpdateSectionBody) =>
    api.patch<Document>(`/documents/${documentId}/sections/${sectionId}`, body),
  // Versions
  getVersions: (documentId: string) =>
    api.get<DocumentVersion[]>(`/documents/${documentId}/versions`),
  // Explicit "Create new version" — snapshots the current section set into a
  // brand-new DocumentVersion row. Normal section saves mutate in place; this
  // is one of the three sanctioned triggers for a new version (the others are
  // review-bounce and restore).
  createVersion: (documentId: string, body: { label?: 'Draft' | 'For Review' | 'Final'; note?: string } = {}) =>
    api.post<DocumentVersion>(`/documents/${documentId}/versions`, body),
  restoreSections: (documentId: string, body: RestoreSectionsBody) =>
    api.post<Document>(`/documents/${documentId}/restore`, body),
  // Review
  submitForReview: (documentId: string, body: SubmitForReviewBody) =>
    api.post<Document>(`/documents/${documentId}/submit-for-review`, body),
  // Stage (PRD-A-010 linear stage-gated progression). Advance moves the
  // document to the next stage in [study-start-up → during-study → post-study
  // → cross-functional-review → crm → final-output]. Fails 422 when the
  // document is already at Final Output.
  getStage: (documentId: string) =>
    api.get<{
      documentId: string
      current:      DocumentStage | null
      currentLabel: string | null
      next:         DocumentStage | null
      nextLabel:    string | null
      terminal:     boolean
    }>(`/documents/${documentId}/stage`),
  advanceStage: (documentId: string) =>
    api.post<Document>(`/documents/${documentId}/advance-stage`, {}),
  // Section locks (sPM-autosave). Lease-based advisory lock on
  // (documentId, sectionId). The hook useSectionLock drives this; the
  // bottom-line contract is: hold a live lock before you call
  // updateSection, or the server returns 423 Locked.
  acquireSectionLock: (documentId: string, sectionId: string) =>
    api.post<{
      outcome: 'acquired' | 'extended' | 'stolen'
      holder: { userId: string; acquiredAt: string; lastHeartbeatAt: string; expiresInSeconds: number }
      staleSeconds: number
    }>(`/documents/${documentId}/sections/${sectionId}/lock`, {}),
  releaseSectionLock: (documentId: string, sectionId: string) =>
    api.delete<{ released: boolean }>(`/documents/${documentId}/sections/${sectionId}/lock`),
  getDocumentLocks: (documentId: string) =>
    api.get<{
      documentId: string
      staleSeconds: number
      locks: Array<{ sectionId: string; holder: { userId: string; acquiredAt: string; lastHeartbeatAt: string; expiresInSeconds: number } }>
    }>(`/documents/${documentId}/locks`),
  // Project-level checklist summary — read-only aggregate used by the home
  // page's "Checklist status" box. Never materialises missing instances.
  getProjectChecklistSummary: (projectId: string) =>
    api.get<{
      totalDocuments: number
      documentsWithChecklist: number
      totalItems: number
      complete: number
      pending: number
      waived: number
      mandatoryPending: number
    }>(`/projects/${projectId}/checklist-summary`),
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
  // Newest first. Without `page` the server returns up to its default page.
  getAuditTrail: (documentId: string, page?: { limit: number; offset: number }) =>
    api.get<{ entries: AuditEntry[]; total: number; limit: number; offset: number }>(
      `/documents/${documentId}/audit${page ? `?limit=${page.limit}&offset=${page.offset}` : ''}`,
    ),
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
  // Unified per-section edit history (sPM-section-history). Every save
  // writes a row — manual, AI accept, undo, restore. The optional filters
  // let the UI switch between the user's own feed and the team-wide view,
  // or restrict to one origin kind.
  getSectionHistory: (documentId: string, sectionId: string, filters: { mine?: boolean; origin?: 'manual' | 'ai' | 'undo' | 'restore' } = {}) => {
    const qs = new URLSearchParams()
    if (filters.mine)   qs.set('mine', 'true')
    if (filters.origin) qs.set('origin', filters.origin)
    const suffix = qs.toString() ? `?${qs}` : ''
    return api.get<{
      documentId: string
      sectionId: string
      currentVersionId: string | null
      entries: Array<{
        id: string
        actorId: string
        actorName: string
        origin: 'manual' | 'ai' | 'undo' | 'restore'
        createdAt: string
        documentVersionId: string
        aiCallRecordId: string | null
        revertedFromId: string | null
        promptText: string | null
        aiIntent:  string | null
        aiModel:   string | null
        interveningCount: number
        interveningByActor: Array<{ actorId: string; actorName: string; count: number }>
        canRevert: boolean
      }>
    }>(`/documents/${documentId}/sections/${sectionId}/history${suffix}`)
  },
  revertSectionEdit: (editHistoryId: string) =>
    api.post<{ ok: true; documentId: string; sectionId: string; contentHtml: string; revertedAt: string }>(
      `/section-edits/${editHistoryId}/revert`, {},
    ),

  // AI chat (sPM-ai-chat) — per-user, per-section conversation thread.
  // Every /ai-suggest call writes two rows (user turn + assistant turn)
  // into this thread; the panel renders them chronologically oldest-first.
  getAiChat: (documentId: string, sectionId: string) =>
    api.get<{
      documentId: string
      sectionId:  string
      actorId:    string
      messages: Array<{
        id:               string
        role:             'user' | 'assistant' | 'system'
        content:          string
        scope:            'section' | 'document' | 'source' | null
        kind:             'suggest' | 'explain' | null
        intent:           string | null
        aiModel:          string | null
        aiCallRecordId:   string | null
        appliedToSection: boolean
        appliedAt:        string | null
        createdAt:        string
      }>
    }>(`/documents/${documentId}/sections/${sectionId}/ai-chat`),
  acceptAiChatMessage: (messageId: string) =>
    api.post<{ id: string; appliedToSection: boolean; appliedAt: string | null }>(
      `/ai-chat-messages/${messageId}/accept`, {},
    ),
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
