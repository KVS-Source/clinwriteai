// Platform-level checklist baseline — one ChecklistTemplate per Module A
// deliverable type, each pre-loaded with the framework-mandatory items
// Admins should always see. Shipped in code (not an admin screen) so the
// compliance floor can't be edited mid-flight by accident.
//
// Idempotency rules:
//   - A platform baseline is a ChecklistTemplate with projectId=NULL.
//   - Keyed on (deliverableType, projectId=NULL, version=1).
//   - On re-run, items are reconciled by `(templateId, text)` — new items
//     are inserted, missing-from-code items left in place (we never delete
//     seeded rows on re-run because instance items may be referencing them).
//
// Called from prisma/seed.ts and from the standalone backfill script.

import type { PrismaClient } from '@prisma/client'

export interface BaselineItem {
  text: string
  framework: string                                   // e.g. "ICH E3", "21 CFR Part 11"
  frameworkMandatory?: boolean                        // default true
  ownerRaci: 'R' | 'A' | 'C' | 'I'
  stage:
    | 'study_start_up'
    | 'during_study'
    | 'reporting'
    | 'cross_functional_review'
    | 'crm'
    | 'final_output'
  autoCompleteOn?: 'submit_for_review' | 'crm_complete' | 'document_signed' | null
}

/**
 * Keyed by document type (DB form — underscored). Keep each type to the
 * minimum compliance floor; Admins add project-specific items on top.
 */
