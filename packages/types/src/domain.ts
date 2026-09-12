// Platform domain types — Module A Clinical Writing
// Source: docs/Technical_Architecture.md §4

// --- Enum union types ---

export type ProjectStatus = 'initiated' | 'ongoing' | 'on-hold' | 're-open' | 'closed'

export type DocumentStatus =
  | 'not-started' | 'in-authoring' | 'in-review'
  | 'crm-in-progress' | 'pending-signature' | 'signed'

export type DocumentStage =
  | 'study-start-up' | 'during-study' | 'post-study'
  | 'cross-functional-review' | 'crm' | 'final-output'

export type DocumentType =
  | 'csr-full' | 'csr-synopsis' | 'protocol' | 'protocol-amendment'
  | 'ib' | 'icf' | 'safety-narrative' | 'dsur' | 'end-of-study-summary'

export type RACIRole = 'R' | 'A' | 'C' | 'I'

export type PanelMode =
  | 'ai' | 'traceability' | 'voice' | 'checklist' | 'audit' | 'comments'
  | 'review-assignment' | 'crm-resolution' | 'ich-e3' | 'meddra' | 'tlf'
  | null

export type SignatureStatus = 'signed' | 'awaiting' | 'queued'
export type SignatureMeaning = 'authored' | 'reviewed' | 'approved'
export type CommentSeverity = 'major' | 'minor' | 'query'
export type CommentStatus = 'open' | 'resolved'
export type ChecklistItemStatus = 'pending' | 'in-progress' | 'complete' | 'waived'
export type ICHSectionStatus = 'complete' | 'in-progress' | 'not-started' | 'warning'
export type TLFItemType = 'T' | 'L' | 'F'
export type ResolutionType = 'accept' | 'accept-with-modification' | 'reject'
export type PresenceStatus = 'active' | 'locked' | 'idle'

// --- Core interfaces ---

export interface User {
  id: string
  name: string
  initials: string
  role: string
  email: string
  colourKey: keyof typeof USER_COLOURS
}

export interface Project {
  id: string
  name: string
  shortTitle: string
  client: string
  therapeuticArea: string
  phase: string
  status: ProjectStatus
  startDate: string
  dataCutoff?: string
  activeModules: string[]
  submissionCountries: string[]
  team: TeamMember[]
}

export interface TeamMember {
  userId: string
  name: string
  initials: string
  role: string
  raci: RACIRole
  colourKey: string
}

export interface Document {
  id: string
  projectId: string
  type: DocumentType
  title: string
  status: DocumentStatus
  stage: DocumentStage
  version: string
  therapeuticArea: string
  assigneeId: string
  updatedAt: string | null
  sections: Section[]
}

export interface Section {
  id: string
  number: string
  title: string
  status: ICHSectionStatus
  presenceUserId?: string
  isLocked?: boolean
  lockedByUserId?: string
}

export interface Comment {
  id: string // CMT-###
  documentId: string
  sectionRef: string
  reviewerId: string
  reviewerName: string
  reviewerInitials: string
  text: string
  severity: CommentSeverity
  status: CommentStatus
  createdAt: string
  age: string // computed display value e.g. "3 days ago"
}

export interface ChecklistItem {
  id: string
  templateItemId: string | null
  text: string
  framework: string
  frameworkMandatory: boolean
  status: ChecklistItemStatus
  isUserAdded?: boolean
  completedBy?: string
  completedAt?: string
  waivedBy?: string
  waivedAt?: string
  waiverReason?: string
}

export interface AuditEntry {
  id: string
  timestamp: string
  actor: string
  actorInitials: string
  actorColourKey: string
  action: string
  eventType:
    | 'content-edited' | 'ai-draft' | 'comment-added' | 'comment-resolved'
    | 'checklist-waived' | 'checklist-completed' | 'document-signed'
    | 'version-restore' | 'voice-note-added' | 'qa-review-completed'
  detail: string
}

export interface DocumentVersion {
  id: string
  versionNumber: string
  label: string
  createdBy: string
  createdAt: string
  isCurrent: boolean
  contentHash: string
}

export interface SignatureRecord {
  id: string // SIG-####-##
  signer: string
  initials: string
  role: string
  meaning: SignatureMeaning
  status: SignatureStatus
  step: number
  timestamp?: string
  authMethod?: string
  documentHash?: string
  version_at_signing?: string
}

export interface CRMMeeting {
  id: string
  documentId: string
  documentTitle: string
  meetingRef: string
  version: string
  date: string
  startTime: string
  endTime: string
  startedAt?: string
  chair: TeamMember
  attendees: TeamMember[]
  commentIds: string[]
  resolvedIds: string[]
  activeId: string | null
  pendingIds: string[]
}

export interface VoiceNote {
  id: string
  documentId: string
  sectionRef: string
  actorId: string
  actorName: string
  audioRef: string
  transcript: string
  duration: number
  createdAt: string
}

export interface TLFItem {
  type: TLFItemType
  id: string
  title: string
  linkedSections: string[]
  referenceCount?: number
}

export interface MedDRATerm {
  pt: string
  code: string
  soc: string
  usedInDocument: boolean
  sections?: string[]
}

export interface ICHSection {
  section: string
  title: string
  status: ICHSectionStatus
  note?: string
}

export interface AISuggestion {
  text: string
  sources: string[]
  model: string
  generatedAt: string
}

export interface PresenceState {
  userId: string
  sectionId: string
  status: PresenceStatus
  initials: string
  colourKey: string
}

export interface CRMResolution {
  commentId: string
  type: ResolutionType
  note: string
  resolvedBy: string
  resolvedAt: string
}

// --- Lookup constants ---

export const USER_COLOURS = {
  MW: { bg: '#DBEAFE', text: '#1D4ED8' },
  SC: { bg: '#F0FDF4', text: '#15803D' },
  JO: { bg: '#F5F3FF', text: '#7C3AED' },
  EV: { bg: '#FEF3C7', text: '#D97706' },
  PN: { bg: '#FEE2E2', text: '#DC2626' },
  AH: { bg: '#E0F2FE', text: '#0369A1' },
  RT: { bg: '#FCE7F3', text: '#9D174D' },
  LP: { bg: '#F3F4F6', text: '#374151' },
  AI: { bg: '#F5F3FF', text: '#7C3AED' },
} as const

export const STATUS_META: Record<DocumentStatus, { bg: string; fg: string; label: string }> = {
  'not-started':      { bg: '#F8FAFC', fg: '#64748B', label: 'Not Started' },
  'in-authoring':     { bg: '#EFF6FF', fg: '#2563EB', label: 'In Authoring' },
  'in-review':        { bg: '#FFFBEB', fg: '#B45309', label: 'In Review' },
  'crm-in-progress':  { bg: '#F5F3FF', fg: '#7C3AED', label: 'CRM In Progress' },
  'pending-signature':{ bg: '#FFFBEB', fg: '#B45309', label: 'Pending Signature' },
  'signed':           { bg: '#F0FDF4', fg: '#15803D', label: 'Signed ✓' },
}

export const RACI_META: Record<RACIRole, { bg: string; fg: string; border?: string }> = {
  R: { bg: '#EFF6FF', fg: '#2563EB' },
  A: { bg: '#F0FDF4', fg: '#15803D' },
  C: { bg: '#F8FAFC', fg: '#64748B', border: '#E2E8F0' },
  I: { bg: '#F8FAFC', fg: '#94A3B8', border: '#E2E8F0' },
}

