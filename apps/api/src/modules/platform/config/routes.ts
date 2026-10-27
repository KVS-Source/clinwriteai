// Admin Panel config (sPM04) — GET /admin/config.
//
// The web Admin Panel was only ever served by an MSW mock, so any build with
// mocks off (e.g. the demo) sat on "Loading configuration…" forever. This
// returns the UI's PlatformConfig shape, using real values where the API
// knows them (configured AI models + key presence, SMTP presence, active seat
// count, tenant name) and static defaults for integrations that aren't wired
// yet. `stub: true` flags the defaults, mirroring GET /admin/subscription.
// Persisting edits (Save changes) needs a config table — deferred.
//
// POST /admin/test-connection fires a real test prompt at the AI engine (see
// test-connection.ts); the last result is read back from the audit trail, so
// "last tested" survives restarts and shows who/when.

import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../../auth/rbac.js'
import { createAnthropicClientFromEnv } from '../ai-gateway/anthropic-client.js'
import { runConnectionTest } from './test-connection.js'
import {
  AI_ENGINE_SAVED, availableEngineOptions, resolveAiEngineSettings, validateAiEngineSettings,
  type AiEngineSettings,
} from './ai-engine-settings.js'
import { z } from 'zod'

const saveAiEngineSchema = z.object({
  default:                  z.string().min(1),
  fallback:                 z.string().min(1),
  perModuleOverrideEnabled: z.boolean(),
})

const SEAT_LIMIT = 50

const AI_TEST_ACTION = 'ai_connection_tested'

