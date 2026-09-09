import { api } from './client'
import type {
  Publication, PublicationAuthor, Citation, SubmissionCheck, SubmissionCheckSummary,
  ReviewRound, ReviewComment,
  CreatePublicationBody, UpdatePublicationBody, AddAuthorBody,
  InsertCitationBody, SubmitReviewResponseBody, CongressExportBody,
} from '@platform/types'

export interface PubMedRecord {
  id:           string
  pmid:         string
  title:        string
  source:       string
  shortRef:     string
  fullRef:      string
  abstractText: string
  keys:         string
}

export const publicationsApi = {
  // Publications
  list:   (projectId: string) =>
    api.get<Publication[]>(`/projects/${projectId}/publications`),
  get:    (publicationId: string) =>
    api.get<Publication>(`/publications/${publicationId}`),
  create: (body: CreatePublicationBody) =>
    api.post<Publication>(`/publications`, body),
  update: (publicationId: string, body: UpdatePublicationBody) =>
    api.patch<Publication>(`/publications/${publicationId}`, body),

  // AI footprint
  getFootprint: (publicationId: string) =>
    api.get<{ totalAiPercent: number; totalHumanPercent: number; breakdown: { label: string; aiPercent: number }[] }>(
      `/publications/${publicationId}/footprint`,
    ),

  // Authors
  getAuthors: (publicationId: string) =>
    api.get<PublicationAuthor[]>(`/publications/${publicationId}/authors`),
  addAuthor:  (publicationId: string, body: AddAuthorBody) =>
    api.post<PublicationAuthor>(`/publications/${publicationId}/authors`, body),
  updateAuthor: (publicationId: string, authorId: string, body: Partial<PublicationAuthor>) =>
    api.patch<PublicationAuthor>(`/publications/${publicationId}/authors/${authorId}`, body),
  runDebarmentCheck: (publicationId: string, authorId: string) =>
    api.post<{ debarmentStatus: string; debarmentCheckedAt: string }>(
      `/publications/${publicationId}/authors/${authorId}/debarment-check`,
      {},
    ),
  runPublicationDebarmentCheck: (publicationId: string) =>
    api.post<{ checkedAt: string; authorsChecked: number; matches: number; sources: string[] }>(
      `/publications/${publicationId}/debarment-check`,
      {},
    ),
  toggleICMJE: (publicationId: string, authorId: string, body: { criterionIndex: number; met: boolean; confirmedBy?: string }) =>
    api.patch<{ criterionIndex: number; met: boolean; confirmedBy: string; confirmedAt: string }>(
      `/publications/${publicationId}/authors/${authorId}/icmje`, body,
    ),
  acknowledgeICMJE: (publicationId: string, authorId: string, body: { acknowledgedBy?: string }) =>
    api.post<{ icmjeAcknowledged: boolean; icmjeAcknowledgedBy: string; icmjeAcknowledgedAt: string }>(
      `/publications/${publicationId}/authors/${authorId}/icmje/acknowledge`, body,
    ),
  remindAuthor: (publicationId: string, authorId: string) =>
    api.post<{ remindedAt: string }>(
      `/publications/${publicationId}/authors/${authorId}/remind`, {},
    ),

  // Citations
  getCitations:   (publicationId: string) =>
    api.get<Citation[]>(`/publications/${publicationId}/citations`),
  insertCitation: (publicationId: string, body: InsertCitationBody) =>
    api.post<Citation>(`/publications/${publicationId}/citations`, body),
  removeCitation: (publicationId: string, citationId: string) =>
    api.delete<{ removedAt: string }>(`/publications/${publicationId}/citations/${citationId}`),
  pubmedSearch:   (q: string) =>
    api.get<{ results: PubMedRecord[]; fetchedAt?: string }>(`/pubmed/search?q=${encodeURIComponent(q)}`),

  // Submission checks
  getSubmissionChecks: (publicationId: string) =>
    api.get<{ summary: SubmissionCheckSummary; checks: SubmissionCheck[] }>(
      `/publications/${publicationId}/submission-checks`,
    ),
  runSubmissionChecks: (publicationId: string) =>
    api.post<{ startedAt: string; checks: SubmissionCheck[] }>(
      `/publications/${publicationId}/submission-checks/run`, {},
    ),
  resolveSubmissionCheck: (publicationId: string, checkId: string, body: Partial<SubmissionCheck>) =>
    api.patch<SubmissionCheck>(`/publications/${publicationId}/submission-checks/${checkId}`, body),

  // Peer review
  getReviewRounds: (publicationId: string) =>
    api.get<ReviewRound[]>(`/publications/${publicationId}/review-rounds`),
  getReviewComments: (roundId: string) =>
    api.get<ReviewComment[]>(`/review-rounds/${roundId}/comments`),
  submitReviewResponse: (roundId: string, commentId: string, body: SubmitReviewResponseBody) =>
    api.patch<ReviewComment>(`/review-rounds/${roundId}/comments/${commentId}`, body),
  aiDraftResponse: (roundId: string, commentId: string) =>
    api.post<{ responseText: string; aiDrafted: boolean; aiModel: string; aiGeneratedAt: string }>(
      `/review-rounds/${roundId}/comments/${commentId}/ai-draft`, {},
    ),

  // Congress export
  congressExport: (publicationId: string, body: CongressExportBody) =>
    api.post<{ exportId: string; format: string; congress: string; createdAt: string }>(
      `/publications/${publicationId}/congress-export`, body,
    ),

  // Final output (B09)
  getFinal: (publicationId: string) =>
    api.get<FinalRecord>(`/publications/${publicationId}/final`),
  downloadFinal: (publicationId: string) =>
    api.post<{ downloadId: string; fileCount: number; createdAt: string }>(
      `/publications/${publicationId}/final/download`, {},
    ),
}

// --- Final output types ---

export interface OrcidEntry {
  name: string; initials: string; orcid: string; avatarBg: string; avatarFg: string
}
export interface PackageFile {
  name: string; note: string; crossModule?: boolean
}
export interface ProvenanceRow {
  label: string; meta: string; current?: boolean
}
export interface LibraryCard {
  name: string; note: string
}
export interface StatusRow {
  label: string; value: string; fg: string
}
export interface FinalRecord {
  publicationId:   string
  journal:         string
  publishedDate:   string
  articleUrl:      string
  citation:        string
  doi:             string
  doiRegisteredAt: string
  orcids:          OrcidEntry[]
  packageFiles:    PackageFile[]
  provenanceChain: {
    sourceRecord:      ProvenanceRow[]
    publicationRecord: ProvenanceRow[]
  }
  libraryCards: LibraryCard[]
  statusRows:   StatusRow[]
}
