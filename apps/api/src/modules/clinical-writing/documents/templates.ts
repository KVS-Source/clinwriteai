// ICH E3 section templates applied when a document is created, so a new
// document opens with its section navigator populated instead of "0 of 0
// sections". IDs + numbers follow the seeded fixtures (apps/web/src/data/
// documents.json) so new and seeded documents share one section shape.
//
// Every type offered in the New Document form has a template — a document
// created with no sections can't be edited at all. Structures follow the seeded
// fixtures with study-specific wording removed; End-of-Study Summary (no fixture)
// follows the EU CTR 536/2014 Annex IV summary-of-results headings.

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

const PROTOCOL: TemplateSection[] = [
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

const PROTOCOL_AMENDMENT: TemplateSection[] = [
  { id: 'pa1', number: '§1', title: 'Protocol Amendment Summary of Changes' },
  { id: 'pa2', number: '§2', title: 'Rationale for Amendment' },
  { id: 'pa3', number: '§3', title: 'Detailed Changes by Protocol Section' },
  { id: 'pa4', number: '§4', title: 'Impact on Participants & Benefit–Risk' },
  { id: 'pa5', number: '§5', title: 'Updated Statistical Considerations' },
  { id: 'pa6', number: '§6', title: 'Updated Assessment Schedule' },
  { id: 'pa7', number: '§7', title: 'IRB / EC Notification Log' },
]

const IB: TemplateSection[] = [
  { id: 'ib1',  number: '§1',  title: 'Summary' },
  { id: 'ib2',  number: '§2',  title: 'Introduction and Development Rationale' },
  { id: 'ib3',  number: '§3',  title: 'Physical, Chemical, and Pharmaceutical Properties' },
  { id: 'ib4',  number: '§4',  title: 'Non-clinical Studies' },
  { id: 'ib5',  number: '§5',  title: 'Clinical Pharmacology' },
  { id: 'ib6',  number: '§6',  title: 'Clinical Efficacy' },
  { id: 'ib7',  number: '§7',  title: 'Clinical Safety' },
  { id: 'ib8',  number: '§8',  title: 'Reference Safety Information' },
  { id: 'ib9',  number: '§9',  title: 'Guidance for the Investigator' },
  { id: 'ib10', number: '§10', title: 'References' },
]

const ICF: TemplateSection[] = [
  { id: 'i1',  number: '§1',  title: 'Overview and Key Information' },
  { id: 'i2',  number: '§2',  title: 'Why is this study being done?' },
  { id: 'i3',  number: '§3',  title: 'What is the usual approach to my condition?' },
  { id: 'i4',  number: '§4',  title: 'What are my choices if I decide not to take part?' },
  { id: 'i5',  number: '§5',  title: 'What will happen if I decide to take part?' },
  { id: 'i6',  number: '§6',  title: 'What are the risks and benefits?' },
  { id: 'i7',  number: '§7',  title: 'Can I stop later?' },
  { id: 'i8',  number: '§8',  title: 'What are the study groups?' },
  { id: 'i9',  number: '§9',  title: 'Exams, tests, and procedures involved' },
  { id: 'i10', number: '§10', title: 'What are my responsibilities?' },
  { id: 'i11', number: '§11', title: 'What are the costs?' },
  { id: 'i12', number: '§12', title: 'What if I am injured?' },
  { id: 'i13', number: '§13', title: 'Who will see my medical information?' },
  { id: 'i14', number: '§14', title: 'Where can I get more information?' },
  { id: 'i15', number: '§15', title: 'Optional studies' },
  { id: 'i16', number: '§16', title: 'Signatures' },
  { id: 'i17', number: '§17', title: 'Attachment A — Study Calendar' },
]

const SAFETY_NARRATIVE: TemplateSection[] = [
  { id: 'sae1', number: '§1', title: 'Case Identification (metadata)' },
  { id: 'sae2', number: '§2', title: 'Patient Narrative (chronological prose)' },
  { id: 'sae3', number: '§3', title: 'Chronology of Key Events (table)' },
  { id: 'sae4', number: '§4', title: 'Relevant Laboratory Data (table)' },
  { id: 'sae5', number: '§5', title: 'Concomitant Medications' },
  { id: 'sae6', number: '§6', title: 'SAE Assessment Summary (table)' },
  { id: 'sae7', number: '§7', title: 'Causality Considerations' },
  { id: 'sae8', number: '§8', title: 'Investigator Signature' },
]

// ICH E2F
const DSUR: TemplateSection[] = [
  { id: 'd_es',  number: 'ES',  title: 'Executive Summary' },
  { id: 'd_toc', number: 'TOC', title: 'Table of Contents' },
  { id: 'd1',  number: '§1',  title: 'Introduction' },
  { id: 'd2',  number: '§2',  title: 'Worldwide Marketing Approval Status' },
  { id: 'd3',  number: '§3',  title: 'Actions Taken in the Reporting Period for Safety Reasons' },
  { id: 'd4',  number: '§4',  title: 'Changes to Reference Safety Information' },
  { id: 'd5',  number: '§5',  title: 'Inventory of Clinical Trials (Ongoing + Completed)' },
  { id: 'd6',  number: '§6',  title: 'Estimated Cumulative Exposure' },
  { id: 'd7',  number: '§7',  title: 'Line Listings & Summary Tabulations of SARs/SAEs' },
  { id: 'd8',  number: '§8',  title: 'Significant Findings from Clinical Trials' },
  { id: 'd9',  number: '§9',  title: 'Safety Findings from Non-interventional Studies' },
  { id: 'd10', number: '§10', title: 'Other Clinical Trial / Study Safety Information' },
  { id: 'd11', number: '§11', title: 'Safety Findings from Marketing Experience' },
  { id: 'd12', number: '§12', title: 'Non-clinical Data' },
  { id: 'd13', number: '§13', title: 'Literature' },
  { id: 'd14', number: '§14', title: 'Other DSURs' },
  { id: 'd15', number: '§15', title: 'Lack of Efficacy' },
  { id: 'd16', number: '§16', title: 'Region-Specific Information' },
  { id: 'd17', number: '§17', title: 'Late-Breaking Information' },
  { id: 'd18', number: '§18', title: 'Overall Safety Assessment' },
  { id: 'd19', number: '§19', title: 'Summary of Important Risks' },
  { id: 'd20', number: '§20', title: 'Conclusions' },
]

// EU CTR 536/2014 Article 37 / Annex IV summary of results
const END_OF_STUDY_SUMMARY: TemplateSection[] = [
  { id: 'eos1', number: '§1', title: 'Trial Information' },
  { id: 'eos2', number: '§2', title: 'Subject Disposition' },
  { id: 'eos3', number: '§3', title: 'Baseline Characteristics' },
  { id: 'eos4', number: '§4', title: 'End Points' },
  { id: 'eos5', number: '§5', title: 'Adverse Events' },
  { id: 'eos6', number: '§6', title: 'Additional Information (modifications, interruptions, limitations)' },
  { id: 'eos7', number: '§7', title: 'Declaration of the Submitting Party' },
]

const PATIENT_NARRATIVE: TemplateSection[] = [
  { id: 'pn1', number: '§1', title: 'Patient Identification & Demographics' },
  { id: 'pn2', number: '§2', title: 'Relevant Medical History' },
  { id: 'pn3', number: '§3', title: 'Study Treatment & Exposure' },
  { id: 'pn4', number: '§4', title: 'Event Description (chronological)' },
  { id: 'pn5', number: '§5', title: 'Treatment of the Event & Outcome' },
  { id: 'pn6', number: '§6', title: 'Investigator & Sponsor Assessment' },
]

// The UI sends hyphen-case types ('csr-full'); older rows use snake_case.
const TEMPLATES: Record<string, TemplateSection[]> = {
  'csr-full': CSR_FULL,
  'csr-synopsis': CSR_SYNOPSIS,
  'protocol': PROTOCOL,
  'protocol-amendment': PROTOCOL_AMENDMENT,
  'ib': IB,
  'icf': ICF,
  'safety-narrative': SAFETY_NARRATIVE,
  'dsur': DSUR,
  'end-of-study-summary': END_OF_STUDY_SUMMARY,
  'patient-narrative': PATIENT_NARRATIVE,
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
