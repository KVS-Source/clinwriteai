import { api } from './client'
import type {
  Document, ChecklistItem, AuditEntry, Comment,
  AISuggestion, SignatureRecord, DocumentVersion, VoiceNote,
  CreateDocumentBody, UpdateSectionBody, CompleteItemBody, WaiveItemBody,
  RestoreSectionsBody, SubmitForReviewBody, AddCommentBody,
  ResolveCommentBody, SignDocumentBody, AISuggestBody, AcceptSuggestionBody,
} from '@platform/types'

export const documentsApi = {
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
  resolveComment: (documentId: string, commentId: string, body: ResolveCommentBody) =>
    api.patch<Comment>(`/documents/${documentId}/comments/${commentId}/resolve`, body),
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
  getSignatureChain: (documentId: string) =>
    api.get<SignatureRecord[]>(`/documents/${documentId}/signature-chain`),
  sign: (documentId: string, body: SignDocumentBody) =>
    api.post<SignatureRecord>(`/documents/${documentId}/sign`, body),
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
