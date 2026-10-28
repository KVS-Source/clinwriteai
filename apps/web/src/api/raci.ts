// API client for the unified RBAC / RACI endpoints shipped in Chunk 2.
// Each function is a thin wrapper around apps/api/src/modules/platform/*.
// Error handling + base-URL + credentials are inherited from client.ts.

import { api } from './client'

// --- Document RACI --------------------------------------------------------

export type RaciLetter = 'R' | 'A' | 'C' | 'I' | 'Q'

export interface DocumentRaciRow {
  id: string
  documentId: string
  userId: string
  letter: RaciLetter
  sectionId: string | null
  approvalOrder: number | null
  signatureRequired: boolean
  signatureMeaning: string | null
  submittedAt: string | null
  reviewedAt: string | null
  approvedAt: string | null
  signatureId: string | null
  rejectedAt: string | null
  rejectionNote: string | null
  assignedBy: string
  assignedAt: string
  removedAt: string | null
}

export interface RaciTransitionEvaluation {
  gatingLetter: RaciLetter | null
  nextStatus: string | null
  cohortDone: number
  cohortTotal: number
  cohortComplete: boolean
  rejectedRows: number
}

export const raciApi = {
  list: (documentId: string) =>
    api.get<DocumentRaciRow[]>(`/documents/${documentId}/raci`),

  assign: (documentId: string, body: {
    userId: string
    letter: RaciLetter
    sectionId?: string | null
    approvalOrder?: number | null
    signatureRequired?: boolean
    signatureMeaning?: string | null
    selfGrantReason?: string
  }) =>
    api.post<DocumentRaciRow>(`/documents/${documentId}/raci`, body),

  remove: (documentId: string, raciId: string) =>
    api.delete<void>(`/documents/${documentId}/raci/${raciId}`),

  complete: (documentId: string, raciId: string, body: { signatureId?: string | null } = {}) =>
    api.post<{
      row: DocumentRaciRow
      transition: RaciTransitionEvaluation
      transitioned: boolean
    }>(`/documents/${documentId}/raci/${raciId}/complete`, body),

  reject: (documentId: string, raciId: string, body: { note: string }) =>
    api.post<DocumentRaciRow>(`/documents/${documentId}/raci/${raciId}/reject`, body),
}

// --- Project members ------------------------------------------------------

export interface ProjectMember {
  id: string
  projectId: string
  userId: string
  projectRole: string | null
  addedBy: string
  addedAt: string
  removedAt: string | null
}

export const projectMembersApi = {
  list: (projectId: string) =>
    api.get<ProjectMember[]>(`/projects/${projectId}/members`),
  add: (projectId: string, body: { userId: string; projectRole?: string | null }) =>
    api.post<ProjectMember>(`/projects/${projectId}/members`, body),
  remove: (projectId: string, memberId: string) =>
    api.delete<void>(`/projects/${projectId}/members/${memberId}`),
}

// --- PM dashboard ---------------------------------------------------------

export interface PmDashboardDocument {
  id: string
  title: string
  type: string
  status: string
  assigneeId: string
  targetCompletionDate: string | null
  isOverdue: boolean
  raciProgress: RaciTransitionEvaluation
}

export interface PmDashboardBottleneck {
  userId: string
  pendingCount: number
}

export interface PmDashboardResponse {
  project: { id: string; name: string; status: string }
  members: Array<{ id: string; userId: string; projectRole: string | null; addedAt: string }>
  documents: PmDashboardDocument[]
  summary: {
    totalDocuments: number
    byStatus: Record<string, number>
    overdueCount: number
    activeMembers: number
  }
  bottlenecks: PmDashboardBottleneck[]
  generatedAt: string
}

export interface PortfolioDashboardProject {
  id: string
  name: string
  status: string
  memberCount: number
  documentCount: number
  overdueCount: number
  byStatus: Record<string, number>
}

