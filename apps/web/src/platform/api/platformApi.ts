// Platform & Admin API client — used by sPM04–sPM18 and sB10.
import { api, ApiError } from '../../api/client'
import type { TherapeuticArea } from '../../api/taxonomy'
import type {
  PlatformConfig, AiConnectionTestResult, AiEngineSaveBody, PlatformUser, MasterLibraryItem,
  MasterLibraryShareRecord, MasterLibraryVersion, MasterLibraryAuditPage, BestPractice,
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

export interface FrameworkSupersedeRequest {
  id:              string
  frameworkId:     string
  status:          'pending' | 'approved' | 'rejected'
  reason:          string | null
  requestedBy:     string
  requestedByName: string | null
  requestedAt:     string
  decidedBy:       string | null
  decidedByName:   string | null
  decidedAt:       string | null
  rejectionReason: string | null
}

export interface LibraryListParams {
  q?: string
  module?: string[]
  itemType?: string[]
  docType?: string[]
  ta?: string[]
  projectId?: string
  version?: string
  sort?: 'recent' | 'oldest' | 'name-asc' | 'name-desc' | 'type-asc' | 'type-desc' | 'ta-asc' | 'ta-desc'
  includeRetired?: boolean
  limit?: number
}

export interface LibraryPage { items: MasterLibraryItem[]; total: number; nextCursor: string | null }

// What happened to a signed document's automatic push to the Master Library (GET /library/auto-push/:documentId).
export type LibraryAutoPushStatus =
  | { state: 'pushed'; entry: { id: string; addedAt: string; libraryVersion: string; documentVersion: string | null } }
  | { state: 'skipped'; reason: string; missing?: string[]; at: string | null; documentVersion: string | null }
  | { state: 'failed'; reason: string; at: string | null; documentVersion: string | null }
  | { state: 'waiting' | 'not_signed'; documentVersion?: string | null }

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

// When the registry last synced from ICH (button or the daily automatic sync) and whether the automatic sync is on.
export interface IchSyncStatus {
  lastSyncedAt: string | null
  lastTrigger:  'manual' | 'automatic' | null
  autoSync:     { enabled: boolean; everyDays: number }
}

export interface IchSyncResult {
  fetched: number; created: string[]; updated: string[]; unchanged: number; withdrawn: string[]
  skipped: Array<{ code: string; reason: string }>
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
  scope?:        string[]        // ClinWrite modules it applies to ('A'…'E'); migration 72
  updatedAt:     string
}

// The query string for the Master Library list and its count. A list value that contains a comma (or a percent sign) is
// percent-encoded so it stays one value; the API decodes it.
function libraryQuery(params: LibraryListParams): URLSearchParams {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    const value = Array.isArray(v) ? v.map(x => String(x).replace(/%/g, '%25').replace(/,/g, '%2C')).join(',') : v
    if (value !== undefined && value !== '' && value !== false) qs.set(k, String(value))
  }
  return qs
}

export interface CreateFrameworkBody {
  name:          string
  version:       string
  jurisdiction:  string
  category:      string
  effectiveDate: string          // ISO datetime
  description?:  string
  sourceUrl?:    string
  scope?:        Array<'A' | 'B' | 'C' | 'D' | 'E'>
}

