import { api } from '../../../api/client'
import type {
  MedContentItem, MedClaim, PreMLRResult, AgenticReport,
  MLRReviewer, MLRComment, MLRDecision, KOLSession, MedLibraryCard,
  ContentExpiryRecord, MedContentType, ComplianceTrack, ReviewTier, ClaimStatus,
} from '@platform/types'

// --- Request body types (local to Module C) ---

export interface CreateMedContentBody {
  type:                  MedContentType
  title:                 string
  complianceTrack:       ComplianceTrack
  taTag:                 string
  channels:              string[]
  targetAudience:        string[]
  projectId?:            string
  reviewTier?:           ReviewTier | null
  medicalAffairsPlanId?: string | null
  publicationPlanId?:    string | null
  ownerId?:              string
}

export interface AISuggestBody { sectionId: string; prompt?: string }

export interface FKScoreResponse { score: number; passed: boolean; runAt: string }

export interface PreMLRRunResponse { runAt: string; result: PreMLRResult }

export interface MLRDecisionBody {
  decision:          MLRDecision
  decisionNote:      string
  signatureConfirmed: boolean
  signaturePassword: string
  decidedBy:         string
}

export interface HarvestClaimResponse { candidates: MedClaim[] }

export interface AdoptClaimBody {
  claimId: string
  approvedLibraryText: string
  adoptedBy: string
}

export interface WCAGFailureFixBody { fixedBy: string; note?: string }

export interface LibraryPushBody {
  cardIds: string[]
  pushedBy: string
}

// --- Client ---

export const medContentApi = {
  // Content list + CRUD
  list:   (projectId: string) =>
    api.get<MedContentItem[]>(`/projects/${projectId}/med-content`),
  get:    (contentId: string) =>
    api.get<MedContentItem>(`/med-content/${contentId}`),
  create: (projectId: string, body: CreateMedContentBody) =>
    api.post<MedContentItem>(`/projects/${projectId}/med-content`, body),
  update: (contentId: string, body: Partial<MedContentItem>) =>
    api.patch<MedContentItem>(`/med-content/${contentId}`, body),

  // Tier override
  overrideTier: (contentId: string, body: { newTier: ReviewTier; reason: string; overriddenBy: string }) =>
    api.patch<MedContentItem>(`/med-content/${contentId}/tier`, body),

  // FK score
  getFKScore: (contentId: string) =>
    api.get<FKScoreResponse>(`/med-content/${contentId}/fk-score`),

  // AI suggest (shared with Modules A + B)
  aiSuggest: (contentId: string, body: AISuggestBody) =>
    api.post<{ responseText: string; aiModel: string; generatedAt: string }>(
      `/med-content/${contentId}/ai-suggest`, body,
    ),

  // Pre-MLR
  runPreMLR: (contentId: string) =>
    api.post<PreMLRRunResponse>(`/med-content/${contentId}/pre-mlr/run`, {}),
  getPreMLR: (contentId: string) =>
    api.get<PreMLRResult>(`/med-content/${contentId}/pre-mlr`),
  acknowledgeIssue: (contentId: string, issueId: string, body: { acknowledgedBy: string }) =>
    api.patch<{ acknowledgedAt: string }>(`/med-content/${contentId}/pre-mlr/issues/${issueId}/acknowledge`, body),

  // Agentic report
  getAgenticReport: (contentId: string) =>
    api.get<AgenticReport>(`/med-content/${contentId}/agentic-report`),
  escalateFinding: (contentId: string, findingN: number, body: { escalatedBy: string }) =>
    api.post<{ escalationAuditId: string; escalatedAt: string }>(
      `/med-content/${contentId}/agentic-report/findings/${findingN}/escalate`, body,
    ),

  // Submit to MLR
  submitToMLR: (contentId: string, body: { submittedBy: string }) =>
    api.post<{ submittedAt: string; auditEntryId: string }>(
      `/med-content/${contentId}/submit-to-mlr`, body,
    ),

  // MLR review
  getMLRReviewers: (contentId: string) =>
    api.get<MLRReviewer[]>(`/med-content/${contentId}/mlr-reviewers`),
  getMLRComments: (contentId: string) =>
    api.get<MLRComment[]>(`/med-content/${contentId}/mlr-comments`),
  addMLRComment: (contentId: string, body: { text: string; tag: MLRComment['tag']; reviewerId: string }) =>
    api.post<MLRComment>(`/med-content/${contentId}/mlr-comments`, body),
  resolveMLRComment: (contentId: string, commentId: string, body: { resolvedBy: string }) =>
    api.patch<MLRComment>(`/med-content/${contentId}/mlr-comments/${commentId}/resolve`, body),
  submitMLRDecision: (contentId: string, body: MLRDecisionBody) =>
    api.post<{ decisionAt: string; auditEntryId: string; nextStatus: string }>(
      `/med-content/${contentId}/mlr-decision`, body,
    ),

  // Claims
  getClaims: (contentId: string) =>
    api.get<MedClaim[]>(`/med-content/${contentId}/claims`),
  harvestClaims: (contentId: string) =>
    api.post<HarvestClaimResponse>(`/med-content/${contentId}/claims/harvest`, {}),
  adoptClaim: (contentId: string, body: AdoptClaimBody) =>
    api.post<MedClaim>(`/med-content/${contentId}/claims/adopt`, body),
  updateClaimStatus: (contentId: string, claimId: string, body: { approvalStatus: ClaimStatus; reviewerId: string }) =>
    api.patch<MedClaim>(`/med-content/${contentId}/claims/${claimId}`, body),

  // KOL session
  getKOLSession: (contentId: string) =>
    api.get<KOLSession>(`/med-content/${contentId}/kol-session`),
  uploadTranscript: (sessionId: string, body: { transcriptText: string; uploadedBy: string }) =>
    api.post<{ uploadedAt: string }>(`/kol-sessions/${sessionId}/transcript`, body),
  generateInsights: (sessionId: string) =>
    api.post<{ insightsReportText: string; generatedAt: string }>(
      `/kol-sessions/${sessionId}/insights/generate`, {},
    ),

  // Formatting / WCAG / Locales
  runWCAG: (contentId: string) =>
    api.post<{ runAt: string; passed: boolean; score: number }>(`/med-content/${contentId}/wcag/run`, {}),
  fixWCAGFailure: (contentId: string, failureId: string, body: WCAGFailureFixBody) =>
    api.patch<{ fixedAt: string }>(`/med-content/${contentId}/wcag/failures/${failureId}/fix`, body),
  getLocales: (contentId: string) =>
    api.get<{ code: string; label: string; enabled: boolean; status: string }[]>(
      `/med-content/${contentId}/locales`,
    ),

  // Final output + library push
  getFinal: (contentId: string) =>
    api.get<{
      contentItem:      MedContentItem
      libraryCards:     MedLibraryCard[]
      expiryRecord:     ContentExpiryRecord
      approvals:        { name: string; role: string; decidedAt: string }[]
    }>(`/med-content/${contentId}/final`),
  pushToLibrary: (contentId: string, body: LibraryPushBody) =>
    api.post<{ pushedAt: string; cardCount: number }>(
      `/med-content/${contentId}/library/push`, body,
    ),

  // Portfolio
  getPortfolio: (projectId: string, scope?: string) =>
    api.get<MedContentItem[]>(`/projects/${projectId}/med-content/portfolio${scope ? `?scope=${encodeURIComponent(scope)}` : ''}`),
}
