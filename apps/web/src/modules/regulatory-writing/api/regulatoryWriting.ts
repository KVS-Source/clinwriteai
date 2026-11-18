// Regulatory Writing (Regulatory Writing) API client — 32 endpoints per API Contracts v4.0 §44–§55.
import { api } from '../../../api/client'
import type {
  RegulatorySubmission,
  ECTDNode,
  CMCReadinessReport,
  ConsistencyCheckResult,
  ECTDValidationResult,
  RedactionRecord,
  SuperReviewer,
  GatewaySubmissionRecord,
  HACorrespondence,
  RegulatoryAlert,
  RegulatoryLibraryCard,
  ODDAssessment,
  GatewayTarget,
  PartElevenSignature,
  RegSubmissionType,
} from '@platform/types'

// --- Request/response bodies ---

export interface CreateSubmissionBody {
  projectId:              string
  sourceModuleAProjectId: string | null
  submissionType:         RegSubmissionType
  targetHAs:              GatewayTarget[]
  ectdVersion:            '3.2.2' | '4.0'
  taTag:                  string
  title:                  string
  compound:               string
  indication:             string
  ownerId:                string
}

export interface CanonicalJsonIndexResponse {
  submissionId:  string
  indexedAt:     string
  dataPoints:    number
  sources:       { docId: string; docType: string; extractedPoints: number }[]
}

export interface ConsistencyCheckRunResponse {
  runAt:  string
  result: ConsistencyCheckResult
}

export interface ECTDValidationRunResponse {
  runAt:  string
  result: ECTDValidationResult
}

export interface GatewayTransmitBody {
  gateway:    GatewayTarget
  partEleven: PartElevenSignature
}

export interface HAResponseGenerateBody {
  questionId: string
  by:         string
}

export interface HAResponseGenerateResponse {
  questionId:       string
  responseDraft:    string
  aiModel:          string
  aiFootprintPct:   number
  generatedAt:      string
}

export interface LibraryPushRegBody {
  cardIds:  string[]
  pushedBy: string
}

export interface FinalRecordResponse {
  submission:     RegulatorySubmission
  gatewayRecord:  GatewaySubmissionRecord
  libraryCards:   RegulatoryLibraryCard[]
  ectdNodes:      ECTDNode[]
}

// --- API surface (32 endpoints) ---