// Status is Current / Deprecated (retired) only; scope is the modules the framework applies to.
function frameworkShape(r: FrameworkRow): RegulatoryFramework {
  return {
    id:            r.id,
    code:          r.name,
    name:          r.description || r.name,
    issuer:        r.jurisdiction,
    version:       r.version,
    effectiveDate: r.effectiveDate,
    scope:         (r.scope ?? []) as RegulatoryFramework['scope'],
    status:        r.retiredAt ? 'Deprecated' : 'Current',
    lastUpdated:   r.updatedAt,
    changeSummary: null,
    sourceUrl:     r.sourceUrl,
    category:      r.category,
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
    const qs = libraryQuery(params)
    if (cursor) qs.set('cursor', cursor)
    const { data, headers } = await api.getWithHeaders<MasterLibraryItem[]>(`/library${qs.size ? `?${qs}` : ''}`)
    const total = Number(headers.get('X-Total-Count'))
    return { items: data, total: Number.isFinite(total) && headers.has('X-Total-Count') ? total : data.length, nextCursor: headers.get('X-Next-Cursor') || null }
  },
  // How many items the same filters match — one number, no rows (the tab bar's count).
  countLibrary: async (params: LibraryListParams): Promise<number> => {
    const qs = libraryQuery(params)
    const { total } = await api.get<{ total: number }>(`/library/count${qs.size ? `?${qs}` : ''}`)
    return total
  },
  // FR-A-080: a signed document is pushed to the library by itself on signing; this says what happened.
  libraryAutoPushStatus: (documentId: string) =>
    api.get<LibraryAutoPushStatus>(`/library/auto-push/${encodeURIComponent(documentId)}`),
  // PM: add a document from the computer (PDF or Word). Multipart: the fields first, then the file.
  uploadLibraryDocument: (form: FormData) =>
    api.upload<MasterLibraryItem>('/library/upload', form),
  getLibraryItem: (itemId: string) =>
    api.get<MasterLibraryItem>(`/library/${itemId}`),
  // Every version of the same document (matched on its source document, not its title), newest first.
  listLibraryItemVersions: (itemId: string) =>
    api.get<MasterLibraryVersion[]>(`/library/${encodeURIComponent(itemId)}/versions`),
  // A Project Manager (only) shares a Master Document by email. Colleagues get a notification; anyone
  // else (no account) gets an invitation whose link opens the document only after an emailed one-time code.
  shareLibraryItem: (itemId: string, emails: string[]) =>
    api.post<{ shared: Array<{ email: string; kind: 'user' | 'invite'; name?: string }>; failed: string[] }>(`/library/${encodeURIComponent(itemId)}/share`, { emails }),
  // Everyone the document has ever been shared with, by whom and when (newest first, permanent).
  listLibraryItemShares: (itemId: string) =>
    api.get<MasterLibraryShareRecord[]>(`/library/${encodeURIComponent(itemId)}/shares`),
  // This document's Master Library activity (pushed / uploaded, viewed, shared, ...), newest first, a page at a time. Read-only.
  // `from` / `to` (ISO instants) keep it to that period.
  listLibraryItemAudit: (itemId: string, offset = 0, limit = 50, period: { from?: string; to?: string } = {}) =>
    api.get<MasterLibraryAuditPage>(`/library/${encodeURIComponent(itemId)}/audit?limit=${limit}&offset=${offset}${period.from ? `&from=${encodeURIComponent(period.from)}` : ''}${period.to ? `&to=${encodeURIComponent(period.to)}` : ''}`),
  // Records that a section was pulled into a document (usage count + audit).
  adoptLibrarySection: (itemId: string, body: { adoptingModule: 'A' | 'B' | 'C' | 'D' | 'E'; adoptingEntity: string }) =>
    api.post<unknown>(`/library/sections/${itemId}/adopt`, body),

  // The writing modules (A–E) this caller's tenant has switched on — what the Best Practices filter offers.
  getEnabledModules: () =>
    api.get<{ modules: Array<'A' | 'B' | 'C' | 'D' | 'E'> }>('/library/enabled-modules'),

  // sPM09 — Best Practices
  listBestPractices: () =>
    api.get<BestPractice[]>('/library/best-practices'),
  createBestPractice: (body: Partial<BestPractice>) =>
    api.post<BestPractice>('/library/best-practices', body),

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
  // sPM16 — Reports & Analytics
  listReports: () =>
    api.get<ReportDefinition[]>('/reports/available'),
  getHealthScores: () =>
    api.get<ModuleHealthScore[]>('/reports/health-scores'),
  // One report on screen: headline figures + its rows (the same rows the download carries).
  getReportPreview: (reportType: string, range: { dateFrom: string; dateTo: string }) =>
    api.get<{ reportType: string; header: string[]; rows: unknown[][]; totalRows: number; summary: Array<{ label: string; value: string | number }> }>(
      // An empty bound (range cleared) is left out: from the beginning / up to today.
      `/reports/${reportType}/preview?${new URLSearchParams(Object.entries(range).filter(([, v]) => v)).toString()}`,
    ),
  // AI tokens + cost on the PM's projects this billing period (the Reports cost panel).
  getReportCostSummary: () =>
    api.get<{ periodStart: string; projects: number; tokensConsumed: number; estimatedSpend: number; tenantName: string | null }>('/reports/cost-summary'),
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
  // Imports the real ICH guideline list from ich.org (codes, titles, ICH step, step date, PDF link).
  syncFrameworksFromIch: () =>
    api.post<IchSyncResult>('/admin/frameworks/sync-ich', {}),
  getIchSyncStatus: () =>
    api.get<IchSyncStatus>('/admin/frameworks/sync-ich/status'),
  listFrameworks: () =>
    api.get<FrameworkRow[]>('/admin/frameworks?includeRetired=true').then(rows => rows.map(frameworkShape)),
  createFramework: (body: CreateFrameworkBody) =>
    api.post<FrameworkRow>('/admin/frameworks', body).then(frameworkShape),
  // Sets which ClinWrite modules a framework applies to (same people who can add a framework).
  setFrameworkScope: (frameworkId: string, scope: Array<'A' | 'B' | 'C' | 'D' | 'E'>) =>
    api.patch<FrameworkRow>(`/admin/frameworks/${encodeURIComponent(frameworkId)}`, { scope }).then(frameworkShape),
  // Marks a framework superseded (sets retiredAt). Audited server-side; irreversible.
  // Marking a framework superseded is a two-person decision: a PM sends it for approval, another PM or a
  // QC approves (the framework is retired) or rejects with a reason. There is no direct retire.
  sendFrameworkForApproval: (frameworkId: string, reason?: string) =>
    api.post<FrameworkSupersedeRequest>(`/admin/frameworks/${encodeURIComponent(frameworkId)}/supersede-request`, reason ? { reason } : {}),
  listFrameworkRequests: (params: { status?: 'pending' | 'approved' | 'rejected'; frameworkId?: string } = {}) => {
    const qs = new URLSearchParams()
    if (params.status) qs.set('status', params.status)
    if (params.frameworkId) qs.set('frameworkId', params.frameworkId)
    return api.get<FrameworkSupersedeRequest[]>(`/admin/frameworks/supersede-requests${qs.size ? `?${qs}` : ''}`)
  },
  approveFrameworkRequest: (requestId: string) =>
    api.post<FrameworkSupersedeRequest>(`/admin/frameworks/supersede-requests/${encodeURIComponent(requestId)}/approve`, {}),
  rejectFrameworkRequest: (requestId: string, reason: string) =>
    api.post<FrameworkSupersedeRequest>(`/admin/frameworks/supersede-requests/${encodeURIComponent(requestId)}/reject`, { reason }),

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
  // AI readiness — one source of truth for "is AI set up?". The New
  // Document wizard disables its Draft-with-AI opt-in when this says
  // no; admin screens surface a banner + setup CTA. Any authenticated
  // user may call this (the wizard needs it).
  getAiReadiness: () =>
    api.get<AiReadiness>('/ai/readiness'),

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
  // AI-extract section rules from the policy's SME prompt. Does NOT
  // write to the policy — returns the parsed rules so the admin can
  // review + Save on the editor to persist.
  extractSectionRules: (docType: string) =>
    api.post<{
      sectionRules: Record<string, Array<{ severity: 'must' | 'should' | 'nice'; text: string }>>
      sectionCount: number
      ruleCount:    number
    }>(`/document-type-policies/${encodeURIComponent(docType)}/extract-section-rules`, {}),

  // --- AiPromptRecord (Phase-1 pointer refactor, migration 73) ----------
  // Prompts are now their own entity with a draft → approved → retired
  // workflow. The AI Prompts admin tab talks to these routes; the Doc
  // Type Policies screen still edits BP digest + section rules on the
  // legacy `smePrompt` column until Phase 2 promotes BP too.
  listAiPrompts: () =>
    api.get<{ prompts: AiPromptRecord[] }>(`/ai-prompts`),
  /** Latest approved row for a docType — 404 means no approved row exists. */
  getAiPrompt: async (docType: string): Promise<AiPromptRecord | null> => {
    try {
      return await api.get<AiPromptRecord>(`/ai-prompts/${encodeURIComponent(docType)}`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  /** Version history (draft + approved + retired, newest first). */
  listAiPromptVersions: (docType: string) =>
    api.get<{ versions: AiPromptRecord[] }>(`/ai-prompts/${encodeURIComponent(docType)}/versions`),
  createAiPromptDraft: (body: AiPromptCreateBody) =>
    api.post<AiPromptRecord>(`/ai-prompts`, body),
  updateAiPromptDraft: (id: string, body: AiPromptPatchBody) =>
    api.patch<AiPromptRecord>(`/ai-prompts/${encodeURIComponent(id)}`, body),
  approveAiPrompt: (id: string) =>
    api.post<AiPromptRecord>(`/ai-prompts/${encodeURIComponent(id)}/approve`, {}),
  retireAiPrompt: (id: string, reason: string) =>
    api.post<AiPromptRecord>(`/ai-prompts/${encodeURIComponent(id)}/retire`, { reason }),
  /** Run AI extraction on this prompt row's smePrompt. Returns BOTH the
   *  per-section rules AND the cross-cutting rules (migration 95).
   *  Admin reviews + saves via `updateAiPromptDraft` to persist. */
  extractSectionRulesForPrompt: (id: string) =>
    api.post<{
      sectionRules:      Record<string, Array<{ severity: 'must' | 'should' | 'nice'; text: string }>>
      crossCuttingRules: Array<{ severity: 'must' | 'should' | 'nice'; text: string }>
      sectionCount:      number
      ruleCount:         number
      crossCuttingCount: number
    }>(`/ai-prompts/${encodeURIComponent(id)}/extract-section-rules`, {}),

  // --- Licensing (migration 92) ----------------------------------------
  // Per-install signed-JWT licence. GET re-verifies on every call, so
  // the response is fresh truth; never cache stale values client-side
  // beyond react-query's normal staleTime.
  getLicense: () =>
    api.get<LicenseView>(`/license`),
  importLicense: (token: string) =>
    api.post<LicenseView>(`/license/import`, { token }),

  // --- Platform Settings — Branding + Localisation (migration 93) -----
  getPlatformSettings: () =>
    api.get<PlatformSettingsView>(`/platform-settings`),
  updateBranding: (body: Partial<BrandingSettings>) =>
    api.patch<PlatformSettingsView>(`/platform-settings/branding`, body),
  updateLocalisation: (body: Partial<LocalisationSettings>) =>
    api.patch<PlatformSettingsView>(`/platform-settings/localisation`, body),
  updateVoiceSettings: (body: Partial<VoiceSettings>) =>
    api.patch<PlatformSettingsView>(`/platform-settings/voice`, body),
  updateSsoSettings: (body: Partial<SsoSettings>) =>
    api.patch<PlatformSettingsView>(`/platform-settings/sso`, body),

  // SectionTemplate methods retired in migration 94 — per-section
  // formatRules live inside DocumentTemplate.sections[] now; use the
  // existing template endpoints to read/edit them.

  // --- BestPracticeRecord (Phase-2 pointer refactor, migration 74) ------
  // BP digest is its own versioned entity. The distill worker writes to
  // a draft row for the docType; admin reviews + approves. Distillation
  // itself is still triggered via the policy route's
  // distill-best-practice-file endpoint — unchanged UI, new destination.
  listBestPracticeRecords: () =>
    api.get<{ records: BestPracticeRecord[] }>(`/best-practice-records`),
  getBestPracticeRecord: async (docType: string): Promise<BestPracticeRecord | null> => {
    try {
      return await api.get<BestPracticeRecord>(`/best-practice-records/${encodeURIComponent(docType)}`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  listBestPracticeVersions: (docType: string) =>
    api.get<{ versions: BestPracticeRecord[] }>(`/best-practice-records/${encodeURIComponent(docType)}/versions`),
  updateBestPracticeDraft: (id: string, body: BestPracticePatchBody) =>
    api.patch<BestPracticeRecord>(`/best-practice-records/${encodeURIComponent(id)}`, body),
  approveBestPractice: (id: string) =>
    api.post<BestPracticeRecord>(`/best-practice-records/${encodeURIComponent(id)}/approve`, {}),
  retireBestPractice: (id: string, reason: string) =>
    api.post<BestPracticeRecord>(`/best-practice-records/${encodeURIComponent(id)}/retire`, { reason }),

  // --- Publication (Module B) policy stack — Phase M-B.1 (migration 75) ---
  listPublicationTypePolicies: () =>
    api.get<{ policies: PublicationTypePolicy[] }>(`/publication-type-policies`),
  getPublicationTypePolicy: async (docType: string): Promise<PublicationTypePolicy | null> => {
    try {
      return await api.get<PublicationTypePolicy>(`/publication-type-policies/${encodeURIComponent(docType)}`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  createPublicationTypePolicy: (body: PublicationTypePolicyCreateBody) =>
    api.post<PublicationTypePolicy>(`/publication-type-policies`, body),
  updatePublicationTypePolicy: (docType: string, body: PublicationTypePolicyPatchBody) =>
    api.patch<PublicationTypePolicy>(`/publication-type-policies/${encodeURIComponent(docType)}`, body),
  retirePublicationTypePolicy: (docType: string, reason: string) =>
    api.post<PublicationTypePolicy>(`/publication-type-policies/${encodeURIComponent(docType)}/retire`, { reason }),
  /** Admin BP PDF upload — stores as a platform DocumentUpload and
   *  enqueues publications.distill_best_practice. Worker writes to a
   *  draft PublicationBestPracticeRecord; admin approves separately. */
  distillPublicationBestPracticeFile: (docType: string, file: File) => {
    const form = new FormData()
    form.append('file', file, file.name)
    return api.upload<{
      jobId:     string
      uploadId:  string
      policyId:  string
      docType:   string
      version:   number
      fileName:  string
      sizeBytes: number
    }>(`/publication-type-policies/${encodeURIComponent(docType)}/distill-best-practice-file`, form)
  },

  // --- Medical-content (Module C) policy stack --------------------------
  listMedContentTypePolicies: () =>
    api.get<{ policies: MedContentTypePolicy[] }>(`/med-content-type-policies`),
  getMedContentTypePolicy: async (docType: string): Promise<MedContentTypePolicy | null> => {
    try {
      return await api.get<MedContentTypePolicy>(`/med-content-type-policies/${encodeURIComponent(docType)}`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  createMedContentTypePolicy: (body: MedContentTypePolicyCreateBody) =>
    api.post<MedContentTypePolicy>(`/med-content-type-policies`, body),
  updateMedContentTypePolicy: (docType: string, body: MedContentTypePolicyPatchBody) =>
    api.patch<MedContentTypePolicy>(`/med-content-type-policies/${encodeURIComponent(docType)}`, body),
  retireMedContentTypePolicy: (docType: string, reason: string) =>
    api.post<MedContentTypePolicy>(`/med-content-type-policies/${encodeURIComponent(docType)}/retire`, { reason }),
  distillMedContentBestPracticeFile: (docType: string, file: File) => {
    const form = new FormData()
    form.append('file', file, file.name)
    return api.upload<{
      jobId:     string
      uploadId:  string
      policyId:  string
      docType:   string
      version:   number
      fileName:  string
      sizeBytes: number
    }>(`/med-content-type-policies/${encodeURIComponent(docType)}/distill-best-practice-file`, form)
  },

  listMedContentAiPrompts: () =>
    api.get<{ prompts: MedContentAiPromptRecord[] }>(`/med-content-ai-prompts`),
  getMedContentAiPrompt: async (docType: string): Promise<MedContentAiPromptRecord | null> => {
    try {
      return await api.get<MedContentAiPromptRecord>(`/med-content-ai-prompts/${encodeURIComponent(docType)}`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  listMedContentAiPromptVersions: (docType: string) =>
    api.get<{ versions: MedContentAiPromptRecord[] }>(`/med-content-ai-prompts/${encodeURIComponent(docType)}/versions`),
  createMedContentAiPromptDraft: (body: MedContentAiPromptCreateBody) =>
    api.post<MedContentAiPromptRecord>(`/med-content-ai-prompts`, body),
  updateMedContentAiPromptDraft: (id: string, body: MedContentAiPromptPatchBody) =>
    api.patch<MedContentAiPromptRecord>(`/med-content-ai-prompts/${encodeURIComponent(id)}`, body),
  approveMedContentAiPrompt: (id: string) =>
    api.post<MedContentAiPromptRecord>(`/med-content-ai-prompts/${encodeURIComponent(id)}/approve`, {}),
  retireMedContentAiPrompt: (id: string, reason: string) =>
    api.post<MedContentAiPromptRecord>(`/med-content-ai-prompts/${encodeURIComponent(id)}/retire`, { reason }),

  listMedContentBestPracticeRecords: () =>
    api.get<{ records: MedContentBestPracticeRecord[] }>(`/med-content-best-practice-records`),
  listMedContentBestPracticeVersions: (docType: string) =>
    api.get<{ versions: MedContentBestPracticeRecord[] }>(`/med-content-best-practice-records/${encodeURIComponent(docType)}/versions`),
  updateMedContentBestPracticeDraft: (id: string, body: MedContentBestPracticePatchBody) =>
    api.patch<MedContentBestPracticeRecord>(`/med-content-best-practice-records/${encodeURIComponent(id)}`, body),
  approveMedContentBestPractice: (id: string) =>
    api.post<MedContentBestPracticeRecord>(`/med-content-best-practice-records/${encodeURIComponent(id)}/approve`, {}),
  retireMedContentBestPractice: (id: string, reason: string) =>
    api.post<MedContentBestPracticeRecord>(`/med-content-best-practice-records/${encodeURIComponent(id)}/retire`, { reason }),

  // --- Regulatory (Module D) policy stack ------------------------------
  listRegulatoryTypePolicies: () =>
    api.get<{ policies: RegulatoryTypePolicy[] }>(`/regulatory-type-policies`),
  getRegulatoryTypePolicy: async (docType: string): Promise<RegulatoryTypePolicy | null> => {
    try {
      return await api.get<RegulatoryTypePolicy>(`/regulatory-type-policies/${encodeURIComponent(docType)}`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  createRegulatoryTypePolicy: (body: RegulatoryTypePolicyCreateBody) =>
    api.post<RegulatoryTypePolicy>(`/regulatory-type-policies`, body),
  updateRegulatoryTypePolicy: (docType: string, body: RegulatoryTypePolicyPatchBody) =>
    api.patch<RegulatoryTypePolicy>(`/regulatory-type-policies/${encodeURIComponent(docType)}`, body),
  retireRegulatoryTypePolicy: (docType: string, reason: string) =>
    api.post<RegulatoryTypePolicy>(`/regulatory-type-policies/${encodeURIComponent(docType)}/retire`, { reason }),
  distillRegulatoryBestPracticeFile: (docType: string, file: File) => {
    const form = new FormData()
    form.append('file', file, file.name)
    return api.upload<{
      jobId:     string
      uploadId:  string
      policyId:  string
      docType:   string
      version:   number
      fileName:  string
      sizeBytes: number
    }>(`/regulatory-type-policies/${encodeURIComponent(docType)}/distill-best-practice-file`, form)
  },

  listRegulatoryAiPrompts: () =>
    api.get<{ prompts: RegulatoryAiPromptRecord[] }>(`/regulatory-ai-prompts`),
  getRegulatoryAiPrompt: async (docType: string): Promise<RegulatoryAiPromptRecord | null> => {
    try {
      return await api.get<RegulatoryAiPromptRecord>(`/regulatory-ai-prompts/${encodeURIComponent(docType)}`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  listRegulatoryAiPromptVersions: (docType: string) =>
    api.get<{ versions: RegulatoryAiPromptRecord[] }>(`/regulatory-ai-prompts/${encodeURIComponent(docType)}/versions`),
  createRegulatoryAiPromptDraft: (body: RegulatoryAiPromptCreateBody) =>
    api.post<RegulatoryAiPromptRecord>(`/regulatory-ai-prompts`, body),
  updateRegulatoryAiPromptDraft: (id: string, body: RegulatoryAiPromptPatchBody) =>
    api.patch<RegulatoryAiPromptRecord>(`/regulatory-ai-prompts/${encodeURIComponent(id)}`, body),
  approveRegulatoryAiPrompt: (id: string) =>
    api.post<RegulatoryAiPromptRecord>(`/regulatory-ai-prompts/${encodeURIComponent(id)}/approve`, {}),
  retireRegulatoryAiPrompt: (id: string, reason: string) =>
    api.post<RegulatoryAiPromptRecord>(`/regulatory-ai-prompts/${encodeURIComponent(id)}/retire`, { reason }),

  listRegulatoryBestPracticeRecords: () =>
    api.get<{ records: RegulatoryBestPracticeRecord[] }>(`/regulatory-best-practice-records`),
  listRegulatoryBestPracticeVersions: (docType: string) =>
    api.get<{ versions: RegulatoryBestPracticeRecord[] }>(`/regulatory-best-practice-records/${encodeURIComponent(docType)}/versions`),
  updateRegulatoryBestPracticeDraft: (id: string, body: RegulatoryBestPracticePatchBody) =>
    api.patch<RegulatoryBestPracticeRecord>(`/regulatory-best-practice-records/${encodeURIComponent(id)}`, body),
  approveRegulatoryBestPractice: (id: string) =>
    api.post<RegulatoryBestPracticeRecord>(`/regulatory-best-practice-records/${encodeURIComponent(id)}/approve`, {}),
  retireRegulatoryBestPractice: (id: string, reason: string) =>
    api.post<RegulatoryBestPracticeRecord>(`/regulatory-best-practice-records/${encodeURIComponent(id)}/retire`, { reason }),

  // --- Ideation (Module E) policy stack --------------------------------
  listIdeationTypePolicies: () =>
    api.get<{ policies: IdeationTypePolicy[] }>(`/ideation-type-policies`),
  getIdeationTypePolicy: async (docType: string): Promise<IdeationTypePolicy | null> => {
    try {
      return await api.get<IdeationTypePolicy>(`/ideation-type-policies/${encodeURIComponent(docType)}`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  createIdeationTypePolicy: (body: IdeationTypePolicyCreateBody) =>
    api.post<IdeationTypePolicy>(`/ideation-type-policies`, body),
  updateIdeationTypePolicy: (docType: string, body: IdeationTypePolicyPatchBody) =>
    api.patch<IdeationTypePolicy>(`/ideation-type-policies/${encodeURIComponent(docType)}`, body),
  retireIdeationTypePolicy: (docType: string, reason: string) =>
    api.post<IdeationTypePolicy>(`/ideation-type-policies/${encodeURIComponent(docType)}/retire`, { reason }),
  distillIdeationBestPracticeFile: (docType: string, file: File) => {
    const form = new FormData()
    form.append('file', file, file.name)
    return api.upload<{
      jobId:     string
      uploadId:  string
      policyId:  string
      docType:   string
      version:   number
      fileName:  string
      sizeBytes: number
    }>(`/ideation-type-policies/${encodeURIComponent(docType)}/distill-best-practice-file`, form)
  },

  listIdeationAiPrompts: () =>
    api.get<{ prompts: IdeationAiPromptRecord[] }>(`/ideation-ai-prompts`),
  getIdeationAiPrompt: async (docType: string): Promise<IdeationAiPromptRecord | null> => {
    try {
      return await api.get<IdeationAiPromptRecord>(`/ideation-ai-prompts/${encodeURIComponent(docType)}`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  listIdeationAiPromptVersions: (docType: string) =>
    api.get<{ versions: IdeationAiPromptRecord[] }>(`/ideation-ai-prompts/${encodeURIComponent(docType)}/versions`),
  createIdeationAiPromptDraft: (body: IdeationAiPromptCreateBody) =>
    api.post<IdeationAiPromptRecord>(`/ideation-ai-prompts`, body),
  updateIdeationAiPromptDraft: (id: string, body: IdeationAiPromptPatchBody) =>
    api.patch<IdeationAiPromptRecord>(`/ideation-ai-prompts/${encodeURIComponent(id)}`, body),
  approveIdeationAiPrompt: (id: string) =>
    api.post<IdeationAiPromptRecord>(`/ideation-ai-prompts/${encodeURIComponent(id)}/approve`, {}),
  retireIdeationAiPrompt: (id: string, reason: string) =>
    api.post<IdeationAiPromptRecord>(`/ideation-ai-prompts/${encodeURIComponent(id)}/retire`, { reason }),

  listIdeationBestPracticeRecords: () =>
    api.get<{ records: IdeationBestPracticeRecord[] }>(`/ideation-best-practice-records`),
  listIdeationBestPracticeVersions: (docType: string) =>
    api.get<{ versions: IdeationBestPracticeRecord[] }>(`/ideation-best-practice-records/${encodeURIComponent(docType)}/versions`),
  updateIdeationBestPracticeDraft: (id: string, body: IdeationBestPracticePatchBody) =>
    api.patch<IdeationBestPracticeRecord>(`/ideation-best-practice-records/${encodeURIComponent(id)}`, body),
  approveIdeationBestPractice: (id: string) =>
    api.post<IdeationBestPracticeRecord>(`/ideation-best-practice-records/${encodeURIComponent(id)}/approve`, {}),
  retireIdeationBestPractice: (id: string, reason: string) =>
    api.post<IdeationBestPracticeRecord>(`/ideation-best-practice-records/${encodeURIComponent(id)}/retire`, { reason }),

  listPublicationAiPrompts: () =>
    api.get<{ prompts: PublicationAiPromptRecord[] }>(`/publication-ai-prompts`),
  getPublicationAiPrompt: async (docType: string): Promise<PublicationAiPromptRecord | null> => {
    try {
      return await api.get<PublicationAiPromptRecord>(`/publication-ai-prompts/${encodeURIComponent(docType)}`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  listPublicationAiPromptVersions: (docType: string) =>
    api.get<{ versions: PublicationAiPromptRecord[] }>(`/publication-ai-prompts/${encodeURIComponent(docType)}/versions`),
  createPublicationAiPromptDraft: (body: PublicationAiPromptCreateBody) =>
    api.post<PublicationAiPromptRecord>(`/publication-ai-prompts`, body),
  updatePublicationAiPromptDraft: (id: string, body: PublicationAiPromptPatchBody) =>
    api.patch<PublicationAiPromptRecord>(`/publication-ai-prompts/${encodeURIComponent(id)}`, body),
  approvePublicationAiPrompt: (id: string) =>
    api.post<PublicationAiPromptRecord>(`/publication-ai-prompts/${encodeURIComponent(id)}/approve`, {}),
  retirePublicationAiPrompt: (id: string, reason: string) =>
    api.post<PublicationAiPromptRecord>(`/publication-ai-prompts/${encodeURIComponent(id)}/retire`, { reason }),

  listPublicationBestPracticeRecords: () =>
    api.get<{ records: PublicationBestPracticeRecord[] }>(`/publication-best-practice-records`),
  getPublicationBestPracticeRecord: async (docType: string): Promise<PublicationBestPracticeRecord | null> => {
    try {
      return await api.get<PublicationBestPracticeRecord>(`/publication-best-practice-records/${encodeURIComponent(docType)}`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  listPublicationBestPracticeVersions: (docType: string) =>
    api.get<{ versions: PublicationBestPracticeRecord[] }>(`/publication-best-practice-records/${encodeURIComponent(docType)}/versions`),
  updatePublicationBestPracticeDraft: (id: string, body: PublicationBestPracticePatchBody) =>
    api.patch<PublicationBestPracticeRecord>(`/publication-best-practice-records/${encodeURIComponent(id)}`, body),
  approvePublicationBestPractice: (id: string) =>
    api.post<PublicationBestPracticeRecord>(`/publication-best-practice-records/${encodeURIComponent(id)}/approve`, {}),
  retirePublicationBestPractice: (id: string, reason: string) =>
    api.post<PublicationBestPracticeRecord>(`/publication-best-practice-records/${encodeURIComponent(id)}/retire`, { reason }),
  // One-shot admin upload for the Best Practices parser: pick a PDF,
  // the server stores it as a platform DocumentUpload (projectId=null,
  // sourceCategory='best_practice') AND enqueues distillation in the
  // same request. UI polls the policy row for the digest to populate.
  distillBestPracticeFile: (docType: string, file: File) => {
    const form = new FormData()
    form.append('file', file, file.name)
    return api.upload<{
      jobId:     string
      uploadId:  string
      policyId:  string
      docType:   string
      version:   number
      fileName:  string
      sizeBytes: number
    }>(`/document-type-policies/${encodeURIComponent(docType)}/distill-best-practice-file`, form)
  },

  // --- Template Library (admin) ----------------------------------------
  // Create + edit + retire DocumentTemplate rows that drive the New
  // Document wizard, and the PDF parser that extracts the section
  // outline from an exemplar / final document.
  listDocumentTemplatesAdmin: () =>
    api.get<DocumentTemplateAdmin[]>('/document-templates'),
  createDocumentTemplate: (body: DocumentTemplateCreateBody) =>
    api.post<DocumentTemplateAdmin>('/document-templates', body),
  updateDocumentTemplate: (templateId: string, body: DocumentTemplateUpdateBody) =>
    api.patch<DocumentTemplateAdmin>(`/document-templates/${encodeURIComponent(templateId)}`, body),
  retireDocumentTemplate: (templateId: string) =>
    api.post<DocumentTemplateAdmin>(`/document-templates/${encodeURIComponent(templateId)}/retire`, {}),
  // One-shot PDF parser: multipart file + optional templateId (parse
  // into an existing template) OR type+label+description+framework
  // (parse into a freshly-created bare template). Enqueues
  // platform.distill_template on the server.
  parseTemplateFile: (
    file: File,
    target: { templateId: string } | { type: string; label: string; description: string; framework: string },
  ) => {
    const form = new FormData()
    form.append('file', file, file.name)
    const qs = new URLSearchParams()
    if ('templateId' in target) qs.set('templateId', target.templateId)
    else {
      qs.set('type',        target.type)
      qs.set('label',       target.label)
      qs.set('description', target.description)
      qs.set('framework',   target.framework)
    }
    return api.upload<{
      jobId:      string
      templateId: string
      uploadId:   string
      type:       string
      fileName:   string
      sizeBytes:  number
    }>(`/document-templates/parse-file?${qs.toString()}`, form)
  },
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

// --- AI readiness ---------------------------------------------------------
// Mirror of GET /ai/readiness. Consumed by the useAiReadiness() hook +
// the AiReadinessBanner that every admin AI screen (+ the New Document
// wizard's Draft-with-AI opt-in) consults before letting the user go.

export interface AiReadiness {
  configured:    boolean
  defaultModel:  string
  fallbackModel: string
  provider:      string            // 'anthropic' | 'openai' | …
  blockers:      string[]          // e.g. ['ANTHROPIC_API_KEY']
  setupPath:     string            // e.g. '/admin' — where the CTA sends the admin
}

// Auto-match ↔ explicit pin resolution for a policy's dependent assets.
// `auto`   → asset of the same docType the system found on its own
// `pinned` → the asset the admin explicitly overrode to (via policy.templateId etc.)
// `effective` → which one wins ('pinned' > 'auto' > 'none')
export interface ResolvedTemplateAsset {
  auto:      { id: string; label: string; version: number } | null
  pinned:    { id: string; label: string; version: number } | null
  effective: 'auto' | 'pinned' | 'none'
}
export interface ResolvedChecklistAsset {
  auto:      { id: string; version: number } | null
  pinned:    { id: string; version: number } | null
  effective: 'auto' | 'pinned' | 'none'
}
export interface ResolvedPolicyAssets {
  template:  ResolvedTemplateAsset
  checklist: ResolvedChecklistAsset
}

/** Per-doc-type input requirements the PM toggles on the Policy admin
 *  screen (migration 100). Each flag maps to one preflight blocker
 *  that the AI drafter runs before enqueueing. See
 *  apps/api/src/modules/clinical-writing/documents/ai-draft-preflight.ts. */
export interface PolicyRequirements {
  requireSources:  boolean
  requireTemplate: boolean
  /** Maps to the Create wizard's "Instructions for the AI drafter" field
   *  (persisted on documents.aiInstructions). When true, the field is
   *  required at Create time and the preflight re-checks it. */
  requirePurpose:  boolean
}

export const DEFAULT_POLICY_REQUIREMENTS: PolicyRequirements = {
  requireSources:  true,
  requireTemplate: true,
  requirePurpose:  true,
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
  requirements:        PolicyRequirements
  effectiveDate:       string
  supersededBy:        string | null
  retiredAt:           string | null
  retiredBy:           string | null
  retireReason:        string | null
  createdBy:           string
  updatedBy:           string
  createdAt:           string
  updatedAt:           string
  // Populated by the GET routes — the admin editor renders chips from
  // this instead of asking the user to type template/checklist ids
  // manually. Null-safe for older API builds that don't include it.
  resolved?:           ResolvedPolicyAssets
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
  requirements?:        PolicyRequirements
}

export interface DocumentTypePolicyCreateBody extends DocumentTypePolicyEditableFields {
  docType:    string
  // Optional on create — server defaults to a "configure in AI Prompts"
  // placeholder since the real SME text lives on AiPromptRecord, which
  // the policy auto-resolves per docType.
  smePrompt?: string
}

export type DocumentTypePolicyUpdateBody = DocumentTypePolicyEditableFields

export interface DocumentTypePolicyBumpBody extends DocumentTypePolicyEditableFields {
  smePrompt:    string        // required on bump (API Zod re-posts the whole body)
  changeReason: string
}

// --- AiPromptRecord (platform/ai-prompt) ---------------------------------
// Phase-1 pointer refactor (migration 73): AI prompts become their own
// versioned entity with an explicit draft → approved → retired workflow.
// A Document pins the id+version it was created under so later admin
// approvals don't rewrite how it gets drafted.
export type AiPromptStatus = 'draft' | 'approved' | 'retired'

export type AiPromptSectionRules = Record<string, Array<{ severity: 'must' | 'should' | 'nice'; text: string }>>

/** Cross-cutting rules extracted from smePrompt (migration 95). Shipped
 *  as GENERAL RULES on every AI call in place of the full SME prompt
 *  dump — admins see them beside sectionRules on the AI Prompts editor. */
export type CrossCuttingRule = { severity: 'must' | 'should' | 'nice'; text: string }

export interface AiPromptRecord {
  id:                 string
  docType:            string
  version:            number
  status:             AiPromptStatus
  smePrompt:          string
  sectionRules:       unknown                // parsed structure — see AiPromptSectionRules
  crossCuttingRules?: CrossCuttingRule[]     // optional — empty on legacy rows that pre-date migration 95
  supersededBy:       string | null
  effectiveDate:      string | null
  retiredAt:          string | null
  retireReason:       string | null
  approvedBy:         string | null
  approvedAt:         string | null
  createdBy:          string
  updatedBy:          string
  createdAt:          string
  updatedAt:          string
}

export interface AiPromptCreateBody {
  docType:            string
  smePrompt:          string
  sectionRules?:      AiPromptSectionRules
  crossCuttingRules?: CrossCuttingRule[]
}

export interface AiPromptPatchBody {
  smePrompt?:         string
  sectionRules?:      AiPromptSectionRules
  crossCuttingRules?: CrossCuttingRule[]
}

// --- License (platform/licensing, migration 92) -------------------------
// Per-install view of the signed licence JWT. Re-verified on every GET,
// so a stale response from the browser cache is still safe — the UI
// only ever sees state the server reaffirmed. `modules` + `features`
// here come from the signed claim, NEVER the DB snapshot columns.
export type LicenseState =
  | 'active'
  | 'expired'
  | 'invalid'
  | 'dev_mode_unlicensed'
  | 'auto_dev_unlicensed'   // no row + dev public key in use → all modules auto-granted
  | 'unlicensed'

export interface LicenseView {
  state:            LicenseState
  publicKeySource:  'env' | 'dev_fallback'
  installId:        string | null
  customerName:     string | null
  modules:          string[]
  features:         string[]
  issuedAt:         string | null
  expiry:           string | null
  importedAt:       string | null
  importedBy:       string | null
  daysToExpiry:     number | null
  invalidReason?:   string
  invalidDetail?:   string
}

// --- Platform Settings — Branding + Localisation (migration 93) --------
// Edited on Settings → Branding and Settings → Localisation. The server
// merges partial PATCH bodies with the current row so a single field
// update doesn't overwrite everything.

export interface BrandingSettings {
  companyName?:   string
  primaryColor?:  string                  // #RGB or #RRGGBB
  logoUrl?:       string
  emailFromName?: string
}

export interface LocalisationSettings {
  timezone?:   string                     // IANA, e.g. 'Asia/Kolkata'
  country?:    string                     // ISO-3166-1 alpha-2
  dateFormat?: string                     // e.g. 'yyyy-MM-dd'
  timeFormat?: '24h' | '12h'
  currency?:   string                     // ISO-4217
}

// Migration 96: voice + sso sections. API keys for voice providers and
// the OIDC client secret live on ExternalApiCredential rows — these
// JSONB blobs hold the non-secret config only.

export interface VoiceSettings {
  engine?:               string            // e.g. 'whisper', 'assemblyai', 'azure-speech'
  gdprJurisdiction?:     'EU' | 'UK' | 'US' | 'APAC'
  audioRetentionPolicy?: 'delete-immediately' | 'retain-30d' | 'retain-90d'
}

export interface SsoOidcSettings {
  issuerUrl: string
  clientId:  string
  scopes?:   string[]
}
export interface SsoSamlSettings {
  entityId:    string
  metadataUrl?: string
  acsUrl?:     string
}
export interface SsoSettings {
  enabled?:      boolean
  protocol?:     'oidc' | 'saml' | null
  emailDomains?: string[]
  oidc?:         SsoOidcSettings | null
  saml?:         SsoSamlSettings | null
}

export interface PlatformSettingsView {
  branding:     BrandingSettings
  localisation: LocalisationSettings
  voice:        VoiceSettings
  sso:          SsoSettings
  updatedBy:    string | null
  updatedAt:    string
}

// SectionTemplate types retired in migration 94 — per-section formatting
// rules now live inside DocumentTemplate.sections[] (see the Templates
// tab) with the shape `{ id, number, title, formatRules?, ... }`.

// --- BestPracticeRecord (platform/best-practice) --------------------------
// Phase-2 pointer refactor (migration 74): BP digest becomes its own
// versioned entity with the same draft → approved → retired workflow as
// AiPromptRecord. The distill worker writes to a draft row; admin
// reviews + approves.
export type BestPracticeStatus = 'draft' | 'approved' | 'retired'

export interface BestPracticeDigestShape {
  principles:     Array<{
    scope:    string                                     // 'whole-doc' | 'section:<key>'
    severity: 'must' | 'should' | 'nice'
    text:     string
  }>
  sourcePdfId?:   string
  distilledAt?:   string
  distilledModel?: string
}

export interface BestPracticeRecord {
  id:             string
  docType:        string
  version:        number
  status:         BestPracticeStatus
  digest:         BestPracticeDigestShape
  sourcePdfId:    string | null
  distilledAt:    string | null
  distilledModel: string | null
  supersededBy:   string | null
  effectiveDate:  string | null
  retiredAt:      string | null
  retireReason:   string | null
  approvedBy:     string | null
  approvedAt:     string | null
  createdBy:      string
  updatedBy:      string
  createdAt:      string
  updatedAt:      string
}

export interface BestPracticePatchBody {
  digest?: BestPracticeDigestShape
}

// --- Publication (Module B) policy stack — Phase M-B.1 (migration 75) ---
// Mirror shapes of DocumentTypePolicy / AiPromptRecord / BestPracticeRecord
// scoped to publication doctypes. Admin tab lives at
// /master-library/publication-policies.
export interface PublicationTypePolicy {
  id:                   string
  docType:              string
  version:              number
  isCurrent:            boolean
  templateId:           string | null
  checklistTemplateId:  string | null
  guidelineKey:         string | null
  smePrompt:            string
  bestPracticeDigest:   unknown
  sectionRules:         unknown
  effectiveDate:        string
  retiredAt:            string | null
  retiredBy:            string | null
  retireReason:         string | null
  supersededBy:         string | null
  createdBy:            string
  updatedBy:            string
  createdAt:            string
  updatedAt:            string
}

export interface PublicationTypePolicyCreateBody {
  docType:              string
  smePrompt:            string
  bestPracticeDigest?:  unknown
  sectionRules?:        Record<string, Array<{ severity: 'must' | 'should' | 'nice'; text: string }>>
  templateId?:          string | null
  checklistTemplateId?: string | null
  guidelineKey?:        string | null
}

export type PublicationTypePolicyPatchBody = Omit<PublicationTypePolicyCreateBody, 'docType' | 'smePrompt'> & {
  smePrompt?: string
}

export interface PublicationAiPromptRecord {
  id:            string
  docType:       string
  version:       number
  status:        AiPromptStatus
  smePrompt:     string
  sectionRules:  unknown
  supersededBy:  string | null
  effectiveDate: string | null
  retiredAt:     string | null
  retireReason:  string | null
  approvedBy:    string | null
  approvedAt:    string | null
  createdBy:     string
  updatedBy:     string
  createdAt:     string
  updatedAt:     string
}

export interface PublicationAiPromptCreateBody {
  docType:       string
  smePrompt:     string
  sectionRules?: AiPromptSectionRules
}

export interface PublicationAiPromptPatchBody {
  smePrompt?:    string
  sectionRules?: AiPromptSectionRules
}

export interface PublicationBestPracticeRecord {
  id:             string
  docType:        string
  version:        number
  status:         BestPracticeStatus
  digest:         BestPracticeDigestShape
  sourcePdfId:    string | null
  distilledAt:    string | null
  distilledModel: string | null
  supersededBy:   string | null
  effectiveDate:  string | null
  retiredAt:      string | null
  retireReason:   string | null
  approvedBy:     string | null
  approvedAt:     string | null
  createdBy:      string
  updatedBy:      string
  createdAt:      string
  updatedAt:      string
}

export interface PublicationBestPracticePatchBody {
  digest?: BestPracticeDigestShape
}

// --- Medical-content (Module C) policy stack — Phase M-C.1 (migration 79)
// Mirror shapes of PublicationTypePolicy / AiPromptRecord /
// BestPracticeRecord scoped to medical content doctypes. Admin tab
// lives at /master-library/med-content-policies.
export type MedContentComplianceTrack = 'promotional' | 'non_promotional' | 'cme' | 'advisory'

export interface MedContentTypePolicy {
  id:                   string
  docType:              string
  version:              number
  isCurrent:            boolean
  templateId:           string | null
  checklistTemplateId:  string | null
  complianceTrack:      MedContentComplianceTrack | null
  reviewTierFormula:    string | null
  smePrompt:            string
  bestPracticeDigest:   unknown
  sectionRules:         unknown
  effectiveDate:        string
  retiredAt:            string | null
  retiredBy:            string | null
  retireReason:         string | null
  supersededBy:         string | null
  createdBy:            string
  updatedBy:            string
  createdAt:            string
  updatedAt:            string
}

export interface MedContentTypePolicyCreateBody {
  docType:              string
  smePrompt:            string
  bestPracticeDigest?:  unknown
  sectionRules?:        Record<string, Array<{ severity: 'must' | 'should' | 'nice'; text: string }>>
  templateId?:          string | null
  checklistTemplateId?: string | null
  complianceTrack?:     MedContentComplianceTrack | null
  reviewTierFormula?:   string | null
}

export type MedContentTypePolicyPatchBody = Omit<MedContentTypePolicyCreateBody, 'docType' | 'smePrompt'> & {
  smePrompt?: string
}

export interface MedContentAiPromptRecord {
  id:            string
  docType:       string
  version:       number
  status:        AiPromptStatus
  smePrompt:     string
  sectionRules:  unknown
  supersededBy:  string | null
  effectiveDate: string | null
  retiredAt:     string | null
  retireReason:  string | null
  approvedBy:    string | null
  approvedAt:    string | null
  createdBy:     string
  updatedBy:     string
  createdAt:     string
  updatedAt:     string
}

export interface MedContentAiPromptCreateBody {
  docType:       string
  smePrompt:     string
  sectionRules?: AiPromptSectionRules
}

export interface MedContentAiPromptPatchBody {
  smePrompt?:    string
  sectionRules?: AiPromptSectionRules
}

export interface MedContentBestPracticeRecord {
  id:             string
  docType:        string
  version:        number
  status:         BestPracticeStatus
  digest:         BestPracticeDigestShape
  sourcePdfId:    string | null
  distilledAt:    string | null
  distilledModel: string | null
  supersededBy:   string | null
  effectiveDate:  string | null
  retiredAt:      string | null
  retireReason:   string | null
  approvedBy:     string | null
  approvedAt:     string | null
  createdBy:      string
  updatedBy:      string
  createdAt:      string
  updatedAt:      string
}

export interface MedContentBestPracticePatchBody {
  digest?: BestPracticeDigestShape
}

// --- Regulatory (Module D) policy types -------------------------------

export type RegulatoryTrack = 'ind' | 'nda' | 'maa' | 'bla' | 'variation' | 'other'

export interface RegulatoryTypePolicy {
  id:                   string
  docType:              string
  version:              number
  isCurrent:            boolean
  templateId:           string | null
  checklistTemplateId:  string | null
  regulatoryTrack:      RegulatoryTrack | null
  reviewTierFormula:    string | null
  smePrompt:            string
  bestPracticeDigest:   unknown
  sectionRules:         unknown
  effectiveDate:        string
  retiredAt:            string | null
  retiredBy:            string | null
  retireReason:         string | null
  supersededBy:         string | null
  createdBy:            string
  updatedBy:            string
  createdAt:            string
  updatedAt:            string
}

export interface RegulatoryTypePolicyCreateBody {
  docType:              string
  smePrompt:            string
  bestPracticeDigest?:  unknown
  sectionRules?:        Record<string, Array<{ severity: 'must' | 'should' | 'nice'; text: string }>>
  templateId?:          string | null
  checklistTemplateId?: string | null
  regulatoryTrack?:     RegulatoryTrack | null
  reviewTierFormula?:   string | null
}

export type RegulatoryTypePolicyPatchBody = Omit<RegulatoryTypePolicyCreateBody, 'docType' | 'smePrompt'> & {
  smePrompt?: string
}

export interface RegulatoryAiPromptRecord {
  id:            string
  docType:       string
  version:       number
  status:        AiPromptStatus
  smePrompt:     string
  sectionRules:  unknown
  supersededBy:  string | null
  effectiveDate: string | null
  retiredAt:     string | null
  retireReason:  string | null
  approvedBy:    string | null
  approvedAt:    string | null
  createdBy:     string
  updatedBy:     string
  createdAt:     string
  updatedAt:     string
}

export interface RegulatoryAiPromptCreateBody {
  docType:       string
  smePrompt:     string
  sectionRules?: AiPromptSectionRules
}

export interface RegulatoryAiPromptPatchBody {
  smePrompt?:    string
  sectionRules?: AiPromptSectionRules
}

export interface RegulatoryBestPracticeRecord {
  id:             string
  docType:        string
  version:        number
  status:         BestPracticeStatus
  digest:         BestPracticeDigestShape
  sourcePdfId:    string | null
  distilledAt:    string | null
  distilledModel: string | null
  supersededBy:   string | null
  effectiveDate:  string | null
  retiredAt:      string | null
  retireReason:   string | null
  approvedBy:     string | null
  approvedAt:     string | null
  createdBy:      string
  updatedBy:      string
  createdAt:      string
  updatedAt:      string
}

export interface RegulatoryBestPracticePatchBody {
  digest?: BestPracticeDigestShape
}

// --- Ideation (Module E) policy types ---------------------------------

export type IdeationChannelHint = 'kol' | 'hcp' | 'patient' | 'press'

export interface IdeationTypePolicy {
  id:                   string
  docType:              string
  version:              number
  isCurrent:            boolean
  templateId:           string | null
  checklistTemplateId:  string | null
  channelHint:          IdeationChannelHint | null
  reviewTierFormula:    string | null
  smePrompt:            string
  bestPracticeDigest:   unknown
  sectionRules:         unknown
  effectiveDate:        string
  retiredAt:            string | null
  retiredBy:            string | null
  retireReason:         string | null
  supersededBy:         string | null
  createdBy:            string
  updatedBy:            string
  createdAt:            string
  updatedAt:            string
}

export interface IdeationTypePolicyCreateBody {
  docType:              string
  smePrompt:            string
  bestPracticeDigest?:  unknown
  sectionRules?:        Record<string, Array<{ severity: 'must' | 'should' | 'nice'; text: string }>>
  templateId?:          string | null
  checklistTemplateId?: string | null
  channelHint?:         IdeationChannelHint | null
  reviewTierFormula?:   string | null
}

export type IdeationTypePolicyPatchBody = Omit<IdeationTypePolicyCreateBody, 'docType' | 'smePrompt'> & {
  smePrompt?: string
}

export interface IdeationAiPromptRecord {
  id:            string
  docType:       string
  version:       number
  status:        AiPromptStatus
  smePrompt:     string
  sectionRules:  unknown
  supersededBy:  string | null
  effectiveDate: string | null
  retiredAt:     string | null
  retireReason:  string | null
  approvedBy:    string | null
  approvedAt:    string | null
  createdBy:     string
  updatedBy:     string
  createdAt:     string
  updatedAt:     string
}

export interface IdeationAiPromptCreateBody {
  docType:       string
  smePrompt:     string
  sectionRules?: AiPromptSectionRules
}

export interface IdeationAiPromptPatchBody {
  smePrompt?:    string
  sectionRules?: AiPromptSectionRules
}

export interface IdeationBestPracticeRecord {
  id:             string
  docType:        string
  version:        number
  status:         BestPracticeStatus
  digest:         BestPracticeDigestShape
  sourcePdfId:    string | null
  distilledAt:    string | null
  distilledModel: string | null
  supersededBy:   string | null
  effectiveDate:  string | null
  retiredAt:      string | null
  retireReason:   string | null
  approvedBy:     string | null
  approvedAt:     string | null
  createdBy:      string
  updatedBy:      string
  createdAt:      string
  updatedAt:      string
}

export interface IdeationBestPracticePatchBody {
  digest?: BestPracticeDigestShape
}

// --- Template Library admin shape ---------------------------------------
// Full admin shape returned by GET /document-templates. The wizard's own
// DocumentTemplate type (api/documents.ts) is a subset.

export interface DocumentTemplateSection {
  id:      string
  number:  string
  title:   string
  usOnly?: boolean
  // Richer templates (the ICH M11 protocol) also carry the hierarchy and writing guidance. Optional, and
  // any other field is kept as is: editing a section list must not strip them.
  level?:        number
  parentId?:     string | null
  style?:        string | null
  instructions?: string | null
  guidance?:     string | null
  templateText?: string | null
  placeholder?:  string | null
  defaultContentHtml?: string | null
  hasSubsections?: boolean
  tables?:       Array<Record<string, unknown>>
  [extra: string]: unknown
}

export interface DocumentTemplateAdmin {
  id:                       string
  type:                     string
  label:                    string
  description:              string
  framework:                string
  sections:                 DocumentTemplateSection[]
  /** Page layout, styles, standards, front / back matter (richer templates only); null otherwise. */
  spec?:                    Record<string, unknown> | null
  requiredSourceCategories: string[]
  version:                  number
  isCurrent:                boolean
  retiredAt:                string | null
  createdAt:                string
  createdBy:                string
  updatedAt:                string
}

export interface DocumentTemplateCreateBody {
  type:                      string
  label:                     string
  description:               string
  framework:                 string
  sections?:                 DocumentTemplateSection[]
  spec?:                     Record<string, unknown> | null
  requiredSourceCategories?: string[]
}

export type DocumentTemplateUpdateBody = Partial<Omit<DocumentTemplateCreateBody, 'type'>>