// --- Request body types ---

export interface CreateDocumentBody {
  type: DocumentType
  title: string
  templateId?: string
  assigneeId: string
  targetCompletionDate?: string
  description?: string
}

export interface UpdateSectionBody {
  content: string
  sectionId: string
  aiDrafted?: boolean
  aiModel?: string
  sourceDocs?: string[]
}

export interface WaiveItemBody {
  waivedBy: string
  reason: string
}

export interface CompleteItemBody {
  completedBy: string
}

export interface RestoreSectionsBody {
  sections: Array<{ sectionId: string; fromVersionId: string }>
  reason: string
}

export interface SubmitForReviewBody {
  reviewType: 'parallel' | 'sequential'
  reviewers: Array<{ userId: string; raci: RACIRole }>
  dueDate: string
}

export interface AddCommentBody {
  sectionRef: string
  text: string
  severity: CommentSeverity
}

export interface ResolveCommentBody {
  resolutionType: ResolutionType
  note: string
}

export interface SignDocumentBody {
  meaning: SignatureMeaning
  credentialHash: string
  scope?: string[]
}

export interface AISuggestBody {
  sectionId: string
  prompt?: string
  context?: string
}

export interface AcceptSuggestionBody {
  sectionId: string
  text: string
  model: string
  sources: string[]
  generatedAt: string
}

// ============================================================================
// MODULE B — Scientific Writing
// ============================================================================

export type PublicationType =
  | 'manuscript' | 'abstract' | 'poster' | 'pls'
  | 'plain-language-summary' | 'letter' | 'review'

export type PublicationSubtype =
  | 'original-research' | 'case-report' | 'systematic-review'
  | 'meta-analysis' | 'commentary' | null

export type PublicationStage =
  | 'planning' | 'authoring' | 'review' | 'submission' | 'published'

export type PublicationStatus =
  | 'not-started' | 'in-authoring' | 'in-review'
  | 'under-peer-review' | 'submitted' | 'accepted' | 'published' | 'withdrawn'

export type ReportingGuideline =
  | 'CONSORT' | 'STROBE' | 'PRISMA' | 'CARE' | 'SPIRIT' | 'STARD' | 'ARRIVE'

export type PublicationCoiStatus  = 'pending' | 'submitted' | 'expired' | 'not-required'
export type DebarmentStatus       = 'unchecked' | 'checking' | 'clear' | 'flagged'
export type BaaStatus             = 'not-applicable' | 'required' | 'in-progress' | 'signed'
export type GPP2022Status         = 'progress' | 'submitted' | 'complete' | 'not-applicable'

export type SubmissionCheckState  = 'pass' | 'warn' | 'block' | 'ack'
export type SubmissionCheckGroup  = 'format' | 'words' | 'equator' | 'figures' | 'statements' | 'plagiarism' | 'refs'

export type ReviewCommentStatus   = 'not-started' | 'in-progress' | 'responded' | 'accepted'
export type ReviewerTab           = 'r1' | 'r2' | 'r3' | 'ed'

export interface ICMJECriterion {
  criterionIndex: number
  met: boolean
  confirmedBy: string | null
  confirmedAt: string | null
}

export interface Publication {
  id: string
  projectId: string
  type: PublicationType
  subtype: PublicationSubtype
  title: string
  stage: PublicationStage
  status: PublicationStatus
  version: string
  guideline: ReportingGuideline
  journal: string | null
  targetSubmissionDate: string | null
  keyMessage: string | null
  baaStatus: BaaStatus
  sourceDocumentId: string | null
  sourceDocumentLabel: string | null
  ownerId: string
  ownerInitials: string
  createdBy: string
  createdAt: string
  updatedAt: string
  project: string
  doi: string | null
  gpp2022: GPP2022Status
  aiLabel: string | null
  warning: string | null
  due: string | null
}

export interface PublicationAuthor {
  id: string
  publicationId: string
  userId: string | null
  name: string
  initials: string
  role: string
  raci: RACIRole
  isExternal: boolean
  coiStatus: PublicationCoiStatus
  coiSubmittedAt: string | null
  debarmentStatus: DebarmentStatus
  debarmentCheckedAt: string | null
  invitedAt: string | null
  inviteEmail: string | null
  addedBy: string
  addedAt: string
  removedAt: string | null
  avatarBg: string
  avatarFg: string
  icmjeCriteria: ICMJECriterion[]
  icmjeAcknowledged: boolean
  icmjeAcknowledgedBy: string | null
  icmjeAcknowledgedAt: string | null
}

export interface Citation {
  id: string
  publicationId: string
  pmid: string | null
  title: string
  shortRef: string
  fullRef: string
  locus: string
  isSourceDocument: boolean
  insertedBy: string
  insertedAt: string
  removedBy: string | null
  removedAt: string | null
}

export interface SubmissionCheck {
  id: string
  groupId: SubmissionCheckGroup
  label: string
  state: SubmissionCheckState
  note: string
  lastRunAt: string
  resolvedBy: string | null
  resolvedAt: string | null
}

export interface SubmissionCheckSummary {
  total: number
  pass:  number
  warn:  number
  block: number
  ack:   number
}

export interface ReviewRound {
  id: string
  publicationId: string
  roundNumber: number
  journalSubmissionRef: string
  reviewerCount: number
  createdAt: string
}

export interface ReviewComment {
  id: string
  roundId: string
  reviewerTab: ReviewerTab
  commentNumber: number
  commentText: string
  responseText: string
  status: ReviewCommentStatus
  aiDrafted: boolean
  aiModel: string | null
  aiGeneratedAt: string | null
  aiAcceptedBy: string | null
  aiAcceptedAt: string | null
  respondedBy: string | null
  respondedAt: string | null
  auditEntryId: string | null
}

// --- Module B lookup constants ---

export const PUBLICATION_STATUS_META: Record<PublicationStatus, { bg: string; fg: string; label: string }> = {
  'not-started':       { bg: '#F8FAFC', fg: '#64748B', label: 'Not Started' },
  'in-authoring':      { bg: '#EFF6FF', fg: '#2563EB', label: 'In Authoring' },
  'in-review':         { bg: '#FFFBEB', fg: '#B45309', label: 'In Review' },
  'under-peer-review': { bg: '#FFFBEB', fg: '#B45309', label: 'Under Peer Review' },
  'submitted':         { bg: '#F0FDF4', fg: '#15803D', label: 'Submitted' },
  'accepted':          { bg: '#F0FDF4', fg: '#15803D', label: 'Accepted' },
  'published':         { bg: '#F0FDF4', fg: '#15803D', label: 'Published' },
  'withdrawn':         { bg: '#F1F5F9', fg: '#475569', label: 'Withdrawn' },
}

export const CHECK_STATE_META: Record<SubmissionCheckState, { bg: string; fg: string; label: string }> = {
  pass:  { bg: '#F0FDF4', fg: '#15803D', label: 'Pass' },
  warn:  { bg: '#FFFBEB', fg: '#B45309', label: 'Warn' },
  block: { bg: '#F0F7FA', fg: '#005F8E', label: 'Blocking' }, // steel blue — no red per Module B rule
  ack:   { bg: '#F1F5F9', fg: '#475569', label: 'Acknowledged' },
}

