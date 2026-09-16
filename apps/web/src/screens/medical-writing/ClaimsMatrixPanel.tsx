import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { ClaimStatus, MedClaim } from '@platform/types'
import { medContentApi } from '../../modules/medical-writing/api/medContent'
import { useClaimsStore } from '../../modules/medical-writing/store'

// --- Static assumption: default active content ---
const ACTIVE_CONTENT_ID = 'mc-001'
const CURRENT_USER_NAME = 'Dr Sarah Chen'

type FilterTab = 'all' | ClaimStatus

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: 'all',      label: 'All' },
  { id: 'approved', label: 'Approved' },
  { id: 'modified', label: 'Modified' },
  { id: 'must-fix', label: 'Must Fix' },
  { id: 'new',      label: 'New' },
]

function statusMeta(s: ClaimStatus) {
  switch (s) {
    case 'approved': return { bg: '#F0FDF4', fg: '#15803D', label: 'Approved', border: '#BBF7D0' }
    case 'modified': return { bg: '#FFFBEB', fg: '#B45309', label: 'Modified', border: '#FDE68A' }
    case 'must-fix': return { bg: '#EFF6FF', fg: '#005F8E', label: 'Must Fix', border: '#93C5FD' }
    case 'new':      return { bg: '#FFF1F2', fg: '#BE123C', label: 'New',      border: '#FECDD3' }
  }
}

