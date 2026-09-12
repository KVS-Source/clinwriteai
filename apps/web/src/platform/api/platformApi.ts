// Platform & Admin API client — used by sPM04–sPM18 and sB10.
import { api } from '../../api/client'
import type {
  PlatformConfig, PlatformUser, RaciMatrix, MasterLibraryItem,
  BestPractice, PlatformNotification, NotificationPreference,
  AuditTrailEntry, RateCard, Subscription, ReportDefinition,
  ModuleHealthScore, TATag, RegulatoryFramework, SlideDeckJob, Slide,
  PlatformClient, PlatformAnalytics,
} from '@platform/types'

// --- Request bodies ---

export interface InviteUserBody {
  name:     string
  email:    string
  role:     string
  modules:  Array<'A' | 'B' | 'C' | 'D' | 'E'>
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
  createdBy:     string
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

  // sPM17 — TA tags
  listTATags: () =>
    api.get<TATag[]>('/admin/taxonomy'),
  createTATag: (body: CreateTATagBody) =>
    api.post<TATag>('/admin/taxonomy', body),
  updateTATag: (tagId: string, patch: Partial<TATag>) =>
    api.patch<TATag>(`/admin/taxonomy/${tagId}`, patch),
  archiveTATag: (tagId: string) =>
    api.patch<TATag>(`/admin/taxonomy/${tagId}/archive`, {}),
  restoreTATag: (tagId: string) =>
    api.patch<TATag>(`/admin/taxonomy/${tagId}/restore`, {}),
  deleteTATag: (tagId: string) =>
    api.delete<{ ok: true }>(`/admin/taxonomy/${tagId}`),

  // sPM18 — Regulatory Frameworks
  listFrameworks: () =>
    api.get<RegulatoryFramework[]>('/regulatory-frameworks'),
  updateFramework: (frameworkId: string, patch: UpdateFrameworkBody) =>
    api.patch<RegulatoryFramework>(`/regulatory-frameworks/${frameworkId}`, patch),

  // sB10 — Slide Deck (Module B)
  getSlideDeckJob: (publicationId: string, jobId: string) =>
    api.get<SlideDeckJob>(`/publications/${publicationId}/slides/${jobId}`),
  updateSlide: (publicationId: string, jobId: string, slideId: string, patch: Partial<Slide>) =>
    api.patch<Slide>(`/publications/${publicationId}/slides/${jobId}/slides/${slideId}`, patch),
  exportSlideDeck: (publicationId: string, jobId: string) =>
    api.post<{ exportedAt: string; downloadUrl: string }>(
      `/publications/${publicationId}/slides/${jobId}/export`, {},
    ),
}