export const CONGRESS_META: Record<string, { label: string; deadline: string | null }> = {
  ASCO: { label: 'ASCO Annual Meeting',       deadline: '2027-02-01' },
  ESMO: { label: 'ESMO Congress',             deadline: '2027-04-15' },
  ASH:  { label: 'ASH Annual Meeting',        deadline: '2027-08-01' },
  AACR: { label: 'AACR Annual Meeting',       deadline: '2027-01-15' },
}

// Module B Teal (locked)
export const MODULE_B_ACCENT = {
  primary:  '#0D9488',
  primaryHover: '#0F766E',
  bgLight:  '#F0FDFA',
  border:   '#99F6E4',
} as const

// --- Module B request body types ---

export interface CreatePublicationBody {
  projectId: string
  type: PublicationType
  subtype?: PublicationSubtype
  title: string
  guideline: ReportingGuideline
  journal?: string | null
  targetSubmissionDate?: string | null
  keyMessage?: string | null
  sourceDocumentId?: string | null
  sourceDocumentLabel?: string | null
  ownerId: string
}

export interface UpdatePublicationBody {
  title?: string
  stage?: PublicationStage
  status?: PublicationStatus
  version?: string
  journal?: string | null
  targetSubmissionDate?: string | null
  keyMessage?: string | null
}

export interface AddAuthorBody {
  publicationId: string
  userId?: string | null
  name: string
  initials: string
  role: string
  raci: RACIRole
  isExternal: boolean
  inviteEmail?: string
  addedBy: string
}

export interface InsertCitationBody {
  pmid?: string | null
  title: string
  shortRef: string
  fullRef: string
  locus: string
  insertedBy: string
}

export interface SubmitReviewResponseBody {
  responseText: string
  respondedBy: string
  status: ReviewCommentStatus
}

export interface CongressExportBody {
  format: 'pdf' | 'docx' | 'pptx'
  congress: string
  abstractType?: 'oral' | 'poster' | 'e-poster'
}

// ============================================================================
// MODULE C — Medical Writing
// ============================================================================

export type MedContentType =
  | 'hcp-slide-deck' | 'mi-letter' | 'pil' | 'cme-module'
  | 'disease-dossier' | 'eu-ctr-pls' | 'advisory-report'

export type ComplianceTrack = 'mlr' | 'accme'

export type MedContentStatus =
  | 'briefing' | 'kol-session' | 'in-authoring' | 'pre-mlr'
  | 'in-mlr-review' | 'mlr-approved' | 'formatting' | 'final-output' | 'expired'

export type ReviewTier = 1 | 2 | 3

export type ClaimStatus = 'approved' | 'modified' | 'new' | 'must-fix'

export type PreMLRSeverity = 'must-fix' | 'should-fix' | 'note'

export type MLRDecision =
  | 'approve' | 'approve-with-revisions' | 'return-to-author' | 'reject'

export type GDPRConsent = 'confirmed' | 'pending' | 'declined' | 'internal'

export interface MedContentItem {
  id:                          string
  projectId:                   string
  sourceModuleAProjectId:      string | null
  sourceModuleBPublicationId:  string | null
  type:                        MedContentType
  title:                       string
  status:                      MedContentStatus
  stage:                       number
  complianceTrack:             ComplianceTrack
  taTag:                       string
  version:                     string
  channels:                    string[]
  targetAudience:              string[]
  reviewTier:                  ReviewTier | null
  reviewTierOverriddenBy:      string | null
  fkScore:                     number | null
  fkPassed:                    boolean | null
  aiFootprintPct:              number
  expiryDate:                  string | null
  approvedAt:                  string | null
  medicalAffairsPlanId:        string | null
  publicationPlanId:           string | null
  ownerId:                     string
  createdBy?:                  string
  createdAt?:                  string
  updatedAt?:                  string
  project?:                    string
  lane?:                       string
  mlrDueDate?:                 string
  mlrOverdue?:                 boolean
  tierPending?:                boolean
}

export interface MedClaim {
  id:                   string
  contentItemId:        string
  claimText:            string
  sourceRef:            string | null
  sourceType:           string | null
  location:             string
  approvalStatus:       ClaimStatus
  reviewerId:           string | null
  similarityPct:        number
  approvedLibraryText:  string | null
  adoptedAt:            string | null
}

export interface PreMLRIssue {
  id:              string
  severity:        PreMLRSeverity
  slide:           string | null
  title:           string
  detail:          string
  suggestedFix:    string | null
  acknowledged:    boolean
  acknowledgedBy:  string | null
  acknowledgedAt:  string | null
}

export interface PreMLRResult {
  id:              string
  contentItemId:   string
  runAt:           string
  mustFixCount:    number
  shouldFixCount:  number
  noteCount:       number
  passed:          boolean
  runBy:           string
  auditEntryId:    string
  issues:          PreMLRIssue[]
}

export interface AgenticFinding {
  n:                   number
  slide:               string
  severity:            PreMLRSeverity
  title:               string
  detail:              string
  escalatedToMustFix:  boolean
  escalatedBy:         string | null
  escalatedAt:         string | null
  escalationAuditId:   string | null
}

export interface AgenticReport {
  id:                  string
  contentItemId:       string
  runAt:               string
  model:               string
  passedToMLRTeamAt:   string
  auditEntryId:        string
  findings:            AgenticFinding[]
}

export interface MLRReviewer {
  id:              string
  contentItemId:   string
  userId:          string
  name:            string
  initials:        string
  role:            string
  assignedAt:      string
  submittedAt:     string | null
  decision:        MLRDecision | null
  decisionNote:    string | null
  pillBg:          string
  pillFg:          string
  pillBorder:      string
  avBg:            string
  avFg:            string
}

export interface MLRComment {
  id:                     string
  contentItemId:          string
  reviewerId:             string
  reviewerName:           string
  reviewerStamp:          string
  text:                   string
  tag:                    'Must Fix' | 'Should Fix' | 'Note' | 'Advisory'
  tagBg:                  string
  tagFg:                  string
  createdAt:              string
  resolvedAt:             string | null
  resolvedBy:             string | null
  escalatedFromAgentic:   boolean
  escalatedBy:            string | null
  escalatedAt:            string | null
  escalationAuditId:      string | null
}

export interface KOLAttendee {
  name:         string
  affiliation:  string
  gdprConsent:  GDPRConsent
  role:         string
  consentBg:    string
  consentFg:    string
}

export interface KOLSession {
  id:                          string
  contentItemId:               string
  sessionDate:                 string
  attendees:                   KOLAttendee[]
  preReads?:                   string[]
  voiceNoteIds?:               string[]
  transcriptRef?:              string | null
  transcriptionEngine?:        string | null
  transcriptionTimestamp?:     string | null
  transcriptUploadedAt?:       string | null
  insightsReport?:             unknown | null
  insightsReportGeneratedAt?:  string | null
}

export interface MedLibraryCard {
  id:                  string
  contentItemId:       string
  cardType:            'claim' | 'safety' | 'reference' | 'mi-paragraph' | 'slide' | 'framework'
  name:                string
  tags:                string
  taTag:               string
  channels:            string[]
  availableInModules:  string[]
  expiryDate:          string
  pushedBy:            string
  pushedAt:            string
  deprecatedAt:        string | null
}