export function ClaimsMatrixPanel() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const setStoreClaims = useClaimsStore(s => s.setClaims)
  const storeClaims    = useClaimsStore(s => s.claims)
  const updateClaim    = useClaimsStore(s => s.updateClaim)

  const [filter, setFilter] = useState<FilterTab>('all')
  const [query, setQuery]   = useState('')
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [harvestSpin, setHarvestSpin] = useState(false)

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3400) }

  const { data: fetched = [] } = useQuery({
    queryKey: ['med-claims', ACTIVE_CONTENT_ID],
    queryFn:  () => medContentApi.getClaims(ACTIVE_CONTENT_ID),
  })

  useEffect(() => { setStoreClaims(fetched as MedClaim[]) }, [fetched, setStoreClaims])

  const claims = storeClaims

  const gateStats = useMemo(() => ({
    approved: claims.filter(c => c.approvalStatus === 'approved').length,
    modified: claims.filter(c => c.approvalStatus === 'modified').length,
    new:      claims.filter(c => c.approvalStatus === 'new').length,
    mustFix:  claims.filter(c => c.approvalStatus === 'must-fix').length,
    total:    claims.length,
  }), [claims])

  const blocked = gateStats.mustFix > 0

  const filteredClaims = useMemo(() => {
    const q = query.trim().toLowerCase()
    return claims.filter(c => {
      if (filter !== 'all' && c.approvalStatus !== filter) return false
      if (q && !(`${c.claimText} ${c.location}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [claims, filter, query])

  const selectedClaim = claims.find(c => c.id === selectedClaimId) ?? null

  const adoptMutation = useMutation({
    mutationFn: (claim: MedClaim) => {
      if (!claim.approvedLibraryText) throw new Error('no library text')
      return medContentApi.adoptClaim(ACTIVE_CONTENT_ID, {
        claimId:              claim.id,
        approvedLibraryText:  claim.approvedLibraryText,
        adoptedBy:            CURRENT_USER_NAME,
      })
    },
    onSuccess: (_data, claim) => {
      updateClaim(claim.id, {
        approvalStatus:      'approved',
        adoptedAt:           new Date().toISOString(),
        reviewerId:          'library-adoption',
        claimText:           claim.approvedLibraryText ?? claim.claimText,
      })
      flash('Approved library wording adopted — status set to Approved without MLR re-review. Logged to the audit trail.')
    },
  })

  const harvestMutation = useMutation({
    mutationFn: () => medContentApi.harvestClaims(ACTIVE_CONTENT_ID),
    onMutate:   () => setHarvestSpin(true),
    onSettled:  () => setHarvestSpin(false),
    onSuccess:  (data) => {
      qc.invalidateQueries({ queryKey: ['med-claims'] })
      flash(`Harvest complete · ${data.candidates.length} candidate claims re-scored.`)
    },
  })

  return (
    <div className="bg-slate-50" data-screen="claims-matrix-panel">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1280, padding: '20px 32px 40px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/medical-writing`)} className="hover:text-slate-900">Medical Writing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Claims Matrix</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Claims Matrix</h1>
            <p className="font-mono text-xs" style={{ color: '#64748B' }}>
              Veloricept HCP Slide Deck v0.3 · {gateStats.total} claims extracted · Auto-updated during authoring
            </p>
          </div>
          <div className="flex flex-none gap-2">
            <button
              type="button"
              onClick={() => flash('PDF export queued')}
              data-export-matrix
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
            >Export matrix (PDF)</button>
            <button
              type="button"
              onClick={() => harvestMutation.mutate()}
              disabled={harvestSpin}
              data-run-harvest
              className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
              style={{ backgroundColor: harvestSpin ? '#CBD5E1' : '#7C3AED' }}
            >{harvestSpin ? 'Harvesting…' : 'Run claims harvest ✦'}</button>
          </div>
        </div>

        {/* Gate summary */}
        <div
          className="rounded-md px-4 py-3 text-[13px]"
          style={{
            backgroundColor: blocked ? '#FFF1F2' : '#F0FDF4',
            color:           blocked ? '#BE123C' : '#166534',
            borderLeft:      `4px solid ${blocked ? '#BE123C' : '#16A34A'}`,
            border:          `1px solid ${blocked ? '#FDA4AF' : '#BBF7D0'}`,
          }}
          data-gate-summary
          data-gate-blocked={blocked}
        >
          {blocked
            ? `Claims gate: BLOCKED — ${gateStats.mustFix} must-fix claim requires resolution before MLR submission.`
            : `Claims gate: ${gateStats.approved} approved · ${gateStats.modified} modified · ${gateStats.new} new · ${gateStats.mustFix} must-fix. Ready for MLR submission.`}
        </div>

        {/* Filter tabs + search */}
        <div className="flex flex-wrap items-center justify-between gap-3" style={{ borderBottom: '1px solid #E2E8F0' }} data-tabs>
          <div className="flex gap-1">
            {FILTER_TABS.map(t => {
              const count =
                t.id === 'all'      ? gateStats.total :
                t.id === 'approved' ? gateStats.approved :
                t.id === 'modified' ? gateStats.modified :
                t.id === 'must-fix' ? gateStats.mustFix :
                                      gateStats.new
              const active = filter === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setFilter(t.id)}
                  data-filter-tab={t.id}
                  data-filter-active={active || undefined}
                  className="flex items-center gap-1.5 px-3 py-2 text-[13px]"
                  style={{
                    borderBottom: `2px solid ${active ? '#7C3AED' : 'transparent'}`,
                    color:        active ? '#5B21B6' : '#64748B',
                    fontWeight:   active ? 600 : 500,
                  }}
                >
                  {t.label}
                  <span className="font-mono text-[11px]" style={{ color: '#94A3B8' }}>{count}</span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2 pb-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search claim text or location…"
              data-claim-search
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px]"
              style={{ width: 260 }}
            />
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: selectedClaim ? 'minmax(0,1fr) 380px' : 'minmax(0,1fr)' }}>

          {/* Claims table */}
          <section className="rounded-lg border border-slate-200 bg-white p-2 overflow-x-auto" data-claims-table-wrap>
            <table className="w-full text-[13px]" data-claims-table>
              <thead>
                <tr className="text-left text-[11px] font-mono uppercase text-slate-500" style={{ letterSpacing: '0.06em' }}>
                  <th className="p-2">#</th>
                  <th className="p-2">Claim text</th>
                  <th className="p-2">Source</th>
                  <th className="p-2">Location</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Reviewer</th>
                </tr>
              </thead>
              <tbody>
                {filteredClaims.map((c, idx) => {
                  const meta = statusMeta(c.approvalStatus)
                  const selected = selectedClaimId === c.id
                  return (
                    <tr
                      key={c.id}
                      onClick={() => setSelectedClaimId(c.id)}
                      data-claim-row={c.id}
                      data-claim-selected={selected || undefined}
                      className="cursor-pointer border-t border-slate-100"
                      style={{ backgroundColor: selected ? '#F5F3FF' : 'transparent' }}
                    >
                      <td className="p-2 font-mono text-[11px] text-slate-500">{idx + 1}</td>
                      <td className="p-2 text-slate-800">{c.claimText}</td>
                      <td className="p-2 text-slate-600">{c.sourceRef ?? <span className="italic text-slate-400">unset</span>}</td>
                      <td className="p-2 font-mono text-[11px] text-slate-500">{c.location}</td>
                      <td className="p-2">
                        <span
                          className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
                          style={{ backgroundColor: meta.bg, color: meta.fg, border: `1px solid ${meta.border}` }}
                          data-claim-status={c.approvalStatus}
                        >{meta.label}</span>
                      </td>
                      <td className="p-2 text-[11px] text-slate-500">
                        {c.reviewerId ?? '—'}
                        {c.adoptedAt && <div className="text-[10px] text-slate-400">Library adoption · {new Date(c.adoptedAt).toISOString().slice(11, 16)}</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>

          {/* Detail panel */}
          {selectedClaim && (
            <aside className="rounded-lg border border-slate-200 bg-white p-4" data-claim-detail-panel>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[14px] font-bold text-slate-900">Claim Similarity</h3>
                <button type="button" onClick={() => setSelectedClaimId(null)} className="text-[11px] text-slate-500 hover:text-slate-800">Close ×</button>
              </div>

              <p className="font-mono text-[11px] text-slate-500">Claim {selectedClaim.id} · {selectedClaim.location}</p>

              <p className="mt-3 text-[11px] font-mono uppercase text-slate-500" style={{ letterSpacing: '0.08em' }}>Current wording</p>
              <p className="mt-1 rounded-md bg-slate-50 p-2 text-[13px] text-slate-800">{selectedClaim.claimText}</p>

              {selectedClaim.similarityPct >= 80 && selectedClaim.approvedLibraryText ? (
                <>
                  <p className="mt-3 text-[11px] font-mono uppercase text-slate-500" style={{ letterSpacing: '0.08em' }}>Matched approved claim</p>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">Master Library · VELORA-301 · Oncology · Oct 2026</p>
                  <blockquote
                    className="mt-2 rounded-md border-l-4 p-3 text-[13px]"
                    style={{ backgroundColor: '#F0FDF4', color: '#166534', borderLeftColor: '#16A34A' }}
                    data-approved-library-text
                  >
                    {selectedClaim.approvedLibraryText}
                  </blockquote>
                  <p className="mt-2 text-[11px] text-slate-500">Approved 05 Oct 2026 · MLR approved · Expires 05 Oct 2028</p>
                  <span
                    className="mt-2 inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold"
                    style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
                    data-similarity-chip
                  >{selectedClaim.similarityPct}% text similarity — approved claim recommended</span>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => adoptMutation.mutate(selectedClaim)}
                      data-adopt-library
                      className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
                      style={{ backgroundColor: '#7C3AED' }}
                    >Use approved claim text</button>
                    <button
                      type="button"
                      onClick={() => setSelectedClaimId(null)}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700"
                    >Keep current wording (requires re-review)</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="mt-3 text-[13px]" style={{ color: '#005F8E' }} data-no-library-match>
                    No match in approved library
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700">Add source citation</button>
                    <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700">Remove claim</button>
                  </div>
                </>
              )}
            </aside>
          )}
        </div>
      </div>

      {toast && (
        <div
          data-toast
          className="pointer-events-none fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-lg px-4 py-3 text-[13px]"
          style={{ backgroundColor: '#1E293B', color: '#FFFFFF' }}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#7C3AED' }} />
          {toast}
        </div>
      )}
    </div>
  )
}
