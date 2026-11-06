import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ProjectRaciAssignment, RACIRole, PlatformUserRole } from '@platform/types'
import { PLATFORM_USER_ROLE_LABEL } from '@platform/types'
import { projectsApi } from '../../api'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store'
import { myRaciRows } from '../raciTemplate'
import { rolesOf } from '../../config/roles'

type ModuleKey = 'A' | 'B' | 'C' | 'D' | 'E'

interface ModuleMeta { nameKey: string; blurbKey: string; stages: number; colour: string; stageLabelKeys: string[] }

const MODULE_META: Record<ModuleKey, ModuleMeta> = {
  A: { nameKey: 'nav.clinical_writing',    blurbKey: 'page.onboarding_wizard.blurb_a', stages: 6, colour: '#2563EB',
       stageLabelKeys: ['page.onboarding_wizard.stage_a_draft','page.onboarding_wizard.stage_a_review','page.onboarding_wizard.stage_a_crm','page.onboarding_wizard.stage_a_approval','page.onboarding_wizard.stage_a_signoff','page.onboarding_wizard.stage_a_final'] },
  B: { nameKey: 'nav.scientific_writing',  blurbKey: 'page.onboarding_wizard.blurb_b', stages: 6, colour: '#0D9488',
       stageLabelKeys: ['page.onboarding_wizard.stage_b_concept','page.onboarding_wizard.stage_b_draft','page.onboarding_wizard.stage_b_author_review','page.onboarding_wizard.stage_b_peer_review','page.onboarding_wizard.stage_b_submission','page.onboarding_wizard.stage_b_final'] },
  C: { nameKey: 'nav.medical_writing',     blurbKey: 'page.onboarding_wizard.blurb_c', stages: 6, colour: '#7C3AED',
       stageLabelKeys: ['page.onboarding_wizard.stage_c_brief','page.onboarding_wizard.stage_c_draft','page.onboarding_wizard.stage_c_pre_mlr','page.onboarding_wizard.stage_c_mlr','page.onboarding_wizard.stage_c_format','page.onboarding_wizard.stage_c_final'] },
  D: { nameKey: 'nav.regulatory_writing',  blurbKey: 'page.onboarding_wizard.blurb_d', stages: 6, colour: '#B0200D',
       stageLabelKeys: ['page.onboarding_wizard.stage_d_setup','page.onboarding_wizard.stage_d_ctd_auth','page.onboarding_wizard.stage_d_cmc','page.onboarding_wizard.stage_d_super_review','page.onboarding_wizard.stage_d_publish','page.onboarding_wizard.stage_d_gateway'] },
  E: { nameKey: 'nav.ideation_publishing', blurbKey: 'page.onboarding_wizard.blurb_e', stages: 4, colour: '#0D9488',
       stageLabelKeys: ['page.onboarding_wizard.stage_e_uploaded','page.onboarding_wizard.stage_e_under_review','page.onboarding_wizard.stage_e_reviewed','page.onboarding_wizard.stage_e_approved'] },
}

const RACI_COLOURS: Record<RACIRole, { bg: string; fg: string }> = {
  R: { bg: '#FEF2F2', fg: '#B0200D' },
  A: { bg: '#FFFBEB', fg: '#D97706' },
  C: { bg: '#EFF6FF', fg: '#1A3C5E' },
  I: { bg: '#F8FAFC', fg: '#94A3B8' },
}

const RACI_WORD_KEYS: Record<RACIRole, string> = {
  R: 'page.onboarding_wizard.raci_word_r',
  A: 'page.onboarding_wizard.raci_word_a',
  C: 'page.onboarding_wizard.raci_word_c',
  I: 'page.onboarding_wizard.raci_word_i',
}

