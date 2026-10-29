// Platform & Admin API client — used by sPM04–sPM18 and sB10.
import { api } from '../../api/client'
import type { TherapeuticArea } from '../../api/taxonomy'
import type {
  PlatformConfig, AiConnectionTestResult, AiEngineSaveBody, PlatformUser, RaciMatrix, MasterLibraryItem,
  BestPractice, PlatformNotification, NotificationPreference,
  AuditTrailEntry, RateCard, Subscription, ReportDefinition,
  ModuleHealthScore, TATag, RegulatoryFramework, SlideDeckJob, Slide,
  PlatformClient, PlatformAnalytics,
  ProjectRaciAssignment, ProjectRaciAssignmentBody,
} from '@platform/types'

// --- Request bodies ---

export interface InviteUserBody {
  name:     string
  email:    string
  role:     string
  modules:  Array<'A' | 'B' | 'C' | 'D' | 'E'>
}

export interface RateCardVersionSummary {
  id:          string
  version:     string
  isActive:    boolean
  publishedAt: string
  notes?:      string | null
  validUntil?: string        // not stored by the API yet; mock data only
}

export interface CreateRateCardBody {
  version:               string
  label:                 string
  effectiveFrom:         string
  validUntil:            string
  currency:              string
  isDisruptionRateCard:  boolean
  rates:                 Array<{ module: string; serviceType: string; unit: string; rate: number }>
}

export interface CreateTATagBody {
  name:          string
  abbreviation:  string
}

const TA_ADMIN = '/admin/taxonomy/therapeutic-areas'

type TaxonomyRow = TherapeuticArea & { projectCount?: number; documentCount?: number }

function taTagShape(r: TaxonomyRow): TATag {
  return {
    id:            r.code,
    name:          r.label,
    abbreviation:  r.code,
    status:        r.status,
    projectCount:  r.projectCount ?? 0,
    documentCount: r.documentCount ?? 0,
    createdAt:     r.createdAt,   // full ISO timestamp — the TA list sorts same-day tags by time
    createdBy:     r.createdBy,
    archivedAt:    r.archivedAt?.slice(0, 10),
  }
}

// sPM18 — the API's regulatory_frameworks row (GET/POST /admin/frameworks).
interface FrameworkRow {
  id:            string
  name:          string          // unique short code, e.g. 'ICH E3'
  version:       string
  jurisdiction:  string          // issuer, e.g. 'ICH' | 'FDA' | 'EMA'
  category:      string
  effectiveDate: string
  retiredAt:     string | null
  description:   string | null   // full name
  sourceUrl:     string | null
  updatedAt:     string
}

export interface CreateFrameworkBody {
  name:          string
  version:       string
  jurisdiction:  string
  category:      string
  effectiveDate: string          // ISO datetime
  description?:  string
  sourceUrl?:    string
}

// The registry stores no scope or revision status yet: scope is empty and
// status is Current / Deprecated (retired) only.
function frameworkShape(r: FrameworkRow): RegulatoryFramework {
  return {
    id:            r.id,
    code:          r.name,
    name:          r.description || r.name,
    issuer:        r.jurisdiction,
    version:       r.version,
    effectiveDate: r.effectiveDate,
    scope:         [],
    status:        r.retiredAt ? 'Deprecated' : 'Current',
    lastUpdated:   r.updatedAt,
    changeSummary: null,
  }
}

export interface GenerateReportBody {
  format:   'pdf' | 'csv'
  dateFrom?: string
  dateTo?:   string
  filters?: Record<string, unknown>
}

// --- Client ---

