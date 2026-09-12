import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { IdeationArtefact, IdeationProject, ClaimCurrencyCheck, ClaimCurrencyClaim } from '@platform/types'
import { SourceGateBlock } from '../../components/ui/SourceGateBlock'
import { ClaimCurrencyBadge } from '../../components/ui/ClaimCurrencyBadge'
import { useIdeationStore } from '../../modules/ideation-publishing/store'
import ideationProjectsFixture from '../../data/ideationProjects.json'
import ideationArtefactsFixture from '../../data/ideationArtefacts.json'
import claimCurrencyFixture     from '../../data/claimCurrencyCheck.json'

const PROJECTS  = ideationProjectsFixture  as unknown as IdeationProject[]
const ARTEFACTS = ideationArtefactsFixture as unknown as IdeationArtefact[]
const CLAIM_CURRENCY = claimCurrencyFixture as unknown as ClaimCurrencyCheck

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

interface CheckHeaderProps {
  n:      number
  label:  string
  status: 'passed' | 'bypassed' | 'flagged' | 'blocked' | 'confirmed-external'
  meta:   string
}

function CheckHeader({ n, label, status, meta }: CheckHeaderProps) {
  const s = {
    passed:              { symbol: '✓', bg: '#F0FDF4', fg: '#166534', border: '#BBF7D0', text: 'Passed'   },
    bypassed:            { symbol: '○', bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1', text: 'Bypassed' },
    flagged:             { symbol: '⚠', bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A', text: meta       },
    blocked:             { symbol: '⊘', bg: '#FFF1F2', fg: '#BE123C', border: '#FDA4AF', text: 'Blocked'  },
    'confirmed-external':{ symbol: '⇢', bg: '#EFF6FF', fg: '#1D4ED8', border: '#93C5FD', text: 'Confirmed external' },
  }[status]
  return (
    <div className="flex flex-wrap items-center gap-3" data-check-header={`check-${n}`}>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-400">Check {n}</span>
        <p className="text-[14px] font-bold text-slate-900">{label}</p>
      </div>
      <span
        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold"
        style={{ backgroundColor: s.bg, color: s.fg, border: `1px solid ${s.border}` }}
        data-check-status={status}
      >
        <span className="font-mono">{s.symbol}</span>{s.text}
      </span>
    </div>
  )
}

interface ClaimRowProps { claim: ClaimCurrencyClaim }
function ClaimRow({ claim }: ClaimRowProps) {
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3"
      data-claim-row={claim.id}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{claim.id} · {claim.source}</p>
          <p className="mt-0.5 text-[13px] text-slate-900">"{claim.text}"</p>
          <p className="mt-1 font-mono text-[10px] text-slate-500">Verified against {claim.verifiedAgainst}</p>
        </div>
        <ClaimCurrencyBadge status={claim.status} />
      </div>
      {claim.flagNote && (
        <p className="rounded-md px-2 py-1 text-[12px]" style={{ backgroundColor: '#FFFBEB', color: '#78350F' }}>
          {claim.flagNote}
        </p>
      )}
      {claim.acknowledgementNote && (
        <p
          className="rounded-md px-2 py-1 text-[12px]"
          style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
          data-claim-acknowledgement
        >
          ✓ Acknowledged · {claim.acknowledgedByName ?? 'Ms Priya Nair'} · {formatDate(claim.acknowledgedAt)} · {claim.acknowledgementNote}
        </p>
      )}
    </div>
  )
}

export function ArtefactUploadSourceCheck() {
  const { projectId, ideationProjectId } = useParams()
  const navigate = useNavigate()

  const setActiveArtefact = useIdeationStore(s => s.setActiveArtefact)
  const setClaimCurrency  = useIdeationStore(s => s.setClaimCurrency)

  const project  = useMemo(() => PROJECTS.find(p => p.id === ideationProjectId), [ideationProjectId])
  const artefact = useMemo(() => ARTEFACTS.find(a => a.ideationProjectId === ideationProjectId), [ideationProjectId])
  const claimCheck = artefact?.id === CLAIM_CURRENCY.ideationArtefactId ? CLAIM_CURRENCY : null

  useEffect(() => {
    setActiveArtefact(artefact ?? null)
    setClaimCurrency(claimCheck)
  }, [artefact, claimCheck, setActiveArtefact, setClaimCurrency])

  if (!project || !artefact) {
    return (
      <div className="p-8 text-center text-sm text-slate-500" data-screen="artefact-upload-source-check">
        Artefact not found for project {ideationProjectId}.
      </div>
    )
  }

  const isBlocked      = artefact.approvalStatusCheck === 'blocked'
  const isExternal     = artefact.approvalStatusCheck === 'confirmed-external'
  const gatePassed     = artefact.approvalStatusCheck === 'passed'
  const withinNinetyDays = artefact.withinNinetyDays === true

  const sourceModuleLabel = artefact.sourceModule === 'external' ? 'External Upload' : `Module ${artefact.sourceModule}`
  const originModuleLabel = artefact.sourceModule === 'external' ? 'External' : `Module ${artefact.sourceModule}`

  const flags       = claimCheck?.claimsExtracted.filter(c => c.status !== 'current') ?? []
  const conflicting = claimCheck?.claimsExtracted.filter(c => c.status === 'conflicting') ?? []

  return (
    <div className="bg-slate-50" data-screen="artefact-upload-source-check" data-artefact-id={artefact.id}>
      <div className="flex flex-col gap-5" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate('/projects')} className="hover:text-slate-900">All projects</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <button onClick={() => navigate(`/projects/${projectId}`)} className="hover:text-slate-900">VELORA-301</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <button onClick={() => navigate(`/projects/${projectId}/ideation-publishing`)} className="hover:text-slate-900">Ideation &amp; Publishing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{project.title}</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Artefact Upload &amp; Source Check</h1>
            <p className="font-mono text-xs" style={{ color: '#64748B' }}>
              Stage 1 · {project.title} · {project.compound}
            </p>
          </div>
          <div className="flex flex-none gap-2">
            <button
              type="button"
              onClick={() => navigate(`/projects/${projectId}/ideation-publishing`)}
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
            >← Back</button>
            <button
              type="button"
              disabled={isBlocked || conflicting.length > 0}
              onClick={() => navigate(`/projects/${projectId}/ideation-publishing/projects/${ideationProjectId}/tagging`)}
              data-proceed-to-tagging
              className="h-9 rounded-md px-3 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: '#0D9488' }}
            >Proceed to tagging →</button>
          </div>
        </div>

        {/* BLOCKED — full-width source gate block, hides check panels */}
        {isBlocked && (
          <SourceGateBlock
            reason={artefact.approvalStatusNote}
            originModule={originModuleLabel}
            detail="Source currency and claim currency checks will not run until the source document is Signed / Final Output / Submitted."
          />
        )}

        {/* Two-column body */}
        <div className="grid gap-5" style={{ gridTemplateColumns: '1.15fr 0.85fr' }}>

          {/* LEFT column — artefact + checks */}
          <div className="flex flex-col gap-4">

            {/* Artefact panel */}
            <section className="rounded-lg border border-slate-200 bg-white p-5" data-artefact-panel>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Artefact</p>
              <p className="mt-1 text-[15px] font-bold text-slate-900">{artefact.title} · {artefact.version}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
                  style={{ backgroundColor: '#F0FDFA', color: '#0F766E', border: '1px solid #99F6E4' }}
                  data-source-chip
                >
                  {sourceModuleLabel} · {artefact.sourceModule === 'external' ? 'External' : 'Medical Writing'} ·
                  {isBlocked ? ' In Authoring' : ' Final Output'}
                  {artefact.originalApprovalDate ? ` · Signed ${formatDate(artefact.originalApprovalDate)}` : ''}
                </span>
                <span className="font-mono text-[11px] text-slate-500">{artefact.id}</span>
              </div>
              {isExternal && (
                <p className="mt-3 rounded-md px-3 py-2 text-[12px]" style={{ backgroundColor: '#EFF6FF', color: '#1E3A8A' }}>
                  External upload. Ideation Lead confirmed approval via external process (DD-E-002) — logged to audit trail.
                </p>
              )}
            </section>

            {/* Check 1 — Source gate */}
            {!isBlocked && (
              <section className="rounded-lg border border-slate-200 bg-white p-5" data-check="source-gate">
                <CheckHeader n={1} label="Source gate" status={isExternal ? 'confirmed-external' : 'passed'} meta="" />
                <p className="mt-2 text-[13px] text-slate-700">{artefact.approvalStatusNote}</p>
                {artefact.masterLibraryPushDate && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span
                      className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: '#F0FDFA', color: '#0F766E', border: '1px solid #99F6E4' }}
                      data-master-library-chip
                    >
                      Pushed to Master Library {formatDate(artefact.masterLibraryPushDate)} · within 90 days
                    </span>
                  </div>
                )}
                {gatePassed && withinNinetyDays && (
                  <p
                    className="mt-3 rounded-md px-3 py-2 text-[12px]"
                    style={{ backgroundColor: '#F0FDFA', color: '#0F766E' }}
                    data-ninety-day-note
                  >
                    ℹ 90-day currency check bypass active — source currency check skipped (FR-E-002 v0.3).
                  </p>
                )}
              </section>
            )}

            {/* Check 2 — Source currency (skipped when withinNinetyDays) */}
            {!isBlocked && (
              <section className="rounded-lg border border-slate-200 bg-white p-5" data-check="source-currency">
                <CheckHeader n={2} label="Source currency" status={withinNinetyDays ? 'bypassed' : 'passed'} meta="" />
                {withinNinetyDays ? (
                  <p className="mt-2 text-[13px] text-slate-700" data-source-currency-bypass>
                    Master Library card pushed {formatDate(artefact.masterLibraryPushDate)} — within 90 days.
                    Lightweight currency check not required (FR-E-002 v0.3).
                  </p>
                ) : (
                  <p className="mt-2 text-[13px] text-slate-700">
                    Currency confirmed against Master Library headline metrics.
                  </p>
                )}
              </section>
            )}

            {/* Check 3 — Claim currency */}
            {!isBlocked && claimCheck && (
              <section className="rounded-lg border border-slate-200 bg-white p-5" data-check="claim-currency">
                <CheckHeader
                  n={3}
                  label="Claim currency"
                  status={flags.length > 0 ? 'flagged' : 'passed'}
                  meta={`${flags.length} flag${flags.length === 1 ? '' : 's'}`}
                />
                <p className="mt-2 text-[13px] text-slate-700" data-claim-summary>
                  {claimCheck.totalClaimsExtracted} claims extracted · {claimCheck.results.current} current · {claimCheck.results.potentiallySuperseded} potentially superseded · {claimCheck.results.conflicting} conflicting
                </p>
                <p className="mt-1 font-mono text-[11px] text-slate-500">
                  Verified against SmPC v2.1 §4.1, §4.2, §5.1 and VELORA-301 CSR v1.0
                </p>

                {flags.length > 0 && (
                  <div className="mt-4 flex flex-col gap-2" data-claim-flags>
                    {flags.map(f => <ClaimRow key={f.id} claim={f} />)}
                  </div>
                )}

                {conflicting.length > 0 && (
                  <p
                    className="mt-3 rounded-md px-3 py-2 text-[12px] font-semibold"
                    style={{ backgroundColor: '#FEF2F2', color: '#7F1D1D' }}
                    data-conflicting-block-note
                  >
                    ⚑ Conflicting claim detected — this claim is blocked at the claim level and must not be tagged.
                    Tagging cannot proceed until it is removed at source.
                  </p>
                )}
              </section>
            )}

            {/* External-artefact note (ia-002) — claim check not yet run */}
            {isExternal && !claimCheck && (
              <section className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-[13px] text-slate-600" data-check="claim-currency-pending">
                <p className="font-semibold text-slate-800">Claim currency</p>
                <p className="mt-1">Claim currency check will run once the artefact is uploaded to the Master Library.</p>
              </section>
            )}
          </div>

          {/* RIGHT column — source document viewer (always read-only) */}
          <aside
            className="flex flex-col rounded-lg border border-slate-200 bg-white"
            data-source-document
            data-read-only
            style={{ height: 'fit-content', maxHeight: 720 }}
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="flex min-w-0 flex-col">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Source document — read-only
                </span>
                <p className="text-[13px] font-semibold text-slate-900">{artefact.title} {artefact.version}</p>
              </div>
              <span
                className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold"
                style={{ backgroundColor: '#F1F5F9', color: '#475569' }}
              >Read only (DD-E-001)</span>
            </header>
            <div
              className="flex-1 overflow-auto px-5 py-4 text-[13px] leading-relaxed text-slate-700"
              style={{ backgroundColor: '#FCFDFE', cursor: 'default' }}
              onClick={(e) => {
                // Design rule: clicking shows a + tag affordance — no cursor / no edit mode.
                const marker = document.createElement('span')
                marker.textContent = '+'
                marker.style.cssText = 'position:fixed;top:' + e.clientY + 'px;left:' + e.clientX + 'px;padding:2px 6px;background:#0D9488;color:white;border-radius:4px;font-size:11px;font-weight:600;pointer-events:none;z-index:9999;'
                marker.setAttribute('data-tag-affordance', '+')
                document.body.appendChild(marker)
                setTimeout(() => marker.remove(), 800)
              }}
              data-source-body
            >
              <p className="font-semibold text-slate-900">VELORA-301 KOL Advisory Board Summary v1.0</p>
              <p className="mt-2">
                <strong>§3.2 Primary endpoint.</strong> Progression-free survival (PFS) was the primary endpoint. The
                hazard ratio was 0.61 (95% CI 0.48–0.77; p&lt;0.001), with median PFS of 14.2 months in the
                veloricept + pembrolizumab arm versus 8.7 months in the pembrolizumab arm.
              </p>
              <p className="mt-2">
                <strong>§3.4 Subgroups.</strong> Benefit was consistent across PD-L1 expression level and tumour
                histology (squamous and non-squamous). Interaction p-values were non-significant.
              </p>
              <p className="mt-2">
                <strong>§4.1 Safety overview.</strong> Grade 3 or higher treatment-related adverse events occurred in
                52% versus 44% of patients. No new safety signals were identified.
              </p>
              <p className="mt-2">
                <strong>§4.3 Notable AEs.</strong> Pneumonitis was reported in 8% of veloricept-treated patients.
                Discontinuation due to AEs occurred in 12% versus 8%.
              </p>
              <p className="mt-4 rounded-md px-3 py-2 text-[11px]" style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>
                Click any passage to preview the tag affordance. No cursor. No edit mode. All edits happen at source in Module C.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