export interface ContentExpiryRecord {
  id:                string
  contentItemId:     string
  expiryDate:        string
  alert60dSentAt:    string | null
  alert30dSentAt:    string | null
  expired:           boolean
  alertRecipients:   string[]
}

// --- Module C lookup constants ---

export const MED_CONTENT_TYPE_META: Record<MedContentType, { label: string; code: string; bg: string; fg: string; patientFacing: boolean }> = {
  'hcp-slide-deck':   { label: 'HCP Slide Deck',        code: 'HCP DECK', bg: '#F5F3FF', fg: '#6D28D9', patientFacing: false },
  'mi-letter':        { label: 'MI Letter',              code: 'MI',       bg: '#F5F3FF', fg: '#6D28D9', patientFacing: false },
  'pil':              { label: 'Patient Info Leaflet',   code: 'PIL',      bg: '#F0FDFA', fg: '#0F766E', patientFacing: true  },
  'cme-module':       { label: 'CME Module',             code: 'CME',      bg: '#EFF6FF', fg: '#1D4ED8', patientFacing: false },
  'disease-dossier':  { label: 'Disease Dossier',        code: 'DOSSIER',  bg: '#F5F3FF', fg: '#6D28D9', patientFacing: false },
  'eu-ctr-pls':       { label: 'EU CTR PLS',             code: 'PLS',      bg: '#F0FDFA', fg: '#0F766E', patientFacing: true  },
  'advisory-report':  { label: 'Advisory Report',        code: 'ADVBOARD', bg: '#F5F3FF', fg: '#6D28D9', patientFacing: false },
}

export const MED_CONTENT_STATUS_META: Record<MedContentStatus, { bg: string; fg: string; label: string }> = {
  briefing:        { bg: '#F1F5F9', fg: '#64748B', label: 'Briefing' },
  'kol-session':   { bg: '#F5F3FF', fg: '#7C3AED', label: 'KOL Session' },
  'in-authoring':  { bg: '#EFF6FF', fg: '#2563EB', label: 'In Authoring' },
  'pre-mlr':       { bg: '#F5F3FF', fg: '#7C3AED', label: 'Pre-MLR' },
  'in-mlr-review': { bg: '#FFFBEB', fg: '#B45309', label: 'In MLR Review' },
  'mlr-approved':  { bg: '#F0FDF4', fg: '#15803D', label: 'MLR Approved' },
  formatting:      { bg: '#EFF6FF', fg: '#2563EB', label: 'Formatting' },
  'final-output':  { bg: '#F0FDF4', fg: '#15803D', label: 'Final Output' },
  expired:         { bg: '#FFF1F2', fg: '#BE123C', label: 'Expired ⚠' },
}

export const REVIEW_TIER_META: Record<ReviewTier, { label: string; threshold: string; bg: string; fg: string }> = {
  1: { label: 'Tier 1', threshold: 'Low risk · self-approval',     bg: '#F0FDF4', fg: '#15803D' },
  2: { label: 'Tier 2', threshold: 'Standard · MLR review',        bg: '#FFFBEB', fg: '#B45309' },
  3: { label: 'Tier 3', threshold: 'High risk · full MLR + Legal', bg: '#EFF6FF', fg: '#005F8E' },
}

export const MLR_DECISION_META: Record<MLRDecision, { label: string; bg: string; fg: string; border: string }> = {
  'approve':                { label: 'Approve',                bg: '#F0FDF4', fg: '#15803D', border: '1px solid #BBF7D0' },
  'approve-with-revisions': { label: 'Approve with revisions', bg: '#EFF6FF', fg: '#1D4ED8', border: '1px solid #BFDBFE' },
  'return-to-author':       { label: 'Return to author',       bg: '#FFFBEB', fg: '#B45309', border: '1px solid #FDE68A' },
  'reject':                 { label: 'Reject',                 bg: '#FEE2E2', fg: '#B91C1C', border: '1px solid #FECACA' },
}

export const MODULE_C_ACCENT = {
  primary:      '#7C3AED',
  primaryHover: '#6D28D9',
  bgLight:      '#F5F3FF',
  bgMedium:     '#EDE9FE',
  border:       '#DDD6FE',
} as const

// ============================================================================
// MODULE D — REGULATORY WRITING (Technical Architecture v4.0 §32)
// ============================================================================

export type RegSubmissionType =
  | 'ind' | 'nda-maa' | 'psur-pbrer' | 'rmp-rems' | 'ha-response' | 'cer' | 'orphan-drug'

export type SubmissionStatus =
  | 'source-gathering' | 'module2-authoring' | 'finalisation'
  | 'super-review' | 'publishing' | 'submitted' | 'post-submission'

export type CTDModuleStatus =
  | 'not-started' | 'in-authoring' | 'in-review' | 'signed' | 'auto-generated' | 'read-only'

export type GatewayTarget       = 'fda-esg' | 'ema-cesp' | 'cdsco' | 'mhra'
export type GatewayACKStatus    = 'pending' | 'ack1' | 'ack2' | 'ack3' | 'nack'
export type ConsistencySeverity = 'major' | 'minor'
export type RedactionType       = 'ppd' | 'cci'

export interface RegulatorySubmission {
  id:                          string
  projectId:                   string
  sourceModuleAProjectId:      string | null
  submissionType:              RegSubmissionType
  status:                      SubmissionStatus
  stage:                       number
  targetHAs:                   GatewayTarget[]
  ectdVersion:                 '3.2.2' | '4.0'
  taTag:                       string
  validatorEngine:             'extedo' | 'lorenz'
  title:                       string
  compound:                    string
  indication:                  string
  ownerId:                     string
  createdBy:                   string
  createdAt:                   string
  updatedAt:                   string
  project?:                    string
  lane?:                       string
  consistencyFlagged?:         boolean
  consistencyContradictions?:  number
  cmcReadinessAcknowledged?:   boolean
  cmcReadinessPct?:            number
  canonicalJsonIndexed?:       boolean
  canonicalJsonDataPoints?:    number
  raciSignedCount?:            number
  raciTotalCount?:             number
  gatewayAck2ConfirmedAt?:     string | null
  gatewayAck2Gateway?:         string
}

export interface ECTDNode {
  id:                  string
  submissionId:        string
  moduleSection:       string
  sectionTitle:        string
  status:              CTDModuleStatus
  isReadOnly:          boolean
  isSystemGenerated:   boolean
  lastUpdated:         string
  documentId?:         string | null
  hasContradiction?:   boolean
  contradictionCount?: number
}

export interface CMCReadinessSection {
  section:      string
  title:        string
  status:       'complete' | 'gap' | 'not-started'
  completePct:  number
  missingItems: { item: string; required: boolean; expectedDate: string | null }[]
}

export interface CMCReadinessReport {
  id:              string
  submissionId:    string
  completenessPct: number
  generatedAt:     string
  acknowledgedBy:  string | null
  acknowledgedAt:  string | null
  riskNote:        string | null
  sections:        CMCReadinessSection[]
  ichQValidation?: Record<string, Record<string, string>>
}

