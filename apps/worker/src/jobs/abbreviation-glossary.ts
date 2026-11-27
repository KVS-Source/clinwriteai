// Abbreviations for the finishing pass (finishing.ts), agreed 2026-11-27: the drafter is told to spell out each
// abbreviation at first use, and anything it misses that is listed here is spelled out by code at its first use.
//
//   COMMON_ABBREVIATIONS — known to every reader; never need a full form.
//   STANDARD_GLOSSARY    — standard full forms in clinical / regulatory writing. Only unambiguous ones: "PD"
//                          (progressive disease / pharmacodynamics), "SD", "HR" and "PR" are left out on purpose.
//
// To extend (e.g. the SME's list): add entries here; keys are the abbreviation exactly as written.

export const COMMON_ABBREVIATIONS: ReadonlySet<string> = new Set([
  'US', 'USA', 'UK', 'EU', 'FDA', 'EMA', 'WHO', 'HIV', 'AIDS', 'DNA', 'RNA', 'URL',
])

export const STANDARD_GLOSSARY: Readonly<Record<string, string>> = {
  // Safety
  AE:     'adverse event',
  SAE:    'serious adverse event',
  TEAE:   'treatment-emergent adverse event',
  SUSAR:  'suspected unexpected serious adverse reaction',
  DLT:    'dose-limiting toxicity',
  MTD:    'maximum tolerated dose',
  CTCAE:  'Common Terminology Criteria for Adverse Events',
  // Oncology efficacy
  RECIST: 'Response Evaluation Criteria in Solid Tumors',
  OS:     'overall survival',
  PFS:    'progression-free survival',
  ORR:    'objective response rate',
  ECOG:   'Eastern Cooperative Oncology Group',
  PS:     'performance status',
  SCLC:   'small cell lung cancer',
  NSCLC:  'non-small cell lung cancer',
  NCI:    'National Cancer Institute',
  EORTC:  'European Organisation for Research and Treatment of Cancer',
  // Statistics
  CI:     'confidence interval',
  ITT:    'intention-to-treat',
  SAP:    'statistical analysis plan',
  // Committees, conduct and documents
  IDMC:   'Independent Data Monitoring Committee',
  DSMB:   'Data and Safety Monitoring Board',
  IRB:    'Institutional Review Board',
  IEC:    'Independent Ethics Committee',
  GCP:    'Good Clinical Practice',
  ICH:    'International Council for Harmonisation',
  ICF:    'informed consent form',
  CRF:    'case report form',
  CRO:    'contract research organisation',
  CSR:    'clinical study report',
  IB:     'Investigator’s Brochure',
  IMP:    'investigational medicinal product',
  PRO:    'patient-reported outcome',
  // Regulatory
  IND:    'Investigational New Drug',
  NCT:    'National Clinical Trial',
  CTA:    'Clinical Trial Application',
  CFR:    'Code of Federal Regulations',
  GDPR:   'General Data Protection Regulation',
  // Laboratory and imaging
  CT:     'computed tomography',
  MRI:    'magnetic resonance imaging',
  PET:    'positron emission tomography',
  ECG:    'electrocardiogram',
  ULN:    'upper limit of normal',
  ALT:    'alanine aminotransferase',
  AST:    'aspartate aminotransferase',
  HBV:    'hepatitis B virus',
  HCV:    'hepatitis C virus',
  FSH:    'follicle-stimulating hormone',
  PK:     'pharmacokinetics',
}
