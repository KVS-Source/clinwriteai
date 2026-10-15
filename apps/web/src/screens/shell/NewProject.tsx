// New Project form — rendered inside a right-edge SlidePanel from
// AllProjects. API ready at POST /projects (apps/api/src/modules/
// projects/routes.ts). super-admin + admin only; the server-side 403
// is what the user sees if they lack the role — form shows a friendly
// error in that case.

import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '../../api'
import { ApiError } from '../../api/client'
import { useTaLabels } from '../../hooks'

const PHASES  = ['Preclinical', 'Phase 1', 'Phase 1/2', 'Phase 2', 'Phase 2/3', 'Phase 3', 'Phase 4', 'Post-marketing']
const MODULES = ['A', 'B', 'C', 'D', 'E'] as const
const COUNTRIES = ['US', 'EU', 'IN', 'UK', 'JP', 'CN', 'BR', 'AU', 'CA']

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
  const qc = useQueryClient()

  const [name,            setName]            = useState('')
  const [idOverride,      setIdOverride]      = useState('')
  const [shortTitle,      setShortTitle]      = useState('')
  const [client,          setClient]          = useState('')
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
        client,
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
    client.trim().length > 0 &&
    therapeuticArea.length > 0 &&
    phase.length > 0 &&
    activeModules.length > 0

  const errorMsg = create.isError
    ? create.error instanceof ApiError
      ? create.error.status === 403
        ? 'Only admins and super-admins can create projects.'
        : create.error.status === 409
          ? `Project id "${derivedId}" is already taken. Edit the auto-derived id below.`
          : (create.error.body as { error?: string; message?: string } | null)?.error === 'invalid_therapeutic_area'
            ? (create.error.body as { message: string }).message
            : `Could not create project (HTTP ${create.error.status}).`
      : 'Could not create project — see console for details.'
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
      <Section title="Basics">
        <Field label="Project name *">
          <input value={name} onChange={e => setName(e.currentTarget.value)} required
            className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]" />
        </Field>
        <Field label="Short title">
          <input value={shortTitle} onChange={e => setShortTitle(e.currentTarget.value)}
            placeholder="Defaults to project name"
            className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]" />
        </Field>
        <Field label="Client *">
          <input value={client} onChange={e => setClient(e.currentTarget.value)} required
            className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]" />
        </Field>
        <Field label="Project id *" hint="Auto-derived from name. Override if the project has an established code.">
          <input value={derivedId} onChange={e => setIdOverride(e.currentTarget.value.toUpperCase())}
            className="h-9 w-full rounded-md border border-slate-300 px-3 font-mono text-[12px]" />
        </Field>
      </Section>

      <Section title="Study details">
        <Field label="Therapeutic area *" wide>
          <select value={therapeuticArea} onChange={e => setTherapeuticArea(e.currentTarget.value)} required
            className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]">
            <option value="" disabled>{tasLoading ? 'Loading…' : taLabels.length ? 'Select a therapeutic area' : 'No TA tags — add one in Admin → TA Tags'}</option>
            {taLabels.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="Phase *">
          <select value={phase} onChange={e => setPhase(e.currentTarget.value)}
            className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]">
            {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Indication">
          <input value={indication} onChange={e => setIndication(e.currentTarget.value)}
            className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]" />
        </Field>
        <Field label="Reference trial" wide>
          <input value={referenceTrial} onChange={e => setReferenceTrial(e.currentTarget.value)}
            placeholder="VELORA-301, STUDY-ABCD, …"
            className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]" />
        </Field>
        <Field label="Start date *">
          <input type="date" value={startDate} onChange={e => setStartDate(e.currentTarget.value)} required
            className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]" />
        </Field>
        <Field label="Data cutoff">
          <input type="date" value={dataCutoff} onChange={e => setDataCutoff(e.currentTarget.value)}
            className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]" />
        </Field>
      </Section>

      <Section title="Modules enabled" hint="Can be changed later.">
        <div className="col-span-2 flex flex-wrap gap-2">
          {MODULES.map(m => {
            const active = activeModules.includes(m)
            return (
              <button key={m} type="button"
                onClick={() => toggle(activeModules, m, setActiveModules)}
                className={`rounded-md border px-3 py-1 text-[12px] font-semibold ${
                  active ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-600'
                }`}>
                {m === 'A' ? 'Clinical Writing' :
                 m === 'B' ? 'Scientific Writing' :
                 m === 'C' ? 'Medical Writing' :
                 m === 'D' ? 'Regulatory Writing' : 'Ideation & Publishing'}
              </button>
            )
          })}
        </div>
      </Section>

      <Section title="Submission countries" hint="India (IN) tenants also trigger DPDPA controls.">
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
          Cancel
        </button>
        <button type="submit" disabled={!canSubmit || create.isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
          {create.isPending ? 'Creating…' : 'Create project'}
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
