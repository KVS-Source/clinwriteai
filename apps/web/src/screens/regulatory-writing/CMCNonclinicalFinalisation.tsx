import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { ECTDNode } from '@platform/types'
import { regulatoryWritingApi } from '../../modules/regulatory-writing/api/regulatoryWriting'
import { useECTDStore } from '../../modules/regulatory-writing/store'
import { CTDReadOnlyBanner } from '../../components/ui'

type FinalisationTab = 'module1' | 'module3' | 'module4' | 'module5'

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function CMCNonclinicalFinalisation() {
  const { projectId, submissionId } = useParams()
  const navigate = useNavigate()

  const nodes    = useECTDStore(s => s.nodes)
  const setNodes = useECTDStore(s => s.setNodes)

  const [tab,   setTab]                   = useState<FinalisationTab>('module3')
  const [module4Signed, setModule4Signed] = useState(false)
  const [regionalFormsComplete, setRegionalFormsComplete] = useState(true)
  const [toast, setToast]                 = useState<string | null>(null)

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const { data: cmc } = useQuery({
    queryKey: ['cmc-readiness', submissionId],
    queryFn:  () => regulatoryWritingApi.getCMCReadiness(submissionId!),
    enabled:  !!submissionId,
  })
  const { data: fetched = [] } = useQuery({
    queryKey: ['reg-ectd-map', submissionId],
    queryFn:  () => regulatoryWritingApi.getECTDMap(submissionId!),
    enabled:  !!submissionId,
  })

  useEffect(() => { setNodes(fetched as ECTDNode[]) }, [fetched, setNodes])

  const module5Nodes = nodes.filter(n => n.isReadOnly)

  const gateItems = {
    module1: regionalFormsComplete,
    module3: !!cmc?.acknowledgedBy,
    module4: module4Signed,
    module5: true,
  }
  const canSubmit = Object.values(gateItems).every(Boolean)

  const submitToSuperReview = () => {
    if (!canSubmit) return
    navigate(`/projects/${projectId}/regulatory-writing/submissions/${submissionId}/super-review`)
  }

  const sectionStatusLabel = (sec: { section: string; status: string }) => {
    if (sec.section === '3.4') return { text: '○ Not started', bg: '#F1F5F9', fg: '#64748B', action: 'Start' }
    if (sec.status === 'complete') return { text: '✓ Signed off — Dr R. Patel · 14 Oct', bg: '#F0FDF4', fg: '#166534', action: 'Locked' }
    if (sec.status === 'gap')      return { text: '⚠ Stability gap — batches 3 & 4 pending', bg: '#FFFBEB', fg: '#B45309', action: 'Sign off with risk note' }
                                   return { text: '○ Not started', bg: '#F1F5F9', fg: '#64748B', action: 'Start' }
  }

  return (
    <div className="bg-slate-50" data-screen="cmc-nonclinical-finalisation">
      <div className="mx-auto flex flex-col gap-4" style={{ maxWidth: 1280, padding: '20px 32px 32px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/regulatory-writing`)} className="hover:text-slate-900">Regulatory Writing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Modules 1 &amp; 3–5 Finalisation</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Modules 1 &amp; 3–5 Finalisation</h1>
            <p className="font-mono text-xs" style={{ color: '#64748B' }}>Stage 3 of 6 · CMC + Nonclinical + Module 1 regional + Module 5 imported</p>
          </div>
          <button
            type="button"
            onClick={submitToSuperReview}
            disabled={!canSubmit}
            data-submit-super-review
            data-submit-enabled={canSubmit}
            className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
            style={{ backgroundColor: canSubmit ? '#B0200D' : '#CBD5E1', cursor: canSubmit ? 'pointer' : 'not-allowed' }}
          >Submit to Super Review →</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200" data-tab-bar>
          {(['module1', 'module3', 'module4', 'module5'] as FinalisationTab[]).map(id => {
            const label = id === 'module1' ? 'Module 1 (Regional)'
                        : id === 'module3' ? 'Module 3 (CMC)'
                        : id === 'module4' ? 'Module 4 (Nonclinical)'
                                           : 'Module 5 (Clinical — Read-Only)'
            const active = tab === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                data-tab={id}
                data-tab-active={active || undefined}
                className="px-3 py-2 text-[13px]"
                style={{
                  borderBottom: `2px solid ${active ? '#B0200D' : 'transparent'}`,
                  color:        active ? '#B0200D' : '#64748B',
                  fontWeight:   active ? 600 : 500,
                }}
              >{label}</button>
            )
          })}
        </div>

        {/* Tab content */}
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          {tab === 'module3' && cmc && (
            <div data-module3-tab>
              <div className="flex items-center gap-4">
                <div
                  className="relative flex h-24 w-24 flex-none items-center justify-center rounded-full"
                  style={{ background: `conic-gradient(#B0200D ${cmc.completenessPct}%, #F1F5F9 0)` }}
                  data-cmc-ring
                >
                  <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-white">
                    <span className="text-[18px] font-bold" style={{ color: '#B0200D' }} data-cmc-pct>{cmc.completenessPct}%</span>
                  </div>
                </div>
                <div className="flex-1">
                  <p className="text-[13px] font-semibold text-slate-800">CMC Lead sign-off required for all sections before proceeding</p>
                  <p className="mt-1 rounded-md px-3 py-2 text-[12px]" style={{ backgroundColor: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0' }} data-cmc-risk-note>
                    Stability data batches 3 and 4 pending · Risk acknowledged by Dr R. Patel · 12 Oct 2026 · Logged to audit trail
                  </p>
                </div>
              </div>

              <table className="mt-4 w-full text-[13px]" data-cmc-sections>
                <thead>
                  <tr className="text-left text-[11px] font-mono uppercase text-slate-500" style={{ letterSpacing: '0.06em' }}>
                    <th className="pb-2">Section</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {cmc.sections.map(sec => {
                    const m = sectionStatusLabel(sec)
                    return (
                      <tr key={sec.section} className="border-t border-slate-100" data-cmc-row={sec.section}>
                        <td className="py-2 font-mono text-slate-700">{sec.section} · {sec.title}</td>
                        <td className="py-2">
                          <span className="inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: m.bg, color: m.fg }}>{m.text}</span>
                        </td>
                        <td className="py-2 text-slate-600">{m.action}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              <p className="mt-4 font-mono text-[11px] text-slate-500" data-ich-q-row>
                ICH Q-series validation: 3.2.S · Q11 ✓ · Q8 ✓ · 3.2.P · Q8 ✓ · Q9 ✓ · Q10 ✓
              </p>
              <p className="mt-1 text-[12px] text-slate-600">Module 2.3 → Module 3: 12 cross-refs verified ✓ · 0 broken.</p>
            </div>
          )}

          {tab === 'module1' && (
            <div data-module1-tab>
              <p className="mb-3 text-[13px] font-semibold text-slate-800">Regional Administrative — Cover Letters &amp; Forms</p>
              <ul className="flex flex-col gap-2 text-[13px]">
                <li className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2">
                  <span className="text-slate-700">FDA cover letter</span>
                  <span className="ml-auto rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#166534' }}>System-generated ✓</span>
                </li>
                <li className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2">
                  <span className="text-slate-700">EMA cover letter</span>
                  <span className="ml-auto rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#166534' }}>System-generated ✓</span>
                </li>
                <li className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2">
                  <span className="text-slate-700">Form FDA 1571</span>
                  <span className="ml-auto rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#166534' }}>Auto-populated ✓</span>
                </li>
                <li className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2">
                  <span className="text-slate-700">Form FDA 1572</span>
                  <span className="ml-auto rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}>Requires investigator e-signature</span>
                </li>
              </ul>
              <p className="mt-4 text-[11px] font-mono uppercase text-slate-500" style={{ letterSpacing: '0.06em' }}>Country-specific label differences</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {['§4.1', '§4.4', '§4.8'].map(s => (
                  <span key={s} className="rounded-md px-2 py-1 text-[11px] font-semibold" style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }}>{s} differs (EU vs US)</span>
                ))}
              </div>
              <label className="mt-4 flex items-center gap-2 text-[12px] text-slate-700">
                <input
                  type="checkbox"
                  checked={regionalFormsComplete}
                  onChange={(e) => setRegionalFormsComplete(e.target.checked)}
                  data-regional-forms-complete
                />
                Regional forms complete (all investigator signatures collected)
              </label>
            </div>
          )}

          {tab === 'module4' && (
            <div data-module4-tab>
              <p className="text-[13px] text-slate-800">
                <strong>22 nonclinical study reports</strong> · ICH S1 ✓ · S4 ✓ · S6 ✓ · S7A ✓ · S8 ✓
              </p>
              <p className="mt-2 text-[12px] text-slate-600">Cross-references from Module 2.4 and 2.6 to Module 4: 24 verified ✓ · 0 broken.</p>
              <div className="mt-4 rounded-md bg-slate-50 p-3">
                <p className="text-[13px] font-semibold text-slate-800">Nonclinical Lead sign-off</p>
                <p className="mt-1 text-[12px] text-slate-600">
                  Dr A. Bhatt · {module4Signed ? '✓ Signed' : '○ Pending'}
                </p>
                <button
                  type="button"
                  onClick={() => { setModule4Signed(true); flash('Module 4 signed off by Nonclinical Lead. Logged to audit trail.') }}
                  disabled={module4Signed}
                  data-sign-module4
                  className="mt-2 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
                  style={{ backgroundColor: module4Signed ? '#CBD5E1' : '#B0200D', cursor: module4Signed ? 'not-allowed' : 'pointer' }}
                >{module4Signed ? 'Signed ✓' : 'Sign off Module 4'}</button>
              </div>
            </div>
          )}

          {tab === 'module5' && (
            <div data-module5-tab>
              <CTDReadOnlyBanner />
              <p className="mt-3 text-[13px] font-semibold text-slate-800">Imported documents</p>
              <ul className="mt-2 flex flex-col gap-2 text-[13px]">
                {module5Nodes.map(n => (
                  <li key={n.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2" data-module5-doc={n.id}>
                    <span className="font-mono text-[11px] text-slate-500 w-14 flex-none">{n.moduleSection}</span>
                    <span className="flex-1 text-slate-700">{n.sectionTitle} · Signed 28 Oct 2026 · Module A</span>
                    <a href="#" className="rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#EFF6FF', color: '#005F8E', border: '1px solid #93C5FD' }}>
                      View in Module A →
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[12px] text-slate-600">Module 5 TOC: auto-generated from imported CSRs ✓</p>
              <p className="mt-1 text-[12px] text-slate-600">
                Module 2.5 → Module 5: 18 refs verified ✓ · <span style={{ color: '#B45309' }}>2 flagged ⚠ (resolve in sD04)</span>
              </p>
            </div>
          )}
        </div>

        {/* Sign-off summary strip */}
        <div className="grid gap-3 md:grid-cols-4" data-signoff-strip>
          <div className="rounded-md border p-3" style={{ borderColor: gateItems.module1 ? '#BBF7D0' : '#E2E8F0', backgroundColor: gateItems.module1 ? '#F0FDF4' : '#FFFFFF' }} data-strip-module1>
            <p className="text-[11px] font-mono uppercase text-slate-500">Module 1</p>
            <p className="mt-1 text-[13px] font-semibold text-slate-800">
              {gateItems.module1 ? '✓ Complete' : 'Pending — complete regional forms'}
            </p>
          </div>
          <div className="rounded-md border p-3" style={{ borderColor: '#FDE68A', backgroundColor: '#FFFBEB' }} data-strip-module3>
            <p className="text-[11px] font-mono uppercase text-slate-500">Module 3</p>
            <p className="mt-1 text-[13px] font-semibold" style={{ color: '#B45309' }}>⚠ Partial — stability gap acknowledged</p>
          </div>
          <div className="rounded-md border p-3" style={{ borderColor: gateItems.module4 ? '#BBF7D0' : '#E2E8F0', backgroundColor: gateItems.module4 ? '#F0FDF4' : '#FFFFFF' }} data-strip-module4>
            <p className="text-[11px] font-mono uppercase text-slate-500">Module 4</p>
            <p className="mt-1 text-[13px] font-semibold text-slate-800">
              {gateItems.module4 ? '✓ Signed by Nonclinical Lead' : 'Pending — Nonclinical Lead sign-off'}
            </p>
          </div>
          <div className="rounded-md border p-3" style={{ borderColor: '#BBF7D0', backgroundColor: '#F0FDF4' }} data-strip-module5>
            <p className="text-[11px] font-mono uppercase text-slate-500">Module 5</p>
            <p className="mt-1 text-[13px] font-semibold" style={{ color: '#166534' }}>✓ Imported from Module A</p>
          </div>
        </div>

        {cmc && (
          <p className="font-mono text-[10px] text-slate-500">
            CMC readiness generated {formatDate(cmc.generatedAt)} · Acknowledged {formatDate(cmc.acknowledgedAt)}
          </p>
        )}
      </div>

      {toast && (
        <div
          data-toast
          className="pointer-events-none fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-lg px-4 py-3 text-[13px]"
          style={{ backgroundColor: '#1E293B', color: '#FFFFFF' }}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#B0200D' }} />
          {toast}
        </div>
      )}
    </div>
  )
}
