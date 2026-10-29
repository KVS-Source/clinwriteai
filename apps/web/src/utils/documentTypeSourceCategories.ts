// Document type → required source categories.
//
// Used by the New Document wizard (step 2) to filter the source-document
// picker to only the categories that make sense for the chosen type —
// e.g. a CSR Full is written from Protocol + SAP + TLF + CRF/lab data,
// not from Regulatory correspondence.
//
// Keys match DocumentType in packages/types (hyphenated), values match
// SOURCE_CATEGORIES.value in utils/sourceCategories.ts.
//
// Hardcoded today — the user has the category column on every source
// document, so the mapping is just the filter rule. If this ever needs
// per-tenant tweaking, move it to a DB-backed template row (planned
// as M2 of the New Document rework).

export const SOURCE_CATEGORIES_BY_DOC_TYPE: Record<string, readonly string[]> = {
  'csr-full':             ['protocol', 'sap', 'tlf', 'crf', 'lab_data'],
  'csr-synopsis':         ['protocol', 'sap', 'tlf'],
  'protocol':             ['ib', 'regulatory'],
  'protocol-amendment':   ['protocol', 'regulatory'],
  'ib':                   ['csr', 'regulatory'],
  'icf':                  ['protocol', 'icf', 'regulatory'],
  'safety-narrative':     ['crf', 'lab_data'],
  'dsur':                 ['csr', 'protocol', 'regulatory'],
  'end-of-study-summary': ['csr'],
  'patient-narrative':    ['crf', 'lab_data'],
}

/** Returns the source categories a document of this type should be written from, or null if unknown. */
export function sourceCategoriesForDocType(docType: string): readonly string[] | null {
  return SOURCE_CATEGORIES_BY_DOC_TYPE[docType] ?? null
}
