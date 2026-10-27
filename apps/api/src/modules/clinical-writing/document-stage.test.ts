import { describe, expect, it } from 'vitest'
import {
  DB_STAGES,
  dbStageToUi,
  isDbStage,
  isLaterStage,
  nextStage,
  stageIndex,
  STAGE_LABELS,
  StageAdvanceError,
  uiStageToDb,
} from './document-stage.js'

describe('document stage machine', () => {
  it('walks the linear six-stage sequence', () => {
    expect(nextStage('study_start_up')).toBe('during_study')
    expect(nextStage('during_study')).toBe('reporting')
    expect(nextStage('reporting')).toBe('cross_functional_review')
    expect(nextStage('cross_functional_review')).toBe('crm')
    expect(nextStage('crm')).toBe('final_output')
  })

  it('treats final_output as terminal', () => {
    expect(nextStage('final_output')).toBeNull()
  })

  it('round-trips every stage through db<->ui converters', () => {
    for (const s of DB_STAGES) {
      expect(uiStageToDb(dbStageToUi(s))).toBe(s)
    }
  })

  it('preserves the legacy reporting <-> post-study alias', () => {
    expect(dbStageToUi('reporting')).toBe('post-study')
    expect(uiStageToDb('post-study')).toBe('reporting')
  })

  it('isDbStage accepts canonical values and rejects aliases/unknowns', () => {
    expect(isDbStage('study_start_up')).toBe(true)
    expect(isDbStage('reporting')).toBe(true)
    expect(isDbStage('post-study')).toBe(false)
    expect(isDbStage('unknown')).toBe(false)
    expect(isDbStage(null)).toBe(false)
    expect(isDbStage(undefined)).toBe(false)
    expect(isDbStage(42)).toBe(false)
  })

  it('isLaterStage is strict (not >=) and respects order', () => {
    expect(isLaterStage('study_start_up', 'during_study')).toBe(true)
    expect(isLaterStage('crm', 'final_output')).toBe(true)
    expect(isLaterStage('crm', 'crm')).toBe(false)
    expect(isLaterStage('final_output', 'crm')).toBe(false)
    expect(isLaterStage('cross_functional_review', 'study_start_up')).toBe(false)
  })

  it('stageIndex matches DB_STAGES declaration order', () => {
    expect(stageIndex('study_start_up')).toBe(0)
    expect(stageIndex('final_output')).toBe(DB_STAGES.length - 1)
  })

  it('exposes a human label for every stage', () => {
    for (const s of DB_STAGES) {
      expect(STAGE_LABELS[s]).toBeTruthy()
      expect(STAGE_LABELS[s].length).toBeGreaterThan(0)
    }
  })

  it('StageAdvanceError carries the reason tag', () => {
    const err = new StageAdvanceError('document at terminal stage', 'terminal')
    expect(err.name).toBe('StageAdvanceError')
    expect(err.reason).toBe('terminal')
    expect(err.message).toMatch(/terminal/)
  })
})
