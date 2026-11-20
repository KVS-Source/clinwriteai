// Resolve the Anthropic API key for this install.
//
// Order of precedence:
//   1. ExternalApiCredential row with apiId='anthropic' (admin-pasted via
//      Settings → AI engine → API keys; migration 56adf73 added the UI).
//   2. ANTHROPIC_API_KEY environment variable (legacy / dev workaround).
//
// Returns an empty string when nothing is configured so callers can treat
// "not set" uniformly. The resolver intentionally does NOT throw — the
// drafting job uses the result to flip the document to aiDraftState=
// 'not_configured' instead of crashing.
//
// Mirrored in apps/worker/src/jobs/resolve-anthropic-key.ts; both files
// have to agree on the order of precedence or the Admin's pasted key will
// work in one place but not the other.

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
    const dbKey = row?.apiKey?.trim() ?? ''
    if (dbKey) return dbKey
  } catch {
    // Prisma errors (migration not run yet, table missing) fall through
    // to the env check — this must not become a reason drafting hangs.
  }
  return process.env.ANTHROPIC_API_KEY?.trim() ?? ''
}