export const platformApi = {
  // sPM04 / sPM05 — config
  // Fires a real test prompt at the AI engine; the server answers within ~5 seconds.
  // Saves the default / fallback engine and the per-module override switch; AI calls use it from then on.
  saveAiEngine: (body: AiEngineSaveBody) => api.put<AiEngineSaveBody>('/admin/config/ai-engine', body),
  testAiConnection: () => api.post<AiConnectionTestResult>('/admin/test-connection', {}),
  getConfig: () =>
    api.get<PlatformConfig>('/admin/config'),

  // sPM06 — users
  listUsers: () =>
    api.get<PlatformUser[]>('/admin/users'),
  inviteUser: (body: InviteUserBody) =>
    api.post<PlatformUser>('/admin/users/invite', body),
  updateUser: (userId: string, patch: Partial<PlatformUser>) =>
    api.patch<PlatformUser>(`/admin/users/${userId}`, patch),

  // sPM07 — RACI
  getRaci: (projectId: string) =>
    api.get<RaciMatrix>(`/raci/${projectId}`),
  listProjectRaci: (projectId: string) =>
    api.get<ProjectRaciAssignment[]>(`/projects/${projectId}/raci`),
  setProjectRaci: (projectId: string, body: ProjectRaciAssignmentBody) =>
    api.put<ProjectRaciAssignment>(`/projects/${projectId}/raci`, body),
  deleteProjectRaci: (projectId: string, activity: string) =>
    api.delete<void>(`/projects/${projectId}/raci/${encodeURIComponent(activity)}`),

  // sPM08 — Master Library
  listLibrary: () =>
    api.get<MasterLibraryItem[]>('/library'),
  getLibraryItem: (itemId: string) =>
    api.get<MasterLibraryItem>(`/library/${itemId}`),
  // Records that a section was pulled into a document (usage count + audit).
  adoptLibrarySection: (itemId: string, body: { adoptingModule: 'A' | 'B' | 'C' | 'D' | 'E'; adoptingEntity: string }) =>
    api.post<unknown>(`/library/sections/${itemId}/adopt`, body),

  // sPM09 — Best Practices
  listBestPractices: () =>
    api.get<BestPractice[]>('/library/best-practices'),
  createBestPractice: (body: Partial<BestPractice>) =>
    api.post<BestPractice>('/library/best-practices', body),

  // sPM14 — Notifications
  listNotifications: () =>
    api.get<PlatformNotification[]>('/notifications'),
  getNotificationPreferences: () =>
    api.get<NotificationPreference[]>('/notifications/preferences'),
  updateNotificationPreferences: (prefs: NotificationPreference[]) =>
    api.patch<NotificationPreference[]>('/notifications/preferences', prefs),
  markNotificationRead: (id: string) =>
    api.patch<PlatformNotification>(`/notifications/${id}/mark-read`, {}),

  // sPM15 — Audit trail. API mounts the admin audit routes under
  // /admin/audit (see modules/platform/tenant-admin/audit/routes.ts). The
  // bare /audit path only ever existed as an MSW mock; using it against
  // the real server 404s. API returns { rows, nextCursor, hasMore };
  // flatten to the AuditTrailEntry[] shape the AuditTrailViewer expects.
  listAudit: async (): Promise<AuditTrailEntry[]> => {
    const r = await api.get<{ rows: AuditTrailEntry[] } | AuditTrailEntry[]>('/admin/audit')
    return Array.isArray(r) ? r : (r.rows ?? [])
  },
  getAudit: (id: string) =>
    api.get<AuditTrailEntry>(`/admin/audit/${id}`),
  exportAuditCsv: () =>
    api.get<{ downloadUrl: string; rowCount: number }>('/admin/audit/export'),

  // sPM05 — Super Admin clients + analytics
  listPlatformClients: () =>
    api.get<PlatformClient[]>('/super-admin/clients'),
  getPlatformAnalytics: () =>
    api.get<PlatformAnalytics>('/super-admin/analytics'),

  // sPM12 — Rate cards
  listRateCards: () =>
    api.get<RateCard[]>('/super-admin/rate-cards'),
  createRateCard: (body: CreateRateCardBody) =>
    api.post<RateCard>('/super-admin/rate-cards', body),

  // Live rate-card versions served by the AI gateway (GET /ai/rate-cards).
  // Different shape from the sPM12 RateCard above — only the active flag and
  // version are shared. validUntil is only present on mock data today.
  listRateCardVersions: () =>
    api.get<RateCardVersionSummary[]>('/ai/rate-cards'),

  // sPM11 / sPM13 — Subscription & Services
  getServicesDashboard: () =>
    api.get<Subscription>('/services/dashboard'),

  // Services analytics — six aggregates for the usage panels on /services.
  // Tenant admins get their tenant only; platform admins see all tenants.
  getUsageAnalytics: (windowDays = 30) =>
    api.get<{
      generatedAt: string
      windowDays: number
      totals: { calls: number; tokens: number; costUsd: number }
      dailyTokens: Array<{ date: string; tokens: number }>
      promptIntents: Array<{ label: string; value: number; hint: string }>
      modelMix:      Array<{ label: string; value: number; hint: string }>
      topPrompts:    Array<{ label: string; hint: string }>
      topUsers:      Array<{ label: string; hint: string }>
      hourlyDistribution: number[]
      hourlyPeakLabel: string
    }>(`/ai/usage-analytics?windowDays=${windowDays}`),
  getSubscription: () =>
    api.get<Subscription>('/admin/subscription'),
  // Records a pending top-up; no payment gateway is integrated yet.
  requestTopUp: (body: { tokens: number; amountUsd: number; gateway: string | null }) =>
    api.post<{ requestId: string; status: 'pending_payment'; requestedAt: string }>('/admin/subscription/top-up', body),

  // sPM16 — Reports & Analytics
  listReports: () =>
    api.get<ReportDefinition[]>('/reports/available'),
  getHealthScores: () =>
    api.get<ModuleHealthScore[]>('/reports/health-scores'),
  generateReport: (reportType: string, body: GenerateReportBody) =>
    api.post<{ reportType: string; format: string; generatedAt: string; downloadUrl: string }>(
      `/reports/${reportType}/generate`, body,
    ),

  // sPM17 — TA tags. Backed by the therapeutic-areas taxonomy routes; the
  // TA `code` doubles as the tag id + abbreviation, `label` is the name.
  listTATags: () =>
    api.get<TaxonomyRow[]>('/taxonomy/therapeutic-areas?includeArchived=true&includeUsage=true')
      .then(rows => rows.map(taTagShape)),
  createTATag: (body: CreateTATagBody) =>
    api.post<TaxonomyRow>(TA_ADMIN, { code: body.abbreviation, label: body.name }).then(taTagShape),
  updateTATag: (tagId: string, patch: { name?: string }) =>
    api.patch<TaxonomyRow>(`${TA_ADMIN}/${encodeURIComponent(tagId)}`, { label: patch.name }).then(taTagShape),
  archiveTATag: (tagId: string) =>
    api.patch<TaxonomyRow>(`${TA_ADMIN}/${encodeURIComponent(tagId)}`, { status: 'archived' }).then(taTagShape),
  restoreTATag: (tagId: string) =>
    api.patch<TaxonomyRow>(`${TA_ADMIN}/${encodeURIComponent(tagId)}`, { status: 'active' }).then(taTagShape),
  deleteTATag: (tagId: string) =>
    api.delete<{ ok: true }>(`${TA_ADMIN}/${encodeURIComponent(tagId)}`),

  // sPM18 — Regulatory Frameworks
  listFrameworks: () =>
    api.get<FrameworkRow[]>('/admin/frameworks?includeRetired=true').then(rows => rows.map(frameworkShape)),
  createFramework: (body: CreateFrameworkBody) =>
    api.post<FrameworkRow>('/admin/frameworks', body).then(frameworkShape),
  // Marks a framework superseded (sets retiredAt). Audited server-side; irreversible.
  retireFramework: (frameworkId: string) =>
    api.post<FrameworkRow>(`/admin/frameworks/${encodeURIComponent(frameworkId)}/retire`, {}).then(frameworkShape),

  // sB10 — Slide Deck (Scientific Writing)
  getSlideDeckJob: (publicationId: string, jobId: string) =>
    api.get<SlideDeckJob>(`/publications/${publicationId}/slides/${jobId}`),
  updateSlide: (publicationId: string, jobId: string, slideId: string, patch: Partial<Slide>) =>
    api.patch<Slide>(`/publications/${publicationId}/slides/${jobId}/slides/${slideId}`, patch),
  exportSlideDeck: (publicationId: string, jobId: string) =>
    api.post<{ exportedAt: string; downloadUrl: string }>(
      `/publications/${publicationId}/slides/${jobId}/export`, {},
    ),

  // Polymorphic edit history for slides (sPM-edit-history-polymorphic).
  // In-place mutation (same model as Module A sections). History payload
  // serialises title + bodyText + speakerNotes together so revert restores
  // the slide atomically.
  getSlideHistory: (slideId: string, filters: { mine?: boolean; origin?: 'manual' | 'ai' | 'undo' | 'restore' } = {}) => {
    const qs = new URLSearchParams()
    if (filters.mine)   qs.set('mine', 'true')
    if (filters.origin) qs.set('origin', filters.origin)
    const suffix = qs.toString() ? `?${qs}` : ''
    return api.get<{
      entityType: 'slide'
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
    }>(`/slides/${slideId}/history${suffix}`)
  },
  revertSlideEdit: (editHistoryId: string) =>
    api.post<{ ok: true; revertedAt: string; restored: { title: string; bodyText: string; speakerNotes: string } | null }>(
      `/slide-edits/${editHistoryId}/revert`, {},
    ),

  // External API credentials — admin-managed secrets for the Admin Panel's
  // External APIs tab. GET returns masked keys only; PUT upserts; DELETE
  // clears a connector.
  listExternalApiCredentials: () =>
    api.get<ExternalApiCredentialRow[]>('/admin/external-apis/credentials'),
  saveExternalApiCredentials: (apiId: string, body: ExternalApiCredentialBody) =>
    api.put<ExternalApiCredentialRow>(`/admin/external-apis/${encodeURIComponent(apiId)}/credentials`, body),
  deleteExternalApiCredentials: (apiId: string) =>
    api.delete<void>(`/admin/external-apis/${encodeURIComponent(apiId)}/credentials`),
}

export interface ExternalApiCredentialRow {
  apiId:        string
  hasApiKey:    boolean
  apiKeyMasked: string | null
  username:     string | null
  baseUrl:      string | null
  notes:        string | null
  updatedAt:    string
  updatedBy:    string
}

export interface ExternalApiCredentialBody {
  apiKey?:   string | null
  username?: string | null
  baseUrl?:  string | null
  notes?:    string | null
}
