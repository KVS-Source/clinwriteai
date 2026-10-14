// Platform & Admin API client — used by sPM04–sPM18 and sB10.
import { api } from '../../api/client'
import type { TherapeuticArea } from '../../api/taxonomy'
import type {
  PlatformConfig, PlatformUser, RaciMatrix, MasterLibraryItem,
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
    createdAt:     r.createdAt.slice(0, 10),
    createdBy:     r.createdBy,
    archivedAt:    r.archivedAt?.slice(0, 10),
  }
}

export interface UpdateFrameworkBody {
  status?:         string
  changeSummary?:  string
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

  // sPM15 — Audit trail
  listAudit: () =>
    api.get<AuditTrailEntry[]>('/audit'),
  getAudit: (id: string) =>
    api.get<AuditTrailEntry>(`/audit/${id}`),
  exportAuditCsv: () =>
    api.get<{ downloadUrl: string; rowCount: number }>('/audit/export/csv'),

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
  getSubscription: () =>
    api.get<Subscription>('/admin/subscription'),

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
    api.get<RegulatoryFramework[]>('/regulatory-frameworks'),
  updateFramework: (frameworkId: string, patch: UpdateFrameworkBody) =>
    api.patch<RegulatoryFramework>(`/regulatory-frameworks/${frameworkId}`, patch),

  // sB10 — Slide Deck (Scientific Writing)
  getSlideDeckJob: (publicationId: string, jobId: string) =>
    api.get<SlideDeckJob>(`/publications/${publicationId}/slides/${jobId}`),
  updateSlide: (publicationId: string, jobId: string, slideId: string, patch: Partial<Slide>) =>
    api.patch<Slide>(`/publications/${publicationId}/slides/${jobId}/slides/${slideId}`, patch),
  exportSlideDeck: (publicationId: string, jobId: string) =>
    api.post<{ exportedAt: string; downloadUrl: string }>(
      `/publications/${publicationId}/slides/${jobId}/export`, {},
    ),
}
