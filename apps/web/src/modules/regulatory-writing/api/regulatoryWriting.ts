// Regulatory Writing (Module D) API client — 32 endpoints per API Contracts v4.0 §44–§55.
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
}
