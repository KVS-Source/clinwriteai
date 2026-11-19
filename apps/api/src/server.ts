// Aurora/ClinWrite API — Fastify entrypoint.
//
// Phase 1 scaffold (per docs/architecture-implementation-plan.md Phase 1).
// Boots cleanly against a Postgres from Testcontainers or docker-compose.local.yml.
// Wires config + secrets provider; subsequent commits add auth, audit plugin,
// Prisma client, OpenAPI, Zod routes.

import 'dotenv/config'
import Fastify from 'fastify'
import { loadEnv } from './config/env.js'
import { createSecretsProvider } from './config/secrets.js'

async function buildServer() {
  const env = loadEnv()

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV === 'development'
        ? { target: 'pino-pretty' }
        : undefined,
    },
    requestIdHeader: 'x-request-id',
    disableRequestLogging: false,
    // Default is 100; raise it so base64url-encoded blob keys fit as a
    // single :keyB64 path param (/blob/local/:bucket/:keyB64). Our keys
    // encode <projectId>/<prefix>/<date>/<rand>.<ext> which decodes to
    // ~70-90 bytes but base64-encodes to ~100-130 chars.
    maxParamLength: 512,
    // nginx proxies from loopback (infra/standalone/nginx/platform.conf) and
    // sets X-Forwarded-For. Trusting only that hop makes request.ip the real
    // client — otherwise every user shares one rate-limit bucket and audit
    // rows record 127.0.0.1.
    trustProxy: ['127.0.0.1', '::1'],
  })

  // ---- Decorate with providers (DI pattern) ----
  const secrets = createSecretsProvider(env)
  app.decorate('env', env)
  app.decorate('secrets', secrets)

  // ---- Health + readiness ----
  app.get('/health', async () => ({
    status: 'ok',
    service: env.OTEL_SERVICE_NAME,
    version: process.env.npm_package_version ?? '0.1.0',
    uptime: process.uptime(),
    phase: 'Phase 1 scaffold',
  }))

  app.get('/ready', async (_request, reply) => {
    // Readiness probe: all backing services reachable? Container orchestrators
    // use this to decide if traffic can route; k8s/nginx won't forward requests
    // until this returns 200. Each check has a short per-call timeout so a
    // hung dependency doesn't hold the probe open past the orchestrator's
    // own timeout (typically 5s).
    //
    // The probe deliberately does NOT fail on blob backend errors in local
    // mode — the local filesystem check is trivially always-up, and a disk
    // full / permissions issue surfaces through the blob metrics instead.
    const started = Date.now()
    const checks: Record<string, { ok: boolean; latencyMs: number; error?: string }> = {}

    async function check<T>(name: string, fn: () => Promise<T>, timeoutMs = 2000): Promise<void> {
      const t0 = Date.now()
      try {
        await Promise.race([
          fn(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
        ])
        checks[name] = { ok: true, latencyMs: Date.now() - t0 }
      } catch (err) {
        checks[name] = {
          ok: false,
          latencyMs: Date.now() - t0,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }

    // Postgres — a cheap SELECT 1 confirms the connection pool is live.
    await check('postgres', async () => {
      await app.prisma.$queryRaw`SELECT 1`
    })

    // Redis — ping. If the queue plugin's connection has been severed
    // (Redis restart), ioredis auto-reconnects; a successful ping means
    // the reconnect has settled.
    await check('redis', async () => {
      const result = await app.redis.ping()
      if (result !== 'PONG') throw new Error(`unexpected ping response: ${result}`)
    })

    const allOk = Object.values(checks).every(c => c.ok)
    const totalMs = Date.now() - started
    if (!allOk) {
      return reply.code(503).send({ ready: false, totalMs, checks })
    }
    return { ready: true, totalMs, checks }
  })

  // ---------- Security + utility plugins ----------
  // Order matters: cookie before auth, cors + helmet before any routes, rate-limit
  // before heavy handlers. Sensible gives us app.httpErrors.* for consistent 4xx.
  await app.register(import('@fastify/cookie'))
  await app.register(import('@fastify/cors'), {
    origin: env.CORS_ORIGIN,
    credentials: env.CORS_CREDENTIALS,
    // Paged lists send their total and next-page cursor in headers; a cross-origin
    // browser can only read them if they are exposed here (Master Library, CW-061).
    exposedHeaders: ['X-Total-Count', 'X-Next-Cursor', 'Content-Disposition', 'Retry-After'],
  })
  await app.register(import('@fastify/helmet'), { contentSecurityPolicy: false })
  await app.register(import('@fastify/sensible'))
  // Multipart used by document upload (Module A). 50MB limit matches
  // the API contract; buckets live in BlobStorage, not inline in Fastify.
  await app.register(import('@fastify/multipart'), {
    limits: {
      fileSize: 50 * 1024 * 1024,
      files: 1,
    },
  })
  // Rate limit registration moved below queue so we can pass the shared
  // Redis connection as the backing store (see "Rate limit (Redis-backed)"
  // section). In-memory fallback persisted here if queue plugin failed
  // to decorate app.redis — e.g. test contexts that bypass queue entirely.

  // ---------- OpenAPI docs ----------
  if (env.NODE_ENV !== 'production' || env.FEATURE_OPENAPI_DOCS) {
    await app.register(import('@fastify/swagger'), {
      openapi: {
        info: {
          title: 'Aurora/ClinWrite Platform API',
          description: 'Phase 1 scaffold. Routes defined by Fastify; schemas added route-by-route.',
          version: process.env.npm_package_version ?? '0.1.0',
        },
        servers: [{ url: `http://${env.HOST}:${env.PORT}` }],
        components: {
          securitySchemes: {
            sessionCookie: { type: 'apiKey', in: 'cookie', name: 'aurora_session' },
          },
        },
      },
    })
    await app.register(import('@fastify/swagger-ui'), { routePrefix: '/docs' })
  }

  // ---------- Metrics (before everything else so HTTP metrics catch every route) ----------
  await app.register(import('./modules/platform/metrics/plugin.js'))

  // ---------- Core data + audit plumbing ----------
  await app.register(import('./prisma/plugin.js'))
  await app.register(import('./audit/plugin.js'))
  // Polymorphic edit history — one service used by every module that
  // tracks revertable content edits (Module A sections, Module E atomised
  // content; Modules B/D/PPT come later). Must register AFTER prisma.
  await app.register(import('./modules/platform/edit-history/plugin.js'))

  // ---------- Queue (BullMQ producer side; worker runs in apps/worker) ----------
  await app.register(import('./modules/platform/queue/plugin.js'))

  // ---------- Email adapter (noop by default; log / console / future
  //            Postmark / SES selected via EMAIL_PROVIDER env) ----------
  await app.register(import('./modules/platform/email/plugin.js'))

  // ---------- SMS adapter (noop by default; log / console / twilio-
  //            stub selected via SMS_PROVIDER env) ----------
  await app.register(import('./modules/platform/sms/plugin.js'))

  // ---------- Social publish adapter (noop by default; log / console /
  //            per-platform stubs selected via SOCIAL_PUBLISH_PROVIDER) ----------
  await app.register(import('./modules/platform/social-publish/plugin.js'))

  // ---------- Public KOL review (no auth — token in URL path is the
  //            auth; rate-limited per route; mounted at /public/ so
  //            the WAF can scope aggressive rules to this prefix) ----------
  const { kolReviewPublicRoutes } = await import('./modules/ideation/kol-review-public/routes.js')
  await app.register(kolReviewPublicRoutes)

  // ---------- Rate limit (Redis-backed) ----------
  const { rateLimitCounting } = await import('./modules/platform/rate-limit.js')
  // Shares the queue plugin's ioredis connection via app.redis so multi-
  // instance deployments converge on a single counter per key. Without
  // this, running N replicas effectively lets a client make N*100 req/min
  // because each instance tracks its own counter.
  await app.register(import('@fastify/rate-limit'), {
    // Who is counted and how much they may do: see rate-limit.ts.
    ...rateLimitCounting,
    redis: app.redis,
    // Namespace in Redis so the counter keys are distinguishable from
    // BullMQ job keys (both use the same connection).
    nameSpace: 'ratelimit:',
    // If Redis is unreachable at request time, don't 500 — let the request
    // through. Alert fires via BullMQ queue-depth metric which proxies for
    // Redis liveness.
    skipOnError: true,
    // continueExceeding stays off: it renews the block on every request made
    // while limited, and the editor's presence/lock heartbeats would keep a
    // limited user locked out indefinitely.
  })

  // ---------- Blob storage (local filesystem for dev; S3-compatible for prod) ----------
  await app.register(import('./modules/platform/blob/plugin.js'))

  // ---------- Auth (SSO + JWT session + RBAC) ----------
  await app.register(import('./auth/plugin.js'))
  // Every :documentId route answers 404 to someone who may not see the document (CW-020).
  await app.register(import('./auth/document-access.js'))

  // ---------- Realtime (Socket.io presence channel) ----------
  await app.register(import('./modules/platform/realtime/plugin.js'))

  // ---------- Platform routes ----------
  const { projectRoutes } = await import('./modules/projects/routes.js')
  const { userRoutes } = await import('./modules/platform/users/routes.js')
  await app.register(projectRoutes, { prefix: '/projects' })
  await app.register(userRoutes, { prefix: '/admin/users' })

  // External API credentials — admin-managed secrets for the Admin
  // Panel's External APIs tab (Configure modal). GET lists masked
  // credentials; PUT /:apiId upserts one connector; DELETE clears.
  const { externalApiCredentialsRoutes } = await import('./modules/platform/external-api-credentials/routes.js')
  await app.register(externalApiCredentialsRoutes, { prefix: '/admin/external-apis' })

  // ---------- Tenant Admin (Arc 3 of docs/pivot-plan.md) ----------
  // Four plugins, all mounted at root — path shapes mix /admin/tenants/*,
  // /admin/memberships/*, /admin/sso-connections/*, /admin/audit*.
  const { tenantsRoutes } = await import('./modules/platform/tenant-admin/tenants/routes.js')
  const { membershipsRoutes } = await import('./modules/platform/tenant-admin/memberships/routes.js')
  const { ssoRoutes } = await import('./modules/platform/tenant-admin/sso/routes.js')
  const { auditViewerRoutes } = await import('./modules/platform/tenant-admin/audit/routes.js')
  await app.register(tenantsRoutes)
  await app.register(membershipsRoutes)
  await app.register(ssoRoutes)
  await app.register(auditViewerRoutes)

  // ---------- DPDPA 2023 (Arc 7 + 10 of docs/pivot-plan.md) ----------
  // Decorates app.dpdpa (consent gate) + app.transfer (cross-border
  // gate) + registers /admin/dpdpa/consents, /dpdpa/requests (public
  // intake), /admin/dpdpa/requests, /admin/dpdpa/transfer-allowlist.
  await app.register(import('./modules/platform/dpdpa/plugin.js'))

  // ---------- Subscriptions (Arc 8.4) ----------
  const { subscriptionRoutes } = await import('./modules/platform/subscriptions/routes.js')
  await app.register(subscriptionRoutes)

  // ---------- Admin Panel config (sPM04) ----------
  const { adminConfigRoutes } = await import('./modules/platform/config/routes.js')
  await app.register(adminConfigRoutes)

  // ---------- Module A — Clinical Writing ----------
  const { documentsProjectScopedRoutes, documentsRoutes } =
    await import('./modules/clinical-writing/documents/routes.js')
  // documentsProjectScopedRoutes handles /projects/:projectId/documents paths;
  // documentsRoutes handles /documents/:documentId paths. Two mount points,
  // one plugin file so the handlers share the service instance.
  await app.register(documentsProjectScopedRoutes, { prefix: '/projects' })
  await app.register(documentsRoutes, { prefix: '/documents' })

  // Document templates — section skeleton + source-category rules per
  // deliverable type. Powers the New Document wizard; mutations deferred
  // to the Admin edit screen (seeded on deploy for now).
  const { documentTemplatesRoutes } =
    await import('./modules/clinical-writing/document-templates/routes.js')
  await app.register(documentTemplatesRoutes, { prefix: '/document-templates' })

  // Document type policies — SME prompt + best-practice digest +
  // template / checklist / ICH links per doc type. Reads are open to
  // any authenticated caller (New Document wizard previews it);
  // writes are super-admin only (see document-type-policy/routes.ts).
  const { documentTypePolicyRoutes } =
    await import('./modules/platform/document-type-policy/routes.js')
  await app.register(documentTypePolicyRoutes, { prefix: '/document-type-policies' })

  // AI Prompt — first-class versioned entity (Phase 1 of the pointer
  // refactor). AI assembly picks the latest approved row by docType
  // (or a pinned row on Document).
  const { aiPromptRoutes } = await import('./modules/platform/ai-prompt/routes.js')
  await app.register(aiPromptRoutes, { prefix: '/ai-prompts' })

  // Best-Practice Record — first-class versioned entity (Phase 2 of the
  // pointer refactor). AI assembly picks the latest approved digest by
  // docType (or a pinned row on Document). Distillation still flows
  // through /document-type-policies/:docType/distill-best-practice-file
  // — the worker writes to a draft BestPracticeRecord for admin review.
  const { bestPracticeRoutes } = await import('./modules/platform/best-practice/routes.js')
  await app.register(bestPracticeRoutes, { prefix: '/best-practice-records' })

  // Section Template — per-section formatting JSON (migration 90). Admin
  // authors font/paragraph/list/table rules per (docType, sectionKey);
  // document creation snapshots the approved row onto each section so
  // AI rewrites preserve the styling. Replaces BP's role as the vehicle
  // for AI-steering formatting hints (BP is now author-guidance only).
  const { sectionTemplateRoutes } = await import('./modules/platform/section-template/routes.js')
  await app.register(sectionTemplateRoutes, { prefix: '/section-templates' })

  // Licensing (migration 92) — per-install signed-JWT licence. IT admin
  // imports the token on Settings → Licensing; the verifier re-reads
  // the token on every GET so a tampered DB row doesn't widen trust.
  const { licenseRoutes } = await import('./modules/platform/licensing/routes.js')
  await app.register(licenseRoutes, { prefix: '/license' })

  // Scientific-Writing Policy admin (Phase M-B.1, migration 75) — mirror
  // of the clinical-writing policy stack scoped to publication doctypes
  // (manuscript_full_research, review_systematic, abstract, poster,
  // letter, pls, …). Writes are PM-only + Module B gated.
  const {
    publicationTypePolicyRoutes,
    publicationAiPromptRoutes,
    publicationBestPracticeRoutes,
  } = await import('./modules/scientific-writing/policy/routes.js')
  await app.register(publicationTypePolicyRoutes,    { prefix: '/publication-type-policies' })
  await app.register(publicationAiPromptRoutes,      { prefix: '/publication-ai-prompts' })
  await app.register(publicationBestPracticeRoutes,  { prefix: '/publication-best-practice-records' })

  // Medical-Writing Policy admin (Phase M-C.1, migration 79) — mirror
  // of the publication policy stack scoped to medical content doctypes
  // (hcp_slide_deck, mi_letter, pil, cme_module, disease_dossier,
  // eu_ctr_pls, advisory_report). Writes PM-only + Module C gated.
  const {
    medContentTypePolicyRoutes,
    medContentAiPromptRoutes,
    medContentBestPracticeRoutes,
  } = await import('./modules/medical-writing/policy/routes.js')
  await app.register(medContentTypePolicyRoutes,    { prefix: '/med-content-type-policies' })
  await app.register(medContentAiPromptRoutes,      { prefix: '/med-content-ai-prompts' })
  await app.register(medContentBestPracticeRoutes,  { prefix: '/med-content-best-practice-records' })

  // Regulatory-Writing Policy admin (Phase M-D.1, migration 84) — mirror
  // of the medical-content policy stack scoped to regulatory doctypes
  // (ctd_m2_3_qos, ctd_m2_4_nonclin_overview, ctd_m2_5_clinical_overview,
  // ctd_m2_7_clinical_summary, cover_letter, ha_response_narrative, etc.).
  // Writes PM-only + Module D gated.
  const {
    regulatoryTypePolicyRoutes,
    regulatoryAiPromptRoutes,
    regulatoryBestPracticeRoutes,
  } = await import('./modules/regulatory-writing/policy/routes.js')
  await app.register(regulatoryTypePolicyRoutes,    { prefix: '/regulatory-type-policies' })
  await app.register(regulatoryAiPromptRoutes,      { prefix: '/regulatory-ai-prompts' })
  await app.register(regulatoryBestPracticeRoutes,  { prefix: '/regulatory-best-practice-records' })

  // Ideation Policy admin (Phase M-E.1, migration 87) — mirror of the
  // regulatory policy stack scoped to ideation / KOL engagement
  // doctypes (kol_engagement_brief, patient_story, hcp_insight_report,
  // medical_affairs_narrative, disease_awareness_brief, press_release).
  // Writes PM-only + Module E gated.
  const {
    ideationTypePolicyRoutes,
    ideationAiPromptRoutes,
    ideationBestPracticeRoutes,
  } = await import('./modules/ideation/policy/routes.js')
  await app.register(ideationTypePolicyRoutes,   { prefix: '/ideation-type-policies' })
  await app.register(ideationAiPromptRoutes,     { prefix: '/ideation-ai-prompts' })
  await app.register(ideationBestPracticeRoutes, { prefix: '/ideation-best-practice-records' })

  const { documentsUploadRoutes } = await import('./modules/clinical-writing/documents/upload-routes.js')
  await app.register(documentsUploadRoutes, { prefix: '/projects' })
  const { documentsSourceRoutes } = await import('./modules/clinical-writing/documents/source-routes.js')
  await app.register(documentsSourceRoutes, { prefix: '/projects' })
  const { documentsReferencesRoutes } = await import('./modules/clinical-writing/documents/references-routes.js')
  await app.register(documentsReferencesRoutes, { prefix: '/documents' })

  // Document Brief — compact derived summary carried on every AI
  // section-rewrite call. Read-only route; mutations happen as
  // fire-and-forget regen from the document/section/protocol-metadata
  // mutation paths.
  const { documentBriefRoutes } = await import('./modules/clinical-writing/document-brief/routes.js')
  await app.register(documentBriefRoutes, { prefix: '/documents' })

  const { voiceNotesRoutes } = await import('./modules/clinical-writing/voice-notes/routes.js')
  await app.register(voiceNotesRoutes, { prefix: '/documents' })

  const { presenceRoutes } = await import('./modules/clinical-writing/presence/routes.js')
  await app.register(presenceRoutes, { prefix: '/documents' })

  const { sectionLockRoutes } = await import('./modules/clinical-writing/section-locks/routes.js')
  await app.register(sectionLockRoutes, { prefix: '/documents' })

  const { checklistRoutes, projectChecklistRoutes, checklistTemplateAdminRoutes } = await import('./modules/clinical-writing/checklist/routes.js')
  await app.register(checklistRoutes, { prefix: '/documents' })
  // R-only slice of the checklist (reorder, submit-gate preview, submit-with-reason).
  // Separate file to keep routes.ts untouched during the ongoing admin-template WIP.
  const { checklistRActionRoutes } = await import('./modules/clinical-writing/checklist/r-actions.js')
  await app.register(checklistRActionRoutes, { prefix: '/documents' })
  // Project-level rollup for the Clinical Writing home page's "Checklist
  // status" box. Read-only — never materialises instances, so visits are safe.
  await app.register(projectChecklistRoutes, { prefix: '/projects' })
  // Admin-only template management (approve/lock). UI arrives in phase 4;
  // the endpoint ships now so phase-2 gates can rely on locked templates.
  await app.register(checklistTemplateAdminRoutes, { prefix: '/checklist-templates' })

  const { commentsRoutes, projectCommentsRoutes } = await import('./modules/clinical-writing/comments/routes.js')
  await app.register(commentsRoutes, { prefix: '/documents' })
  await app.register(projectCommentsRoutes, { prefix: '/projects' })

  const { crmRoutes } = await import('./modules/clinical-writing/crm/routes.js')
  // Mixed path shapes (/documents/:documentId/crm and /crm/:meetingId/...)
  // kept in one plugin so handlers share nextCrmRef. Registered at root —
  // the handlers use full paths.
  await app.register(crmRoutes)

  const { tlfRoutes } = await import('./modules/clinical-writing/tlf/routes.js')
  // Project-scoped, package-scoped, item-scoped and document-scoped paths —
  // registered at root with full paths, same pattern as peer-review + crm.
  await app.register(tlfRoutes)

  const { ichE3Routes } = await import('./modules/clinical-writing/ich-e3/routes.js')
  // Document-scoped: GET report + waive/unwaive. Replaces the mock-only
  // /documents/:id/ich-e3 the frontend used to hit.
  await app.register(ichE3Routes, { prefix: '/documents' })

  const { signatureRoutes } = await import('./modules/clinical-writing/signatures/routes.js')
  // Part 11 e-sig: /documents/:id/signature-chains, /signature-chains/:id,
  // /signature-records/:id/sign — mixed shapes, registered at root with
  // full paths.
  await app.register(signatureRoutes)

  // ---------- Module B — Scientific Writing ----------
  const { publicationsProjectScopedRoutes, publicationsRoutes } =
    await import('./modules/scientific-writing/publications/routes.js')
  await app.register(publicationsProjectScopedRoutes, { prefix: '/projects' })
  await app.register(publicationsRoutes, { prefix: '/publications' })

  // Phase M-B.2 — publication versioning, section-content save, section
  // locks. Mirrors clinical-writing section-locks + document-version
  // routes for publications.
  const { publicationSectionRoutes } =
    await import('./modules/scientific-writing/publications/section-routes.js')
  await app.register(publicationSectionRoutes, { prefix: '/publications' })

  // Phase M-B.4 — publication section AI-suggest (tighten / explain /
  // edit / custom / draft_from_source). Mirror of clinical /ai-suggest
  // with publication policy + source auto-attach + grounding rules.
  const { publicationAiSuggestRoutes } =
    await import('./modules/scientific-writing/publications/ai-suggest-routes.js')
  await app.register(publicationAiSuggestRoutes, { prefix: '/publications' })

  // Phase M-B.5 — publication section comments (threaded, @mention
  // notifications, R/A/C gating).
  const { publicationCommentRoutes } =
    await import('./modules/scientific-writing/publications/comment-routes.js')
  await app.register(publicationCommentRoutes, { prefix: '/publications' })

  const { citationsRoutes, pubmedRoutes } = await import('./modules/scientific-writing/citations/routes.js')
  await app.register(citationsRoutes, { prefix: '/publications' })
  // pubmedRoutes mounts at root — the client's citation-search endpoint
  // is GET /pubmed/search (not /publications/pubmed/search).
  await app.register(pubmedRoutes)

  const { authorsRoutes } = await import('./modules/scientific-writing/authors/routes.js')
  await app.register(authorsRoutes, { prefix: '/publications' })

  const { submissionChecksRoutes } = await import('./modules/scientific-writing/submission-checks/routes.js')
  await app.register(submissionChecksRoutes, { prefix: '/publications' })

  const { peerReviewRoutes } = await import('./modules/scientific-writing/peer-review/routes.js')
  // Mixed path shapes (/publications/:id/review-rounds and /round-comments/:id)
  // kept in one plugin so handlers share snapshotLetterVersion. Registered
  // at root — the handlers use full paths.
  await app.register(peerReviewRoutes)

  const { congressRoutes } = await import('./modules/scientific-writing/congress/routes.js')
  await app.register(congressRoutes, { prefix: '/publications' })

  // Slide deck backend (sPM-slide-deck-backend) — real backing for the
  // Module B SlidedeckGenerator UI + per-slide edit history/revert.
  const { slidesRoutes } = await import('./modules/scientific-writing/slides/routes.js')
  await app.register(slidesRoutes)

  // Target-journal catalogue — read-only reference data for the
  // JournalSubmissionReadiness screen. Replaces the JOURNALS inline array.
  const { journalsRoutes } = await import('./modules/scientific-writing/journals/routes.js')
  await app.register(journalsRoutes)

  // ---------- Module C — Medical Writing ----------
  const { medContentProjectScopedRoutes, medContentRoutes } =
    await import('./modules/medical-writing/content/routes.js')
  await app.register(medContentProjectScopedRoutes, { prefix: '/projects' })
  await app.register(medContentRoutes, { prefix: '/med-content' })

  const { medContentUploadRoutes } = await import('./modules/medical-writing/content/upload-routes.js')
  await app.register(medContentUploadRoutes, { prefix: '/projects' })

  // Phase M-C.2 — med-content versioning + sections + section locks +
  // slide locks. Mirror of publication-section routes.
  const { medContentSectionRoutes, medSlideLockRoutes } =
    await import('./modules/medical-writing/content/section-routes.js')
  await app.register(medContentSectionRoutes, { prefix: '/med-content' })
  await app.register(medSlideLockRoutes)

  // Phase M-C.4 — section-scoped /ai-suggest. Sits alongside the
  // existing content-level /ai-suggest in content/routes.ts.
  const { medContentAiSuggestSectionRoutes } =
    await import('./modules/medical-writing/content/ai-suggest-section-routes.js')
  await app.register(medContentAiSuggestSectionRoutes, { prefix: '/med-content' })

  // Phase M-C.5 — section + slide comments with RACI gating.
  const { medContentCommentRoutes, medSlideCommentRoutes } =
    await import('./modules/medical-writing/content/comment-routes.js')
  await app.register(medContentCommentRoutes, { prefix: '/med-content' })
  await app.register(medSlideCommentRoutes)

  const { kolSessionRoutes } = await import('./modules/medical-writing/content/routes.js')
  await app.register(kolSessionRoutes, { prefix: '/kol-sessions' })

  const { claimsRoutes } = await import('./modules/medical-writing/claims/routes.js')
  await app.register(claimsRoutes, { prefix: '/med-content' })

  const { preMlrRoutes } = await import('./modules/medical-writing/pre-mlr/routes.js')
  await app.register(preMlrRoutes, { prefix: '/med-content' })

  const { mlrRoutes } = await import('./modules/medical-writing/mlr/routes.js')
  await app.register(mlrRoutes, { prefix: '/med-content' })

  // Slide deck — GET /med-content/:id/slide-deck + POST .../slides/ai-generate;
  // PATCH / DELETE land on /med-slides/:slideId so slide-id-only clients
  // don't need the content id.
  const { slideDeckRoutes, slideItemRoutes } = await import('./modules/medical-writing/slide-deck/routes.js')
  await app.register(slideDeckRoutes, { prefix: '/med-content' })
  await app.register(slideItemRoutes, { prefix: '/med-slides' })

  // ---------- Module D — Regulatory Writing ----------
  const { regSubmissionsProjectScopedRoutes, regSubmissionsRoutes } =
    await import('./modules/regulatory-writing/submissions/routes.js')
  await app.register(regSubmissionsProjectScopedRoutes, { prefix: '/projects' })
  await app.register(regSubmissionsRoutes, { prefix: '/reg-submissions' })

  const { canonicalRoutes } = await import('./modules/regulatory-writing/canonical/routes.js')
  await app.register(canonicalRoutes, { prefix: '/reg-submissions' })

  const { consistencyRoutes } = await import('./modules/regulatory-writing/consistency/routes.js')
  await app.register(consistencyRoutes, { prefix: '/reg-submissions' })

  const { haCorrespondenceRoutes } = await import('./modules/regulatory-writing/ha-correspondence/routes.js')
  // Mixed path shapes (/regulatory-submissions/:id/... + /ha-correspondence/:id +
  // /ha-questions/:id + /ha-drafts/:id). Registered at root with full paths.
  await app.register(haCorrespondenceRoutes)

  const { safetyReportsRoutes } = await import('./modules/regulatory-writing/safety-reports/routes.js')
  await app.register(safetyReportsRoutes)

  const { oddRoutes } = await import('./modules/regulatory-writing/odd/routes.js')
  await app.register(oddRoutes)

  // Phase M-D.2 — primary writable regulatory-document entity + versioning
  // + sections + section locks. Lives under /regulatory-documents (not
  // /reg-submissions/:id/documents on the list route is already scoped).
  const { regulatorySubmissionDocumentRoutes, regulatoryDocumentRoutes } =
    await import('./modules/regulatory-writing/documents/routes.js')
  await app.register(regulatorySubmissionDocumentRoutes, { prefix: '/reg-submissions' })
  await app.register(regulatoryDocumentRoutes, { prefix: '/regulatory-documents' })

  const { regulatoryDocumentSectionRoutes } =
    await import('./modules/regulatory-writing/documents/section-routes.js')
  await app.register(regulatoryDocumentSectionRoutes, { prefix: '/regulatory-documents' })

  // Phase M-D.4 — section-scoped /ai-suggest.
  const { regulatoryDocumentAiSuggestSectionRoutes } =
    await import('./modules/regulatory-writing/documents/ai-suggest-section-routes.js')
  await app.register(regulatoryDocumentAiSuggestSectionRoutes, { prefix: '/regulatory-documents' })

  // Phase M-D.5 — section comments with RACI gating.
  const { regulatoryDocumentCommentRoutes } =
    await import('./modules/regulatory-writing/documents/comment-routes.js')
  await app.register(regulatoryDocumentCommentRoutes, { prefix: '/regulatory-documents' })

  // Aliases + stubs — covers path mismatches (ectd-map, consistency-check,
  // etc.) and externally-blocked endpoints (gateway, super-reviewers,
  // library-cards) with deterministic placeholder shapes so the UI's
  // buttons + screens render instead of 404'ing.
  // See apps/api/src/modules/regulatory-writing/aliases-and-stubs.ts.
  // NB: `regulatoryAlertsStubRoutes` is NOT registered here — the real
  // cross-module `regulatoryAlertsRoutes` further down owns
  // GET /regulatory-alerts (Fastify fails startup on duplicate routes).
  const { regAliasesAndStubs } =
    await import('./modules/regulatory-writing/aliases-and-stubs.js')
  await app.register(regAliasesAndStubs, { prefix: '/reg-submissions' })

  // ---------- Module E — Ideation & Publishing ----------
  const { ideationProjectScopedRoutes, ideationRoutes } =
    await import('./modules/ideation/routes.js')
  await app.register(ideationProjectScopedRoutes, { prefix: '/projects' })
  await app.register(ideationRoutes, { prefix: '/ideation' })

  const { atomisedRoutes } = await import('./modules/ideation/atomised/routes.js')
  await app.register(atomisedRoutes, { prefix: '/ideation' })

  const { publishingRoutes } = await import('./modules/ideation/publishing/routes.js')
  await app.register(publishingRoutes, { prefix: '/ideation' })

  // Phase M-E.2 — artefact section / version / lock routes.
  const { ideationArtefactSectionRoutes } =
    await import('./modules/ideation/artefacts/section-routes.js')
  await app.register(ideationArtefactSectionRoutes, { prefix: '/ideation-artefacts' })

  // Phase M-E.4 — section-scoped /ai-suggest.
  const { ideationArtefactAiSuggestSectionRoutes } =
    await import('./modules/ideation/artefacts/ai-suggest-section-routes.js')
  await app.register(ideationArtefactAiSuggestSectionRoutes, { prefix: '/ideation-artefacts' })

  // Phase M-E.5 — section comments with RACI gating.
  const { ideationArtefactCommentRoutes } =
    await import('./modules/ideation/artefacts/comment-routes.js')
  await app.register(ideationArtefactCommentRoutes, { prefix: '/ideation-artefacts' })

  // Aliases + stubs — the web client speaks /ideation-projects/*,
  // /ideation-artefacts/*, /ideation-cards/*, /ideation-calendar/*,
  // /ideation-adaptations/*, /ideation-orcid/*, /ideation-social-alerts/*,
  // /kol-review/* at root (0/21 paths match the canonical API). See
  // apps/api/src/modules/ideation/aliases-and-stubs.ts.
  const { ideationAliasesAndStubs } =
    await import('./modules/ideation/aliases-and-stubs.js')
  await app.register(ideationAliasesAndStubs)

  // ---------- Phase 4 shared platform services ----------
  await app.register(import('./modules/platform/notifications/plugin.js'))
  // Warns, then suspends, accounts inactive for 30 days (needs notifications + audit).
  await app.register(import('./modules/platform/users/inactivity-plugin.js'))

  const { libraryRoutes } = await import('./modules/platform/library/routes.js')
  await app.register(libraryRoutes, { prefix: '/library' })
  // Master Library "Share": POST /library/:id/share (PM / Contributor), and the public pages behind an
  // invitation link — the reader proves the invited address with an emailed one-time code (share.ts).
  const { libraryShareRoutes, sharedLibraryPublicRoutes } = await import('./modules/platform/library/share.js')
  await app.register(libraryShareRoutes, { prefix: '/library' })
  await app.register(sharedLibraryPublicRoutes, { prefix: '/shared-library' })
  // The details panel's Audit trail: the document's whole life, read-only (audit-trail.ts).
  const { libraryAuditRoutes } = await import('./modules/platform/library/audit-trail.js')
  await app.register(libraryAuditRoutes, { prefix: '/library' })
  // Signed documents go into the library by themselves; GET /library/auto-push/:documentId reports it (auto-push.ts).
  const { libraryAutoPushRoutes } = await import('./modules/platform/library/auto-push.js')
  await app.register(libraryAutoPushRoutes, { prefix: '/library' })

  const { notificationsRoutes } = await import('./modules/platform/notifications/routes.js')
  await app.register(notificationsRoutes, { prefix: '/notifications' })

  const { frameworksRoutes } = await import('./modules/platform/frameworks/routes.js')
  await app.register(frameworksRoutes, { prefix: '/admin/frameworks' })

  const { raciRoutes } = await import('./modules/platform/raci/routes.js')
  await app.register(raciRoutes, { prefix: '/projects' })

  const { documentRaciRoutes } = await import('./modules/platform/document-raci/routes.js')
  await app.register(documentRaciRoutes, { prefix: '/documents' })

  const { projectMembersRoutes } = await import('./modules/platform/project-members/routes.js')
  await app.register(projectMembersRoutes, { prefix: '/projects' })

  const { pmDashboardRoutes } = await import('./modules/platform/pm-dashboard/routes.js')
  await app.register(pmDashboardRoutes, { prefix: '/projects' })

  // Capability-filtered user listing for the RACI editor picker.
  const { assignableUsersRoutes } = await import('./modules/platform/assignable-users/routes.js')
  await app.register(assignableUsersRoutes, { prefix: '/projects' })

  const { portfolioDashboardRoutes } = await import('./modules/platform/pm-dashboard/portfolio.js')
  await app.register(portfolioDashboardRoutes, { prefix: '/dashboards' })

  // Guest invitations — one plugin for both scope='document' and
  // scope='project'. Mounted at root since the paths carry their own
  // /documents or /projects prefix.
  const { guestInvitationRoutes } = await import('./modules/platform/guest-invitations/routes.js')
  await app.register(guestInvitationRoutes)
  // Public redemption endpoints — the guest hits these after clicking
  // the magic link. Zero auth; the signed JWT in the URL is the sole credential.
  const { guestRedemptionRoutes } = await import('./modules/platform/guest-invitations/redemption.js')
  await app.register(guestRedemptionRoutes, { prefix: '/guest' })

  await app.register(import('./modules/platform/ai-gateway/plugin.js'))
  const { aiGatewayRoutes } = await import('./modules/platform/ai-gateway/routes.js')
  await app.register(aiGatewayRoutes, { prefix: '/ai' })

  const { complianceRoutes } = await import('./modules/platform/compliance/routes.js')
  await app.register(complianceRoutes, { prefix: '/admin/compliance' })

  const { regulatoryAlertsRoutes } = await import('./modules/platform/regulatory-alerts/routes.js')
  // Cross-module read + per-user ack + super-admin publish. Registered at
  // root — paths are a mix of /regulatory-alerts/* and /admin/regulatory-alerts/*.
  await app.register(regulatoryAlertsRoutes)

  const { reportsCatalogueRoutes } = await import('./modules/platform/reports/catalogue-routes.js')
  await app.register(reportsCatalogueRoutes)
  const { reportsRoutes } = await import('./modules/platform/reports/routes.js')
  // Read-only aggregation layer across all 5 modules. Project dashboard
  // open to any module member; tenant + AI spend + audit activity gated to admins.
  await app.register(reportsRoutes)

  const { taxonomyRoutes } = await import('./modules/platform/taxonomy/routes.js')
  // Therapeutic-areas catalogue — read for every authed user, CRUD for super-admin.
  await app.register(taxonomyRoutes)

  // Compliance gauge scheduler — keeps the Prometheus gauges the Phase 6
  // alerts rely on (audit chain intact, last verify, access review, backup
  // success) fresh. Mounted last so all dependencies (prisma + audit +
  // metrics) are decorated first.
  await app.register(import('./modules/platform/compliance/plugin.js'))

  // Automatic ICH sync — keeps the ICH Frameworks registry in step with ich.org once a day (ICH_AUTO_SYNC=off to stop).
  await app.register(import('./modules/platform/frameworks/ich-auto-sync-plugin.js'))

  // Licensing boot check (migration 92) — read the active license once
  // so the operator sees the state in the startup log. Does NOT cache
  // the result: the GET /license path re-verifies on every read so
  // DB tamper attempts fail at request time, not just at boot.
  try {
    const { LicenseService } = await import('./modules/platform/licensing/service.js')
    const { setLicenseModules } = await import('./auth/rbac.js')
    const view = await new LicenseService(app.prisma).getActive()
    if (view.publicKeySource === 'dev_fallback') {
      app.log.warn(
        { licenseState: view.state, publicKeySource: view.publicKeySource },
        'LICENSE_PUBLIC_KEY env var not set — using embedded dev public key. DO NOT RUN IN PRODUCTION.',
      )
    }
    // Hand the parsed modules to the module-gate (rbac.ts). The override
    // persists until POST /license/import refreshes it (see routes.ts).
    // Unlicensed install → empty set → every module gate returns 503.
    // Dev-mode-unlicensed → view.modules = all five → gate stays open.
    // Invalid/expired → empty set (strict: broken licence doesn't grant).
    setLicenseModules(view.state === 'active' || view.state === 'dev_mode_unlicensed' ? view.modules : [])
    app.log.info(
      { licenseState: view.state, customer: view.customerName, modules: view.modules, daysToExpiry: view.daysToExpiry },
      'licensing: boot check complete',
    )
  } catch (err) {
    app.log.warn({ err }, 'licensing: boot check failed (non-fatal)')
  }

  return app
}

async function main() {
  const app = await buildServer()
  const env = app.env

  try {
    await app.listen({ port: env.PORT, host: env.HOST })
    app.log.info(
      { phase: 'Phase 1 scaffold', env: env.NODE_ENV, secretsProvider: env.SECRETS_PROVIDER },
      `Aurora API listening on http://${env.HOST}:${env.PORT}`,
    )
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

// Fastify type augmentation — so `app.env` and `app.secrets` are typed everywhere
declare module 'fastify' {
  interface FastifyInstance {
    env: ReturnType<typeof loadEnv>
    secrets: ReturnType<typeof createSecretsProvider>
  }
}

// Export buildServer for integration tests
export { buildServer }

// Boot when run directly (not when imported). pathToFileURL normalises
// Windows-style process.argv[1] ('C:\...') to the triple-slash file URL
// shape import.meta.url produces ('file:///C:/...').
import { pathToFileURL } from 'node:url'
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
