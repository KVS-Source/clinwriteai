// Resolve the Anthropic API key for this install.
//
// DB-only — the single source of truth is the ExternalApiCredential row
// with apiId='anthropic', pasted through Settings → AI engine → API keys.
// ANTHROPIC_API_KEY env var is no longer read for Module A (Clinical
// Writing) code paths; admins who used to export the env on the server
// must paste the key into the UI once instead.
//
// Returns an empty string when nothing is configured so callers can treat
// "not set" uniformly. The resolver intentionally does NOT throw — the
// drafting job uses the result to flip the document to aiDraftState=
// 'not_configured' and surface the "not configured" toast + Settings
// link instead of crashing the worker.
//
// Mirrored in apps/worker/src/jobs/resolve-anthropic-key.ts; both files
// must agree on the lookup or the admin's pasted key will work in one
// place but not the other.

interface PrismaLike {
  externalApiCredential: {
    findFirst(args: { where: { apiId: string }; select: { apiKey: true } }): Promise<{ apiKey: string | null } | null>
  }
}

export async function resolveAnthropicKey(prisma: PrismaLike): Promise<string> {
  try {
    const row = await prisma.externalApiCredential.findFirst({
      where: { apiId: 'anthropic' },
      select: { apiKey: true },
    })
    return row?.apiKey?.trim() ?? ''
  } catch {
    // Prisma errors (migration not run yet, table missing) surface as
    // "not configured" — same path as a missing key. Never throw; the
    // drafter needs a clean empty string so the toast can show.
    return ''
  }
}
