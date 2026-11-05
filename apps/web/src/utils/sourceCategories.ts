// Source-document categories — mirror of apps/api/.../documents/source-categories.ts.
// Sources are evidence from many systems, so this is separate from the authored
// document types (CSR, Protocol, …) that Clinical Writing generates.

import i18n from '../i18n'

export const SOURCE_CATEGORIES: { value: string; labelKey: string }[] = [
  { value: 'protocol',   labelKey: 'component.source_categories.protocol' },
  { value: 'sap',        labelKey: 'component.source_categories.sap' },
  { value: 'tlf',        labelKey: 'component.source_categories.tlf' },
  { value: 'ib',         labelKey: 'component.source_categories.ib' },
  { value: 'icf',        labelKey: 'component.source_categories.icf' },
  { value: 'crf',        labelKey: 'component.source_categories.crf' },
  { value: 'lab_data',   labelKey: 'component.source_categories.lab_data' },
  { value: 'csr',        labelKey: 'component.source_categories.csr' },
  { value: 'regulatory', labelKey: 'component.source_categories.regulatory' },
  { value: 'other',      labelKey: 'component.source_categories.other' },
]

export const sourceCategoryLabel = (v: string | null | undefined): string => {
  const known = SOURCE_CATEGORIES.find(c => c.value === v)
  return known ? i18n.t(known.labelKey) : (v ? v.replace(/[_-]+/g, ' ') : '—')
}
