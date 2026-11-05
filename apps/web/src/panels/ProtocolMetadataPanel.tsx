// Protocol metadata panel — migration 60.
//
// Right-hand panel for 'protocol' / 'protocol-amendment' documents. Shows:
//   - Document Type pill (resolved from doc.type)
//   - Identification: Study Title, Protocol Number, Protocol Version
//   - Sponsorship: Sponsor, Investigational Product
//   - Study: Therapeutic Area (read-only, inherited from the project),
//     Study Phase (read-only, from Project.phase via useQuery),
//     Study Design (textarea), Target Population (textarea)
//   - Regulatory: Regulatory Region (dropdown)
//   - Source Documents: count + link to the Source References panel
//
// Save behaviour: onBlur autosave, per field. The mutation payload only
// carries the one changed key so a server-side error on one field doesn't
// block the rest. A "Saving…" / "Saved" chip in the header signals state.
// Reuses the same visual aesthetic as SourceReferencesPanel + AuditTrailPanel.

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { Document, DocumentType, RegulatoryRegion } from '@platform/types'
import { documentsApi, type ProtocolMetadataPatch } from '../api/documents'
import { useSourceAccess } from '../hooks/useSourceAccess'
import { projectsApi } from '../api/projects'
import { ApiError } from '../api/client'
import { useDocumentStore } from '../store'

interface Props {
  documentId: string
  onOpenSources?: () => void
}

type FieldKey = keyof ProtocolMetadataPatch

// Doc-type labels shown on the top pill. Only the two protocol types
// are addressable from this panel; anything else is defensively labelled.
const TYPE_LABEL_KEYS: Partial<Record<DocumentType, string>> = {
  'protocol':             'component.protocol_type_label.protocol',
  'protocol-amendment':   'component.protocol_type_label.protocol_amendment',
}

const REGULATORY_REGIONS: ReadonlyArray<RegulatoryRegion> = ['us', 'eu', 'india', 'global', 'other']
const REGION_LABEL_KEYS: Record<RegulatoryRegion, string> = {
  us:     'page.protocol_metadata_panel.region_us',
  eu:     'page.protocol_metadata_panel.region_eu',
  india:  'page.protocol_metadata_panel.region_india',
  global: 'page.protocol_metadata_panel.region_global',
  other:  'page.protocol_metadata_panel.region_other',
}

