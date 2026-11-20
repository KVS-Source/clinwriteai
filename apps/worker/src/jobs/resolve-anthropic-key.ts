// Worker mirror of apps/api/src/modules/platform/ai-gateway/resolve-
// anthropic-key.ts. The API handles admin PUTs that populate the row;
// the worker consumes it here when it needs to call Claude. DB-only —
// env is no longer read on Module A paths. Admin pastes via Settings →
// AI engine → API keys or drafting runs the 'not_configured' path.

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
    // "not configured" — never crash the worker over a missing key.
    return ''
  }
}
