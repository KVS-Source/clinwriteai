// Platform & Admin API client — used by sPM04–sPM18 and sB10.
import { api, ApiError } from '../../api/client'
import type { TherapeuticArea } from '../../api/taxonomy'
import type {
  PlatformConfig, AiConnectionTestResult, AiEngineSaveBody, PlatformUser, MasterLibraryItem,
  BestPractice,
  AuditTrailEntry, RateCard, Subscription, ReportDefinition,
  ModuleHealthScore, TATag, RegulatoryFramework, SlideDeckJob, Slide,
  PlatformClient, PlatformAnalytics,
  ProjectRaciAssignment, ProjectRaciAssignmentBody,
} from '@platform/types'

// One in-app notification as GET /notifications/me returns it (the Notification row).
export interface MyNotification {
  id: string
  recipientId: string
  kind: string                                   // e.g. 'signature_requested', 'user.invitation'
  severity: 'info' | 'warning' | 'critical'
  title: string
  body: string
  linkPath: string | null                        // where the notification points in the app
  channels: string[]
  payload: Record<string, unknown>
  readAt: string | null
  dismissedAt: string | null
  createdAt: string
  /** Where it belongs (the API works this out). Null when it isn't about a document. */
  context?: { projectId: string | null; projectName: string | null; documentId: string; documentTitle: string } | null
  /** Who it came from, with their role (e.g. Reviewer). Null when unknown. */
  actor?: { name: string; role: string } | null
  /** For a user holding two roles: the role this one is for ('pm' | 'contributor'), else null. Opening it
   *  while working as the other role asks them to switch first (NotificationCentre). */
  forRole?: string | null
}

// --- Request bodies ---

export interface LibraryListParams {
  q?: string
  module?: string[]
  itemType?: string[]
  docType?: string[]
  ta?: string[]
  projectId?: string
  version?: string
  from?: string
  to?: string
  sort?: 'recent' | 'oldest' | 'name-asc' | 'name-desc'
  includeRetired?: boolean
  limit?: number
}

export interface LibraryPage { items: MasterLibraryItem[]; total: number; nextCursor: string | null }

export interface LibraryDocumentEntry {
  id: string
  name: string
  sectionId: string | null          // null = the whole document
  documentVersion: string | null
  libraryVersion: string
}

