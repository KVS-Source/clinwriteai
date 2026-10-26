// Polymorphic edit history (sPM-edit-history-polymorphic).
//
// One central service that every module calls instead of writing its own
// *EditHistory table. Each entity type registers a "revert handler" — the
// per-type mutator that knows how to put the before-content back where it
// belongs (clinical_section → SectionContent.update; atomised_content →
// AtomisedContent.update; etc.).
//
// Public surface:
//   recordEdit(args)         — write one history row (manual, ai, undo, restore)
//   listHistory(filter)      — fetch rows for an entity scope
//   revert(editHistoryId)    — dispatch to the right handler by entityType
//
// Design decisions:
//   - origin='undo' rows are themselves undoable (dispatch same handler)
//   - Idempotency: callers compare before/after themselves before calling
//     recordEdit — the service doesn't deduplicate (keeps the trail honest)
//   - Clinical-section rows additionally populate the convenience columns
//     documentId/sectionId/documentVersionId so Module A's existing audit
//     queries keep working untouched

import type { PrismaClient } from '@prisma/client'

export type EntityType =
  | 'clinical_section'
  | 'atomised_content'
  | 'peer_review_response'
  | 'ha_response_draft'
  | 'slide'

export type EditOrigin = 'manual' | 'ai' | 'undo' | 'restore'

export interface RecordEditArgs {
  entityType:   EntityType
  entityId:     string
  subUnitId?:   string | null
  actorId:      string
  origin:       EditOrigin
  beforeHtml:   string | null
  afterHtml:    string
  // AI metadata linkback for origin='ai' rows
  aiCallRecordId?: string | null
  // Undo linkback for origin='undo' rows
  revertedFromId?: string | null
  // Clinical-section convenience columns (Module A compat) — populate when
  // entityType='clinical_section'; otherwise leave null
  documentId?:        string | null
  sectionId?:         string | null
  documentVersionId?: string | null
}

export interface ListHistoryFilter {
  entityType: EntityType
  entityId:   string
  subUnitId?: string
  /** When true, only rows authored by this user show up. */
  actorId?:   string
  /** Narrow by origin kind. */
  origin?:    EditOrigin
}

/**
 * Per-entity-type revert handler. Called inside the service transaction;
 * must mutate the entity's current content to `beforeHtml`, recompute any
 * entity-specific hashes, and return the id of the current container row
 * (version id, deck id, etc.) so the caller can use it in audit events.
 */
export type RevertHandler = (
  prisma: PrismaClient,
  args: {
    editHistoryRow: {
      id: string
      entityType: string
      entityId:   string
      subUnitId:  string | null
      beforeHtml: string | null
      documentVersionId: string | null
    }
    currentUserId: string
  },
) => Promise<{
  /** Previous HTML snapshot the mutation replaced — fed into the mirror origin='undo' row. */
  previousHtml: string
  /** Content the editor should display after the revert. */
  contentAfter: string
}>

export class EditHistoryService {
  private readonly handlers = new Map<EntityType, RevertHandler>()

  constructor(private readonly prisma: PrismaClient) {}

  /** Modules register their per-entity-type revert handler at boot. */
  registerRevertHandler(entityType: EntityType, handler: RevertHandler): void {
    this.handlers.set(entityType, handler)
  }

  async recordEdit(args: RecordEditArgs): Promise<{ id: string; createdAt: Date }> {
    const row = await this.prisma.editHistory.create({
      data: {
        entityType:        args.entityType,
        entityId:          args.entityId,
        subUnitId:         args.subUnitId ?? null,
        actorId:           args.actorId,
        origin:            args.origin,
        beforeHtml:        args.beforeHtml,
        afterHtml:         args.afterHtml,
        aiCallRecordId:    args.aiCallRecordId ?? null,
        revertedFromId:    args.revertedFromId ?? null,
        documentId:        args.documentId        ?? null,
        sectionId:         args.sectionId         ?? null,
        documentVersionId: args.documentVersionId ?? null,
      },
      select: { id: true, createdAt: true },
    })
    return row
  }

  /**
   * Lists history rows for an entity scope with optional actor + origin
   * filters. Rows come newest-first. Each row carries the pre-computed
   * `interveningCount` (how many newer rows exist across all actors on
   * the same scope) so the UI's revert-confirmation modal can tell the
   * user what they're about to drop.
   */
  async listHistory(filter: ListHistoryFilter) {
    const baseWhere = {
      entityType: filter.entityType,
      entityId:   filter.entityId,
      ...(filter.subUnitId !== undefined && { subUnitId: filter.subUnitId }),
    }
    const narrowedWhere = {
      ...baseWhere,
      ...(filter.actorId && { actorId: filter.actorId }),
      ...(filter.origin  && { origin:  filter.origin }),
    }

    const [rows, allRows] = await Promise.all([
      this.prisma.editHistory.findMany({
        where:   narrowedWhere,
        orderBy: { createdAt: 'desc' },
      }),
      // Always fetch the full set for intervening-count accuracy, even when
      // the caller filtered to a subset. Only id/actorId/createdAt needed.
      (filter.actorId || filter.origin)
        ? this.prisma.editHistory.findMany({
            where:   baseWhere,
            orderBy: { createdAt: 'desc' },
            select:  { id: true, actorId: true, createdAt: true },
          })
        : Promise.resolve(null),
    ])

    const positionOf = new Map(
      (allRows ?? rows).map((r, i) => [r.id, i]),
    )
    const allRowsForIntervening = (allRows ?? rows)
    return rows.map(r => {
      const idx = positionOf.get(r.id) ?? 0
      const intervening = allRowsForIntervening.slice(0, idx)
      const interveningByActor = Array.from(
        intervening.reduce((m, row) => m.set(row.actorId, (m.get(row.actorId) ?? 0) + 1), new Map<string, number>()),
      ).map(([actorId, count]) => ({ actorId, count }))
      return { ...r, interveningCount: intervening.length, interveningByActor }
    })
  }

  /**
   * Reverts the entity's current state to the beforeHtml of the given
   * history row. Dispatches to the per-entity-type handler registered at
   * boot, then writes a mirror origin='undo' row so the revert itself is
   * reversible.
   */
  async revert(editHistoryId: string, currentUserId: string) {
    const target = await this.prisma.editHistory.findUnique({ where: { id: editHistoryId } })
    if (!target) throw new Error('edit_history_not_found')
    if (target.beforeHtml === null) throw new Error('cannot_revert_no_snapshot')

    const handler = this.handlers.get(target.entityType as EntityType)
    if (!handler) throw new Error(`no_revert_handler:${target.entityType}`)

    const result = await handler(this.prisma, {
      editHistoryRow: {
        id:                target.id,
        entityType:        target.entityType,
        entityId:          target.entityId,
        subUnitId:         target.subUnitId,
        beforeHtml:        target.beforeHtml,
        documentVersionId: target.documentVersionId,
      },
      currentUserId,
    })

    await this.recordEdit({
      entityType:        target.entityType as EntityType,
      entityId:          target.entityId,
      subUnitId:         target.subUnitId,
      actorId:           currentUserId,
      origin:            'undo',
      beforeHtml:        result.previousHtml,
      afterHtml:         result.contentAfter,
      revertedFromId:    target.id,
      documentId:        target.documentId,
      sectionId:         target.sectionId,
      documentVersionId: target.documentVersionId,
    })

    return result
  }
}
