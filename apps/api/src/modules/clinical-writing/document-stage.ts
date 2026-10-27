// Clinical Writing document stage machine — Module A.
//
// Six stages, linear, no skipping. Stored as snake_case in the DB (one legacy
// alias: 'reporting' == post_study, kept because the original fixtures used
// that name). The hyphen-case form crosses the API boundary. uiStage()/
// dbStage() convert between the two.
//
// Stage advancement is write-once per step: Study Start-Up → During Study →
// Post-Study → Cross-Functional Review → CRM → Final Output. The route layer
// owns RBAC + auto-advance-on-status; this file just owns the enum + math.

export const DB_STAGES = [
  'study_start_up',
  'during_study',
  'reporting',               // UI form: post-study
  'cross_functional_review',
  'crm',
  'final_output',
] as const
export type DbStage = typeof DB_STAGES[number]

export const UI_STAGES = [
  'study-start-up',
  'during-study',
  'post-study',
  'cross-functional-review',
  'crm',
  'final-output',
] as const
export type UiStage = typeof UI_STAGES[number]

const DB_TO_UI: Record<DbStage, UiStage> = {
  study_start_up: 'study-start-up',
  during_study: 'during-study',
  reporting: 'post-study',
  cross_functional_review: 'cross-functional-review',
  crm: 'crm',
  final_output: 'final-output',
}

const UI_TO_DB: Record<UiStage, DbStage> = {
  'study-start-up': 'study_start_up',
  'during-study': 'during_study',
  'post-study': 'reporting',
  'cross-functional-review': 'cross_functional_review',
  'crm': 'crm',
  'final-output': 'final_output',
}

export const STAGE_LABELS: Record<DbStage, string> = {
  study_start_up: 'Study Start-Up',
  during_study: 'During Study',
  reporting: 'Post-Study / Data Analysis',
  cross_functional_review: 'Cross-Functional Review',
  crm: 'CRM',
  final_output: 'Final Output',
}

export function isDbStage(s: unknown): s is DbStage {
  return typeof s === 'string' && (DB_STAGES as readonly string[]).includes(s)
}

export function dbStageToUi(s: DbStage): UiStage {
  return DB_TO_UI[s]
}

export function uiStageToDb(s: UiStage): DbStage {
  return UI_TO_DB[s]
}

export function stageIndex(s: DbStage): number {
  return DB_STAGES.indexOf(s)
}

export function nextStage(from: DbStage): DbStage | null {
  const i = DB_STAGES.indexOf(from)
  if (i < 0 || i >= DB_STAGES.length - 1) return null
  return DB_STAGES[i + 1]!
}

/** True when `candidate` is strictly later than `current` in the stage order. */
export function isLaterStage(current: DbStage, candidate: DbStage): boolean {
  return DB_STAGES.indexOf(candidate) > DB_STAGES.indexOf(current)
}

export class StageAdvanceError extends Error {
  constructor(message: string, public readonly reason: 'terminal' | 'invalid') {
    super(message)
    this.name = 'StageAdvanceError'
  }
}