export const BASELINE_ITEMS: Record<string, BaselineItem[]> = {
  csr_full: [
    { text: 'Study title and identifiers match the protocol',          framework: 'ICH E3',          ownerRaci: 'R', stage: 'study_start_up' },
    { text: 'Ethics committee / IRB approvals attached',               framework: 'ICH E6',          ownerRaci: 'A', stage: 'study_start_up' },
    { text: 'Investigator credentials verified and on file',           framework: 'ICH E6',          ownerRaci: 'C', stage: 'study_start_up' },
    { text: 'Informed consent process documented for every subject',   framework: '21 CFR 50',       ownerRaci: 'R', stage: 'during_study' },
    { text: 'Protocol deviations logged and reviewed',                 framework: 'ICH E6',          ownerRaci: 'R', stage: 'during_study' },
    { text: 'Statistical Analysis Plan finalised and locked',          framework: 'ICH E9',          ownerRaci: 'C', stage: 'reporting' },
    { text: 'Database lock completed and audited',                     framework: 'ICH E6',          ownerRaci: 'A', stage: 'reporting' },
    { text: 'Author draft completed and submitted for review',         framework: 'SOP',             ownerRaci: 'R', stage: 'cross_functional_review', autoCompleteOn: 'submit_for_review' },
    { text: 'Medical review completed and signed off',                 framework: 'ICH E3',          ownerRaci: 'C', stage: 'cross_functional_review' },
    { text: 'Cross-functional review meeting minutes recorded',        framework: 'SOP',             ownerRaci: 'A', stage: 'crm', autoCompleteOn: 'crm_complete' },
    { text: 'Final signature by Medical Director',                     framework: '21 CFR Part 11',  ownerRaci: 'A', stage: 'final_output', autoCompleteOn: 'document_signed' },
  ],
  csr_synopsis: [
    { text: 'Study design summary matches the full CSR',               framework: 'ICH E3 §2',       ownerRaci: 'R', stage: 'study_start_up' },
    { text: 'Primary endpoint result captured',                        framework: 'ICH E9',          ownerRaci: 'R', stage: 'reporting' },
    { text: 'Medical reviewer sign-off recorded',                      framework: 'SOP',             ownerRaci: 'C', stage: 'cross_functional_review', autoCompleteOn: 'submit_for_review' },
    { text: 'Final approval signed',                                   framework: '21 CFR Part 11',  ownerRaci: 'A', stage: 'final_output', autoCompleteOn: 'document_signed' },
  ],
  protocol: [
    { text: 'Protocol synopsis complete',                              framework: 'ICH E6',          ownerRaci: 'R', stage: 'study_start_up' },
    { text: 'Risk-based monitoring plan documented',                   framework: 'ICH E6',          ownerRaci: 'C', stage: 'study_start_up' },
    { text: 'Statistical considerations detailed',                     framework: 'ICH E9',          ownerRaci: 'C', stage: 'study_start_up' },
    { text: 'Investigator Brochure cross-referenced',                  framework: 'ICH E6',          ownerRaci: 'R', stage: 'study_start_up' },
    { text: 'Regulatory authority approval received',                  framework: 'ICH E6',          ownerRaci: 'A', stage: 'during_study' },
    { text: 'Cross-functional review complete',                        framework: 'SOP',             ownerRaci: 'C', stage: 'crm', autoCompleteOn: 'crm_complete' },
    { text: 'Final approval signatures captured',                      framework: '21 CFR Part 11',  ownerRaci: 'A', stage: 'final_output', autoCompleteOn: 'document_signed' },
  ],
  protocol_amendment: [
    { text: 'Rationale for amendment documented',                      framework: 'ICH E6 §6.2',     ownerRaci: 'R', stage: 'study_start_up' },
    { text: 'Impact on consent form assessed',                         framework: 'ICH E6',          ownerRaci: 'A', stage: 'study_start_up' },
    { text: 'IRB / Ethics Committee notified',                         framework: 'ICH E6',          ownerRaci: 'A', stage: 'during_study' },
    { text: 'Amendment approved by sponsor',                           framework: '21 CFR Part 11',  ownerRaci: 'A', stage: 'final_output', autoCompleteOn: 'document_signed' },
  ],
  ib: [
    { text: 'Preclinical data summarised',                             framework: 'ICH E6 §7',       ownerRaci: 'R', stage: 'study_start_up' },
    { text: 'Clinical data to date summarised',                        framework: 'ICH E6 §7',       ownerRaci: 'R', stage: 'study_start_up' },
    { text: 'Safety profile overview included',                        framework: 'ICH E6 §7',       ownerRaci: 'C', stage: 'study_start_up' },
    { text: 'Guidance for the investigator included',                  framework: 'ICH E6 §7',       ownerRaci: 'R', stage: 'study_start_up' },
    { text: 'Annual update scheduled',                                 framework: 'ICH E6',          ownerRaci: 'A', stage: 'final_output', autoCompleteOn: 'document_signed' },
  ],
  icf: [
    { text: 'Required consent elements present',                       framework: '21 CFR 50.25',    ownerRaci: 'R', stage: 'study_start_up' },
    { text: 'Language in plain terms (reading grade reviewed)',        framework: '21 CFR 50',       ownerRaci: 'C', stage: 'study_start_up' },
    { text: 'IRB / EC approval attached',                              framework: '21 CFR 50',       ownerRaci: 'A', stage: 'study_start_up' },
    { text: 'Translations verified where applicable',                  framework: 'ICH E6',          ownerRaci: 'C', stage: 'during_study' },
    { text: 'Sponsor signature on final version',                      framework: '21 CFR Part 11',  ownerRaci: 'A', stage: 'final_output', autoCompleteOn: 'document_signed' },
  ],
  safety_narrative: [
    { text: 'Patient identifier and demographics confirmed',           framework: 'ICH E3 §12.3',    ownerRaci: 'R', stage: 'during_study' },
    { text: 'Timeline of events documented',                           framework: 'ICH E3 §12.3',    ownerRaci: 'R', stage: 'during_study' },
    { text: 'Causality assessment included',                           framework: 'ICH E2A',         ownerRaci: 'C', stage: 'reporting' },
    { text: 'Reviewed by medical monitor',                             framework: 'SOP',             ownerRaci: 'C', stage: 'cross_functional_review', autoCompleteOn: 'submit_for_review' },
    { text: 'Final approval obtained',                                 framework: '21 CFR Part 11',  ownerRaci: 'A', stage: 'final_output', autoCompleteOn: 'document_signed' },
  ],
  dsur: [
    { text: 'Reporting period clearly defined',                        framework: 'ICH E2F',         ownerRaci: 'R', stage: 'study_start_up' },
    { text: 'Cumulative exposure data included',                       framework: 'ICH E2F',         ownerRaci: 'R', stage: 'during_study' },
    { text: 'Serious adverse events listed with analysis',             framework: 'ICH E2F',         ownerRaci: 'R', stage: 'reporting' },
    { text: 'Risk–benefit assessment updated',                         framework: 'ICH E2F',         ownerRaci: 'C', stage: 'reporting' },
    { text: 'Submitted to regulatory authorities',                     framework: '21 CFR 312.33',   ownerRaci: 'A', stage: 'final_output', autoCompleteOn: 'document_signed' },
  ],
  'end-of-study-summary': [
    { text: 'Final subject disposition recorded',                      framework: 'ICH E3',          ownerRaci: 'R', stage: 'reporting' },
    { text: 'All regulatory submissions complete',                     framework: 'ICH E6',          ownerRaci: 'A', stage: 'final_output' },
    { text: 'Database locked and archived',                            framework: '21 CFR Part 11',  ownerRaci: 'A', stage: 'final_output', autoCompleteOn: 'document_signed' },
  ],
  patient_narrative: [
    { text: 'All serious adverse events covered',                      framework: 'ICH E3 §12.3',    ownerRaci: 'R', stage: 'during_study' },
    { text: 'MedDRA coding verified',                                  framework: 'MedDRA',          ownerRaci: 'C', stage: 'reporting' },
    { text: 'Reviewed by medical lead',                                framework: 'SOP',             ownerRaci: 'C', stage: 'cross_functional_review', autoCompleteOn: 'submit_for_review' },
    { text: 'Final approval obtained',                                 framework: '21 CFR Part 11',  ownerRaci: 'A', stage: 'final_output', autoCompleteOn: 'document_signed' },
  ],
}

