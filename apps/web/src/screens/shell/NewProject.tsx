// New Project form — rendered inside a right-edge SlidePanel from
// AllProjects. API ready at POST /projects (apps/api/src/modules/
// projects/routes.ts). super-admin + admin only; the server-side 403
// is what the user sees if they lack the role — form shows a friendly
// error in that case.

import { THERAPEUTIC_AREA_LABEL } from '../../utils/labels'
import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { projectsApi } from '../../api'
import { ApiError } from '../../api/client'
import { useTaLabels } from '../../hooks'

const PHASES  = ['Preclinical', 'Phase 1', 'Phase 1/2', 'Phase 2', 'Phase 2/3', 'Phase 3', 'Phase 4', 'Post-marketing']
const MODULES = ['A', 'B', 'C', 'D', 'E'] as const
const COUNTRIES = ['US', 'EU', 'IN', 'UK', 'JP', 'CN', 'BR', 'AU', 'CA']

// Module code → nav key — labels resolve via nav.* so the sidebar + this
// toggle stay consistent (and never say "Module A/B/C" in UI).
const MODULE_NAV_KEY: Record<(typeof MODULES)[number], string> = {
  A: 'nav.clinical_writing',
  B: 'nav.scientific_writing',
  C: 'nav.medical_writing',
  D: 'nav.regulatory_writing',
  E: 'nav.ideation_publishing',
}

function slugifyToId(name: string): string {
  const cleaned = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned ? `PROJ-${cleaned.slice(0, 32)}` : ''
}

interface Props {
  // Called after a successful create (parent typically closes the panel
  // + navigates to the new project).
  onCreated?: (projectId: string) => void
  // Called when the user clicks Cancel.
  onCancel?:  () => void
}