export interface LibraryPushBody {
  documentId: string
  taTag: string
  module: 'A' | 'B' | 'C' | 'D' | 'E'
  docType: string
  version: string
}

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
  // Demo persona switcher: same users as listUsers, open to every persona (bypass mode only).
  listDemoPersonas: () =>
    api.get<PlatformUser[]>('/auth/demo-personas'),
  inviteUser: (body: InviteUserBody) =>
    api.post<PlatformUser>('/admin/users/invite', body),
  updateUser: (userId: string, patch: Partial<PlatformUser>) =>
    api.patch<PlatformUser>(`/admin/users/${userId}`, patch),

  // sPM07 — RACI
  listProjectRaci: (projectId: string) =>
    api.get<ProjectRaciAssignment[]>(`/projects/${projectId}/raci`),
  setProjectRaci: (projectId: string, body: ProjectRaciAssignmentBody) =>
    api.put<ProjectRaciAssignment>(`/projects/${projectId}/raci`, body),
  deleteProjectRaci: (projectId: string, activity: string) =>
    api.delete<void>(`/projects/${projectId}/raci/${encodeURIComponent(activity)}`),

  // sPM08 — Master Library
  listLibrary: () =>
    api.get<MasterLibraryItem[]>('/library'),
  // One page of the Master Library. Filters, search and sort run on the server;
  // the total and the next-page cursor come back in headers.
  listLibraryPage: async (params: LibraryListParams, cursor?: string): Promise<LibraryPage> => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      const value = Array.isArray(v) ? v.join(',') : v
      if (value !== undefined && value !== '' && value !== false) qs.set(k, String(value))
    }
    if (cursor) qs.set('cursor', cursor)
    const { data, headers } = await api.getWithHeaders<MasterLibraryItem[]>(`/library${qs.size ? `?${qs}` : ''}`)
    const total = Number(headers.get('X-Total-Count'))
    return { items: data, total: Number.isFinite(total) && headers.has('X-Total-Count') ? total : data.length, nextCursor: headers.get('X-Next-Cursor') || null }
  },
  // FR-A-080: push a signed, final document (or one of its sections) into the library.
  pushToLibrary: (body: LibraryPushBody) =>
    api.post<MasterLibraryItem>('/library/push', body),
  // What of a document is already in the library (whole document and/or single sections).
  libraryEntriesForDocument: (documentId: string) =>
    api.get<LibraryDocumentEntry[]>(`/library/by-document/${encodeURIComponent(documentId)}`),
  // Admin: a new version of a library section, and withdrawing it.
  versionLibrarySection: (itemId: string, body: { title?: string; body?: string }) =>
    api.post<unknown>(`/library/sections/${itemId}/versions`, body),
  withdrawLibrarySection: (itemId: string, reason?: string) =>
    api.post<unknown>(`/library/sections/${itemId}/retire`, reason ? { reason } : {}),
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

  // Projects that have documents in the library — the Master Library's Projects filter.
  listLibraryProjects: () =>
    api.get<Array<{ id: string; name: string }>>('/library/projects'),

  // sPM14 — Notifications: the signed-in user's own feed (API: modules/platform/notifications/routes.ts),
  // e.g. @mentions and signature requests. There is no preferences endpoint yet, so the screen has no
  // Preferences tab.
  listMyNotifications: () =>
    api.get<MyNotification[]>('/notifications/me?limit=200'),
  myUnreadNotificationCount: () =>
    api.get<{ count: number }>('/notifications/me/unread-count'),
  markMyNotificationsRead: (ids: string[]) =>
    api.post<{ updated: number }>('/notifications/me/mark-read', { ids }),
  markAllMyNotificationsRead: () =>
    api.post<{ updated: number }>('/notifications/me/mark-all-read', {}),
  dismissNotification: (id: string) =>
    api.post<MyNotification>(`/notifications/me/${encodeURIComponent(id)}/dismiss`, {}),

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

  // DocumentTypePolicy — the current policy row for a doc type. Powers the
  // "AI will use" preview on the New Document wizard + the admin policy
  // editor. A 404 (no policy authored yet) is normalised to null so the
  // consumer can render the "no policy" state without an error boundary.
  getDocumentTypePolicy: async (docType: string): Promise<DocumentTypePolicy | null> => {
    try {
      return await api.get<DocumentTypePolicy>(`/document-type-policies/${encodeURIComponent(docType)}`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  // Admin-only CRUD surface for the Policy Admin screen (step 7).
  // writeGate on the API is tenant-admin / super-admin / admin — the
  // AdminGuard on the screen keeps the client in agreement.
  listDocumentTypePolicies: () =>
    api.get<{ policies: DocumentTypePolicy[] }>(`/document-type-policies`),
  createDocumentTypePolicy: (body: DocumentTypePolicyCreateBody) =>
    api.post<DocumentTypePolicy>(`/document-type-policies`, body),
  updateDocumentTypePolicy: (docType: string, body: DocumentTypePolicyUpdateBody) =>
    api.patch<DocumentTypePolicy>(`/document-type-policies/${encodeURIComponent(docType)}`, body),
  bumpDocumentTypePolicy: (docType: string, body: DocumentTypePolicyBumpBody) =>
    api.post<DocumentTypePolicy>(`/document-type-policies/${encodeURIComponent(docType)}/bump`, body),
  retireDocumentTypePolicy: (docType: string, reason: string) =>
    api.post<DocumentTypePolicy>(`/document-type-policies/${encodeURIComponent(docType)}/retire`, { reason }),
  distillBestPractice: (docType: string, uploadId: string) =>
    api.post<{ jobId: string; policyId: string; docType: string; version: number }>(
      `/document-type-policies/${encodeURIComponent(docType)}/distill-best-practice`,
      { uploadId },
    ),
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

// --- DocumentTypePolicy (platform/document-type-policy) ------------------
// Mirrors the API shape() helper. `bestPracticeDigest` and `sectionRules`
// are already JSON-typed server-side so the client can read them directly.

export interface PolicyPrinciple {
  scope:    'whole-doc' | string           // 'whole-doc' | 'section:<key>'
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export interface BestPracticeDigest {
  principles:      PolicyPrinciple[]
  sourcePdfId?:    string
  distilledAt?:    string
  distilledModel?: string
}

export interface DocumentTypePolicy {
  id:                  string
  docType:             string
  version:             number
  isCurrent:           boolean
  smePrompt:           string
  bestPracticeDigest:  BestPracticeDigest | null
  sectionRules:        Record<string, unknown> | null
  templateId:          string | null
  checklistTemplateId: string | null
  ichFramework:        string | null
  effectiveDate:       string
  supersededBy:        string | null
  retiredAt:           string | null
  retiredBy:           string | null
  retireReason:        string | null
  createdBy:           string
  updatedBy:           string
  createdAt:           string
  updatedAt:           string
}

// Shared body shape. `sectionRules` matches the API's Zod
// `sectionRulesSchema`: keyed by stable section key.
export interface DocumentTypePolicyEditableFields {
  smePrompt?:           string
  bestPracticeDigest?:  BestPracticeDigest
  sectionRules?:        Record<string, Array<{ severity: 'must' | 'should' | 'nice'; text: string }>>
  templateId?:          string | null
  checklistTemplateId?: string | null
  ichFramework?:        string | null
}

export interface DocumentTypePolicyCreateBody extends DocumentTypePolicyEditableFields {
  docType:    string
  smePrompt:  string          // required on create (API Zod)
}

export type DocumentTypePolicyUpdateBody = DocumentTypePolicyEditableFields

export interface DocumentTypePolicyBumpBody extends DocumentTypePolicyEditableFields {
  smePrompt:    string        // required on bump (API Zod re-posts the whole body)
  changeReason: string
}
