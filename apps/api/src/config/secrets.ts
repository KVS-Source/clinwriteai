// SecretsProvider — the one and only path for feature code to obtain secrets.
// Per ADR 0006. Implementations: EnvSecretsProvider (dev/test),
// SopsEnvSecretsProvider (standalone VPS), AwsSecretsManagerProvider (year 2).
//
// Feature code MUST import `getSecret()` from here, never read process.env
// directly for secret values. Lint rule in eslint.config.js enforces this
// (added Phase 1 Week 3).

import type { Env } from './env.js'

export interface SecretsProvider {
  /** Fetch a secret by its logical name (e.g. 'DATABASE_URL', 'JWT_SECRET'). */
  getSecret(name: string): Promise<string>

  /** Optional: bulk-fetch for boot-time hot loading. */
  getSecrets?(names: string[]): Promise<Record<string, string>>
}

// ---------------------------------------------------------------------------
// EnvSecretsProvider — reads from process.env. Dev + test only.
// ---------------------------------------------------------------------------

export class EnvSecretsProvider implements SecretsProvider {
  async getSecret(name: string): Promise<string> {
    const value = process.env[name]
    if (value === undefined || value === '') {
      throw new Error(`Secret '${name}' not set in process.env`)
    }
    return value
  }
}

// ---------------------------------------------------------------------------
// SopsEnvSecretsProvider — standalone VPS production (ADR 0009).
// Decrypts /opt/platform/env/<component>.env.enc at boot via sops+age and
// caches the resulting key-value pairs in memory with a TTL.
// ---------------------------------------------------------------------------

export class SopsEnvSecretsProvider implements SecretsProvider {
  private cache: Map<string, string> | null = null
  private cacheExpiresAt = 0
  private readonly ttlMs = 15 * 60 * 1000  // 15 minutes

  constructor(
    private readonly encFilePath: string,
    private readonly ageKeyFile: string,
  ) {}

  async getSecret(name: string): Promise<string> {
    await this.ensureCache()
    const value = this.cache?.get(name)
    if (value === undefined) {
      throw new Error(`Secret '${name}' not found in ${this.encFilePath}`)
    }
    return value
  }

  async getSecrets(names: string[]): Promise<Record<string, string>> {
    await this.ensureCache()
    const result: Record<string, string> = {}
    for (const name of names) {
      result[name] = await this.getSecret(name)
    }
    return result
  }

  private async ensureCache(): Promise<void> {
    const now = Date.now()
    if (this.cache && now < this.cacheExpiresAt) return

    // In Phase 1 Week 3 this calls `sops --decrypt` via child_process and parses
    // the resulting dotenv output. For now, scaffold-only stub.
    throw new Error(
      'SopsEnvSecretsProvider.ensureCache: not yet implemented — ships Phase 1 Week 3. ' +
      'Fall back to EnvSecretsProvider by setting SECRETS_PROVIDER=env.',
    )
  }
}

// ---------------------------------------------------------------------------
// AwsSecretsManagerProvider — cloud migration (year 2).
// ---------------------------------------------------------------------------

export class AwsSecretsManagerProvider implements SecretsProvider {
  async getSecret(_name: string): Promise<string> {
    throw new Error(
      'AwsSecretsManagerProvider: not implemented — ships at cloud migration (year 2).',
    )
  }
}

// ---------------------------------------------------------------------------
// Factory — picks the implementation based on env config.
// ---------------------------------------------------------------------------

export function createSecretsProvider(env: Env): SecretsProvider {
  switch (env.SECRETS_PROVIDER) {
    case 'env':
      return new EnvSecretsProvider()
    case 'sops': {
      if (!env.SOPS_AGE_KEY_FILE) {
        throw new Error('SECRETS_PROVIDER=sops requires SOPS_AGE_KEY_FILE')
      }
      // Convention: /opt/platform/env/api.env.enc (per ADR 0009)
      return new SopsEnvSecretsProvider('/opt/platform/env/api.env.enc', env.SOPS_AGE_KEY_FILE)
    }
    case 'aws-secrets-manager':
      return new AwsSecretsManagerProvider()
  }
}
