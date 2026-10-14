// ICH E3 section templates applied when a document is created, so a new
// document opens with its section navigator populated instead of "0 of 0
// sections". IDs + numbers follow the seeded fixtures (apps/web/src/data/
// documents.json) so new and seeded documents share one section shape.
//
// Only types with an agreed structure are templated; other types still
// start empty until their templates are defined.

import type { SectionPayload } from './service.js'

type TemplateSection = { id: string; number: string; title: string; usOnly?: boolean }

const CSR_FULL: TemplateSection[] = [
  { id: 's1',    number: '§1',    title: 'Title Page' },
  { id: 's2',    number: '§2',    title: 'Synopsis' },
  { id: 's3',    number: '§3',    title: 'Table of Contents' },
  { id: 's4',    number: '§4',    title: 'List of Abbreviations' },
  { id: 's5',    number: '§5',    title: 'Ethics' },
  { id: 's6',    number: '§6',    title: 'Investigators & Sites' },
  { id: 's7',    number: '§7',    title: 'Introduction' },
  { id: 's8',    number: '§8',    title: 'Study Objectives' },
  { id: 's9',    number: '§9',    title: 'Investigational Plan' },
  { id: 's10',   number: '§10',   title: 'Study Patients' },
  { id: 's11',   number: '§11',   title: 'Efficacy Evaluation' },
  { id: 's11_4', number: '§11.4', title: 'Primary Efficacy Analysis' },
  { id: 's12',   number: '§12',   title: 'Safety Evaluation' },
  { id: 's13',   number: '§13',   title: 'Discussion & Conclusions' },
  { id: 's14',   number: '§14',   title: 'References' },
  // FR-A-003: Section 16 appendices are a per-project, per-country checklist.
  { id: 's16_1', number: '§16.1', title: 'Study Information' },
  { id: 's16_2', number: '§16.2', title: 'Patient Data Listings' },
  { id: 's16_4', number: '§16.4', title: 'Individual Patient Data', usOnly: true },
]

const CSR_SYNOPSIS: TemplateSection[] = [
  { id: 'syn1',  number: '§1',  title: 'Title & Study Identifier' },
  { id: 'syn2',  number: '§2',  title: 'Study Centre(s)' },
  { id: 'syn3',  number: '§3',  title: 'Publications (Bibliography)' },
  { id: 'syn4',  number: '§4',  title: 'Study Period (Dates)' },
  { id: 'syn5',  number: '§5',  title: 'Phase of Development' },
  { id: 'syn6',  number: '§6',  title: 'Objectives' },
  { id: 'syn7',  number: '§7',  title: 'Methodology / Study Design' },
  { id: 'syn8',  number: '§8',  title: 'Number of Subjects (Planned & Analysed)' },
  { id: 'syn9',  number: '§9',  title: 'Diagnosis & Main Criteria for Inclusion' },
  { id: 'syn10', number: '§10', title: 'Test Product, Dose & Mode of Administration' },
  { id: 'syn11', number: '§11', title: 'Duration of Treatment' },
  { id: 'syn12', number: '§12', title: 'Reference Therapy' },
  { id: 'syn13', number: '§13', title: 'Criteria for Evaluation (Efficacy / Safety)' },
  { id: 'syn14', number: '§14', title: 'Statistical Methods' },
  { id: 'syn15', number: '§15', title: 'Summary of Efficacy Results' },
  { id: 'syn16', number: '§16', title: 'Summary of Safety Results' },
  { id: 'syn17', number: '§17', title: 'Conclusions' },
]

// The UI sends hyphen-case types ('csr-full'); older rows use snake_case.
const TEMPLATES: Record<string, TemplateSection[]> = {
  'csr-full': CSR_FULL,
  'csr-synopsis': CSR_SYNOPSIS,
}

/** Empty starter sections for `type`, or [] when the type has no template. */
export function templateSections(type: string, submissionCountries: readonly string[] = []): SectionPayload[] {
  const template = TEMPLATES[type.replace(/_/g, '-')] ?? []
  const isUs = submissionCountries.some(c => c.trim().toUpperCase() === 'US')
  return template
    .filter(s => !s.usOnly || isUs)
    .map(s => ({
      sectionId: s.id,
      sectionNumber: s.number,
      sectionTitle: s.title,
      contentHtml: '',
      ichStatus: 'not_started',
    }))
}