export interface ConsistencyContradiction {
  id:             string
  sourceSection:  string
  targetSection:  string
  sourceValue:    string
  targetValue:    string
  severity:       ConsistencySeverity
  resolved:       boolean
  resolvedBy:     string | null
  resolvedAt:     string | null
  resolutionNote: string | null
}

export interface ConsistencyCheckResult {
  id:             string
  submissionId:   string
  runAt:          string
  model:          string
  passed:         boolean
  auditEntryId:   string
  contradictions: ConsistencyContradiction[]
}

export interface ECTDValidationError {
  id:                string
  severity:          'critical' | 'major' | 'minor'
  rule:              string
  description:       string
  detail:            string
  fixInstructions?:  string
  autoFixAvailable:  boolean
  fixed:             boolean
}

export interface ECTDValidationResult {
  id:                string
  submissionId:      string
  runAt:             string
  validator:         'extedo' | 'lorenz'
  validatorVersion?: string
  criticalCount:     number
  majorCount:        number
  minorCount:        number
  passed:            boolean
  auditEntryId:      string
  errors:            ECTDValidationError[]
}

export interface RedactionItem {
  id:           string
  page:         number
  location:     string
  originalText: string
  redactedAs:   string
  type:         RedactionType
  confirmed:    boolean
  confirmedBy:  string | null
  confirmedAt:  string | null
}

export interface RedactionDocument {
  documentId:    string
  documentTitle: string
  ppdDetected:   number
  ppdConfirmed:  number
  cciDetected:   number
  cciConfirmed:  number
  totalPages:    number
  ppdItems:      RedactionItem[]
  cciItems:      RedactionItem[]
}

export interface RedactionRecord {
  id:              string
  submissionId:    string
  stageAtCreation: number
  totalPPD:        number
  totalCCI:        number
  confirmedPPD:    number
  confirmedCCI:    number
  documents:       RedactionDocument[]
}

export interface SuperReviewer {
  id:              string
  submissionId:    string
  userId:          string
  name:            string
  initials:        string
  role:            string
  signedAt:        string | null
  signedAtDisplay: string | null
  pillBg:          string
  pillFg:          string
  pillBorder?:     string
  avBg:            string
  avFg:            string
}

export interface PartElevenSignature {
  meaning:       string
  timestamp:     string
  signatoryName: string
  signatoryRole: string
}

export interface GatewaySubmissionRecord {
  id:                         string
  submissionId:               string
  gateway:                    GatewayTarget
  gatewayLabel:               string
  status:                     GatewayACKStatus
  transmittedAt:              string | null
  transmittedBy:              string | null
  transmittedByName?:         string
  transmittedByRole?:         string
  ack1At:                     string | null
  ack1ElapsedMinutes?:        number
  ack2At:                     string | null
  ack2ElapsedHours?:          number
  ack3At:                     string | null
  ack3EstimatedDate?:         string
  ack3ElapsedHours?:          number
  nackCode:                   string | null
  partEleven:                 PartElevenSignature | null
  packageSize?:               string
  sectionCount?:              number
  packageHash?:               string
  masterLibraryPushUnlocked?: boolean
  masterLibraryPushedAt?:     string | null
  masterLibraryCardsPushed?:  number
}

export interface HAQuestion {
  questionId:       string
  number:           number
  category:         'clinical' | 'cmc' | 'administrative'
  text:             string
  assignedTo:       string
  assignedRole:     string
  status:           'not-started' | 'in-progress' | 'responded'
  respondedAt:      string | null
  aiDraftGenerated: boolean
  aiFootprintPct:   number | null
}

export interface HACorrespondence {
  id:                   string
  submissionId:         string
  direction:            'inbound' | 'outbound'
  type:                 'loq' | 'response' | 'ack' | 'approval' | 'nack'
  gateway:              GatewayTarget
  contentSummary:       string
  receivedAt:           string | null
  respondedAt:          string | null
  loqDocId?:            string | null
  loqDocTitle?:         string
  questionsExtracted?:  number
  questionsCategories?: { clinical: number; cmc: number; administrative: number }
  responsePkgDocId?:    string | null
  questions?:           HAQuestion[]
}

export interface RegulatoryAlert {
  id:                      string
  frameworkName:           string
  changeSummary:           string
  effectiveDate:           string
  isEffectiveDateEstimate: boolean
  affectedModules:         string[]
  alertedAt:               string
  acknowledgedByIds:       string[]
  affectedDossierSections: string[]
  actionRequired:          string
  sourceUrl:               string
}

export interface RegulatoryLibraryCard {
  id:                 string
  submissionId:       string
  cardType:           'ctd-section' | 'label' | 'rmp' | 'ha-response-template'
  name:               string
  tags:               string
  taTag:              string
  submissionType:     RegSubmissionType
  haTarget:           string
  availableInModules: string[]
  pushedBy:           string
  pushedAt:           string
  deprecatedAt:       string | null
}

export interface ODDAssessment {
  id:                   string
  submissionId:         string
  projectId:            string
  compound:             string
  indication:           string
  taTag:                string
  prevalenceScore:      number
  eu: {
    prevalence:      string
    threshold:       string
    meetsThreshold:  boolean
    patientEstimate: string
    status:          string
  }
  us: {
    prevalencePatients: number
    threshold:          string
    meetsThreshold:     boolean
    status:             string
  }
  eligibilityScore:     number
  eligibilityLabel:     string
  benefitDraft:         string
  benefitDraftStatus:   'clinical-lead-pending' | 'clinical-lead-signed'
  clinicalLeadSignedAt: string | null
  generatedAt:          string
}

// --- Lookup constants ---

export const GATEWAY_PRIORITY: Record<GatewayTarget, { priority: number; label: string; apiReady: boolean }> = {
  'fda-esg':  { priority: 1, label: 'FDA ESG',  apiReady: true  },
  'ema-cesp': { priority: 2, label: 'EMA CESP', apiReady: true  },
  'cdsco':    { priority: 3, label: 'CDSCO',    apiReady: true  },
  'mhra':     { priority: 4, label: 'MHRA',     apiReady: false },
}

export const CTD_STATUS_META: Record<CTDModuleStatus, { symbol: string; bg: string; fg: string; label: string }> = {
  'not-started':    { symbol: '○', bg: '#F1F5F9', fg: '#64748B', label: 'Not started' },
  'in-authoring':   { symbol: '✎', bg: '#EFF6FF', fg: '#1D4ED8', label: 'In authoring' },
  'in-review':      { symbol: '◔', bg: '#FFFBEB', fg: '#B45309', label: 'In review' },
  'signed':         { symbol: '✓', bg: '#F0FDF4', fg: '#15803D', label: 'Signed' },
  'auto-generated': { symbol: '✦', bg: '#FFF5F5', fg: '#B0200D', label: 'Auto-generated' },
  'read-only':      { symbol: '🔒', bg: '#EFF6FF', fg: '#005F8E', label: 'Read-only · Module A' },
}

export const MODULE_D_ACCENT = {
  primary:      '#B0200D',
  primaryHover: '#8B1A0A',
  bgLight:      '#FFF5F5',
  bgMedium:     '#FFE0E0',
  border:       '#FFC5C5',
  blockingBlue: '#005F8E',
} as const

