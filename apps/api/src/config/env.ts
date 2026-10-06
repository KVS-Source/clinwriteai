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
  // Default 'A' reflects the 2026-10-06 pivot — Clinical Writing + Tenant
  // Admin only. Routes whose required-modules list doesn't intersect this
  // set return 503 module_disabled. See docs/pivot-plan.md Arc 1.1.
  FEATURE_MODULES_ENABLED: z.string().default('A'),

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
