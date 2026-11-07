// Open-flag service for the Document Brief.
//
// Flags are the escape-hatch tokens the AI emits via the carry prompt
// ("[Information Required: …]", "[Conflict: …]", etc.). They live in
// `document_brief_open_flags` — OUTSIDE the derived brief contentJson —
// so a structural regen (section rename, source link, protocol metadata
// edit) can't wipe them. Readers compose: generated brief + loaded open
// flags = brief with openFlags populated.
//
// Dedup: appendFromAiCall() skips an insert when an open row already
// exists for the same (documentId, sectionId, type, text). A re-emit
// of the same phrase while the finding is still open is a no-op.
// Resolving the flag flips status; a subsequent re-emit after
// resolution creates a new row — the model is legitimately re-raising.
//
// Resolution flow is Part 11-ready: resolvedBy / resolvedAt / note
// captured on the row; the audit chain appends the actor + note on
// resolve as a separate entry at the route.

import type { PrismaClient } from '@prisma/client'
import type { FlagToken, FlagTokenType } from '../carry-prompt/parse.js'

export type OpenFlagStatus = 'open' | 'resolved' | 'dismissed'

export interface OpenFlagRow {
  id:             string
  documentId:     string
  sectionId:      string
  type:           FlagTokenType
  text:           string
  aiCallRecordId: string | null
  status:         OpenFlagStatus
  resolvedBy:     string | null
  resolvedAt:     Date | null
  resolutionNote: string | null
  createdAt:      Date
  updatedAt:      Date
}

export class OpenFlagService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Persist the flags a just-parsed AI call emitted for one section.
   *  Idempotent on (documentId, sectionId, type, text) when an open
   *  row already exists — returns the count actually inserted. */
  async appendFromAiCall(args: {
    documentId:    string
    sectionId:     string
    aiCallRecordId: string | null
    tokens:        FlagToken[]
  }): Promise<{ inserted: number; deduped: number }> {
    if (args.tokens.length === 0) return { inserted: 0, deduped: 0 }

    // Dedup within the incoming batch first — a single AI response can
    // repeat the exact same phrase. We also key-match against existing
    // open rows below.
    const uniqueTokens = Array.from(
      new Map(args.tokens.map(t => [`${t.type}::${t.text}`, t])).values(),
    )

    const existing = await this.prisma.documentBriefOpenFlag.findMany({
      where: {
        documentId: args.documentId,
        sectionId:  args.sectionId,
        status:     'open',
        OR: uniqueTokens.map(t => ({ type: t.type, text: t.text })),
      },
      select: { type: true, text: true },
    })
    const existingKeys = new Set(existing.map(e => `${e.type}::${e.text}`))

    const toInsert = uniqueTokens.filter(t => !existingKeys.has(`${t.type}::${t.text}`))
    if (toInsert.length === 0) {
      return { inserted: 0, deduped: uniqueTokens.length }
    }

    await this.prisma.documentBriefOpenFlag.createMany({
      data: toInsert.map(t => ({
        documentId:     args.documentId,
        sectionId:      args.sectionId,
        type:           t.type,
        text:           t.text,
        aiCallRecordId: args.aiCallRecordId,
      })),
    })

    // `deduped` sums BOTH kinds of skip — within the incoming batch
    // (model repeated the same phrase twice in one response) AND
    // against existing open rows — so a caller gets the full
    // "skipped" tally in one number.
    return {
      inserted: toInsert.length,
      deduped:  args.tokens.length - toInsert.length,
    }
  }

  /** All open flags for a document, grouped by type — matches the
   *  shape the brief's openFlags.* fields expect. */
  async listOpenForBrief(documentId: string): Promise<{
    informationRequired:    Array<{ sectionId: string; note: string }>
    conflicts:              Array<{ sectionId: string; note: string }>
    referenceVerification:  Array<{ sourceId: string; note: string }>
    missingCrossRefTargets: Array<{ sectionId: string; note: string }>
  }> {
    const rows = await this.prisma.documentBriefOpenFlag.findMany({
      where:   { documentId, status: 'open' },
      orderBy: [{ sectionId: 'asc' }, { createdAt: 'asc' }],
    })
    const out = {
      informationRequired:    [] as Array<{ sectionId: string; note: string }>,
      conflicts:              [] as Array<{ sectionId: string; note: string }>,
      referenceVerification:  [] as Array<{ sourceId: string; note: string }>,
      missingCrossRefTargets: [] as Array<{ sectionId: string; note: string }>,
    }
    for (const r of rows) {
      switch (r.type) {
        case 'information_required':
          out.informationRequired.push({ sectionId: r.sectionId, note: r.text })
          break
        case 'conflict':
          out.conflicts.push({ sectionId: r.sectionId, note: r.text })
          break
        case 'reference_verification_required':
          // `text` holds the sourceId per the carry-prompt contract.
          out.referenceVerification.push({ sourceId: r.text, note: `(section ${r.sectionId})` })
          break
        case 'missing_cross_ref_target':
          out.missingCrossRefTargets.push({ sectionId: r.sectionId, note: r.text })
          break
      }
    }
    return out
  }

  /** Full-detail list for the flags management panel — one row per
   *  flag with status + provenance. */
  async listAll(args: { documentId: string; status?: OpenFlagStatus }): Promise<OpenFlagRow[]> {
    const rows = await this.prisma.documentBriefOpenFlag.findMany({
      where:   { documentId: args.documentId, ...(args.status ? { status: args.status } : {}) },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    })
    return rows.map(r => ({
      ...r,
      type:   r.type as FlagTokenType,
      status: r.status as OpenFlagStatus,
    }))
  }

  /** Resolve a flag — status goes to 'resolved' or 'dismissed'.
   *  Returns the updated row, or null when the id doesn't exist or
   *  isn't currently open (resolving an already-resolved flag is a
   *  no-op that returns null — the route 404s). */
  async resolve(args: {
    flagId:         string
    documentId:     string
    actorId:        string
    status:         'resolved' | 'dismissed'
    resolutionNote: string | null
  }): Promise<OpenFlagRow | null> {
    const existing = await this.prisma.documentBriefOpenFlag.findUnique({ where: { id: args.flagId } })
    if (!existing) return null
    if (existing.documentId !== args.documentId) return null
    if (existing.status !== 'open') return null
    const updated = await this.prisma.documentBriefOpenFlag.update({
      where: { id: args.flagId },
      data:  {
        status:         args.status,
        resolvedBy:     args.actorId,
        resolvedAt:     new Date(),
        resolutionNote: args.resolutionNote,
      },
    })
    return {
      ...updated,
      type:   updated.type as FlagTokenType,
      status: updated.status as OpenFlagStatus,
    }
  }
}
