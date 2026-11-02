// Env validation + typed access.
// Boot fails fast if required values are missing.
//
// Per ADR 0006: feature code never reads process.env for *secrets*.
// Secrets go through SecretsProvider (./secrets). Non-sensitive config
// (ports, feature flags, region names) can read process.env directly.

import { z } from 'zod'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Secrets backend selector (ADR 0006)
  SECRETS_PROVIDER: z.enum(['env', 'sops', 'aws-secrets-manager']).default('env'),
  SOPS_AGE_KEY_FILE: z.string().optional(),

  // Auth (ADR 0005)
  SSO_PROVIDER: z.enum(['mock', 'workos']).default('mock'),
  JWT_EXPIRY: z.string().default('24h'),

  // Observability
  OTEL_SERVICE_NAME: z.string().default('platform-api'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),

  // Feature flags
  FEATURE_AI_GATEWAY: z.coerce.boolean().default(true),
  FEATURE_PRESENCE: z.coerce.boolean().default(true),
  // Expose /docs in production too (off by default — enable per environment).
  FEATURE_OPENAPI_DOCS: z.coerce.boolean().default(false),

  // Comma-separated list of enabled business modules (A|B|C|D|E).
  // Default 'A,B,C,D,E' — the 2026-10-06 pivot froze B/C/D/E to run
  // Arcs 1-6, then Arc 11 re-enabled every module at runtime (commit
  // 1e1c4f7, 2026-10-08). Default was flipped from 'A' to all-on
  // 2026-10-21 so new deployments get the full module surface without
  // a bespoke env override. Routes whose required-modules list doesn't
  // intersect this set still return 503 module_disabled — set
  // FEATURE_MODULES_ENABLED=A on a deployment to re-freeze B/C/D/E.
  // See docs/pivot-plan.md Arc 1.1 + Arc 11.
  FEATURE_MODULES_ENABLED: z.string().default('A,B,C,D,E'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  CORS_CREDENTIALS: z.coerce.boolean().default(true),

  // Session cookie Domain attribute. Needed when the web app and API live
  // on different subdomains (demo.clinwrite.ai + api.clinwrite.ai) — set
  // to '.clinwrite.ai' so the cookie set by the API is sent back on
  // requests from the web app. Leave unset for single-origin dev
  // (localhost:5173 → localhost:3001 works via SameSite=Lax).
  SESSION_COOKIE_DOMAIN: z.string().optional(),

  // S3-API (ADR 0007 — MinIO on standalone, S3 on cloud)
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  S3_DOCUMENTS_BUCKET: z.string(),

  // Queue (ADR 0008)
  REDIS_URL: z.string().url(),

  // Password auth + email (Phase A, 2026-11-02).
  //
  // APP_BASE_URL is the public URL where the SPA lives — used to build
  // the reset-password link we email ("${APP_BASE_URL}/reset-password?
  // token=…"). Defaults to CORS_ORIGIN since that's the SPA origin in
  // the single-host dev case; override when API + SPA live on
  // different hosts and the email link should land on the SPA host.
  APP_BASE_URL:                 z.string().url().optional(),

  // Minutes a password reset token stays valid. 30 is a GxP-reasonable
  // default — long enough to switch inbox / mail client, short enough
  // that a stale link in a forwarded email is useless.
  PASSWORD_RESET_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(30),

  // SMTP transport for outbound email (nodemailer). The project ships
  // raw SMTP first (Gmail / corporate relay); SES / SendGrid can wrap
  // the same mailer interface later. Leaving SMTP_HOST empty puts the
  // mailer in "log only" mode (writes the message to stdout, does not
  // transmit) — safe default for local dev + CI.
  SMTP_HOST:                    z.string().optional(),
  SMTP_PORT:                    z.coerce.number().int().positive().default(587),
  SMTP_SECURE:                  z.coerce.boolean().default(false),
  SMTP_USER:                    z.string().optional(),
  SMTP_PASS:                    z.string().optional(),
  EMAIL_FROM:                   z.string().default('ClinWrite.AI <noreply@clinwrite.ai>'),
})

export type Env = z.infer<typeof EnvSchema>

let cached: Env | undefined

export function loadEnv(): Env {
  if (cached) return cached
  const result = EnvSchema.safeParse(process.env)
  if (!result.success) {
    const details = result.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Env validation failed:\n${details}`)
  }
  cached = result.data
  return cached
}
