// SsoProvider interface — per ADR 0005.
//
// Implementations:
//   - MockSsoProvider:  dev + CI only. Signs in a seeded user without a real
//                       identity provider so the full auth loop (callback →
//                       session cookie → RBAC-gated request) can be exercised
//                       end-to-end on a laptop.
//   - WorkOsSsoProvider: wraps @workos-inc/node. Lands when procurement
//                        delivers the WorkOS tenant (Phase 1 Week 5-6).

export interface SsoAuthorizationUrlInput {
  state: string
  redirectUri: string
}

export interface SsoCallbackInput {
  code: string
  state: string
  redirectUri: string
}

export interface SsoIdentity {
  /** Stable identifier from the IdP (becomes User.ssoSubject). */
  subject: string
  email: string
  name: string
  /** Optional tenant hint — WorkOS org id or similar. */
  tenantId?: string
}

export interface SsoProvider {
  getAuthorizationUrl(input: SsoAuthorizationUrlInput): Promise<string>
  exchangeCode(input: SsoCallbackInput): Promise<SsoIdentity>
}

// ---------------------------------------------------------------------------
// Mock provider — the whole flow runs in-process. A dev hitting /auth/login
// is bounced to /auth/callback immediately with a signed-only-by-us code.
// ---------------------------------------------------------------------------

export class MockSsoProvider implements SsoProvider {
  constructor(private readonly fixtureEmail = 'dev@clinwrite.ai') {}

  async getAuthorizationUrl({ state, redirectUri }: SsoAuthorizationUrlInput): Promise<string> {
    const url = new URL(redirectUri)
    url.searchParams.set('code', `mock:${this.fixtureEmail}`)
    url.searchParams.set('state', state)
    return url.toString()
  }

  async exchangeCode({ code }: SsoCallbackInput): Promise<SsoIdentity> {
    if (!code.startsWith('mock:')) {
      throw new Error('MockSsoProvider only accepts codes issued by itself')
    }
    const email = code.slice('mock:'.length)
    return {
      subject: `mock|${email}`,
      email,
      name: humanizeEmail(email),
    }
  }
}

// ---------------------------------------------------------------------------
// WorkOS provider — stub. The real HTTP calls land once we have an API key.
// ---------------------------------------------------------------------------

export class WorkOsSsoProvider implements SsoProvider {
  // Credentials wired through now; the HTTP calls land with WorkOS procurement.
  constructor(
    protected readonly apiKey: string,
    protected readonly clientId: string,
  ) {
    if (!apiKey || !clientId) {
      throw new Error('WorkOsSsoProvider requires WORKOS_API_KEY and WORKOS_CLIENT_ID')
    }
  }

  async getAuthorizationUrl(_input: SsoAuthorizationUrlInput): Promise<string> {
    throw new Error('WorkOsSsoProvider: not implemented — lands with WorkOS tenant procurement (Phase 1 Week 5-6)')
  }

  async exchangeCode(_input: SsoCallbackInput): Promise<SsoIdentity> {
    throw new Error('WorkOsSsoProvider: not implemented — lands with WorkOS tenant procurement (Phase 1 Week 5-6)')
  }
}

function humanizeEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  return local
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

export function createSsoProvider(opts: {
  provider: 'mock' | 'workos'
  workosApiKey?: string
  workosClientId?: string
}): SsoProvider {
  switch (opts.provider) {
    case 'mock':
      return new MockSsoProvider()
    case 'workos':
      return new WorkOsSsoProvider(opts.workosApiKey ?? '', opts.workosClientId ?? '')
  }
}