export function ProtocolMetadataPanel({ documentId, onOpenSources }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const setActivePanel = useDocumentStore(s => s.setActivePanel)

  const { data: doc, isLoading } = useQuery<Document>({
    queryKey: ['document', documentId],
    queryFn: () => documentsApi.get(documentId),
  })

  // Project.phase is read-only + lives on Project, so fetch it separately.
  // Cached under ['project', projectId] which matches the editor's fetch.
  const { data: project } = useQuery({
    queryKey: ['project', doc?.projectId],
    queryFn: () => projectsApi.get(doc!.projectId),
    enabled: !!doc?.projectId,
  })

  // Sources count for the "Source Documents" link row.
  const canViewSources = useSourceAccess(doc?.projectId)?.canView === true
  const { data: sources } = useQuery({
    queryKey: ['document-sources', documentId],
    queryFn: () => documentsApi.listDocumentSources(documentId),
    enabled: canViewSources,
  })
  const sourceCount = sources?.items.length ?? 0

  // Local draft state so the inputs are controlled + the autosave debounce
  // doesn't fight the user's typing. Seeded from the server; updated
  // optimistically on save.
  const [draft, setDraft] = useState<ProtocolMetadataPatch>({})
  useEffect(() => {
    if (!doc) return
    setDraft({
      studyTitle:             doc.studyTitle ?? '',
      protocolNumber:         doc.protocolNumber ?? '',
      protocolVersion:        doc.protocolVersion ?? '',
      sponsor:                doc.sponsor ?? '',
      investigationalProduct: doc.investigationalProduct ?? '',
      studyDesign:            doc.studyDesign ?? '',
      targetPopulation:       doc.targetPopulation ?? '',
      regulatoryRegion:       doc.regulatoryRegion ?? null,
    })
  }, [doc])

  // "Saving…" / "Saved" / error chip. One shared slot — if two fields race,
  // the later mutation's state wins (good enough for a single-user form).
  const [chip, setChip] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const savedTimerRef = useRef<number | null>(null)

  const mutation = useMutation({
    mutationFn: (patch: ProtocolMetadataPatch) =>
      documentsApi.updateProtocolMetadata(documentId, patch),
    onMutate: () => {
      setChip('saving')
      setErrorMessage(null)
      if (savedTimerRef.current) {
        window.clearTimeout(savedTimerRef.current)
        savedTimerRef.current = null
      }
    },
    onSuccess: (updated) => {
      // Push the server's canonical shape back into the cache so the
      // listing badge + downstream panels see the new values without a refetch.
      qc.setQueryData(['document', documentId], updated)
      void qc.invalidateQueries({ queryKey: ['documents', updated.projectId] })
      setChip('saved')
      // Clear the chip after a short delay.
      savedTimerRef.current = window.setTimeout(() => setChip('idle'), 1600)
    },
    onError: (err) => {
      setChip('error')
      if (err instanceof ApiError) {
        const body = err.body as { message?: string; error?: string } | null
        if (body?.error === 'document_locked') {
          setErrorMessage(t('page.protocol_metadata_panel.save_error_locked'))
        } else if (err.status === 403) {
          setErrorMessage(t('page.protocol_metadata_panel.save_error_forbidden'))
        } else if (err.status === 400) {
          setErrorMessage(t('page.protocol_metadata_panel.save_error_validation'))
        } else {
          setErrorMessage(body?.message ?? t('page.protocol_metadata_panel.save_error_generic'))
        }
      } else {
        setErrorMessage(t('page.protocol_metadata_panel.save_error_generic'))
      }
    },
  })

  // One field at a time; trimming + null-collapse happens server-side too.
  const save = (field: FieldKey, next: string | null) => {
    if (!doc) return
    const current = (doc as unknown as Record<string, string | null>)[field] ?? null
    const normalised = typeof next === 'string' ? next.trim() : next
    const collapsed = normalised === '' ? null : normalised
    if ((current ?? null) === collapsed) return // no-op
    mutation.mutate({ [field]: collapsed } as ProtocolMetadataPatch)
  }

  const typeLabelKey = doc ? TYPE_LABEL_KEYS[doc.type] : undefined

  if (isLoading || !doc) {
    return (
      <div className="flex min-h-0 flex-1 items-start overflow-y-auto p-4">
        <p className="text-xs text-slate-500">{t('status.loading')}</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-panel="protocol-metadata">
      {/* Header strip — doc type pill + save chip. The outer panel header
          (close + title) is rendered by the editor's panel shell; this
          strip adds panel-specific context. */}
      <div className="flex flex-none items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
        {typeLabelKey && (
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
            style={{ backgroundColor: '#DBEAFE', color: '#1E40AF' }}
            data-protocol-type-pill
          >
            {t(typeLabelKey)}
          </span>
        )}
        <div className="flex-1" />
        <SaveChip state={chip} />
      </div>

      {errorMessage && (
        <p role="alert" className="flex-none bg-red-50 px-4 py-2 text-xs text-red-700" data-protocol-save-error>
          {errorMessage}
        </p>
      )}

      {/* Body */}
      <div className="flex flex-1 flex-col gap-5 p-4">

        <Section title={t('page.protocol_metadata_panel.section_identification')}>
          <Field label={t('page.protocol_metadata_panel.label_study_title')}>
            <input
              type="text"
              value={asString(draft.studyTitle)}
              onChange={e => setDraft(d => ({ ...d, studyTitle: e.target.value }))}
              onBlur={e => save('studyTitle', e.target.value)}
              placeholder={t('page.protocol_metadata_panel.placeholder_study_title')}
              className={INPUT_CLS}
              data-field="studyTitle"
            />
          </Field>
          <Field label={t('page.protocol_metadata_panel.label_protocol_number')}>
            <input
              type="text"
              value={asString(draft.protocolNumber)}
              onChange={e => setDraft(d => ({ ...d, protocolNumber: e.target.value }))}
              onBlur={e => save('protocolNumber', e.target.value)}
              placeholder={t('page.protocol_metadata_panel.placeholder_protocol_number')}
              className={`${INPUT_CLS} font-mono`}
              data-field="protocolNumber"
            />
          </Field>
          <Field label={t('page.protocol_metadata_panel.label_protocol_version')}>
            <input
              type="text"
              value={asString(draft.protocolVersion)}
              onChange={e => setDraft(d => ({ ...d, protocolVersion: e.target.value }))}
              onBlur={e => save('protocolVersion', e.target.value)}
              placeholder={t('page.protocol_metadata_panel.placeholder_protocol_version')}
              className={`${INPUT_CLS} font-mono`}
              data-field="protocolVersion"
            />
          </Field>
        </Section>

        <Section title={t('page.protocol_metadata_panel.section_sponsorship')}>
          <Field label={t('page.protocol_metadata_panel.label_sponsor')}>
            <input
              type="text"
              value={asString(draft.sponsor)}
              onChange={e => setDraft(d => ({ ...d, sponsor: e.target.value }))}
              onBlur={e => save('sponsor', e.target.value)}
              placeholder={t('page.protocol_metadata_panel.placeholder_sponsor')}
              className={INPUT_CLS}
              data-field="sponsor"
            />
          </Field>
          <Field label={t('page.protocol_metadata_panel.label_investigational_product')}>
            <input
              type="text"
              value={asString(draft.investigationalProduct)}
              onChange={e => setDraft(d => ({ ...d, investigationalProduct: e.target.value }))}
              onBlur={e => save('investigationalProduct', e.target.value)}
              placeholder={t('page.protocol_metadata_panel.placeholder_investigational_product')}
              className={INPUT_CLS}
              data-field="investigationalProduct"
            />
          </Field>
        </Section>

        <Section title={t('page.protocol_metadata_panel.section_study')}>
          <ReadOnlyField
            label={t('page.protocol_metadata_panel.label_therapeutic_area')}
            value={doc.therapeuticArea}
            hint={t('page.protocol_metadata_panel.hint_therapeutic_area')}
          />
          <ReadOnlyField
            label={t('page.protocol_metadata_panel.label_study_phase')}
            value={project?.phase ?? '—'}
            hint={t('page.protocol_metadata_panel.hint_study_phase')}
          />
          <Field label={t('page.protocol_metadata_panel.label_study_design')}>
            <textarea
              rows={4}
              value={asString(draft.studyDesign)}
              onChange={e => setDraft(d => ({ ...d, studyDesign: e.target.value }))}
              onBlur={e => save('studyDesign', e.target.value)}
              placeholder={t('page.protocol_metadata_panel.placeholder_study_design')}
              className={`${INPUT_CLS} resize-y`}
              data-field="studyDesign"
            />
          </Field>
          <Field label={t('page.protocol_metadata_panel.label_target_population')}>
            <textarea
              rows={4}
              value={asString(draft.targetPopulation)}
              onChange={e => setDraft(d => ({ ...d, targetPopulation: e.target.value }))}
              onBlur={e => save('targetPopulation', e.target.value)}
              placeholder={t('page.protocol_metadata_panel.placeholder_target_population')}
              className={`${INPUT_CLS} resize-y`}
              data-field="targetPopulation"
            />
          </Field>
        </Section>

        <Section title={t('page.protocol_metadata_panel.section_regulatory')}>
          <Field label={t('page.protocol_metadata_panel.label_regulatory_region')}>
            <select
              value={draft.regulatoryRegion ?? ''}
              onChange={e => {
                const next = (e.target.value || null) as RegulatoryRegion | null
                setDraft(d => ({ ...d, regulatoryRegion: next }))
                save('regulatoryRegion', next)
              }}
              className={INPUT_CLS}
              data-field="regulatoryRegion"
            >
              <option value="">{t('page.protocol_metadata_panel.region_unset')}</option>
              {REGULATORY_REGIONS.map(r => (
                <option key={r} value={r}>{t(REGION_LABEL_KEYS[r])}</option>
              ))}
            </select>
          </Field>
        </Section>

        {canViewSources && (
        <Section title={t('page.protocol_metadata_panel.section_sources')}>
          <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm">
            <span className="text-slate-700">
              {t('page.protocol_metadata_panel.sources_count', { count: sourceCount })}
            </span>
            <button
              type="button"
              onClick={() => (onOpenSources ?? (() => setActivePanel('traceability')))()}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700"
              data-action="view-source-library"
            >
              {t('page.protocol_metadata_panel.view_source_library')}
            </button>
          </div>
        </Section>
        )}

      </div>
    </div>
  )
}

const INPUT_CLS =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 ' +
  'placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

function asString(v: string | null | undefined): string {
  return typeof v === 'string' ? v : ''
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h4>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      {children}
    </label>
  )
}

function ReadOnlyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <div className="flex min-h-[38px] items-center rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
        {value || '—'}
      </div>
      {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </div>
  )
}

function SaveChip({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' }) {
  const { t } = useTranslation()
  if (state === 'idle') return null
  const styles = {
    saving: { bg: '#FEF3C7', color: '#92400E', label: t('page.protocol_metadata_panel.chip_saving') },
    saved:  { bg: '#DCFCE7', color: '#166534', label: t('page.protocol_metadata_panel.chip_saved')  },
    error:  { bg: '#FEE2E2', color: '#B91C1C', label: t('page.protocol_metadata_panel.chip_error')  },
  }[state]
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ backgroundColor: styles.bg, color: styles.color }}
      data-save-chip={state}
    >
      {styles.label}
    </span>
  )
}
