// Worker mirror of apps/api/src/modules/platform/ai-gateway/resolve-
// anthropic-key.ts. The API handles admin PUTs that populate the row;
// the worker consumes it here when it needs to call Claude. Keep the
// order of precedence identical: DB first, env fallback.

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
