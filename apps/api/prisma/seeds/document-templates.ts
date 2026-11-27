// Platform-level document templates — one per Clinical Writing deliverable
// type, pre-loaded with the ICH-aligned section skeleton + the source
// categories that type is typically written from. Shipped in code (not an
// admin screen) so the canonical structure can't be mutated mid-flight by
// accident; a future Admin UI will allow forking + custom templates.
//
// Idempotency rules:
//   - A current template is DocumentTemplate with isCurrent=TRUE.
//   - On re-run, we upsert by (type, isCurrent=TRUE). The migration-level
//     partial unique index enforces at most one current row per type.
//   - If a row with the same type already exists AND its sections or
//     requiredSourceCategories differ from the seed, we leave it alone
//     (do not clobber local edits). Future "force refresh" tooling can
//     bump version + supersede the current row.
//
// Scope (2026-11-27): Protocol-only. The seed previously shipped 10
// templates (CSR Full / Synopsis, DSUR, End-of-Study Summary, ICF, IB,
// Patient Narrative, Protocol, Protocol Amendment, Safety Narrative).
// Removing a template via the admin UI didn't stick because the next
// deploy re-created it — the seed only checks "does a current row
// exist?" If no, create. So admin deletions were silently undone.
// Ship-list trimmed to Protocol only; new templates come in via the
// admin "+ New template" flow + are persisted in the DB only (not
// re-created by the seed).
//
// Called from prisma/seed.ts after the baseline tenant + users exist.

import type { PrismaClient } from '@prisma/client'

export interface TemplateSectionSeed {
  id:      string
  number:  string
  title:   string
  usOnly?: boolean
}

export interface TemplateSeed {
  type:                     string
  label:                    string
  description:              string
  framework:                string
  sections:                 TemplateSectionSeed[]
  requiredSourceCategories: string[]
}

// ---------- Section skeletons ----------

const PROTOCOL_SECTIONS: TemplateSectionSeed[] = [
  { id: 'p1',  number: '§1',  title: 'Protocol Signature Page' },
  { id: 'p2',  number: '§2',  title: 'Protocol Synopsis' },
  { id: 'p3',  number: '§3',  title: 'Schema / Flow Chart' },
  { id: 'p4',  number: '§4',  title: 'Table of Contents' },
  { id: 'p5',  number: '§5',  title: 'Background & Study Rationale' },
  { id: 'p6',  number: '§6',  title: 'Objectives and Endpoints' },
  { id: 'p7',  number: '§7',  title: 'Study Design' },
  { id: 'p8',  number: '§8',  title: 'Study Population (Inclusion/Exclusion)' },
  { id: 'p9',  number: '§9',  title: 'Method of Treatment Assignment & Blinding' },
  { id: 'p10', number: '§10', title: 'Study Treatment' },
  { id: 'p11', number: '§11', title: 'Concomitant Therapy' },
  { id: 'p12', number: '§12', title: 'Study Assessments' },
  { id: 'p13', number: '§13', title: 'Assessment of Safety' },
  { id: 'p14', number: '§14', title: 'Statistical Considerations' },
  { id: 'p15', number: '§15', title: 'Data Collection, Management & QA' },
  { id: 'p16', number: '§16', title: 'Ethics & Regulatory' },
  { id: 'p17', number: '§17', title: 'References' },
  { id: 'p18', number: '§18', title: 'Appendices' },
]

// ---------- Full template seeds (type → everything) ----------

export const DOCUMENT_TEMPLATE_SEEDS: TemplateSeed[] = [
  {
    type:                     'protocol',
    label:                    'Protocol',
    description:              'Study protocol — ICH E6(R3) GCP compliance.',
    framework:                'ICH E6(R3)',
    sections:                 PROTOCOL_SECTIONS,
    requiredSourceCategories: ['ib', 'regulatory'],
  },
]

export interface SeedReport {
  inserted: number
  skipped:  number   // existed with same type + isCurrent=true, left alone
  errors:   Array<{ type: string; error: string }>
}

/**
 * Idempotent seed. Writes any missing document templates (keyed by
 * `type` with `isCurrent=TRUE`) and leaves existing current rows
 * untouched — operators can edit a template without worrying about the
 * next seed run clobbering them.
 */
export async function seedDocumentTemplates(prisma: PrismaClient, actorId: string): Promise<SeedReport> {
  const report: SeedReport = { inserted: 0, skipped: 0, errors: [] }

  for (const seed of DOCUMENT_TEMPLATE_SEEDS) {
    try {
      const existing = await prisma.documentTemplate.findFirst({
        where: { type: seed.type, isCurrent: true },
        select: { id: true },
      })
      if (existing) {
        report.skipped++
        continue
      }
      await prisma.documentTemplate.create({
        data: {
          type:                     seed.type,
          label:                    seed.label,
          description:              seed.description,
          framework:                seed.framework,
          sections:                 seed.sections as unknown as object,
          requiredSourceCategories: seed.requiredSourceCategories,
          createdBy:                actorId,
        },
      })
      report.inserted++
    } catch (err) {
      report.errors.push({ type: seed.type, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return report
}