/**
 * Normalise deliverable-type keys so both hyphenated and underscored
 * spellings map to the same canonical key when looking up the baseline.
 */
export function normaliseDeliverableType(s: string): string {
  return s.replace(/-/g, '_')
}

export interface SeedBaselineOptions {
  /** User id to credit as createdBy / approvedBy on seeded rows. */
  actorId: string
}

export interface SeedBaselineReport {
  templatesTouched: number
  templatesCreated: number
  itemsCreated: number
  itemsPreserved: number
}

/**
 * Ensure a platform-baseline ChecklistTemplate (projectId=NULL, locked)
 * exists for every type in BASELINE_ITEMS, with its full item set. Items
 * are reconciled by text — new items are inserted; items already present
 * on a template are left alone (so instance snapshots can still FK to
 * them). Running this twice is a no-op.
 */
export async function seedChecklistBaseline(
  prisma: PrismaClient,
  opts: SeedBaselineOptions,
): Promise<SeedBaselineReport> {
  const report: SeedBaselineReport = {
    templatesTouched: 0,
    templatesCreated: 0,
    itemsCreated: 0,
    itemsPreserved: 0,
  }

  for (const [deliverableType, items] of Object.entries(BASELINE_ITEMS)) {
    const canonical = normaliseDeliverableType(deliverableType)
    report.templatesTouched++

    // Look up by (deliverableType=canonical, projectId=NULL, version=1).
    // The pre-existing fallback rows (projectId NULL by default on
    // post-migration DBs) are reused — we attach items to them rather than
    // creating a parallel baseline that'd leave the fallbacks dangling.
    let template = await prisma.checklistTemplate.findFirst({
      where: { deliverableType: canonical, projectId: null, version: 1 },
    })

    if (!template) {
      template = await prisma.checklistTemplate.create({
        data: {
          deliverableType: canonical,
          projectId: null,
          version: 1,
          effectiveDate: new Date(),
          changeReason: 'Platform baseline (phase 1 seed)',
          isCurrent: true,
          templateStatus: 'locked',
          approvedBy: opts.actorId,
          approvedAt: new Date(),
          createdBy: opts.actorId,
        },
      })
      report.templatesCreated++
    } else if (template.templateStatus !== 'locked' || !template.approvedAt) {
      // An older fallback (changeReason "Auto-created fallback…") gets
      // upgraded: still version 1, still projectId NULL, but now stamped
      // as the approved baseline so the Phase 2 gates can trust it.
      await prisma.checklistTemplate.update({
        where: { id: template.id },
        data: {
          changeReason: 'Platform baseline (phase 1 seed) — upgraded from fallback',
          templateStatus: 'locked',
          approvedBy: opts.actorId,
          approvedAt: new Date(),
          effectiveDate: template.effectiveDate ?? new Date(),
        },
      })
    }

    // Reconcile items by text (case-sensitive). Not using (templateId,
    // text) as a DB unique because a project override may legitimately
    // repeat an item text with different stage/ownerRaci; here we're
    // reconciling the SAME baseline against itself across re-runs.
    const existing = await prisma.checklistTemplateItem.findMany({
      where: { templateId: template.id },
      select: { text: true },
    })
    const have = new Set(existing.map(r => r.text))

    let sortOrder = (await prisma.checklistTemplateItem.aggregate({
      where: { templateId: template.id },
      _max: { sortOrder: true },
    }))._max.sortOrder ?? 0

    for (const item of items) {
      if (have.has(item.text)) {
        report.itemsPreserved++
        continue
      }
      sortOrder += 10
      await prisma.checklistTemplateItem.create({
        data: {
          templateId: template.id,
          text: item.text,
          framework: item.framework,
          frameworkMandatory: item.frameworkMandatory ?? true,
          ownerRaci: item.ownerRaci,
          stage: item.stage,
          autoCompleteOn: item.autoCompleteOn ?? null,
          sortOrder,
        },
      })
      report.itemsCreated++
    }
  }

  return report
}
