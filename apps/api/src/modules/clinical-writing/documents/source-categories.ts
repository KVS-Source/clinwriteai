// Categories for uploaded source documents (evidence a CW document is written
// from). Deliberately separate from the output document types in templates.ts:
// sources come from many systems and often fit none of the authored types.

export const SOURCE_CATEGORIES = [
  'protocol', 'sap', 'tlf', 'ib', 'icf', 'crf', 'lab_data', 'csr', 'regulatory', 'other',
] as const
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number]

// Display names — a copy of apps/web/src/utils/sourceCategories.ts (the API can't import the web
// package at runtime). source-category-labels.test.ts fails if the two lists drift apart. Search
// matches these, so "Brochure" or "Tables" finds what the Category column shows.
export const SOURCE_CATEGORY_LABEL: Record<SourceCategory, string> = {
  protocol:   'Protocol',
  sap:        'Statistical Analysis Plan (SAP)',
  tlf:        'Tables, listings & figures (TLF)',
  ib:         "Investigator's Brochure",
  icf:        'Informed Consent Form',
  crf:        'CRF / EDC export',
  lab_data:   'Lab data',
  csr:        'Prior CSR',
  regulatory: 'Regulatory correspondence',
  other:      'Other',
}

// A filename token match. `_` counts as a separator (unlike \b).
const tok = (words: string) => new RegExp(`(^|[^a-z0-9])(${words})([^a-z0-9]|$)`)

const RULES: Array<[SourceCategory, RegExp, number]> = [
  ['sap',      /statistical.?analysis.?plan|(^|[^a-z0-9])sap([^a-z0-9]|$)/, 90],
  ['lab_data', /lab(oratory)?[^a-z0-9]?(data|listing|results?)|(^|[^a-z0-9])lab([^a-z0-9]|$)/, 75],
  ['tlf',      tok('tlfs?|tables?|listings?|figures?'), 85],
  ['protocol', /protocol/, 90],
  ['ib',       /investigator.?brochure|(^|[^a-z0-9])ib([^a-z0-9]|$)/, 88],
  ['icf',      /informed.?consent|(^|[^a-z0-9])icf([^a-z0-9]|$)/, 85],
  ['crf',      tok('crfs?|edc|case.?report.?forms?'), 80],
  ['csr',      /csr|clinical.?study.?report/, 85],
  ['regulatory', /(^|[^a-z0-9])(fda|ema|hpra|correspondence|ind|cta)([^a-z0-9]|$)/, 70],
]

/** Filename-based guess. Falls back to 'other' (confidence 0) — never to a real category. */
export function suggestSourceCategory(fileName: string): { category: SourceCategory; confidence: number } {
  const lc = fileName.toLowerCase()
  for (const [category, re, confidence] of RULES) if (re.test(lc)) return { category, confidence }
  return { category: 'other', confidence: 0 }
}
