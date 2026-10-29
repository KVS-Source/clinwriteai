// Resolve the model id the AI draft/validation jobs should use.
//
// Precedence (highest wins):
//   1. ai.engine_saved audit event in the DB (what the Admin Panel's
//      AI Engine tab writes when an operator picks a model + clicks
//      Save Changes). Mirrors apps/api/src/modules/platform/config/
//      ai-engine-settings.ts's loadSavedAiEngineSettings — same source
//      of truth, no duplicate state.
//   2. ANTHROPIC_DRAFT_MODEL env override (per-deployment).
//   3. Hardcoded 'claude-sonnet-4-5' default.
//
// Why not per-tenant yet: the current save flow writes a single global
// row; a tenant filter would be the natural next step once the Admin
// Panel grows a per-tenant AI-engine field. The lookup here already
// takes a tenantId so swapping to a tenant-filtered query is a one-line
// change — call sites don't move.

import type { PrismaClient } from '@prisma/client'

const AI_ENGINE_SAVED_ACTION = 'ai.engine_saved'
const DEFAULT_MODEL = 'claude-sonnet-4-5'

/**
 * Returns the model id to use for AI drafting / validation. tenantId is
 * accepted for future per-tenant selection; the current lookup is
 * global (last ai.engine_saved audit row).
 */
export async function resolveDraftModel(
  prisma: PrismaClient,
  _tenantId: string | null | undefined,
): Promise<string> {
  // DB-saved default — reads the most recent ai.engine_saved audit event.
  // Falls through to env on any error (unreadable row, prisma hiccup, etc.)
  // so the drafter never hard-fails on a config lookup.
  try {
    const rows = await prisma.$queryRaw<Array<{ details: Record<string, unknown> | null }>>`
      SELECT details FROM audit_events WHERE action = ${AI_ENGINE_SAVED_ACTION} ORDER BY id DESC LIMIT 1
    `
    const def = rows[0]?.details?.default
    if (typeof def === 'string' && def.length > 0) return def
  } catch { /* fall through */ }

  const envModel = process.env.ANTHROPIC_DRAFT_MODEL?.trim()
  if (envModel) return envModel
  return DEFAULT_MODEL
}
