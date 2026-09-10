// Module E — Ideation & Publishing API client (21 endpoints).
// KOL review submission uses raw fetch (no auth header) per DD-E rule 5.
import { api } from '../../../api/client'
import type {
  IdeationProject, IdeationArtefact, IdeationContentCard,
  AtomisedContent, ClaimCurrencyCheck, CalendarEntry, SocialListeningAlert,
  KOLContact, KOLReviewDecision, ChannelFormat, IdeationStage,
} from '@platform/types'

const RAW_API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api'

// --- Request/response bodies ---

export interface CreateIdeationProjectBody {
  projectId:  string
  sourceType: 'master-library' | 'upload'
  taTag:      string
  title:      string
  compound:   string
  indication: string
}

export interface UploadArtefactBody {
  ideationProjectId: string
  sourceModule:      'A' | 'B' | 'C' | 'D' | 'external'
  sourceDocId?:      string
  title:             string
  version:           string
  externalConfirmed?: boolean
}

export interface SourceGateResponse {
  ideationArtefactId: string
  approvalStatusCheck: 'passed' | 'blocked' | 'confirmed-external'
  approvalStatusNote:  string
  sourceCurrencyStatus: 'current' | 'superseded' | 'warned' | 'external-confirmed'
}

export interface AtomiseChannelBody {
  channel:      ChannelFormat
  sourcePassage: string
  by:           string
}

export interface ComplianceScreenResponse {
  brandScreenPassed:      boolean
  complianceScreenPassed: boolean
  fixes:                  { issue: string; fixApplied: boolean }[]
}

export interface KOLSubmitBody {
  decisions: KOLReviewDecision[]
  signedOffBy: string
}

export interface DOIRegistrationResponse {
  doi:          string
  registeredAt: string
}

// --- Client ---

export const ideationPublishingApi = {
  // Projects
  listProjects: (projectId: string) =>
    api.get<IdeationProject[]>(`/projects/${projectId}/ideation-projects`),
  getProject: (ideationProjectId: string) =>
    api.get<IdeationProject>(`/ideation-projects/${ideationProjectId}`),
  createProject: (projectId: string, body: CreateIdeationProjectBody) =>
    api.post<IdeationProject>(`/projects/${projectId}/ideation-projects`, body),

  // Artefacts + source gate + claim currency (Stage 1)
  getArtefact: (ideationArtefactId: string) =>
    api.get<IdeationArtefact>(`/ideation-artefacts/${ideationArtefactId}`),
  uploadArtefact: (body: UploadArtefactBody) =>
    api.post<IdeationArtefact>(`/ideation-artefacts`, body),
  runSourceGate: (ideationArtefactId: string) =>
    api.post<SourceGateResponse>(`/ideation-artefacts/${ideationArtefactId}/source-gate`, {}),
  runClaimCurrency: (ideationArtefactId: string) =>
    api.post<ClaimCurrencyCheck>(`/ideation-artefacts/${ideationArtefactId}/claim-currency`, {}),
  getClaimCurrency: (ideationArtefactId: string) =>
    api.get<ClaimCurrencyCheck>(`/ideation-artefacts/${ideationArtefactId}/claim-currency`),
  acknowledgeClaimFlag: (ideationArtefactId: string, flagId: string, body: { acknowledgedBy: string; note: string }) =>
    api.patch<ClaimCurrencyCheck>(`/ideation-artefacts/${ideationArtefactId}/claim-currency/${flagId}/acknowledge`, body),

  // Content cards + atomisation (Stage 2)
  listCards: (ideationProjectId: string) =>
    api.get<IdeationContentCard[]>(`/ideation-projects/${ideationProjectId}/cards`),
  createCard: (ideationProjectId: string, body: { ideationArtefactId: string; sourceSection: string; sourcePassage: string; channelFormats: ChannelFormat[]; title: string; cardType: string }) =>
    api.post<IdeationContentCard>(`/ideation-projects/${ideationProjectId}/cards`, body),
  atomiseChannel: (cardId: string, body: AtomiseChannelBody) =>
    api.post<AtomisedContent>(`/ideation-cards/${cardId}/atomise`, body),
  updateAdaptation: (adaptationId: string, body: { contentText: string; by: string }) =>
    api.patch<AtomisedContent>(`/ideation-adaptations/${adaptationId}`, body),
  runComplianceScreen: (adaptationId: string) =>
    api.post<ComplianceScreenResponse>(`/ideation-adaptations/${adaptationId}/compliance-screen`, {}),

  // KOL review (Stages 2-3) — PUBLIC route, no auth
  getKOLReview: (token: string) =>
    fetch(`${RAW_API_BASE}/kol-review/${token}`, { headers: { 'Content-Type': 'application/json' } })
      .then(r => r.json() as Promise<{ contact: KOLContact; cards: IdeationContentCard[] }>),
  submitKOLReview: (token: string, body: KOLSubmitBody) =>
    fetch(`${RAW_API_BASE}/kol-review/${token}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json() as Promise<{ ok: true; signedOffAt: string }>),

  // Medical Affairs approval (Stage 4)
  getKOLContact: (ideationProjectId: string) =>
    api.get<KOLContact>(`/ideation-projects/${ideationProjectId}/kol-contact`),
  submitMAApproval: (ideationProjectId: string, body: { approvedBy: string; approvedByName: string }) =>
    api.post<IdeationProject>(`/ideation-projects/${ideationProjectId}/ma-approval`, body),

  // Calendar + publishing
  listCalendar: (ideationProjectId: string) =>
    api.get<CalendarEntry[]>(`/ideation-projects/${ideationProjectId}/calendar`),
  scheduleCalendarEntry: (body: { ideationContentCardId: string; channel: ChannelFormat; scheduledDate: string; assignedCreativeId: string }) =>
    api.post<CalendarEntry>(`/ideation-calendar`, body),
  markPublished: (calendarEntryId: string, body: { publishedBy: string; utmParams?: string; seoMetadata?: Record<string, unknown> }) =>
    api.post<CalendarEntry>(`/ideation-calendar/${calendarEntryId}/publish`, body),

  // Social listening
  listSocialAlerts: (ideationProjectId: string) =>
    api.get<SocialListeningAlert[]>(`/ideation-projects/${ideationProjectId}/social-alerts`),
  resolveSocialAlert: (alertId: string, body: { resolvedBy: string; note: string }) =>
    api.patch<SocialListeningAlert>(`/ideation-social-alerts/${alertId}/resolve`, body),

  // Standards & metadata (E10)
  registerDOI: (cardId: string, body: { by: string }) =>
    api.post<DOIRegistrationResponse>(`/ideation-cards/${cardId}/doi/register`, body),
  saveDublinCore: (cardId: string, body: Record<string, string>) =>
    api.post<{ savedAt: string }>(`/ideation-cards/${cardId}/dublin-core`, body),
  verifyORCID: (body: { orcid: string; authorName: string; by: string }) =>
    api.post<{ verified: boolean; verifiedAt: string }>(`/ideation-orcid/verify`, body),
  runWCAGCheck: (cardId: string, body: { channel: ChannelFormat }) =>
    api.post<{ passed: boolean; score: number; failures: { criterion: string; detail: string }[] }>(
      `/ideation-cards/${cardId}/wcag`, body,
    ),

  // Portfolio (E01)
  getPortfolio: (projectId: string, stage?: IdeationStage) =>
    api.get<IdeationProject[]>(
      `/projects/${projectId}/ideation-portfolio${stage ? `?stage=${encodeURIComponent(stage)}` : ''}`,
    ),
}