export function OnboardingWizard() {
  const { t } = useTranslation()
  const { module } = useParams<{ module: string }>()
  const navigate   = useNavigate()
  const currentUser = usePlatformStore(s => s.currentUser)

  const moduleKey: ModuleKey = (module?.toUpperCase() as ModuleKey) || 'E'
  const meta = MODULE_META[moduleKey] ?? MODULE_META.E
  const roleLabels = rolesOf(currentUser).map(r => PLATFORM_USER_ROLE_LABEL[r as PlatformUserRole] ?? r).join(', ')

  // Step 2 (FR-PM-019): the signed-in user's RACI for this module on one of their projects — the
  // project's saved assignments where it has them, the role template otherwise (raciTemplate.ts).
  // The API only lists projects this user can see; with no project there is only the template.
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list(), retry: false })
  const projects = useMemo(() => projectsQ.data ?? [], [projectsQ.data])
  const [chosenProjectId, setChosenProjectId] = useState('')
  const projectId = projects.some(p => p.id === chosenProjectId) ? chosenProjectId : projects[0]?.id ?? ''

  const overridesQ = useQuery<ProjectRaciAssignment[]>({
    queryKey: ['project-raci', projectId],
    queryFn:  () => platformApi.listProjectRaci(projectId),
    enabled:  !!projectId,
    retry: false,
  })
  const raciRows = useMemo(
    () => myRaciRows(currentUser, moduleKey, overridesQ.data ?? []),
    [currentUser, moduleKey, overridesQ.data],
  )
  const raciLoading = projectsQ.isLoading || overridesQ.isLoading
  const raciFailed  = projectsQ.isError || overridesQ.isError
  const retryRaci = () => { void (projectsQ.isError ? projectsQ.refetch() : overridesQ.refetch()) }

  const [stepIdx, setStepIdx] = useState(1) // 0-indexed → step 2 active by default
  const [completed, setCompleted] = useState<Set<number>>(new Set([0])) // step 1 completed

  const totalSteps = 6
  const isLast     = stepIdx === totalSteps - 1

  const goNext = () => {
    setCompleted(prev => new Set([...prev, stepIdx]))
    if (isLast) {
      try { localStorage.setItem(`onboarding-${moduleKey}`, 'complete') } catch { /* prototype */ }
      navigate('/projects')
    } else {
      setStepIdx(stepIdx + 1)
    }
  }
  const goBack = () => stepIdx > 0 && setStepIdx(stepIdx - 1)
  const skipWizard = () => {
    try { localStorage.setItem(`onboarding-${moduleKey}`, 'skipped') } catch { /* prototype */ }
    navigate('/projects')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-auto bg-slate-100"
      data-screen="onboarding-wizard"
      data-module={moduleKey}
      data-no-app-shell
    >

      {/* Top strip */}
      <header className="flex h-14 flex-none items-center justify-between border-b border-slate-200 bg-white px-6" data-top-strip>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md font-mono text-[11px] font-bold text-white" style={{ backgroundColor: meta.colour }}>C</span>
          <span className="text-[14px] font-bold text-slate-900">ClinWrite.AI</span>
        </div>
        <p className="font-mono text-[11px] text-slate-500">
          <span data-user-name>{currentUser.name}</span> · <span data-role-label>{roleLabels}</span>
        </p>
      </header>

      {/* Progress dots */}
      <div className="flex items-center justify-center gap-3 border-b border-slate-200 bg-white py-3" data-progress-dots>
        {Array.from({ length: totalSteps }).map((_, i) => {
          const isActive = i === stepIdx
          const isDone   = completed.has(i)
          return (
            <div key={i} className="flex items-center gap-2" data-progress-step={i + 1} data-step-active={isActive || undefined} data-step-done={isDone || undefined}>
              <span
                className="inline-flex h-6 w-6 items-center justify-center rounded-full font-mono text-[10px] font-bold"
                style={{
                  backgroundColor: isDone ? meta.colour : (isActive ? meta.colour : '#E2E8F0'),
                  color:           isDone || isActive ? '#FFFFFF' : '#94A3B8',
                }}
              >{isDone ? '✓' : (i + 1)}</span>
              <span className="text-[11px] font-semibold" style={{ color: isActive ? meta.colour : '#94A3B8' }}>{t('page.onboarding_wizard.step_n', { n: i + 1 })}</span>
            </div>
          )
        })}
      </div>

      {/* Main card */}
      <main className="mx-auto flex w-full max-w-[880px] flex-1 flex-col gap-5" style={{ padding: '32px 24px' }}>
        <article className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm" data-active-step-card>

          {/* Module colour banner */}
          <div className="h-2 flex-none" style={{ backgroundColor: meta.colour }} data-module-banner />

          <div className="flex flex-col gap-4 p-6">

            {/* STEP 1 — Welcome (rendered as completed reference when step 2+ active) */}
            {stepIdx === 0 && (
              <section data-step-body="welcome">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest" style={{ color: meta.colour }}>{t('page.onboarding_wizard.step_1_eyebrow')}</p>
                <h2 className="mt-1 text-[20px] font-bold text-slate-900" data-module-name>{t('page.onboarding_wizard.welcome_to', { module: t(meta.nameKey) })}</h2>
                <p className="mt-2 text-[13px] text-slate-700" data-module-blurb>{t(meta.blurbKey)}</p>
                <div className="mt-4 flex items-center gap-2" data-stage-strip>
                  {meta.stageLabelKeys.map((labelKey, i) => (
                    <div key={labelKey} className="flex items-center gap-2" data-stage-dot={i + 1}>
                      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: meta.colour }} />
                      <span className="text-[11px] text-slate-700">{t(labelKey)}</span>
                      {i < meta.stageLabelKeys.length - 1 && <span className="text-slate-300">→</span>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* STEP 2 — Your Role (active) */}
            {stepIdx === 1 && (
              <section data-step-body="your-role">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest" style={{ color: meta.colour }}>{t('page.onboarding_wizard.step_2_eyebrow')}</p>
                <h2 className="mt-1 text-[20px] font-bold text-slate-900">
                  {t('page.onboarding_wizard.your_role_prefix')} <span data-role-heading>{roleLabels}</span>
                </h2>
                <p className="mt-2 text-[13px] text-slate-700">
                  {t('page.onboarding_wizard.your_role_body')}
                </p>

                {projects.length > 1 && (
                  <label className="mt-4 flex items-center gap-2 text-[12px] font-semibold text-slate-600">
                    {t('page.onboarding_wizard.raci_project_label')}
                    <select value={projectId} onChange={e => setChosenProjectId(e.currentTarget.value)} data-raci-project
                      className="h-8 rounded-md border border-slate-300 bg-white px-2 text-[12px] font-normal text-slate-900">
                      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                )}

                {raciLoading ? (
                  <p className="mt-4 text-[13px] text-slate-500" data-raci-state="loading">{t('page.onboarding_wizard.raci_loading')}</p>
                ) : raciFailed ? (
                  <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-800" data-raci-state="error">
                    <span>{t('page.onboarding_wizard.raci_load_failed')}</span>
                    <button type="button" onClick={retryRaci} data-action="retry-raci"
                      className="rounded-md border border-red-300 bg-white px-3 py-1 text-[12px] font-semibold text-red-800 hover:bg-red-100">
                      {t('page.onboarding_wizard.raci_retry')}
                    </button>
                  </div>
                ) : raciRows.length === 0 ? (
                  <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-[13px] text-slate-600" data-raci-state="empty">
                    {t('page.onboarding_wizard.raci_empty')}
                  </p>
                ) : (
                <div className="mt-4 overflow-hidden rounded-lg border border-slate-200" data-raci-table>
                  <table className="w-full text-[13px]">
                    <thead style={{ backgroundColor: '#F8FAFC' }}>
                      <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                        <th className="px-4 py-2">{t('page.onboarding_wizard.col_task')}</th>
                        <th className="w-16 px-4 py-2 text-center">{t('page.onboarding_wizard.col_mark')}</th>
                        <th className="px-4 py-2">{t('page.onboarding_wizard.col_meaning')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {raciRows.map(r => {
                        const c = RACI_COLOURS[r.mark]
                        return (
                          <tr key={r.taskId} className="border-t border-slate-200" data-raci-row={r.taskId}>
                            <td className="px-4 py-2 text-slate-800">{r.task}</td>
                            <td className="px-4 py-2 text-center">
                              <span
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md font-mono text-[11px] font-bold"
                                style={{ backgroundColor: c.bg, color: c.fg, border: `1px solid ${c.fg}44` }}
                                data-raci-mark={r.mark}
                              >{r.mark}</span>
                            </td>
                            <td className="px-4 py-2 font-mono text-[12px] text-slate-600" data-raci-word>{t(RACI_WORD_KEYS[r.mark])}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                )}

                <p className="mt-3 font-mono text-[11px] text-slate-500" data-raci-legend>
                  {t('page.onboarding_wizard.raci_legend')}
                </p>
              </section>
            )}

            {/* Placeholder for steps 3–6 — same shell */}
            {stepIdx >= 2 && (
              <section data-step-body={`step-${stepIdx + 1}`}>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest" style={{ color: meta.colour }}>{t('page.onboarding_wizard.step_n', { n: stepIdx + 1 })}</p>
                <h2 className="mt-1 text-[20px] font-bold text-slate-900">
                  {stepIdx === 2 && t('page.onboarding_wizard.step_3_heading')}
                  {stepIdx === 3 && t('page.onboarding_wizard.step_4_heading')}
                  {stepIdx === 4 && t('page.onboarding_wizard.step_5_heading')}
                  {stepIdx === 5 && t('page.onboarding_wizard.step_6_heading')}
                </h2>
                <p className="mt-2 text-[13px] text-slate-700">
                  {t('page.onboarding_wizard.placeholder_step_body')}
                </p>
              </section>
            )}
          </div>

          {/* Step navigation */}
          <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3" data-step-nav>
            <button
              type="button"
              onClick={goBack}
              disabled={stepIdx === 0}
              data-back-button
              className="text-[13px] font-semibold text-slate-500 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
            >{t('page.onboarding_wizard.back_button')}</button>

            <p className="font-mono text-[11px] text-slate-500" data-step-count>{t('page.onboarding_wizard.step_x_of_y', { x: stepIdx + 1, y: totalSteps })}</p>

            <button
              type="button"
              onClick={goNext}
              data-next-button
              data-next-label={isLast ? 'go-to-home' : 'next'}
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white"
              style={{ backgroundColor: meta.colour }}
            >{isLast ? t('page.onboarding_wizard.go_to_module_home') : t('page.onboarding_wizard.next_button')}</button>
          </footer>

        </article>

        <p className="text-center text-[11px] text-slate-500" data-progress-note>
          {t('page.onboarding_wizard.progress_saved_note')}
        </p>

        {stepIdx > 0 && (
          <button
            type="button"
            onClick={skipWizard}
            data-skip-wizard
            className="mx-auto text-[11px] font-semibold text-slate-400 hover:underline"
          >{t('page.onboarding_wizard.skip_wizard')}</button>
        )}
      </main>
    </div>
  )
}