export const regulatoryWritingApi = {
  // Submissions
  listSubmissions: (projectId: string) =>
    api.get<RegulatorySubmission[]>(`/projects/${projectId}/reg-submissions`),
  getSubmission: (submissionId: string) =>
    api.get<RegulatorySubmission>(`/reg-submissions/${submissionId}`),
  createSubmission: (projectId: string, body: CreateSubmissionBody) =>
    api.post<RegulatorySubmission>(`/projects/${projectId}/reg-submissions`, body),
  updateSubmission: (submissionId: string, body: Partial<RegulatorySubmission>) =>
    api.patch<RegulatorySubmission>(`/reg-submissions/${submissionId}`, body),

  // Canonical JSON layer + CMC readiness (Stage 1)
  indexCanonicalJson: (submissionId: string) =>
    api.post<CanonicalJsonIndexResponse>(`/reg-submissions/${submissionId}/canonical-json/index`, {}),
  getCMCReadiness: (submissionId: string) =>
    api.get<CMCReadinessReport>(`/reg-submissions/${submissionId}/cmc-readiness`),
  acknowledgeCMCReadiness: (submissionId: string, body: { acknowledgedBy: string; riskNote?: string }) =>
    api.post<CMCReadinessReport>(`/reg-submissions/${submissionId}/cmc-readiness/acknowledge`, body),

  // eCTD granularity map (Stage 1/2/3)
  getECTDMap: (submissionId: string) =>
    api.get<ECTDNode[]>(`/reg-submissions/${submissionId}/ectd-map`),
  updateECTDNode: (submissionId: string, nodeId: string, body: Partial<ECTDNode>) =>
    api.patch<ECTDNode>(`/reg-submissions/${submissionId}/ectd-map/${nodeId}`, body),

  // Consistency check (Stage 4 gate)
  getConsistencyCheck: (submissionId: string) =>
    api.get<ConsistencyCheckResult>(`/reg-submissions/${submissionId}/consistency-check`),
  runConsistencyCheck: (submissionId: string) =>
    api.post<ConsistencyCheckRunResponse>(`/reg-submissions/${submissionId}/consistency-check/run`, {}),
  resolveContradiction: (submissionId: string, contradictionId: string, body: { resolvedBy: string; note: string }) =>
    api.patch<ConsistencyCheckResult>(`/reg-submissions/${submissionId}/contradictions/${contradictionId}/resolve`, body),

  // Super Review (Stage 4)
  getSuperReviewers: (submissionId: string) =>
    api.get<SuperReviewer[]>(`/reg-submissions/${submissionId}/super-reviewers`),
  signSuperReview: (submissionId: string, reviewerId: string, body: { signedBy: string }) =>
    api.post<SuperReviewer>(`/reg-submissions/${submissionId}/super-reviewers/${reviewerId}/sign`, body),

  // eCTD validation + publishing (Stage 5)
  getECTDValidation: (submissionId: string) =>
    api.get<ECTDValidationResult>(`/reg-submissions/${submissionId}/ectd-validation`),
  runECTDValidation: (submissionId: string) =>
    api.post<ECTDValidationRunResponse>(`/reg-submissions/${submissionId}/ectd-validation/run`, {}),
  autoFixValidationError: (submissionId: string, errorId: string, body: { fixedBy: string }) =>
    api.patch<{ fixedAt: string }>(`/reg-submissions/${submissionId}/ectd-validation/errors/${errorId}/auto-fix`, body),

  // Redaction (Stage 5)
  getRedactionRecord: (submissionId: string) =>
    api.get<RedactionRecord>(`/reg-submissions/${submissionId}/redaction`),
  confirmRedactionItem: (submissionId: string, itemId: string, body: { confirmedBy: string }) =>
    api.patch<{ confirmedAt: string }>(`/reg-submissions/${submissionId}/redaction/items/${itemId}/confirm`, body),

  // Gateway (Stage 6)
  getGatewaySubmissions: (submissionId: string) =>
    api.get<GatewaySubmissionRecord[]>(`/reg-submissions/${submissionId}/gateway`),
  transmitToGateway: (submissionId: string, body: GatewayTransmitBody) =>
    api.post<GatewaySubmissionRecord>(`/reg-submissions/${submissionId}/gateway/transmit`, body),
  simulateACK: (submissionId: string, recordId: string, body: { ack: 'ack1' | 'ack2' | 'ack3' }) =>
    api.post<GatewaySubmissionRecord>(`/reg-submissions/${submissionId}/gateway/${recordId}/simulate-ack`, body),

  // HA correspondence + response drafting (Stage 6)
  getHACorrespondence: (submissionId: string) =>
    api.get<HACorrespondence[]>(`/reg-submissions/${submissionId}/ha-correspondence`),
  uploadLoQ: (submissionId: string, body: { title: string; questionsCount: number }) =>
    api.post<HACorrespondence>(`/reg-submissions/${submissionId}/ha-correspondence/upload-loq`, body),
  generateHAResponse: (submissionId: string, correspondenceId: string, body: HAResponseGenerateBody) =>
    api.post<HAResponseGenerateResponse>(
      `/reg-submissions/${submissionId}/ha-correspondence/${correspondenceId}/questions/${body.questionId}/generate`,
      body,
    ),
  submitHAResponse: (submissionId: string, correspondenceId: string, body: { by: string }) =>
    api.post<HACorrespondence>(
      `/reg-submissions/${submissionId}/ha-correspondence/${correspondenceId}/submit-response`, body,
    ),

  // Polymorphic edit history for HA response drafts (sPM-edit-history-polymorphic).
  // Append model — each entry corresponds to a HaResponseDraft version. Revert
  // creates a NEW draft version with the restored text, preserving the chain.
  getHAResponseHistory: (questionId: string, filters: { mine?: boolean; origin?: 'manual' | 'ai' | 'undo' | 'restore' } = {}) => {
    const qs = new URLSearchParams()
    if (filters.mine)   qs.set('mine', 'true')
    if (filters.origin) qs.set('origin', filters.origin)
    const suffix = qs.toString() ? `?${qs}` : ''
    return api.get<{
      entityType: 'ha_response_draft'
      entityId: string
      entries: Array<{
        id: string
        actorId: string
        actorName: string
        origin: 'manual' | 'ai' | 'undo' | 'restore'
        createdAt: string
        beforeHtml: string | null
        afterHtml: string
        aiCallRecordId: string | null
        revertedFromId: string | null
        promptText: string | null
        aiModel: string | null
        interveningCount: number
        interveningByActor: Array<{ actorId: string; actorName: string; count: number }>
        canRevert: boolean
      }>
    }>(`/ha-questions/${questionId}/history${suffix}`)
  },
  revertHAResponseEdit: (editHistoryId: string) =>
    api.post<{ ok: true; draftText: string; revertedAt: string }>(
      `/ha-draft-edits/${editHistoryId}/revert`, {},
    ),

  // Regulatory intelligence
  listRegulatoryAlerts: () =>
    api.get<RegulatoryAlert[]>(`/regulatory-alerts`),
  acknowledgeRegulatoryAlert: (alertId: string, body: { userId: string }) =>
    api.post<RegulatoryAlert>(`/regulatory-alerts/${alertId}/acknowledge`, body),

  // Master Library + final output
  getLibraryCards: (submissionId: string) =>
    api.get<RegulatoryLibraryCard[]>(`/reg-submissions/${submissionId}/library-cards`),
  pushToLibrary: (submissionId: string, body: LibraryPushRegBody) =>
    api.post<{ pushedAt: string; cardCount: number }>(`/reg-submissions/${submissionId}/library-cards/push`, body),
  getFinalRecord: (submissionId: string) =>
    api.get<FinalRecordResponse>(`/reg-submissions/${submissionId}/final`),

  // Orphan Drug Designation
  getODDAssessment: (submissionId: string) =>
    api.get<ODDAssessment>(`/reg-submissions/${submissionId}/odd`),
  signODDAssessment: (submissionId: string, body: { signedBy: string }) =>
    api.post<ODDAssessment>(`/reg-submissions/${submissionId}/odd/sign`, body),

  // Portfolio
  getPortfolio: (projectId: string, scope?: string) =>
    api.get<RegulatorySubmission[]>(
      `/projects/${projectId}/reg-submissions/portfolio${scope ? `?scope=${encodeURIComponent(scope)}` : ''}`,
    ),

  // --- Regulatory documents (Phase M-D.2+) --------------------------------
  listDocuments: (submissionId: string) =>
    api.get<RegulatoryDocumentRow[]>(`/reg-submissions/${submissionId}/documents`),
  createDocument: (submissionId: string, body: CreateRegulatoryDocumentBody) =>
    api.post<RegulatoryDocumentRow>(`/reg-submissions/${submissionId}/documents`, body),
  getDocument: (id: string) =>
    api.get<RegulatoryDocumentRow>(`/regulatory-documents/${id}`),

  getDocumentSections: (id: string) =>
    api.get<{ regulatoryDocumentId: string; sections: RegulatoryDocumentSectionRow[] }>(
      `/regulatory-documents/${id}/sections`,
    ),
  saveDocumentSection: (id: string, sectionId: string, contentHtml: string) =>
    api.patch<{ id: string; sectionId: string; contentHtml: string; wordCount: number; lastEditedAt: string | null }>(
      `/regulatory-documents/${id}/sections/${encodeURIComponent(sectionId)}`,
      { contentHtml },
    ),
  acquireDocumentSectionLock: (id: string, sectionId: string) =>
    api.post<RegDocSectionLockResult>(
      `/regulatory-documents/${id}/sections/${encodeURIComponent(sectionId)}/lock`, {},
    ),
  releaseDocumentSectionLock: (id: string, sectionId: string) =>
    api.delete<{ released: boolean }>(
      `/regulatory-documents/${id}/sections/${encodeURIComponent(sectionId)}/lock`,
    ),
  listDocumentSectionLocks: (id: string) =>
    api.get<{ regulatoryDocumentId: string; staleSeconds: number; locks: Array<{ sectionId: string; holder: RegDocSectionLockHolder }> }>(
      `/regulatory-documents/${id}/locks`,
    ),
  listDocumentVersions: (id: string) =>
    api.get<{
      regulatoryDocumentId: string
      currentVersionId:     string | null
      versions:             Array<{ id: string; versionNumber: string; label: string; isCurrent: boolean; createdBy: string; createdAt: string }>
    }>(`/regulatory-documents/${id}/versions`),
  bumpDocumentVersion: (id: string, body: { label: string; newVersionNumber: string; note?: string }) =>
    api.post<{ id: string; versionNumber: string; label: string; createdAt: string }>(
      `/regulatory-documents/${id}/versions/bump`, body,
    ),

  startDocumentAiInitialDraft: (id: string, body: { aiInstructions?: string } = {}) =>
    api.post<{ jobId: string; regulatoryDocumentId: string; state: 'enqueued' }>(
      `/regulatory-documents/${id}/ai-initial-draft`, body,
    ),

  aiSuggestDocumentSection: (
    id: string,
    sectionId: string,
    body: {
      intent:        'draft_from_source' | 'tighten' | 'explain' | 'custom' | 'edit'
      customPrompt?: string
      currentContent?: string
      selectionText?: string
      scope?:        'section' | 'document' | 'source'
      attachedSourceIds?: string[]
      model?:        string
    },
  ) =>
    api.post<{ responseText: string; model: string; recordId?: string; scope?: string }>(
      `/regulatory-documents/${id}/sections/${encodeURIComponent(sectionId)}/ai-suggest`,
      body,
    ),
}

