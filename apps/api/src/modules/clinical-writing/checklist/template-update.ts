// Checklist template versions: the approval cycle (CW-029) and moving an
// in-flight document onto a newer template (CW-028, FR-A-001c / AC-A-014).
//
// Approval cycle (maker-checker, action table row 22): a draft is approved by
// someone who did not author it — not its creator, and not anyone who added,
// edited, removed or reordered its items. Who touched a draft is read from the
// audit chain, so it can't be bypassed by a later edit.
//
// Template update: a document keeps the checklist it was created with
// (snapshotted onto its ChecklistInstance). When a newer template version that
// applies to it is approved, the document's Authors and the project's PMs are
// notified, and the Author may adopt it — reviewing exactly what changes first.
// Never automatic, always audited (AC-A-010 / AC-A-014).

import type { PrismaClient } from '@prisma/client'
import type { AuditRepository } from '../../../audit/repository.js'
import { PM_PROJECT_ROLE } from '../../projects/visibility.js'
import { SIGNATURE_BOUND_STATUSES } from '../documents/template-sections.js'

type PrismaTxLike = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0] | PrismaClient

// ---------------------------------------------------------------------------
// Which template applies to a document
// ---------------------------------------------------------------------------

// Same as normalizeDeliverableType in service.ts (which imports this file): templates are keyed by the underscored form.
const normalizeDeliverableType = (s: string) => s.replace(/-/g, '_')

/** Both spellings a document type may be stored under ('csr-full' / 'csr_full'). */
export function deliverableTypeSpellings(type: string): string[] {
  const canonical = normalizeDeliverableType(type)
  return [...new Set([canonical, canonical.replace(/_/g, '-')])]
}

/**
 * The template a new checklist for this document type and project would be
 * built from: the project's own approved override, else the platform baseline,
 * else (pre-migration databases) any current template for the type.
 */
export async function applicableChecklistTemplate(tx: PrismaTxLike, deliverableType: string, projectId: string | null | undefined) {
  const type = normalizeDeliverableType(deliverableType)
  const include = { items: { orderBy: { sortOrder: 'asc' as const } } }
  if (projectId) {
    const override = await tx.checklistTemplate.findFirst({
      where: { deliverableType: type, projectId, isCurrent: true, templateStatus: 'locked' }, include,
    })
    if (override) return override
  }
  return (await tx.checklistTemplate.findFirst({ where: { deliverableType: type, projectId: null, isCurrent: true }, include }))
    ?? tx.checklistTemplate.findFirst({ where: { deliverableType: type, isCurrent: true }, include })
}

// ---------------------------------------------------------------------------
// Approval cycle
// ---------------------------------------------------------------------------

/** Audit actions that make the actor an author of a template draft. */
export const TEMPLATE_AUTHORING_ACTIONS: ReadonlySet<string> = new Set([
  'checklist_template_draft_created',
  'checklist_template_project_override_created',
  'checklist_template_item_added',
  'checklist_template_item_updated',
  'checklist_template_item_deleted',
  'checklist_template_item_reordered',
])

/** Everyone who authored this draft: its creator plus whoever changed its items. */
export async function templateDraftAuthors(
  audit: Pick<AuditRepository, 'pageForEntity'>,
  template: { id: string; createdBy: string },
): Promise<Set<string>> {
  const authors = new Set<string>([template.createdBy])
  const PAGE = 200
  for (let offset = 0; offset < 5000; offset += PAGE) {
    const page = await audit.pageForEntity('checklist_template', template.id, { limit: PAGE, offset })
    for (const row of page.rows) if (TEMPLATE_AUTHORING_ACTIONS.has(row.action)) authors.add(row.actorId)
    if (page.rows.length < PAGE || offset + PAGE >= page.total) break
  }
  return authors
}

export const TEMPLATE_ADOPT_FORBIDDEN = {
  error: 'template_adopt_forbidden',
  message: 'Only the Author (R) on this document can adopt a newer checklist template.',
} as const

export const TEMPLATE_SELF_APPROVAL = {
  error: 'template_self_approval',
  message: 'You authored this draft, so someone else must approve it (approval cycle: the approver must not be the author).',
} as const

// ---------------------------------------------------------------------------
// What adopting a newer template changes (pure)
// ---------------------------------------------------------------------------

export interface TemplateItemLike {
  id: string
  text: string
  framework: string
  frameworkMandatory: boolean
  ownerRaci: string
  stage: string
  autoCompleteOn: string | null
  sortOrder: number
}

