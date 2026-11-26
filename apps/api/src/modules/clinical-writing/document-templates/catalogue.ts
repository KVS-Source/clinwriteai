// The ten clinical-writing document types the platform ships, with the
// metadata (label, description, framework, required source categories)
// the Template Library would otherwise ask an admin to type. The
// create + parse-file routes fill missing fields from here when the
// admin only picks a type from the dropdown.
//
// Kept in sync with:
//   - apps/web/src/screens/clinical-writing/NewDocument.tsx (the type list the wizard shows)
//   - apps/api/prisma/seeds/document-templates.ts            (the initial DB rows)

export interface CatalogueEntry {
  type:                     string
  label:                    string
  description:              string
  framework:                string
  requiredSourceCategories: string[]
}

export const DOCUMENT_TEMPLATE_CATALOGUE: readonly CatalogueEntry[] = [
  { type: 'csr-full',             label: 'CSR (Full)',             description: 'Full Clinical Study Report — ICH E3 structure.',       framework: 'ICH E3',                 requiredSourceCategories: ['protocol', 'sap', 'tlf', 'crf', 'lab_data'] },
  { type: 'csr-synopsis',         label: 'CSR Synopsis',           description: 'Study report synopsis for regulatory submission.',     framework: 'ICH E3',                 requiredSourceCategories: ['protocol', 'sap', 'tlf'] },
  { type: 'protocol',             label: 'Protocol',               description: 'Study protocol — ICH E6(R3) GCP compliance.',          framework: 'ICH E6(R3)',             requiredSourceCategories: ['ib', 'regulatory'] },
  { type: 'protocol-amendment',   label: 'Protocol Amendment',     description: 'Amendment to an in-progress protocol.',                framework: 'ICH E6(R3)',             requiredSourceCategories: ['protocol', 'regulatory'] },
  { type: 'ib',                   label: 'Investigator Brochure',  description: "Investigator's Brochure (IB).",                        framework: 'ICH E6(R3)',             requiredSourceCategories: ['csr', 'regulatory'] },
  { type: 'icf',                  label: 'Informed Consent Form',  description: 'ICF — 21 CFR Part 50 + IRB review.',                   framework: '21 CFR Part 50',         requiredSourceCategories: ['protocol', 'icf', 'regulatory'] },
  { type: 'safety-narrative',     label: 'Safety Narrative',       description: 'Individual safety narrative.',                         framework: 'ICH E2A',                requiredSourceCategories: ['crf', 'lab_data'] },
  { type: 'dsur',                 label: 'DSUR',                   description: 'Development Safety Update Report — ICH E2F.',          framework: 'ICH E2F',                requiredSourceCategories: ['csr', 'protocol', 'regulatory'] },
  { type: 'end-of-study-summary', label: 'End-of-Study Summary',   description: 'EU CTR Article 37 summary.',                           framework: 'EU CTR 536/2014 Annex IV', requiredSourceCategories: ['csr'] },
  { type: 'patient-narrative',    label: 'Patient Narrative',      description: 'Patient-level clinical narrative.',                    framework: 'ICH E3',                 requiredSourceCategories: ['crf', 'lab_data'] },
] as const

const CATALOGUE_BY_TYPE: ReadonlyMap<string, CatalogueEntry> =
  new Map(DOCUMENT_TEMPLATE_CATALOGUE.map(e => [e.type, e]))

export function catalogueEntry(type: string): CatalogueEntry | undefined {
  return CATALOGUE_BY_TYPE.get(type)
}