export function NewProjectForm({ onCreated, onCancel }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const [name,            setName]            = useState('')
  const [idOverride,      setIdOverride]      = useState('')
  const [shortTitle,      setShortTitle]      = useState('')
  const { labels: taLabels, isLoading: tasLoading } = useTaLabels()
  const [therapeuticArea, setTherapeuticArea] = useState('')
  const [indication,      setIndication]      = useState('')
  const [phase,           setPhase]           = useState(PHASES[2])
  const [startDate,       setStartDate]       = useState(() => new Date().toISOString().slice(0, 10))
  const [dataCutoff,      setDataCutoff]      = useState('')
  const [activeModules,   setActiveModules]   = useState<string[]>(['A'])
  const [countries,       setCountries]       = useState<string[]>([])
  const [referenceTrial,  setReferenceTrial]  = useState('')

  const derivedId = useMemo(() => idOverride.trim() || slugifyToId(name), [idOverride, name])

  const toggle = <T extends string>(arr: T[], v: T, setter: (next: T[]) => void) =>
    setter(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v])

  const create = useMutation({
    mutationFn: () =>
      projectsApi.create({
        id: derivedId,
        name,
        shortTitle: shortTitle || name,
        therapeuticArea,
        indication: indication || undefined,
        phase,
        startDate: new Date(startDate).toISOString(),
        dataCutoff: dataCutoff ? new Date(dataCutoff).toISOString() : undefined,
        activeModules: activeModules as ('A'|'B'|'C'|'D'|'E')[],
        submissionCountries: countries,
        referenceTrial: referenceTrial || undefined,
      } as never),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      onCreated?.((created as { id: string }).id)
    },
  })

  const canSubmit =
    derivedId.length >= 3 &&
    name.trim().length > 0 &&
    therapeuticArea.length > 0 &&
    phase.length > 0 &&
    activeModules.length > 0

  const errorMsg = create.isError
    ? create.error instanceof ApiError
      ? create.error.status === 403
        ? t('page.new_project.err_forbidden')
        : create.error.status === 409
          ? t('page.new_project.err_conflict', { id: derivedId })
          : (create.error.body as { error?: string; message?: string } | null)?.error === 'invalid_therapeutic_area'
            ? (create.error.body as { message: string }).message
            : t('page.new_project.err_generic_http', { status: create.error.status })
      : t('page.new_project.err_generic')
    : null

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        if (!canSubmit || create.isPending) return
        create.mutate()
      }}
      className="flex flex-col gap-4 p-5"
      data-form="new-project"
    >
      <Section title={t('page.new_project.section_basics')}>
        <Field label={t('page.new_project.project_name_label')}>
          <input value={name} onChange={e => setName(e.currentTarget.value)} required
            className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]" />
        </Field>
        <Field label={t('page.new_project.short_title_label')}>
          <input value={shortTitle} onChange={e => setShortTitle(e.currentTarget.value)}
            placeholder={t('page.new_project.short_title_placeholder')}
            className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]" />
        </Field>
        <Field label={t('page.new_project.project_id_label')} hint={t('page.new_project.project_id_hint')}>
          <input value={derivedId} onChange={e => setIdOverride(e.currentTarget.value.toUpperCase())}
            className="h-9 w-full rounded-md border border-slate-300 px-3 font-mono text-[12px]" />
        </Field>
      </Section>

      <Section title={t('page.new_project.section_study_details')}>
        <Field label={t('page.new_project.ta_label', { label: THERAPEUTIC_AREA_LABEL })} wide>
          <select value={therapeuticArea} onChange={e => setTherapeuticArea(e.currentTarget.value)} required
            className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]">
            <option value="" disabled>{tasLoading ? t('page.new_project.ta_loading') : taLabels.length ? t('page.new_project.ta_select') : t('page.new_project.ta_none')}</option>
            {taLabels.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
        <Field label={t('page.new_project.phase_label')}>
          <select value={phase} onChange={e => setPhase(e.currentTarget.value)}
            className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]">
            {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label={t('page.new_project.indication_label')}>
          <input value={indication} onChange={e => setIndication(e.currentTarget.value)}
            className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]" />
        </Field>
        <Field label={t('page.new_project.reference_trial_label')} wide>
          <input value={referenceTrial} onChange={e => setReferenceTrial(e.currentTarget.value)}
            placeholder={t('page.new_project.reference_trial_placeholder')}
            className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]" />
        </Field>
        <Field label={t('page.new_project.start_date_label')}>
          <input type="date" value={startDate} onChange={e => setStartDate(e.currentTarget.value)} required
            className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]" />
        </Field>
        <Field label={t('page.new_project.data_cutoff_label')}>
          <input type="date" value={dataCutoff} onChange={e => setDataCutoff(e.currentTarget.value)}
            className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]" />
        </Field>
      </Section>

      <Section title={t('page.new_project.section_modules')} hint={t('page.new_project.section_modules_hint')}>
        <div className="col-span-2 flex flex-wrap gap-2">
          {MODULES.map(m => {
            const active = activeModules.includes(m)
            return (
              <button key={m} type="button"
                onClick={() => toggle(activeModules, m, setActiveModules)}
                className={`rounded-md border px-3 py-1 text-[12px] font-semibold ${
                  active ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-600'
                }`}>
                {t(MODULE_NAV_KEY[m])}
              </button>
            )
          })}
        </div>
      </Section>

      <Section title={t('page.new_project.section_countries')} hint={t('page.new_project.section_countries_hint')}>
        <div className="col-span-2 flex flex-wrap gap-2">
          {COUNTRIES.map(c => {
            const active = countries.includes(c)
            return (
              <button key={c} type="button"
                onClick={() => toggle(countries, c, setCountries)}
                className={`rounded-md border px-3 py-1 font-mono text-[12px] font-semibold ${
                  active ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-600'
                }`}>
                {c}
              </button>
            )
          })}
        </div>
      </Section>

      {errorMsg && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700" role="alert">
          {errorMsg}
        </div>
      )}

      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3 -mx-5 -mb-5">
        <button type="button" onClick={onCancel}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
          {t('page.new_project.cancel')}
        </button>
        <button type="submit" disabled={!canSubmit || create.isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
          {create.isPending ? t('page.new_project.creating') : t('page.new_project.create_project')}
        </button>
      </div>
    </form>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-[13px] font-semibold text-slate-900">{title}</h3>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
    </section>
  )
}

// `wide` spans both columns so long placeholders / option text (e.g. "Select a
// therapeutic area") aren't clipped inside a half-width control.
function Field({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? 'md:col-span-2' : ''}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </label>
  )
}
