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
  // One version's sections as stored (Version Diff compares two of these).
  getVersionSections: (documentId: string, versionId: string) =>
    api.get<{
      id: string
      versionNumber: string
      sections: Array<{ sectionId: string; sectionNumber: string; sectionTitle: string; contentHtml: string }>
    }>(`/documents/${documentId}/versions/${versionId}/sections`),
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

  // Phase 4b admin — template management. All admin-gated.
  listChecklistTemplates: () =>
    api.get<Array<{
      id: string
      deliverableType: string
      projectId: string | null
      version: number
      effectiveDate: string
      changeReason: string
      isCurrent: boolean
      templateStatus: 'draft' | 'locked'
      approvedBy: string | null
      approvedAt: string | null
      createdBy: string
      createdAt: string
      itemCount: number
      instanceCount: number
    }>>(`/checklist-templates`),
  getChecklistTemplate: (templateId: string) =>
    api.get<{
      id: string
      deliverableType: string
      projectId: string | null
      version: number
      effectiveDate: string
      changeReason: string
      isCurrent: boolean
      templateStatus: 'draft' | 'locked'
      approvedBy: string | null
      approvedAt: string | null
      createdBy: string
      createdAt: string
      instanceCount: number
      items: Array<{
        id: string
        text: string
        framework: string
        frameworkMandatory: boolean
        ownerRaci: 'R' | 'A' | 'C' | 'I'
        stage:
          | 'study_start_up'
          | 'during_study'
          | 'reporting'
          | 'cross_functional_review'
          | 'crm'
          | 'final_output'
        autoCompleteOn: 'submit_for_review' | 'crm_complete' | 'document_signed' | null
        sortOrder: number
      }>
    }>(`/checklist-templates/${templateId}`),
  approveChecklistTemplate: (templateId: string) =>
    api.post<unknown>(`/checklist-templates/${templateId}/approve`, {}),
  bumpChecklistTemplateDraft: (templateId: string) =>
    api.post<{ id: string; version: number; templateStatus: 'draft' }>(`/checklist-templates/${templateId}/bump-draft`, {}),
  cloneChecklistTemplateToProject: (templateId: string, projectId: string) =>
    api.post<{ id: string; projectId: string; version: number; templateStatus: 'draft' }>(
      `/checklist-templates/${templateId}/clone-to-project`,
      { projectId },
    ),
  addChecklistTemplateItem: (templateId: string, body: {
    text: string
    framework: string
    frameworkMandatory?: boolean
    ownerRaci: 'R' | 'A' | 'C' | 'I'
    stage: 'study_start_up' | 'during_study' | 'reporting' | 'cross_functional_review' | 'crm' | 'final_output'
    autoCompleteOn?: 'submit_for_review' | 'crm_complete' | 'document_signed' | null
  }) => api.post<{ id: string }>(`/checklist-templates/${templateId}/items`, body),
  patchChecklistTemplateItem: (itemId: string, body: {
    text?: string
    framework?: string
    frameworkMandatory?: boolean
    ownerRaci?: 'R' | 'A' | 'C' | 'I'
    stage?: 'study_start_up' | 'during_study' | 'reporting' | 'cross_functional_review' | 'crm' | 'final_output'
    autoCompleteOn?: 'submit_for_review' | 'crm_complete' | 'document_signed' | null
  }) => api.patch<{ id: string }>(`/checklist-templates/items/${itemId}`, body),
  deleteChecklistTemplateItem: (itemId: string) =>
    api.delete<void>(`/checklist-templates/items/${itemId}`),
  moveChecklistTemplateItem: (itemId: string, direction: 'up' | 'down') =>
    api.post<{ ok: true }>(`/checklist-templates/items/${itemId}/move`, { direction }),

  // Checklist
  getChecklist: (documentId: string) =>
    api.get<ChecklistItem[]>(`/documents/${documentId}/checklist`),
  // Compliance Summary appendix of the output document (FR-A-030 / AC-A-029).
  getComplianceSummary: (documentId: string) =>
    api.get<{
      documentId: string
      checklistTemplateVersion: number | null
      generatedAt: string
      frameworks: Array<{
        name: string
        version: string | null
        jurisdiction: string | null
        description: string | null
        sourceUrl: string | null
        inRegistry: boolean
        rules: Array<{ text: string; mandatory: boolean; status: string }>
      }>
      waivedMandatory: Array<{ text: string; framework: string; waivedBy: string | null; waivedAt: string | null; reason: string | null }>
    }>(`/documents/${documentId}/compliance-summary`),
  completeItem: (documentId: string, itemId: string, body: CompleteItemBody) =>
    api.patch<ChecklistItem>(`/documents/${documentId}/checklist/${itemId}/complete`, body),
  waiveItem: (documentId: string, itemId: string, body: WaiveItemBody) =>
    api.patch<ChecklistItem>(`/documents/${documentId}/checklist/${itemId}/waive`, body),
  addChecklistItem: (documentId: string, body: { text: string; framework: string }) =>
    api.post<ChecklistItem>(`/documents/${documentId}/checklist`, body),
  // Comments
  getComments: (documentId: string) =>
    api.get<Comment[]>(`/documents/${documentId}/comments`),
  // Every comment on the project's documents in one call (each row has its documentId).
  getProjectComments: (projectId: string) =>
    api.get<Comment[]>(`/projects/${projectId}/comments`),
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
  // `from` / `to` (ISO instants) narrow it to a date-time range; `sectionId` /
  // `sectionNumber` to one section's entries (total and paging count only those).
  getAuditTrail: (documentId: string, page?: { limit: number; offset: number; from?: string; to?: string; sectionId?: string; sectionNumber?: string }) => {
    const qs = page
      ? new URLSearchParams(Object.entries({ limit: page.limit, offset: page.offset, from: page.from, to: page.to, sectionId: page.sectionId, sectionNumber: page.sectionNumber })
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)])).toString()
      : ''
    return api.get<{ entries: AuditEntry[]; total: number; limit: number; offset: number }>(
      `/documents/${documentId}/audit${qs ? `?${qs}` : ''}`,
    )
  },
  // Voice notes
  getVoiceNotes: (documentId: string) =>
    api.get<VoiceNote[]>(`/documents/${documentId}/voice-notes`),
  // Multipart upload — audio bytes as the file field, sectionRef + duration
  // as query params (API contract §7). The server stores the audio in the
  // 'voice' blob bucket + enqueues a transcription job; the returned
  // VoiceNote has `transcript: ""` until the worker completes.
  uploadVoiceNote: (
    documentId: string,
    args: { audio: Blob; filename: string; sectionRef: string; durationSeconds?: number },
  ) => {
    const form = new FormData()
    form.append('audio', args.audio, args.filename)
    const qs = new URLSearchParams({ sectionRef: args.sectionRef })
    if (args.durationSeconds !== undefined) qs.set('durationSeconds', String(args.durationSeconds))
    return api.upload<VoiceNote>(`/documents/${documentId}/voice-notes?${qs}`, form)
  },
  getVoiceNoteAudioUrl: (documentId: string, noteId: string) =>
    api.get<{ url: string; expiresInSeconds: number }>(
      `/documents/${documentId}/voice-notes/${noteId}/audio`,
    ),
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
        /** Plain-text preview of pre-edit content for the Section History row (sPM-autosave). */
        beforeExcerpt?: string
        /** Plain-text preview of post-edit content for the Section History row (sPM-autosave). */
        afterExcerpt?:  string
        canRevert: boolean
      }>
      /** Rolled-up session view (sPM-autosave). Same shape as entries plus session fields. */
      sessions?: Array<{
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
        beforeExcerpt?: string
        afterExcerpt?:  string
        canRevert: boolean
        sessionEntryCount: number
        sessionStartedAt:  string
        sessionRawRowIds:  string[]
      }>
    }>(`/documents/${documentId}/sections/${sectionId}/history${suffix}`)
  },
  // NOTE: these three "top-level" endpoints (/section-edits/*,
  // /ai-chat-messages/*) are registered inside documentsRoutes, which the
  // server mounts under prefix='/documents'. So the real serving path is
  // /documents/section-edits/... — not /section-edits/.... Prefixing the
  // client call here matches reality until the server plugin split lands.
  revertSectionEdit: (editHistoryId: string) =>
    api.post<{ ok: true; documentId: string; sectionId: string; contentHtml: string; revertedAt: string }>(
      `/documents/section-edits/${editHistoryId}/revert`, {},
    ),
  // Full before/after HTML for one history row (sPM-autosave diff expand).
  // Called lazily when the user clicks "Show change" on a row — avoids
  // shipping multi-KB snapshots on every history list GET.
  getSectionEditDiff: (editHistoryId: string) =>
    api.get<{
      editHistoryId: string
      documentId:    string | null
      sectionId:     string | null
      origin:        string
      createdAt:     string
      beforeHtml:    string | null
      afterHtml:     string
    }>(`/documents/section-edits/${editHistoryId}/diff`),

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
  // Same /documents prefix caveat as revertSectionEdit above — the route is
  // registered inside documentsRoutes so the real path has the /documents
  // prefix even though the endpoint isn't scoped to any one document.
  acceptAiChatMessage: (messageId: string) =>
    api.post<{ id: string; appliedToSection: boolean; appliedAt: string | null; aiCallRecordId?: string | null }>(
      `/documents/ai-chat-messages/${messageId}/accept`, {},
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
    api.get<{
      package: { version: string; validatedBy: string; validatedDate: string }
      items: Array<{
        type: 'T' | 'L' | 'F'
        id: string                          // human-readable ref (e.g. "T-14.1.1")
        title: string
        linkedSections: string[]            // sectionRefs citing this item on THIS doc
        referenceCount: number
      }>
    }>(`/documents/${documentId}/tlf`),
  // The getICHE3 return shape is tightly coupled to ICHValidatorPanel —
  // if you change one, change the other in the same commit. A previous
  // piecemeal landing (see c5150ef) left the panel's as-cast reading
  // fields the wrapper didn't declare and tanked the demo deploy's
  // `tsc && vite build`. The panel consumes `code`, `sectionId`, `status`
  // and the optional `waiver` payload directly off this shape.
  getICHE3: (documentId: string) =>
    api.get<{
      completionPercent: number
      completeSections:  number
      totalSections:     number
      sections: Array<{
        code:      string
        title:     string
        sectionId: string
        status:    'complete' | 'in_progress' | 'not_started' | 'waived' | 'warning'
        waiver?: {
          waivedBy: string
          waivedAt: string
          reason:   string
          versionAtWaiver: string
        }
      }>
    }>(`/documents/${documentId}/ich-e3`),
  waiveICHE3Section: (documentId: string, sectionCode: string, reason: string) =>
    api.post<unknown>(`/documents/${documentId}/ich-e3/${encodeURIComponent(sectionCode)}/waive`, { reason }),
  unwaiveICHE3Section: (documentId: string, sectionCode: string) =>
    api.delete<void>(`/documents/${documentId}/ich-e3/${encodeURIComponent(sectionCode)}/waive`),
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

  // Document templates — section skeleton + source-category rules per
  // deliverable type. Powers the New Document wizard.
  listTemplates: () =>
    api.get<DocumentTemplate[]>('/document-templates'),
}

export interface DocumentTemplateSection {
  id:      string
  number:  string
  title:   string
  usOnly?: boolean
}

export interface DocumentTemplate {
  id:                       string
  type:                     string
  label:                    string
  description:              string
  framework:                string
  sections:                 DocumentTemplateSection[]
  requiredSourceCategories: string[]
  version:                  number
  updatedAt:                string
}
