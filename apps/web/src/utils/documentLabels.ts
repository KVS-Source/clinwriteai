// Translation keys for the document status, stage and type enums, so every screen names them the same way.

import type { DocumentStage, DocumentStatus, DocumentType } from '@platform/types'
import i18n from '../i18n'

export const DOCUMENT_STATUS_KEY: Record<DocumentStatus, string> = {
  'not-started':       'component.document_labels.status_not_started',
  'in-authoring':      'component.document_labels.status_in_authoring',
  'in-review':         'component.document_labels.status_in_review',
  'crm-in-progress':   'component.document_labels.status_crm_in_progress',
  'pending-signature': 'component.document_labels.status_pending_signature',
  'signed':            'component.document_labels.status_signed',
}

// The same statuses for lists and filters, where "Signed" has no tick.
export const DOCUMENT_STATUS_PLAIN_KEY: Record<DocumentStatus, string> = {
  ...DOCUMENT_STATUS_KEY,
  'signed': 'component.document_labels.status_signed_plain',
}

export const DOCUMENT_STAGE_KEY: Record<DocumentStage, string> = {
  'study-start-up':          'component.document_labels.stage_study_start_up',
  'during-study':            'component.document_labels.stage_during_study',
  'post-study':              'component.document_labels.stage_post_study',
  'cross-functional-review': 'component.document_labels.stage_cross_functional_review',
  'crm':                     'component.document_labels.stage_crm',
  'final-output':            'component.document_labels.stage_final_output',
}

export const DOCUMENT_TYPE_KEY: Record<DocumentType, string> = {
  'csr-full':             'component.document_labels.type_csr_full',
  'csr-synopsis':         'component.document_labels.type_csr_synopsis',
  'protocol':             'component.document_labels.type_protocol',
  'protocol-amendment':   'component.document_labels.type_protocol_amendment',
  'ib':                   'component.document_labels.type_ib',
  'icf':                  'component.document_labels.type_icf',
  'safety-narrative':     'component.document_labels.type_safety_narrative',
  'dsur':                 'component.document_labels.type_dsur',
  'end-of-study-summary': 'component.document_labels.type_end_of_study_summary',
  'patient-narrative':    'component.document_labels.type_patient_narrative',
}

// Label for a value that may come straight from the API: an unknown value shows the fallback, or itself.
const label = (keys: Record<string, string>, value: string | null | undefined, fallback?: string | null): string => {
  const key = value ? keys[value] : undefined
  return key ? i18n.t(key) : fallback ?? value ?? ''
}

// A signer's role is saved in English on the signature record. The standard ones are translated for display;
// a project-team role (e.g. a job title typed for the project) shows as it was entered.
const SIGNER_ROLE_KEY: Record<string, string> = {
  Author: 'page.initiate_signature_chain.role_authored',
  Reviewer: 'page.initiate_signature_chain.role_reviewed',
  Approver: 'page.initiate_signature_chain.role_approved',
  Informed: 'page.initiate_signature_chain.role_acknowledged',
}
export const signerRoleLabel = (role: string) => label(SIGNER_ROLE_KEY, role)

export const documentStageLabel = (stage: string | null | undefined, fallback?: string | null) => label(DOCUMENT_STAGE_KEY, stage, fallback)
export const documentTypeLabel = (type: string | null | undefined, fallback?: string | null) => label(DOCUMENT_TYPE_KEY, type, fallback)
export const documentStatusLabel = (status: string | null | undefined, fallback?: string | null) => label(DOCUMENT_STATUS_PLAIN_KEY, status, fallback)