export interface InstanceItemLike extends Omit<TemplateItemLike, 'id'> {
  id: string
  templateItemId: string | null
  isUserAdded: boolean
  status: string
}

export type ChangedField = 'frameworkMandatory' | 'ownerRaci' | 'stage' | 'autoCompleteOn'

export interface TemplateDiff<I extends InstanceItemLike = InstanceItemLike, T extends TemplateItemLike = TemplateItemLike> {
  /** In the new template, not on the document: added as pending items. */
  added: T[]
  /** On the document from the old template, not in the new one: marked removed (record kept). */
  removed: I[]
  /** On both, with a different owner, stage, auto-complete trigger or mandatory flag. Progress is kept. */
  changed: Array<{ item: I; next: T; fields: ChangedField[] }>
  /** On both and the same. Progress is kept. */
  unchanged: Array<{ item: I; next: T }>
}

const CHANGE_FIELDS: readonly ChangedField[] = ['frameworkMandatory', 'ownerRaci', 'stage', 'autoCompleteOn']

/** An item is the same requirement when its wording and framework match (case and spacing aside). */
export function itemKey(i: { text: string; framework: string }): string {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
  return `${norm(i.framework)}|${norm(i.text)}`
}

/**
 * Compare a document's checklist with a newer template. Items the author added
 * by hand are never touched. An item the author already removed stays removed,
 * so it is neither "removed" again nor "added" back.
 */
export function diffChecklistTemplate<I extends InstanceItemLike, T extends TemplateItemLike>(instanceItems: I[], templateItems: T[]): TemplateDiff<I, T> {
  const pool = new Map<string, I[]>()
  for (const it of instanceItems) {
    if (it.isUserAdded) continue
    const list = pool.get(itemKey(it)) ?? []
    list.push(it)
    pool.set(itemKey(it), list)
  }
  const diff: TemplateDiff<I, T> = { added: [], removed: [], changed: [], unchanged: [] }
  for (const next of [...templateItems].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const match = pool.get(itemKey(next))?.shift()
    if (!match) { diff.added.push(next); continue }
    if (match.status === 'removed') { diff.unchanged.push({ item: match, next }); continue }
    const fields = CHANGE_FIELDS.filter(f => (match[f] ?? null) !== (next[f] ?? null))
    if (fields.length) diff.changed.push({ item: match, next, fields })
    else diff.unchanged.push({ item: match, next })
  }
  for (const left of pool.values()) for (const it of left) if (it.status !== 'removed') diff.removed.push(it)
  return diff
}

// ---------------------------------------------------------------------------
// A document's available update
// ---------------------------------------------------------------------------

export interface TemplateVersionLike {
  id: string
  deliverableType: string
  projectId: string | null
  version: number
  templateStatus: string
  effectiveDate: Date
  approvedAt: Date | null
}

/**
 * Whether `available` is a newer version than the template a document's checklist was built from.
 *   - Same template line (same type, either spelling, and same scope): only a higher version number.
 *     Two rows of one version (the hyphen / underscore duplicates, CW-089) are not an update.
 *   - Another line (a project override that became current, or the baseline again after one was
 *     retired): when it took effect after the document got its checklist.
 */
export function isNewerTemplate(on: TemplateVersionLike, available: TemplateVersionLike, checklistCreatedAt: Date): boolean {
  if (available.id === on.id || available.templateStatus !== 'locked') return false
  const sameLine = normalizeDeliverableType(on.deliverableType) === normalizeDeliverableType(available.deliverableType)
    && (on.projectId ?? null) === (available.projectId ?? null)
  if (sameLine) return available.version > on.version
  return (available.approvedAt ?? available.effectiveDate).getTime() > checklistCreatedAt.getTime()
}

const TEMPLATE_VERSION_SELECT = {
  id: true, deliverableType: true, projectId: true, version: true, templateStatus: true, effectiveDate: true, approvedAt: true,
} as const

/** The newer template a document could adopt, or null when its checklist is on the current one. */
export async function findChecklistTemplateUpdate(prisma: PrismaClient, documentId: string) {
  const instance = await prisma.checklistInstance.findUnique({
    where: { documentId },
    include: {
      items: { orderBy: { sortOrder: 'asc' } },
      template: { select: TEMPLATE_VERSION_SELECT },
      document: { select: { type: true, projectId: true, status: true } },
    },
  })
  if (!instance) return null
  const available = await applicableChecklistTemplate(prisma, instance.document.type, instance.document.projectId)
  if (!available || !isNewerTemplate(instance.template, available, instance.createdAt)) return null
  return { instance, available, diff: diffChecklistTemplate(instance.items, available.items) }
}