// --- Regulatory document shapes (Phase M-D.2/3/4) -----------------------

export interface CreateRegulatoryDocumentBody {
  docType:         'ctd_m2_3_qos' | 'ctd_m2_4_nonclin_overview' | 'ctd_m2_5_clinical_overview'
                 | 'ctd_m2_6_nonclin_summary' | 'ctd_m2_7_clinical_summary'
                 | 'cover_letter' | 'ha_response_narrative' | 'risk_benefit_statement'
  title:           string
  regulatoryTrack?: 'ind' | 'nda' | 'maa' | 'bla' | 'variation' | 'other'
  ownerId?:        string
  aiInstructions?: string
}

export interface RegulatoryDocumentRow {
  id:                              string
  submissionId:                    string
  projectId:                       string
  docType:                         string
  title:                           string
  status:                          string
  stage:                           number
  regulatoryTrack:                 string | null
  version:                         string
  regTypePolicyVersionAtCreate:    number | null
  regAiPromptRecordId:             string | null
  regAiPromptVersionAtCreate:      number | null
  regBestPracticeRecordId:         string | null
  regBestPracticeVersionAtCreate:  number | null
  aiDraftState:                    'idle' | 'drafting' | 'validating' | 'complete' | 'failed'
  aiInstructions:                  string | null
  ownerId:                         string
  createdBy:                       string
  createdAt:                       string
  updatedAt:                       string
  archivedAt:                      string | null
  archiveReason:                   string | null
  currentVersionId:                string | null
}

export interface RegulatoryDocumentSectionRow {
  id:            string
  sectionId:     string
  sectionNumber: string
  sectionTitle:  string
  contentHtml:   string
  wordCount:     number
  aiConfidence:  number | null
  aiFlags:       string[]
  lastEditedBy:  string | null
  lastEditedAt:  string | null
}

export interface RegDocSectionLockHolder {
  userId:           string
  acquiredAt:       string
  lastHeartbeatAt:  string
  expiresInSeconds: number
}

export interface RegDocSectionLockResult {
  outcome:      'acquired' | 'extended' | 'stolen' | 'conflict'
  holder:       RegDocSectionLockHolder
  staleSeconds: number
}
