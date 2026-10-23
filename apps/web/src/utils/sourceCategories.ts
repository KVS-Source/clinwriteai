// Source-document categories — mirror of apps/api/.../documents/source-categories.ts.
// Sources are evidence from many systems, so this is separate from the authored
// document types (CSR, Protocol, …) that Clinical Writing generates.

export const SOURCE_CATEGORIES: { value: string; label: string }[] = [
  { value: 'protocol',   label: 'Protocol' },
  { value: 'sap',        label: 'Statistical Analysis Plan (SAP)' },
  { value: 'tlf',        label: 'Tables, listings & figures (TLF)' },
  { value: 'ib',         label: "Investigator's Brochure" },
  { value: 'icf',        label: 'Informed Consent Form' },
  { value: 'crf',        label: 'CRF / EDC export' },
  { value: 'lab_data',   label: 'Lab data' },
  { value: 'csr',        label: 'Prior CSR' },
  { value: 'regulatory', label: 'Regulatory correspondence' },
  { value: 'other',      label: 'Other' },
]

export const sourceCategoryLabel = (v: string | null | undefined): string =>
  SOURCE_CATEGORIES.find(c => c.value === v)?.label ?? (v ? v.replace(/[_-]+/g, ' ') : '—')