// ---------------------------------------------------------------------------
// Notification on approve
// ---------------------------------------------------------------------------

export const TEMPLATE_UPDATE_KIND = 'checklist_template_update'
export const TEMPLATE_UPDATE_PM_KIND = 'checklist_template_update_project'

interface Notifier {
  send(args: { recipientId: string; kind: string; title: string; body: string; linkPath?: string; payload?: Record<string, unknown> }): Promise<unknown>
}

/**
 * After a template version is approved: every in-flight document that would now
 * get it (not deleted, not at or past signature, project open, checklist still on
 * an older template) is told — its Authors (R, or the assignee) may adopt it, the
 * project's PMs are informed. Marks each instance's notificationSentAt. Returns the
 * documents notified.
 */
export async function notifyChecklistTemplateUpdate(
  prisma: PrismaClient,
  notifications: Notifier,
  template: TemplateVersionLike & { changeReason: string },
): Promise<string[]> {
  const candidates = await prisma.checklistInstance.findMany({
    where: {
      templateId: { not: template.id },
      document: {
        deletedAt: null,
        status: { notIn: [...SIGNATURE_BOUND_STATUSES] },
        type: { in: deliverableTypeSpellings(template.deliverableType) },
        ...(template.projectId ? { projectId: template.projectId } : {}),
      },
    },
    select: {
      id: true, templateVersion: true, createdAt: true,
      template: { select: TEMPLATE_VERSION_SELECT },
      document: { select: { id: true, title: true, type: true, projectId: true, assigneeId: true } },
    },
  })
  if (candidates.length === 0) return []

  // Only documents this template now applies to (a project with its own override keeps that one).
  const projectIds = [...new Set(candidates.map(c => c.document.projectId))]
  const [projects, applicable] = await Promise.all([
    prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, status: true } }),
    Promise.all(projectIds.map(async p => [p, (await applicableChecklistTemplate(prisma, template.deliverableType, p))?.id ?? null] as const)),
  ])
  const open = new Set(projects.filter(p => p.status !== 'closed').map(p => p.id))
  const appliesIn = new Map(applicable)
  const affected = candidates.filter(c => open.has(c.document.projectId)
    && appliesIn.get(c.document.projectId) === template.id
    && isNewerTemplate(c.template, template, c.createdAt))
  if (affected.length === 0) return []

  const docIds = affected.map(c => c.document.id)
  const [authorRows, pmRows] = await Promise.all([
    prisma.documentRaci.findMany({ where: { documentId: { in: docIds }, letter: 'R', removedAt: null }, select: { documentId: true, userId: true } }),
    prisma.projectMember.findMany({ where: { projectId: { in: [...new Set(affected.map(c => c.document.projectId))] }, projectRole: PM_PROJECT_ROLE, removedAt: null }, select: { projectId: true, userId: true } }),
  ])

  for (const c of affected) {
    const doc = c.document
    const authors = new Set(authorRows.filter(r => r.documentId === doc.id).map(r => r.userId))
    if (doc.assigneeId) authors.add(doc.assigneeId)
    const pms = new Set(pmRows.filter(r => r.projectId === doc.projectId).map(r => r.userId).filter(id => !authors.has(id)))
    const linkPath = `/projects/${doc.projectId}/clinical-writing/documents/${doc.id}`
    const payload = { documentId: doc.id, projectId: doc.projectId, templateId: template.id, fromVersion: c.templateVersion, toVersion: template.version }
    const reason = template.changeReason ? ` Reason: ${template.changeReason}` : ''
    for (const recipientId of authors) {
      await notifications.send({
        recipientId, kind: TEMPLATE_UPDATE_KIND, linkPath, payload,
        title: `A newer checklist template is available for "${doc.title}"`,
        body: `Checklist template v${template.version} replaces v${c.templateVersion}. Your checklist stays on v${c.templateVersion} until you review and adopt the changes from the Checklist panel.${reason}`,
      })
    }
    for (const recipientId of pms) {
      await notifications.send({
        recipientId, kind: TEMPLATE_UPDATE_PM_KIND, linkPath, payload,
        title: `Checklist template v${template.version} affects "${doc.title}"`,
        body: `The document's checklist is on v${c.templateVersion}. Its Author can review and adopt v${template.version}; nothing changes until they do.${reason}`,
      })
    }
  }
  await prisma.checklistInstance.updateMany({ where: { id: { in: affected.map(c => c.id) } }, data: { notificationSentAt: new Date() } })
  return docIds
}