// ============================================================================
// MODULE E — IDEATION & PUBLISHING (Technical Architecture v4.0 §39)
// ============================================================================

export type IdeationStage        = 'uploaded' | 'under-review' | 'reviewed' | 'approved'
export type ContentCardStatus    = 'uploaded' | 'under-review' | 'reviewed' | 'approved' | 'rejected'
export type ChannelFormat        =
  | 'linkedin' | 'twitter' | 'blog' | 'email' | 'hcp' | 'medical-affairs' | 'instagram' | 'facebook'
export type ClaimCurrencyStatus  = 'current' | 'potentially-superseded' | 'conflicting'
export type SourceCurrencyStatus = 'current' | 'superseded' | 'warned' | 'external-confirmed'
export type ApprovalStatusCheck  = 'passed' | 'blocked' | 'confirmed-external' | 'pending'
export type SourceModuleOrigin   = 'A' | 'B' | 'C' | 'D' | 'external'

export interface IdeationProject {
  id:                    string
  projectId:             string
  sourceType:            'master-library' | 'upload'
  taTag:                 string
  status:                IdeationStage
  stage:                 number
  title:                 string
  compound:              string
  indication:            string
  createdBy:             string
  createdByName:         string
  createdByRole:         string
  createdAt:             string
  updatedAt:             string
  contentCardCount:      number
  approvedCardCount:     number
  scheduledCount:        number
  publishedCount:        number
  maApprovedAt:          string | null
  maApprovedBy:          string | null
  maApprovedByName?:     string | null
  maApprovedByRole?:     string | null
  sourceGateStatus?:     'passed' | 'blocked' | 'pending'
  sourceGateReason?:     string
}

export interface IdeationArtefact {
  id:                       string
  ideationProjectId:        string
  sourceModule:             SourceModuleOrigin
  sourceDocId:              string | null
  filePath?:                string
  title:                    string
  originalApprovalDate:     string | null
  version:                  string
  sourceCurrencyStatus:     SourceCurrencyStatus
  approvalStatusCheck:      ApprovalStatusCheck
  approvalStatusNote:       string
  externalConfirmedBy?:     string
  externalConfirmedAt?:     string
  masterLibraryPushDate:    string | null
  withinNinetyDays:         boolean | null
  claimCurrencyChecked:     boolean
  claimCurrencyCheckedAt?:  string
}

export interface ClaimCurrencyFlag {
  flagId:              string
  text:                string
  acknowledgedBy:      string
  acknowledgedAt:      string
  acknowledgementNote: string
}

export interface IdeationCardProvenance {
  sourceDoc:        string
  sourceDocVersion: string
  section:          string
  passage:          string
  approvalDate:     string
  originModule:     SourceModuleOrigin
}

export interface IdeationContentCard {
  id:                   string
  ideationArtefactId:   string
  ideationProjectId:    string
  sourceSection:        string
  sourcePassage:        string
  claimCurrencyStatus:  ClaimCurrencyStatus
  claimCurrencyFlag?:   ClaimCurrencyFlag
  channelFormats:       ChannelFormat[]
  kolStatus:            'pending' | 'approved' | 'rejected'
  kolApprovedAt:        string | null
  kolApprovedBy:        string | null
  maStatus:             'pending' | 'approved' | 'rejected'
  maApprovedAt:         string | null
  overallStatus:        ContentCardStatus
  provenance:           IdeationCardProvenance
  provenanceChain:      string[]
  title:                string
  cardType:             'efficacy' | 'safety' | 'subgroup' | 'other'
}

export interface AtomisedContentComplianceFix {
  issue:      string
  fixApplied: boolean
}

export interface AtomisedContent {
  id:                    string
  ideationContentCardId: string
  channel:               ChannelFormat
  channelLabel:          string
  contentText:           string
  aiGenerated:           boolean
  aiFootprintHash:       string
  brandScreenPassed:     boolean
  complianceScreenPassed: boolean
  complianceFixes:       AtomisedContentComplianceFix[]
  characterCount:        number
  wordCount:             number
}

export interface ClaimCurrencyClaim {
  id:                    string
  text:                  string
  status:                ClaimCurrencyStatus
  source:                string
  verifiedAgainst:       string
  flagNote?:             string
  acknowledgedBy?:       string
  acknowledgedByName?:   string
  acknowledgedAt?:       string
  acknowledgementNote?:  string
}

export interface ClaimCurrencyCheck {
  id:                    string
  ideationArtefactId:    string
  ideationProjectId:     string
  runAt:                 string
  totalClaimsExtracted:  number
  results:               { current: number; potentiallySuperseded: number; conflicting: number }
  claimsExtracted:       ClaimCurrencyClaim[]
  acknowledgedBy:        string | null
  acknowledgedAt:        string | null
}

export interface CalendarEntry {
  id:                        string
  ideationContentCardId:     string
  ideationProjectId:         string
  channel:                   ChannelFormat
  channelLabel:              string
  cardTitle:                 string
  scheduledDate:             string
  assignedCreativeId:        string
  assignedCreativeName:      string
  status:                    'scheduled' | 'published' | 'overdue' | 'cancelled'
  publishedAt:               string | null
  publishedBy:               string | null
  utmParams:                 string | null
  seoMetadata:               Record<string, unknown>
  sentimentScore:            number | null
  sentimentAlertSent:        boolean
  isOverdue:                 boolean
  overdueHours?:             number
  overdueAlertSentAt?:       string
  maAdvanceNotificationSent?: boolean
  maAdvanceNotificationSentAt?: string
}

export interface SocialListeningAlert {
  id:                  string
  publishRecordId:     string
  calendarEntryId:     string
  ideationProjectId:   string
  cardTitle:           string
  alertType:           'sentiment' | 'engagement'
  thresholdBreached:   boolean
  sentimentScore:      number
  sentimentThreshold:  number
  triggeredAt:         string
  notifiedMALeadAt:    string
  notifiedMALeadName:  string
  autoStopTriggered:   boolean
  autoStopNote:        string
  resolvedAt:          string | null
  resolvedBy:          string | null
  resolvedByName:      string | null
  resolutionNote:      string | null
}

export interface KOLReviewDecision {
  cardId:   string
  decision: 'approved' | 'rejected' | 'pending'
  comment:  string | null
}

export interface KOLContact {
  id:                 string
  ideationProjectId:  string
  name:               string
  title:              string
  email:              string
  reviewLinkToken:    string
  reviewLinkExpiry:   string
  signedOffAt:        string | null
  reminder1SentAt:    string | null
  reminder2SentAt:    string | null
  escalatedAt:        string | null
  reviewDecisions:    KOLReviewDecision[]
}

// --- Lookup constants ---

export const CHANNEL_META: Record<ChannelFormat, { label: string; charLimit?: number }> = {
  linkedin:          { label: 'LinkedIn',        charLimit: 3000 },
  twitter:           { label: 'X / Twitter',     charLimit: 280 },
  blog:              { label: 'Blog Post' },
  email:             { label: 'Email' },
  hcp:               { label: 'HCP Summary' },
  'medical-affairs': { label: 'Medical Affairs' },
  instagram:         { label: 'Instagram',       charLimit: 2200 },
  facebook:          { label: 'Facebook' },
}