export interface PortfolioDashboardResponse {
  projects: PortfolioDashboardProject[]
  totals: {
    projects: number
    documents: number
    overdueDocuments: number
    members: number
  }
  generatedAt: string
}

export const dashboardsApi = {
  pmProject: (projectId: string) =>
    api.get<PmDashboardResponse>(`/projects/${projectId}/pm-dashboard`),
  portfolio: () =>
    api.get<PortfolioDashboardResponse>(`/dashboards/portfolio`),
}

// --- Checklist (new endpoints only; existing complete/waive/add stay in checklist.ts) ---

export interface SubmitGateDecision {
  kind: 'clean' | 'warn' | 'block'
  pendingMandatory?: Array<{ id: string; text: string; framework: string }>
  pendingOptional?: Array<{ id: string; text: string; framework: string }>
}

export interface AutocheckItemResult {
  itemId: string
  tag: string
  kind: 'completed' | 'pending' | 'skipped'
  reason: string
}

export interface AiPassGatewayInfo {
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  limitDecision: 'allowed' | 'allowed_approaching_cap' | 'rejected_cap'
}

export const checklistRApi = {
  reorder: (documentId: string, items: Array<{ itemId: string; sortOrder: number }>) =>
    api.patch<{ updated: number; items: Array<{ id: string; sortOrder: number }> }>(
      `/documents/${documentId}/checklist/reorder`,
      { items },
    ),

  submitCheck: (documentId: string) =>
    api.get<{ decision: SubmitGateDecision; totalItems: number }>(
      `/documents/${documentId}/checklist/submit-check`,
    ),

  submitWithReason: (documentId: string, reason: string) =>
    api.post<{ decision: SubmitGateDecision; acknowledged: boolean }>(
      `/documents/${documentId}/checklist/submit-with-reason`,
      { reason },
    ),

  autocheckRun: (documentId: string) =>
    api.post<{
      evaluated: number
      flipped: number
      items: AutocheckItemResult[]
    }>(`/documents/${documentId}/checklist/autocheck/run`, {}),

  aiPass: (documentId: string, profile: 'consistency' | 'terminology' | 'tone') =>
    api.post<{
      profile: string
      result: { criticalIssues: number; summary: string }
      cached: boolean
      versionId: string | null
      gateway: AiPassGatewayInfo
    }>(`/documents/${documentId}/checklist/autocheck/ai-pass/${profile}`, {}),
}

// --- Guest invitations ----------------------------------------------------

export type GuestScope = 'document' | 'project'
export type GuestPurpose =
  | 'kol-review'
  | 'sponsor-review'
  | 'external-stat'
  | 'external-audit'
  | 'other'

export interface GuestInvitation {
  id: string
  scope: GuestScope
  documentId: string | null
  projectId: string | null
  email: string
  purpose: GuestPurpose
  invitedBy: string
  invitedAt: string
  expiresAt: string
  revokedAt: string | null
  tokenPreview: string | null
}

export interface GuestInvitationWithToken extends GuestInvitation {
  /** Full magic-link JWT. Returned only on POST, never on GET/DELETE. */
  token: string
}

export const guestInvitationsApi = {
  listForDocument: (documentId: string) =>
    api.get<GuestInvitation[]>(`/documents/${documentId}/guest-invitations`),

  listForProject: (projectId: string) =>
    api.get<GuestInvitation[]>(`/projects/${projectId}/guest-invitations`),

  inviteToDocument: (documentId: string, body: {
    email: string
    purpose?: Exclude<GuestPurpose, 'external-audit'>
    expiresInDays?: number
  }) =>
    api.post<GuestInvitationWithToken>(`/documents/${documentId}/guest-invitations`, body),

  inviteToProject: (projectId: string, body: {
    email: string
    purpose?: 'external-audit' | 'other'
    expiresInDays?: number
  }) =>
    api.post<GuestInvitationWithToken>(`/projects/${projectId}/guest-invitations`, body),

  revoke: (id: string) =>
    api.delete<GuestInvitation>(`/guest-invitations/${id}`),
}
