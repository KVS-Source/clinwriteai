// Admin Panel config (sPM04) — GET /admin/config.
//
// The web Admin Panel was only ever served by an MSW mock, so any build with
// mocks off (e.g. the demo) sat on "Loading configuration…" forever. This
// returns the UI's PlatformConfig shape, using real values where the API
// knows them (configured AI models + key presence, SMTP presence, active seat
// count, tenant name) and static defaults for integrations that aren't wired
// yet. `stub: true` flags the defaults, mirroring GET /admin/subscription.
// Persisting edits (Save changes) needs a config table — deferred.

import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../../auth/rbac.js'

const SEAT_LIMIT = 50

export const adminConfigRoutes: FastifyPluginAsync = async (app) => {
  app.get('/admin/config', { preHandler: requireAuth({ roles: ['admin', 'super-admin'] }) }, async (request) => {
    const user = request.user!
    const env = process.env

    const [tenant, activeSeats, subscription] = await Promise.all([
      user.tenantId ? app.prisma.tenant.findUnique({ where: { id: user.tenantId } }) : null,
      app.prisma.user.count({
        where: { status: 'active', ...(user.tenantId ? { tenantId: user.tenantId } : {}) },
      }),
      app.prisma.subscription.findFirst({ where: { endedAt: null }, orderBy: { startedAt: 'desc' } }),
    ])

    const now = new Date()
    const renewal = new Date(now)
    renewal.setMonth(renewal.getMonth() + 1)

    const defaultModel  = env.ANTHROPIC_MODEL_SONNET || 'claude-sonnet-4-6'
    const fallbackModel = env.ANTHROPIC_MODEL_HAIKU  || 'claude-haiku-4-5'
    const opusModel     = env.ANTHROPIC_MODEL_OPUS   || 'claude-opus-4-7'
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
        default:                  defaultModel,
        fallback:                 fallbackModel,
        perModuleOverrideEnabled: true,
        availableEngines: [
          { id: defaultModel,  label: defaultModel,  provider: 'Anthropic', status: 'active' },
          { id: opusModel,     label: opusModel,     provider: 'Anthropic', status: 'available' },
          { id: fallbackModel, label: fallbackModel, provider: 'Anthropic', status: 'available' },
        ],
        lastTested:          now.toISOString(),
        lastTestedLatencyMs: 0,
        lastTestedStatus:    aiConnected ? 'connected' : 'not-configured',
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
