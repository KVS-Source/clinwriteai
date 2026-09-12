import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { RaciMatrix as RaciMatrixData, PlatformUser, RACIRole, AuditTrailEntry, PlatformUserRole } from '@platform/types'
import { PLATFORM_ACCENT, PLATFORM_USER_ROLE_LABEL } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store'

const RACI_COLOURS: Record<RACIRole, { bg: string; fg: string }> = {
  R: { bg: '#FEF2F2', fg: '#B0200D' },
  A: { bg: '#FFFBEB', fg: '#D97706' },
  C: { bg: '#EFF6FF', fg: '#1A3C5E' },
  I: { bg: '#F8FAFC', fg: '#94A3B8' },
}

const MODULE_LABELS: Record<'A' | 'B' | 'C' | 'D' | 'E', string> = {
  A: 'Clinical Writing', B: 'Scientific Writing', C: 'Medical Writing',
  D: 'Regulatory Writing', E: 'Ideation & Publishing',
}

function initialsFor(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

// Signed-off stages — audit entries where action='SIGNATURE_APPLIED' && module=X
// Any A cell in a signed stage's row is read-only per brief §76.
function computeSignedStages(audit: AuditTrailEntry[]): { module: string; entityId: string }[] {
  return audit.filter(a => a.action === 'SIGNATURE_APPLIED').map(a => ({ module: a.module, entityId: a.entityId }))
}

export function RACIMatrix() {
  const currentUser = usePlatformStore(s => s.currentUser)
  const { data: raci }    = useQuery<RaciMatrixData>({ queryKey: ['raci'],           queryFn: () => platformApi.getRaci('proj-velora-301') })
  const { data: users = [] } = useQuery<PlatformUser[]>({ queryKey: ['admin-users'], queryFn: () => platformApi.listUsers() })
  const { data: audit = [] } = useQuery<AuditTrailEntry[]>({ queryKey: ['audit'],    queryFn: () => platformApi.listAudit() })

  const [activeModule, setActiveModule] = useState<'A' | 'B' | 'C' | 'D' | 'E'>('D')
  const [mineOn, setMineOn] = useState(false)

  const moduleTasks = raci?.modules[activeModule]?.tasks ?? []
  const moduleLabel = MODULE_LABELS[activeModule]

  const allRoles = useMemo(() => {
    const s = new Set<string>()
    moduleTasks.forEach(t => Object.keys(t.assignments).forEach(r => s.add(r)))
    return Array.from(s)
  }, [moduleTasks])

  const filteredTasks = useMemo(() => {
    if (!mineOn) return moduleTasks
    return moduleTasks.filter(t => Object.keys(t.assignments).includes(currentUser.role))
  }, [moduleTasks, mineOn, currentUser.role])

  const peopleInRoles = useMemo(() => {
    return allRoles
      .map(role => ({
        role,
        user: users.find(u => u.role === role),
      }))
      .filter(x => !!x.user)
      .map(x => ({ role: x.role, user: x.user as PlatformUser }))
  }, [allRoles, users])

  const signedStages = useMemo(() => computeSignedStages(audit), [audit])

  const isRowLocked = (taskLabel: string) => {
    // A row is locked when an audit SIGNATURE_APPLIED exists for that module/stage
    if (!taskLabel.includes('Stage')) return false
    return signedStages.some(s => s.module === activeModule)
  }

  return (
    <div className="bg-slate-50" data-screen="raci-matrix">
      <div className="mx-auto flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>Platform</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">RACI Matrix</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>RACI matrix</h1>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>
              {currentUser.name} · {currentUser.role === 'admin' ? 'Admin' : PLATFORM_USER_ROLE_LABEL[currentUser.role]}
            </p>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: '240px 1fr' }}>

          {/* Left panel */}
          <aside className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4" data-project-selector>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Project</p>
            <select
              defaultValue="proj-velora-301"
              data-project-select
              className="h-9 rounded-md border border-slate-300 px-3 text-[13px]"
            >
              <option value="proj-velora-301">VELORA-301 Efficacy Suite</option>
              <option value="proj-aurelia-101">AURELIA-101 Phase I</option>
            </select>

            <p className="mt-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Module</p>
            <div className="flex flex-wrap gap-1" data-module-tabs>
              {(['A','B','C','D','E'] as const).map(m => {
                const isActive = m === activeModule
                const disabled = !raci?.modules[m]
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={disabled}
                    onClick={() => setActiveModule(m)}
                    data-module-tab={m}
                    data-active={isActive || undefined}
                    className="h-8 flex-1 rounded-md text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                    style={{
                      backgroundColor: isActive ? PLATFORM_ACCENT.primary : '#F1F5F9',
                      color:           isActive ? '#FFFFFF' : '#334155',
                    }}
                  >{m}</button>
                )
              })}
            </div>
          </aside>

          {/* Right panel */}
          <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5" data-raci-content>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Matrix</p>
                <p className="mt-1 text-[16px] font-bold text-slate-900" data-heading>
                  Module {activeModule} — {moduleLabel} · VELORA-301 Efficacy Suite
                </p>
                <p className="mt-1 text-[12px] text-slate-600">
                  Default RACI template applied. Adjustments are project-specific and do not affect other projects.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMineOn(!mineOn)}
                  data-mine-toggle
                  data-mine-on={mineOn || undefined}
                  className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
                >{mineOn ? 'Show all tasks' : 'Show my tasks'}</button>
                <button
                  type="button"
                  data-edit-assignments
                  className="h-8 rounded-md border px-3 text-[12px] font-semibold"
                  style={{ borderColor: PLATFORM_ACCENT.primary, color: PLATFORM_ACCENT.primary }}
                >Edit assignments →</button>
              </div>
            </div>

            {/* Matrix table */}
            <div className="overflow-auto rounded-lg border border-slate-200" data-raci-table>
              <table className="w-full text-[12px]">
                <thead style={{ backgroundColor: '#F8FAFC' }}>
                  <tr className="text-left">
                    <th className="sticky left-0 px-3 py-2 font-semibold" style={{ backgroundColor: '#F8FAFC' }}>Task</th>
                    {allRoles.map(r => (
                      <th key={r} className="px-3 py-2 text-center font-semibold text-slate-700" title={PLATFORM_USER_ROLE_LABEL[r as PlatformUserRole] ?? r}>
                        {(PLATFORM_USER_ROLE_LABEL[r as PlatformUserRole] ?? r).split(' ').map((w, i) => i === 0 ? w : w[0]).join(' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map(t => {
                    const locked = isRowLocked(t.label)
                    return (
                      <tr key={t.id} className="border-t border-slate-200" data-raci-row={t.id} data-row-locked={locked || undefined}>
                        <td className="sticky left-0 bg-white px-3 py-2 font-semibold text-slate-900" style={{ backgroundColor: '#FFFFFF' }}>
                          {t.label}
                          {locked && <span className="ml-2 font-mono text-[10px] text-slate-400">🔒 locked</span>}
                        </td>
                        {allRoles.map(r => {
                          const mark = (t.assignments as Record<string, RACIRole | undefined>)[r]
                          if (!mark) return <td key={r} className="px-3 py-2 text-center text-slate-300">—</td>
                          const c = RACI_COLOURS[mark]
                          return (
                            <td key={r} className="px-3 py-2 text-center" data-raci-cell={`${r}-${mark}`}>
                              <span
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md font-mono text-[11px] font-bold"
                                style={{ backgroundColor: c.bg, color: c.fg, border: `1px solid ${c.fg}44` }}
                                data-raci-mark={mark}
                              >{mark}</span>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <p className="font-mono text-[11px] text-slate-500" data-row-count>
              {filteredTasks.length} task{filteredTasks.length === 1 ? '' : 's'}{mineOn ? ` matching ${currentUser.name}` : ''}
            </p>

            <div className="flex flex-wrap gap-3 text-[11px]" data-raci-legend>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: RACI_COLOURS.R.bg, border: `1px solid ${RACI_COLOURS.R.fg}` }} />R = responsible</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: RACI_COLOURS.A.bg, border: `1px solid ${RACI_COLOURS.A.fg}` }} />A = accountable</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: RACI_COLOURS.C.bg, border: `1px solid ${RACI_COLOURS.C.fg}` }} />C = consulted</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: RACI_COLOURS.I.bg, border: `1px solid ${RACI_COLOURS.I.fg}` }} />I = informed</span>
            </div>

            <p className="font-mono text-[11px] text-slate-500" data-accountability-note>
              Exactly one role is Accountable per task. Accountability cannot be reassigned after a stage is signed.
            </p>

            <div className="border-t border-slate-200 pt-4" data-people-panel>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">People in these roles</p>
              <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                {peopleInRoles.map(({ role, user }) => (
                  <div key={role} className="flex items-center gap-2 rounded-md border border-slate-200 p-2" data-person-role={role}>
                    <span
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full font-mono text-[11px] font-bold text-white"
                      style={{ backgroundColor: PLATFORM_ACCENT.primary }}
                    >{initialsFor(user.name)}</span>
                    <div>
                      <p className="text-[12px] font-semibold text-slate-900">{user.name}</p>
                      <p className="font-mono text-[10px] text-slate-500">{PLATFORM_USER_ROLE_LABEL[role as PlatformUserRole] ?? role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p
              className="rounded-md p-3 text-[12px]"
              style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
              data-audit-note
            >
              Every assignment change is written to the audit trail with the acting Admin named and a UTC timestamp.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