export const IDEATION_STAGE_META: Record<IdeationStage, { label: string; bg: string; fg: string }> = {
  uploaded:       { label: 'Uploaded',     bg: '#F1F5F9', fg: '#64748B' },
  'under-review': { label: 'Under Review', bg: '#FFFBEB', fg: '#B45309' },
  reviewed:       { label: 'Reviewed',     bg: '#F0FDFA', fg: '#0F766E' },
  approved:       { label: 'Approved',     bg: '#F0FDF4', fg: '#15803D' },
}

export const CLAIM_CURRENCY_META: Record<ClaimCurrencyStatus, { label: string; bg: string; fg: string }> = {
  current:                 { label: 'Current',                bg: '#F0FDF4', fg: '#15803D' },
  'potentially-superseded':{ label: 'Potentially Superseded', bg: '#FFFBEB', fg: '#B45309' },
  conflicting:             { label: 'Conflicting',            bg: '#EFF6FF', fg: '#005F8E' },
}

export const MODULE_E_ACCENT = {
  primary:      '#0D9488',
  primaryHover: '#0F766E',
  bgLight:      '#F0FDFA',
  bgMedium:     '#CCFBF1',
  border:       '#99F6E4',
  blockingRose: '#BE123C',
  blockingBg:   '#FFF1F2',
} as const

// ============================================================================
// MODULE PM — Platform & Admin (sPM04–sPM18) + Module B sB10
// ============================================================================

export type PlatformUserRole =
  | 'super-admin'
  | 'admin'
  | 'ideation-lead'
  | 'regulatory-writer'
  | 'ma-team-lead'
  | 'content-calendar-manager'
  | 'clinical-lead'
  | 'cmc-lead'
  | 'author'
  | 'qc-checker'
  | 'e-signatory'
  | 'creative-team-member'

export type PlatformUserStatus = 'active' | 'invited' | 'suspended'
export type ModuleKey          = 'A' | 'B' | 'C' | 'D' | 'E' | 'platform'
export type AiEngineStatus     = 'active' | 'available' | 'disabled'
export type PaymentGatewayStatus = 'active' | 'inactive'
export type ExternalApiStatus  = 'connected' | 'not-configured' | 'inactive'
export type FeatureFlagStatus  = 'enabled' | 'disabled' | 'beta'
export type RateCardStatus     = 'active' | 'archived' | 'draft'
export type NotificationEventType =
  | 'stage_advance' | 'review_assigned' | 'ma_advance_notice' | 'system'
  | 'comment' | 'kol_reminder_1' | 'kol_reminder_2' | 'kol_invitation'
  | 'publishing_overdue' | 'gate_failure'
export type AuditActionType =
  | 'SIGNATURE_APPLIED' | 'DOCUMENT_EDITED' | 'ARTEFACT_UPLOADED'
  | 'ACK2_RECEIVED' | 'SUBMISSION_TRANSMITTED' | 'MA_APPROVED'
  | 'CLAIM_CURRENCY_ACKNOWLEDGED' | 'COMMENT_ADDED' | 'USER_INVITED'
  | 'TC_ACCEPTED' | 'FRAMEWORK_ALERT_TRIGGERED' | 'STAGE_ADVANCED'
  | 'CONTRADICTION_RESOLVED' | 'CONTENT_CARD_TAGGED' | 'RATE_CARD_UPDATED'
  | 'MA_REVIEW_RESOLVED' | 'TA_TAG_CREATED' | 'CLIENT_CREATED'
  | 'FRAMEWORK_ACKNOWLEDGED'
export type RegulatoryFrameworkStatus = 'Current' | 'Updated' | 'Draft revision' | 'Deprecated'
export type SubscriptionStatus = 'active' | 'suspended' | 'expired'
export type PaymentMethodType  = 'card' | 'bank-transfer' | 'upi'
export type ReportType =
  | 'project-summary' | 'module-activity' | 'ai-usage'
  | 'user-activity' | 'compliance' | 'publishing-performance'
export type MasterLibraryItemType = 'document' | 'section'
export type TATagStatus = 'active' | 'archived'
export type SlideDeckStatus = 'draft' | 'generating' | 'ready' | 'exported'

export interface PlatformUser {
  id:         string
  name:       string
  email:      string
  role:       PlatformUserRole
  modules:    Array<'A' | 'B' | 'C' | 'D' | 'E'>
  status:     PlatformUserStatus
  lastActive: string | null
}

export interface RaciAssignment {
  admin?:                    RACIRole
  'regulatory-writer'?:      RACIRole
  'clinical-lead'?:          RACIRole
  'cmc-lead'?:               RACIRole
  'qc-checker'?:             RACIRole
  'e-signatory'?:            RACIRole
  'ideation-lead'?:          RACIRole
  'ma-team-lead'?:           RACIRole
  'content-calendar-manager'?: RACIRole
  'creative-team-member'?:   RACIRole
}

export interface RaciTask {
  id:          string
  label:       string
  assignments: RaciAssignment
}

export interface RaciModule {
  label: string
  tasks: RaciTask[]
}

export interface RaciMatrix {
  version:       string
  effectiveDate: string
  modules:       Partial<Record<'A' | 'B' | 'C' | 'D' | 'E', RaciModule>>
}

export interface AiEngineOption { id: string; label: string; provider: string; status: AiEngineStatus }
export interface VoiceEngineOption { id: string; label: string; status: AiEngineStatus }
export interface PaymentGateway { id: string; label: string; status: PaymentGatewayStatus; lastTested: string | null }
export interface ExternalApi    { id: string; label: string; status: ExternalApiStatus;    lastTested: string | null; note?: string; owner?: string }
export interface FeatureFlag    { id: string; label: string; status: FeatureFlagStatus }

export interface PlatformConfig {
  clientId:                 string
  clientName:               string
  plan:                     string
  planStartDate:            string
  renewalDate:              string
  contractedTokensPerMonth: number
  currency:                 string
  aiEngine: {
    default:                    string
    fallback:                   string
    perModuleOverrideEnabled:   boolean
    availableEngines:           AiEngineOption[]
    lastTested:                 string
    lastTestedLatencyMs:        number
    lastTestedStatus:           string
  }
  voiceTranscription: {
    engine:                 string
    availableEngines:       VoiceEngineOption[]
    gdprJurisdiction:       string
    audioRetentionPolicy:   string
    auditDeletionLogged:    boolean
  }
  ectd: {
    defaultVersion:                       string
    validationTool:                       string
    validationCredentialsLastValidated:   string
  }
  paymentGateways: PaymentGateway[]
  externalApis:    ExternalApi[]
  featureFlags:    FeatureFlag[]
  seats?:          { used: number; total: number }
}

export interface MasterLibraryItem {
  id:                string
  name:              string
  module:            ModuleKey
  itemType:          MasterLibraryItemType
  docType:           string
  ta:                string[]
  version:           string
  pushedAt:          string
  pushedBy:          string
  pushedByName:      string
  projectId:         string
  projectName:       string
  tags:              string[]
  isArchived:        boolean
  archivedReason?:   string
  provenanceChain:   string[]
}

export interface BestPractice {
  id:                 string
  module:             ModuleKey
  category:           string
  name:               string
  guidance:           string
  applicableDocTypes: string[]
  frameworkRefs:      string[]
  effectiveFrom:      string
  validUntil:         string
  version:            string
  createdBy:          string
  updatedAt:          string
  reviewDue:          boolean
  reviewDueNote?:     string
}

