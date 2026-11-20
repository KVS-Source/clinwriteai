// Checklist items imported from a CSV file (the "New checklist template" dialog). A spreadsheet kept on a shared
// drive is saved as CSV and picked here; each row becomes one item of the new draft. Headers are matched loosely
// (case, spaces and a few synonyms), stages accept the key or the label shown on screen, and every row that can't
// be used is reported with its line number instead of being dropped silently.

export type ImportStage = 'study_start_up' | 'during_study' | 'reporting' | 'cross_functional_review' | 'crm' | 'final_output'
export type ImportRaci = 'R' | 'A' | 'C' | 'Q' | 'I'
export interface ImportedItem {
  text: string
  framework: string
  frameworkMandatory: boolean
  ownerRaci: ImportRaci
  stage: ImportStage
  autoCompleteOn: string | null
}
export interface ImportResult { items: ImportedItem[]; errors: string[] }

/** A sample file the dialog offers for download, so the columns are right the first time. */
export const CHECKLIST_CSV_SAMPLE =
  'Item,Framework,Mandatory,Owner,Stage,Auto complete\n' +
  '"Synopsis matches the protocol objectives",ICH E3,Yes,R,Post-Study,\n' +
  '"QC of all in-text tables against TFLs",SOP-QC-01,No,Q,Cross-Functional Review,\n' +
  '"Document signed by the medical monitor",21 CFR Part 11,Yes,A,Final Output,document_signed\n'

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

const HEADER_ALIASES: Record<keyof ImportedItem, string[]> = {
  text:               ['item', 'text', 'checklist_item', 'description', 'requirement'],
  framework:          ['framework', 'ich_framework', 'guideline', 'reference'],
  frameworkMandatory: ['mandatory', 'framework_mandatory', 'required'],
  ownerRaci:          ['owner', 'raci', 'owner_raci', 'role'],
  stage:              ['stage', 'phase'],
  autoCompleteOn:     ['auto_complete', 'autocomplete', 'auto_complete_on', 'autocompleteon', 'auto_rule'],
}

const STAGE_ALIASES: Record<string, ImportStage> = {
  study_start_up: 'study_start_up', study_startup: 'study_start_up', start_up: 'study_start_up', startup: 'study_start_up',
  during_study: 'during_study',
  reporting: 'reporting', post_study: 'reporting',
  cross_functional_review: 'cross_functional_review', cross_functional: 'cross_functional_review', review: 'cross_functional_review',
  crm: 'crm', comment_resolution: 'crm', comment_resolution_meeting: 'crm',
  final_output: 'final_output', final: 'final_output',
}

/** RFC 4180-style CSV: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF or LF. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(f => f.trim() !== ''))
}

export function importChecklistCsv(input: string): ImportResult {
  const rows = parseCsv(input)
  if (rows.length === 0) return { items: [], errors: ['The file is empty.'] }
  const header = rows[0]!.map(norm)
  const col = (key: keyof ImportedItem) => header.findIndex(h => HEADER_ALIASES[key].includes(h))
  const idx = { text: col('text'), framework: col('framework'), frameworkMandatory: col('frameworkMandatory'), ownerRaci: col('ownerRaci'), stage: col('stage'), autoCompleteOn: col('autoCompleteOn') }
  const missing = (['text', 'framework', 'stage'] as const).filter(k => idx[k] < 0)
  if (missing.length > 0) {
    return { items: [], errors: [`Missing column${missing.length > 1 ? 's' : ''}: ${missing.map(k => ({ text: 'Item', framework: 'Framework', stage: 'Stage' })[k]).join(', ')}. The first row must name the columns.`] }
  }

  const items: ImportedItem[] = []
  const errors: string[] = []
  rows.slice(1).forEach((r, i) => {
    const line = i + 2
    const get = (k: keyof typeof idx) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '')
    const text = get('text')
    const framework = get('framework')
    const stage = STAGE_ALIASES[norm(get('stage'))]
    const raciRaw = get('ownerRaci').toUpperCase()
    const ownerRaci = (raciRaw === '' ? 'R' : raciRaw.charAt(0)) as ImportRaci
    const problems: string[] = []
    if (!text) problems.push('no item text')
    else if (text.length > 500) problems.push('item text is over 500 characters')
    if (!framework) problems.push('no framework')
    else if (framework.length > 100) problems.push('framework is over 100 characters')
    if (!stage) problems.push(`unknown stage "${get('stage')}"`)
    if (!['R', 'A', 'C', 'Q', 'I'].includes(ownerRaci)) problems.push(`owner "${get('ownerRaci')}" is not one of R, A, C, Q, I`)
    if (problems.length > 0) { errors.push(`Row ${line}: ${problems.join('; ')}.`); return }
    items.push({
      text, framework, ownerRaci, stage: stage!,
      frameworkMandatory: ['yes', 'y', 'true', '1', 'mandatory', 'required'].includes(get('frameworkMandatory').toLowerCase()),
      autoCompleteOn: get('autoCompleteOn') || null,
    })
  })
  if (items.length > 500) return { items: [], errors: ['A template can hold at most 500 items; split the file.'] }
  return { items, errors }
}
