import { useMemo, useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { RaciMatrix as RaciMatrixData, RACIRole, PlatformUserRole } from '@platform/types'
import { PLATFORM_USER_ROLE_LABEL } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { usePlatformStore, PLATFORM_DEMO_USERS } from '../store'

type ModuleKey = 'A' | 'B' | 'C' | 'D' | 'E'

const MODULE_META: Record<ModuleKey, { name: string; blurb: string; stages: number; colour: string; stageLabels: string[] }> = {
  A: { name: 'Clinical Writing',      blurb: 'CSRs, IBs, SAPs and regulatory documents',              stages: 6, colour: '#2563EB', stageLabels: ['Draft', 'Review', 'CRM', 'Approval', 'Sign-off', 'Final'] },
  B: { name: 'Scientific Writing',    blurb: 'Manuscripts, abstracts, posters and publications',      stages: 6, colour: '#0D9488', stageLabels: ['Concept', 'Draft', 'Author Review', 'Peer Review', 'Submission', 'Final'] },
  C: { name: 'Medical Writing',       blurb: 'HCP decks, PILs, CME modules and disease dossiers',     stages: 6, colour: '#7C3AED', stageLabels: ['Brief', 'Draft', 'Pre-MLR', 'MLR', 'Format', 'Final'] },
  D: { name: 'Regulatory Writing',    blurb: 'CTD/eCTD submissions and gateway filings',              stages: 6, colour: '#B0200D', stageLabels: ['Setup', 'CTD Auth', 'CMC', 'Super Review', 'Publish', 'Gateway'] },
  E: { name: 'Ideation & Publishing', blurb: 'Content cards, KOL review and publishing calendar',     stages: 4, colour: '#0D9488', stageLabels: ['Uploaded', 'Under Review', 'Reviewed', 'Approved'] },
}

const RACI_COLOURS: Record<RACIRole, { bg: string; fg: string }> = {
  R: { bg: '#FEF2F2', fg: '#B0200D' },
  A: { bg: '#FFFBEB', fg: '#D97706' },
  C: { bg: '#EFF6FF', fg: '#1A3C5E' },
  I: { bg: '#F8FAFC', fg: '#94A3B8' },
}

const RACI_WORD: Record<RACIRole, string> = {
  R: 'you do this',
  A: 'you are accountable',
  C: 'you are consulted',
  I: 'you are informed',
}

// Demo mapping: choose the current user based on module route param
function demoUserFor(module: ModuleKey) {
  if (module === 'E') return PLATFORM_DEMO_USERS.find(u => u.role === 'ideation-lead')
  if (module === 'D') return PLATFORM_DEMO_USERS.find(u => u.role === 'admin')
  return PLATFORM_DEMO_USERS.find(u => u.role === 'admin')
}

export function OnboardingWizard() {
  const { module } = useParams<{ module: string }>()
  const navigate   = useNavigate()
  const setCurrentUser = usePlatformStore(s => s.setCurrentUser)

  const moduleKey: ModuleKey = (module?.toUpperCase() as ModuleKey) || 'E'
  const meta = MODULE_META[moduleKey] ?? MODULE_META.E
  const demoUser = demoUserFor(moduleKey)

  useEffect(() => {
    // Set the demo current-user based on module so RACI filter has data
    if (demoUser) setCurrentUser(demoUser)
  }, [demoUser, setCurrentUser])

  const currentRole = (demoUser?.role ?? 'admin') as PlatformUserRole

  const { data: raci } = useQuery<RaciMatrixData>({
    queryKey: ['raci', 'proj-velora-301'],
    queryFn:  () => platformApi.getRaci('proj-velora-301'),
  })

  const raciRows = useMemo(() => {
    const tasks = raci?.modules[moduleKey]?.tasks ?? []
    return tasks
      .map(t => ({ task: t.label, mark: (t.assignments as Record<string, RACIRole | undefined>)[currentRole] }))
      .filter(row => !!row.mark) as { task: string; mark: RACIRole }[]
  }, [raci, moduleKey, currentRole])

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
          <span data-user-name>{demoUser?.name ?? '—'}</span> · <span data-role-label>{PLATFORM_USER_ROLE_LABEL[currentRole]}</span>
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
              <span className="text-[11px] font-semibold" style={{ color: isActive ? meta.colour : '#94A3B8' }}>Step {i + 1}</span>
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
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest" style={{ color: meta.colour }}>Step 1 · Welcome</p>
                <h2 className="mt-1 text-[20px] font-bold text-slate-900" data-module-name>Welcome to {meta.name}</h2>
                <p className="mt-2 text-[13px] text-slate-700" data-module-blurb>{meta.blurb}</p>
                <div className="mt-4 flex items-center gap-2" data-stage-strip>
                  {meta.stageLabels.map((label, i) => (
                    <div key={label} className="flex items-center gap-2" data-stage-dot={i + 1}>
                      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: meta.colour }} />
                      <span className="text-[11px] text-slate-700">{label}</span>
                      {i < meta.stageLabels.length - 1 && <span className="text-slate-300">→</span>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* STEP 2 — Your Role (active) */}
            {stepIdx === 1 && (
              <section data-step-body="your-role">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest" style={{ color: meta.colour }}>Step 2 · Your role</p>
                <h2 className="mt-1 text-[20px] font-bold text-slate-900">
                  Your role in this module · <span data-role-heading>{PLATFORM_USER_ROLE_LABEL[currentRole]}</span>
                </h2>
                <p className="mt-2 text-[13px] text-slate-700">
                  These assignments come from the project RACI matrix. They determine which actions you can take and which notifications you receive.
                </p>

                <div className="mt-4 overflow-hidden rounded-lg border border-slate-200" data-raci-table>
                  <table className="w-full text-[13px]">
                    <thead style={{ backgroundColor: '#F8FAFC' }}>
                      <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                        <th className="px-4 py-2">Task</th>
                        <th className="w-16 px-4 py-2 text-center">Mark</th>
                        <th className="px-4 py-2">Meaning</th>
                      </tr>
                    </thead>
                    <tbody>
                      {raciRows.map((r, i) => {
                        const c = RACI_COLOURS[r.mark]
                        return (
                          <tr key={i} className="border-t border-slate-200" data-raci-row={i}>
                            <td className="px-4 py-2 text-slate-800">{r.task}</td>
                            <td className="px-4 py-2 text-center">
                              <span
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md font-mono text-[11px] font-bold"
                                style={{ backgroundColor: c.bg, color: c.fg, border: `1px solid ${c.fg}44` }}
                                data-raci-mark={r.mark}
                              >{r.mark}</span>
                            </td>
                            <td className="px-4 py-2 font-mono text-[12px] text-slate-600" data-raci-word>{RACI_WORD[r.mark]}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <p className="mt-3 font-mono text-[11px] text-slate-500" data-raci-legend>
                  R = you do this · A = you are accountable · C = you are consulted · I = you are informed
                </p>
              </section>
            )}

            {/* Placeholder for steps 3–6 — same shell */}
            {stepIdx >= 2 && (
              <section data-step-body={`step-${stepIdx + 1}`}>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest" style={{ color: meta.colour }}>Step {stepIdx + 1}</p>
                <h2 className="mt-1 text-[20px] font-bold text-slate-900">
                  {stepIdx === 2 && 'Where things go next'}
                  {stepIdx === 3 && 'Notifications you can expect'}
                  {stepIdx === 4 && 'The audit trail'}
                  {stepIdx === 5 && 'You are ready — start with your first project'}
                </h2>
                <p className="mt-2 text-[13px] text-slate-700">
                  This step content will be filled in from module-specific copy. The wizard scaffold, per-module colour and navigation are already in place.
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
            >← Back</button>

            <p className="font-mono text-[11px] text-slate-500" data-step-count>Step {stepIdx + 1} of {totalSteps}</p>

            <button
              type="button"
              onClick={goNext}
              data-next-button
              data-next-label={isLast ? 'go-to-home' : 'next'}
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white"
              style={{ backgroundColor: meta.colour }}
            >{isLast ? 'Go to Module Home →' : 'Next →'}</button>
          </footer>

        </article>

        <p className="text-center text-[11px] text-slate-500" data-progress-note>
          Your progress is saved. You can reopen this walkthrough from the help menu at any time.
        </p>

        {stepIdx > 0 && (
          <button
            type="button"
            onClick={skipWizard}
            data-skip-wizard
            className="mx-auto text-[11px] font-semibold text-slate-400 hover:underline"
          >Skip wizard</button>
        )}
      </main>
    </div>
  )
}
