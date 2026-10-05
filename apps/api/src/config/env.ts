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

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  CORS_CREDENTIALS: z.coerce.boolean().default(true),

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