export const adminConfigRoutes: FastifyPluginAsync = async (app) => {
  // The most recent Test-connection result, from the audit trail.
  async function lastConnectionTest() {
    try {
      const rows = await app.prisma.$queryRaw<Array<{ timestamp: Date; details: Record<string, unknown> | null }>>`
        SELECT "timestamp", details FROM audit_events WHERE action = ${AI_TEST_ACTION} ORDER BY id DESC LIMIT 1
      `
      return rows[0] ?? null
    } catch { return null }                  // an unreadable audit row must not break the Admin Panel
  }

  app.post('/admin/test-connection', { preHandler: requireAuth({ roles: ['admin'] }) }, async (request) => {
    const { default: model } = await resolveAiEngineSettings(app.prisma)   // test the engine the platform will actually use
    const key = process.env.ANTHROPIC_API_KEY?.trim() ?? ''
    const result = await runConnectionTest({
      client: createAnthropicClientFromEnv(),   // null without a key — never the offline stub
      model,
      secrets: [key],
    })
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: AI_TEST_ACTION,
      entityType: 'ai_engine',
      entityId: model,
      details: { status: result.status, model, latencyMs: result.latency, message: result.message },
      ipAddress: request.ip ?? null,
    })
    return result
  })

  // Save the AI engine choice (PRD AC-PM-001). Written to the audit trail with the
  // value it replaces; AI calls pick it up immediately (chooseModel).
  app.put('/admin/config/ai-engine', { preHandler: requireAuth({ roles: ['admin'] }) }, async (request, reply) => {
    const parsed = saveAiEngineSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const next: AiEngineSettings = parsed.data
    const problem = validateAiEngineSettings(next)
    if (problem) return reply.code(400).send({ error: 'validation', message: problem })

    const previous = await resolveAiEngineSettings(app.prisma)
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: AI_ENGINE_SAVED,
      entityType: 'ai_engine',
      entityId: next.default,
      details: { ...next, previous },
      ipAddress: request.ip ?? null,
    })
    return { ...next, availableEngines: availableEngineOptions().map(e => ({ ...e, status: e.id === next.default ? 'active' : 'available' })) }
  })

  app.get('/admin/config', { preHandler: requireAuth({ roles: ['admin'] }) }, async (request) => {
    const user = request.user!
    const env = process.env

    const [tenant, activeSeats, subscription, lastTest, engine] = await Promise.all([
      user.tenantId ? app.prisma.tenant.findUnique({ where: { id: user.tenantId } }) : null,
      app.prisma.user.count({
        where: { status: 'active', ...(user.tenantId ? { tenantId: user.tenantId } : {}) },
      }),
      app.prisma.subscription.findFirst({ where: { endedAt: null }, orderBy: { startedAt: 'desc' } }),
      lastConnectionTest(),
      resolveAiEngineSettings(app.prisma),
    ])

    const now = new Date()
    const renewal = new Date(now)
    renewal.setMonth(renewal.getMonth() + 1)

    const aiConnected   = !!env.ANTHROPIC_API_KEY
    const smtpConnected = (env.EMAIL_PROVIDER ?? '').toLowerCase() === 'smtp' && !!env.SMTP_HOST

    const notConfigured = (id: string, label: string, extra: Record<string, string> = {}) =>
      ({ id, label, status: 'not-configured', lastTested: null, ...extra })

    return {
      clientId:                 tenant?.id ?? 'platform',
      clientName:               tenant?.name ?? 'ClinWrite Platform',
      plan:                     subscription?.plan ?? 'Professional',
      planStartDate:            (subscription?.startedAt ?? now).toISOString().slice(0, 10),
      renewalDate:              renewal.toISOString().slice(0, 10),
      contractedTokensPerMonth: 4_000_000,
      currency:                 'USD',
      aiEngine: {
        default:                  engine.default,
        fallback:                 engine.fallback,
        perModuleOverrideEnabled: engine.perModuleOverrideEnabled,
        availableEngines: availableEngineOptions().map(e => ({ ...e, status: e.id === engine.default ? 'active' : 'available' })),
        lastTested:          lastTest?.timestamp.toISOString() ?? null,
        lastTestedLatencyMs: typeof lastTest?.details?.latencyMs === 'number' ? lastTest.details.latencyMs : null,
        // What the last test found; with none yet, whether a key is even present.
        lastTestedStatus:    (lastTest?.details?.status as string | undefined) ?? (aiConnected ? 'never-tested' : 'not-configured'),
      },
      voiceTranscription: {
        engine: 'whisper',
        availableEngines: [
          { id: 'whisper',      label: 'Whisper (OpenAI)', status: 'active' },
          { id: 'assemblyai',   label: 'AssemblyAI',       status: 'available' },
          { id: 'azure-speech', label: 'Azure Speech',     status: 'available' },
        ],
        gdprJurisdiction:     'APAC',
        audioRetentionPolicy: 'delete-immediately',
        auditDeletionLogged:  true,
      },
      ectd: {
        defaultVersion:                     'v3.2.2',
        validationTool:                     'EXTEDO EXTEDOpulse',
        validationCredentialsLastValidated: null,
      },
      paymentGateways: [
        { id: 'stripe',      label: 'Stripe',      status: 'inactive', lastTested: null },
        { id: 'razorpay',    label: 'RazorPay',    status: 'inactive', lastTested: null },
        { id: 'payu',        label: 'PayU',        status: 'inactive', lastTested: null },
        { id: 'ccavenue',    label: 'CCAvenue',    status: 'inactive', lastTested: null },
        { id: 'upi',         label: 'UPI',         status: 'inactive', lastTested: null },
        { id: 'net-banking', label: 'Net Banking', status: 'inactive', lastTested: null },
      ],
      // External integrations await vendor procurement (see module deferrals),
      // so only what this deployment can actually reach is "connected".
      externalApis: [
        notConfigured('fda-esg', 'FDA ESG'),
        notConfigured('ema-cesp', 'EMA CESP'),
        notConfigured('mhra', 'MHRA'),
        notConfigured('extedo', 'EXTEDO EXTEDOpulse'),
        notConfigured('crossref-orcid', 'CrossRef / ORCID', { owner: 'Ideation & Publishing' }),
        notConfigured('pubmed', 'PubMed'),
        notConfigured('cdsco', 'CDSCO'),
        notConfigured('sms-gateway', 'SMS Gateway'),
        smtpConnected
          ? { id: 'smtp', label: 'Email SMTP', status: 'connected', lastTested: now.toISOString() }
          : notConfigured('smtp', 'Email SMTP'),
        notConfigured('pmda', 'PMDA'),
      ],
      featureFlags: [
        { id: 'module-e-localisation', label: 'Ideation & Publishing Localisation', status: 'enabled' },
        { id: 'voice-notes',           label: 'Voice Notes',                        status: 'enabled' },
        { id: 'slide-deck-generator',  label: 'Slide Deck Generator',               status: 'enabled' },
        { id: 'best-practices-api',    label: 'Best Practices API',                 status: 'beta' },
      ],
      seats: { used: activeSeats, total: SEAT_LIMIT },
      stub: true,
    }
  })
}