export interface PlatformNotification {
  id:            string
  eventType:     NotificationEventType
  title:         string
  body:          string
  module:        ModuleKey
  projectId:     string | null
  entityRef:     string | null
  targetUserId:  string
  sentAt:        string
  isRead:        boolean
  ctaLabel:      string
  ctaRoute:      string
}

export interface NotificationPreference {
  userId:     string
  eventType:  NotificationEventType | string
  email:      boolean
  inApp:      boolean
  sms:        boolean
}

export interface PartElevenRecord {
  signatoryName:        string
  role:                 string
  email:                string
  meaning:              string
  documentVersionHash:  string
  timestamp:            string
}

export interface AuditTrailEntry {
  id:          string
  timestamp:   string
  userId:      string
  userName:    string
  action:      AuditActionType
  entityType:  string
  entityId:    string
  entityLabel: string
  module:      ModuleKey
  details:     string
  ipAddress:   string | null
  sessionId:   string | null
  partEleven:  PartElevenRecord | null
}

export interface RateCardEntry {
  module:      string
  serviceType: string
  unit:        string
  rate:        number
}

export interface RateCard {
  id:                     string
  version:                string
  label:                  string
  status:                 RateCardStatus
  effectiveFrom:          string
  validUntil:             string
  archivedAt:             string | null
  createdBy:              string
  createdByName:          string
  isDisruptionRateCard:   boolean
  note?:                  string
  expiryReminderSentAt?:  string | null
  currency:               string
  rates:                  RateCardEntry[]
}

export interface ModuleBreakdown {
  module:          ModuleKey
  label:           string
  tokensConsumed:  number
  cost:            number
  pctOfTotal:      number
  burnRate:        'low' | 'on-track' | 'high'
  status:          'healthy' | 'monitor' | 'over'
}

export interface Invoice {
  id:       string
  date:     string
  amount:   number
  services: string
  status:   'paid' | 'pending' | 'overdue' | 'failed'
  pdfUrl:   string
}

export interface MarketValueSavingsRow {
  module:           ModuleKey
  hoursEquivalent:  number
  standardRate:     number
  savings:          number
}

export interface Subscription {
  clientId:                 string
  planName:                 string
  contractedTokensPerMonth: number
  currency:                 string
  monthlyFee:               number
  renewalDate:              string
  autoRenew:                boolean
  currentMonthRunningTotal?: number
  paymentMethod: {
    type:         PaymentMethodType
    brand:        string
    last4:        string
    expiryMonth:  number
    expiryYear:   number
  }
  activeGateways: string[]
  currentPeriod: {
    month:                string
    tokensConsumed:       number
    tokensRemaining:      number
    estimatedSpend:       number
    burnRatePerDay:       number
    projectedEndOfMonth:  number
  }
  moduleBreakdown: ModuleBreakdown[]
  invoices:        Invoice[]
  marketValueSavings: {
    total:                 number
    calculatedAt:          string
    rateCardVersion:       string
    rateCardSetBy:         string
    rateCardEffectiveDate: string
    breakdown:             MarketValueSavingsRow[]
  }
  burnRateAlert?: {
    active:                    boolean
    affectedModules:           string[]
    affectedPct:               number
    projectedExhaustionDate:   string
    daysBeforeRenewal:         number
    message:                   string
  }
}

export interface ReportDefinition {
  id:               string
  type:             ReportType
  label:            string
  description:      string
  availableFormats: Array<'pdf' | 'csv'>
  lastGenerated:    string | null
  generatedBy:      string | null
}

export interface ModuleHealthScore {
  module:             ModuleKey
  label:              string
  healthScore:        number
  completionRate:     number
  reviewPassRate:     number
  crmCompletionRate:  number
  avgStageDays:       number
  activeDocuments:    number
  overdueDocuments:   number
}

export interface TATag {
  id:              string
  name:            string
  abbreviation:    string
  status:          TATagStatus
  projectCount:    number
  documentCount:   number
  createdAt:       string
  createdBy:       string
  archivedAt?:     string
}

export interface RegulatoryFramework {
  id:             string
  code:           string
  name:           string
  issuer:         string
  version:        string
  effectiveDate:  string
  scope:          Array<'A' | 'B' | 'C' | 'D' | 'E'>
  status:         RegulatoryFrameworkStatus
  lastUpdated:    string
  changeSummary:  string | null
}

export interface SlideFigure {
  figureId:          string
  altText:           string | null
  figureDescription?: string
}

export interface Slide {
  id:            string
  position:      number
  title:         string
  bodyText:      string
  figures:       SlideFigure[]
  speakerNotes:  string
}

export interface AccessibilityMissingAltText {
  slideId:            string
  slideTitle:         string
  figureId:           string
  figureDescription:  string
}

export interface SlideDeckJob {
  id:                    string
  publicationId:         string
  publicationTitle:      string
  source:                string
  congressTarget:        string
  slideCountLimit:       number
  status:                SlideDeckStatus
  aiModel:               string
  aiFootprintPct:        number
  generatedAt:           string
  totalSlides:           number
  clientTemplate:        { id: string; label: string; applied: boolean }
  congressGateActive:    boolean
  congressGateMessage:   string
  accessibilityGate: {
    active:            boolean
    missingAltText:    AccessibilityMissingAltText[]
  }
  slides:                Slide[]
}

export const PLATFORM_ACCENT = {
  primary:      '#1A3C5E',   // navy-700
  primaryHover: '#12304F',
  bgTint:       '#EFF6FF',   // navy-50
  bgLight:      '#DBEAFE',   // navy-100
  borderMedium: '#BFDBFE',   // navy-200
  destructive:  '#B91C1C',
} as const

export const MODULE_B_SB10_ACCENT = {
  primary:      '#7B3C9A',
  primaryHover: '#5B21B6',
} as const

export type PlatformClientStatus = 'active' | 'suspended' | 'churned'

export interface PlatformClient {
  id:               string
  name:             string
  note?:            string
  plan:             string
  status:           PlatformClientStatus
  adminContactName: string | null
  createdAt:        string
  revenueToDateGBP: number
}

export interface PlatformAnalytics {
  totalActiveUsers:          number
  activeProjects:            number
  documentsCreatedRolling30: number
  aiTokensRolling30:         number
  mrrGBP:                    number
  arrGBP:                    number
  churnThisQuarter:          number
  avgTokensPerClientMonth:   number
  clientCounts: {
    active:    number
    suspended: number
    churned:   number
  }
}

export const PLATFORM_USER_ROLE_LABEL: Record<PlatformUserRole, string> = {
  'super-admin':               'Super Admin',
  'admin':                     'Admin',
  'ideation-lead':             'Ideation Lead',
  'regulatory-writer':         'Regulatory Writer',
  'ma-team-lead':              'MA Team Lead',
  'content-calendar-manager':  'Content Calendar Manager',
  'clinical-lead':             'Clinical Lead',
  'cmc-lead':                  'CMC Lead',
  'author':                    'Author',
  'qc-checker':                'QC Checker',
  'e-signatory':               'E-Signatory',
  'creative-team-member':      'Creative Team Member',
}
