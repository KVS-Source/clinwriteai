import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { AuditTrailEntry, AuditActionType, ModuleKey } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store'

const ACTION_CYCLE: (AuditActionType | 'All')[] = [
  'All' as const, 'SIGNATURE_APPLIED', 'STAGE_ADVANCED', 'DOCUMENT_EDITED', 'SUBMISSION_TRANSMITTED', 'ACK2_RECEIVED',
]
const MODULE_CYCLE: (ModuleKey | 'All')[] = ['All', 'A', 'B', 'C', 'D', 'E', 'platform']

const MODULE_LABEL_KEYS: Record<ModuleKey | 'platform' | 'All', string> = {
  'All':      'page.audit_trail_viewer.all_disciplines',
  'A':        'nav.clinical_writing',
  'B':        'nav.scientific_writing',
  'C':        'nav.medical_writing',
  'D':        'nav.regulatory_writing',
  'E':        'nav.ideation_publishing',
  'platform': 'page.audit_trail_viewer.module_platform',
}

function formatUTC(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  const ss = String(d.getUTCSeconds()).padStart(2, '0')
  return `${dd} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm}:${ss} UTC`
}

function ActionBadge({ action }: { action: string }) {
  const kind = action.includes('SIGNATURE') || action.includes('TRANSMITTED')
    ? { bg: PLATFORM_ACCENT.bgTint, fg: PLATFORM_ACCENT.primary }
    : action.includes('ADVANCED') || action.includes('APPROVED')
    ? { bg: '#F0FDF4', fg: '#166534' }
    : action.includes('ALERT') || action.includes('WARNED')
    ? { bg: '#FFFBEB', fg: '#B45309' }
    : { bg: '#F1F5F9', fg: '#475569' }
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
      style={{ backgroundColor: kind.bg, color: kind.fg }}
      data-action-badge={action}
    >{action}</span>
  )
}

export function AuditTrailViewer() {
  const { t } = useTranslation()
  const currentUser = usePlatformStore(s => s.currentUser)
  const { data: entries = [] } = useQuery<AuditTrailEntry[]>({
    queryKey: ['audit'],
    queryFn:  () => platformApi.listAudit(),
  })

  const [dateFrom, setDateFrom] = useState('2026-09-01')
  const [dateTo,   setDateTo]   = useState('2026-09-09')
  const [userFilter,   setUserFilter]   = useState<'all' | string>('all')
  const [actionIdx,    setActionIdx]    = useState(0)
  const [moduleIdx,    setModuleIdx]    = useState(0)

  const [selectedId, setSelectedId] = useState<string>('aud-001')
  const [exportResult, setExportResult] = useState<{ url: string; rows: number } | null>(null)

  // Default active on first load
  useEffect(() => { if (entries.length && !entries.some(e => e.id === selectedId)) setSelectedId(entries[0].id) }, [entries, selectedId])

  const activeAction = ACTION_CYCLE[actionIdx]
  const activeModule = MODULE_CYCLE[moduleIdx]

  const filtered = useMemo(() => {
    return entries.filter(e => {
      const day = e.timestamp.slice(0, 10)
      if (day < dateFrom || day > dateTo)                              return false
      if (userFilter !== 'all' && e.userId !== userFilter)              return false
      if (activeAction !== 'All' && e.action !== activeAction)          return false
      if (activeModule !== 'All' && e.module !== activeModule)          return false
      return true
    })
  }, [entries, dateFrom, dateTo, userFilter, activeAction, activeModule])

  const activeEntry = useMemo(
    () => entries.find(e => e.id === selectedId) ?? entries[0] ?? null,
    [entries, selectedId],
  )

  const uniqueUsers = useMemo(() => {
    const map = new Map<string, string>()
    entries.forEach(e => map.set(e.userId, e.userName))
    return Array.from(map.entries())
  }, [entries])

  const detailFields: { label: string; value: string }[] = useMemo(() => {
    if (!activeEntry) return []
    const base = [
      { label: t('page.audit_trail_viewer.field_timestamp'),  value: formatUTC(activeEntry.timestamp) },
      { label: t('page.audit_trail_viewer.field_user'),       value: activeEntry.userName },
      { label: t('page.audit_trail_viewer.field_role'),       value: activeEntry.userId === 'SYSTEM' ? t('page.audit_trail_viewer.role_system') : (activeEntry.partEleven?.role ?? '—') },
      { label: t('page.audit_trail_viewer.field_action'),     value: activeEntry.action },
      { label: t('page.audit_trail_viewer.field_entity'),     value: `${activeEntry.entityLabel} (${activeEntry.entityType})` },
      { label: t('page.audit_trail_viewer.field_discipline'), value: activeEntry.module.toUpperCase() },
      { label: t('page.audit_trail_viewer.field_ip'),         value: activeEntry.ipAddress ?? '—' },
      { label: t('page.audit_trail_viewer.field_session_id'), value: activeEntry.sessionId ?? '—' },
    ]
    if (activeEntry.partEleven) {
      base.push(
        { label: t('page.audit_trail_viewer.field_signatory'),           value: activeEntry.partEleven.signatoryName },
        { label: t('page.audit_trail_viewer.field_role'),                value: activeEntry.partEleven.role },
        { label: t('page.audit_trail_viewer.field_email'),               value: activeEntry.partEleven.email },
        { label: t('page.audit_trail_viewer.field_meaning_of_sig'),      value: activeEntry.partEleven.meaning },
        { label: t('page.audit_trail_viewer.field_doc_version_hash'),    value: activeEntry.partEleven.documentVersionHash },
      )
    }
    return base
  }, [activeEntry, t])

  const handleExport = async () => {
    try {
      const res = await platformApi.exportAuditCsv()
      setExportResult({ url: res.downloadUrl, rows: res.rowCount })
    } catch { /* prototype */ }
  }

  return (
    <div className="bg-slate-50" data-screen="audit-trail-viewer">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>{t('page.audit_trail_viewer.crumb_platform')}</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{t('page.audit_trail_viewer.crumb_audit_trail')}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>{t('page.audit_trail_viewer.title')}</h1>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>
              {t('page.audit_trail_viewer.user_demo_summary', { name: currentUser.name })}
            </p>
          </div>
        </div>

        {/* Immutability banner — always visible */}
        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: PLATFORM_ACCENT.bgTint, border: `1px solid ${PLATFORM_ACCENT.borderMedium}`, color: PLATFORM_ACCENT.primary }}
          role="note"
          data-immutability-banner
        >
          <p className="text-[13px] font-semibold">{t('page.audit_trail_viewer.immutability_banner_title')}</p>
          <p className="mt-1 text-[12px]">
            {t('page.audit_trail_viewer.immutability_banner_body')}
          </p>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3" data-filter-bar>
          <label className="flex items-center gap-1 text-[12px] text-slate-600">
            <span className="font-mono">{t('page.audit_trail_viewer.from')}</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.currentTarget.value)}
              className="h-8 rounded-md border border-slate-300 px-2 text-[12px]" data-filter-from />
          </label>
          <label className="flex items-center gap-1 text-[12px] text-slate-600">
            <span className="font-mono">{t('page.audit_trail_viewer.to')}</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.currentTarget.value)}
              className="h-8 rounded-md border border-slate-300 px-2 text-[12px]" data-filter-to />
          </label>

          <select value={userFilter} onChange={(e) => setUserFilter(e.currentTarget.value)} data-filter-user
            className="h-8 rounded-md border border-slate-300 px-2 text-[12px]">
            <option value="all">{t('page.audit_trail_viewer.all_users')}</option>
            {uniqueUsers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>

          <button
            type="button"
            onClick={() => setActionIdx((actionIdx + 1) % ACTION_CYCLE.length)}
            data-cycle-action
            data-active-action={activeAction}
            className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
          >{t('page.audit_trail_viewer.action_label')}: {activeAction === 'All' ? t('page.audit_trail_viewer.all_actions') : activeAction}</button>

          <button
            type="button"
            onClick={() => setModuleIdx((moduleIdx + 1) % MODULE_CYCLE.length)}
            data-cycle-module
            data-active-module={activeModule}
            className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
          >{t('page.audit_trail_viewer.discipline_label')}: {t(MODULE_LABEL_KEYS[activeModule])}</button>

          <div className="flex-1" />

          <button
            type="button"
            onClick={handleExport}
            data-export-csv
            className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
          >{t('page.audit_trail_viewer.export_csv')}</button>
        </div>

        {exportResult && (
          <p className="rounded-md p-2 text-[12px]" style={{ backgroundColor: '#F0FDF4', color: '#166534' }} data-export-result>
            {t('page.audit_trail_viewer.export_ready', { rows: exportResult.rows, url: exportResult.url })}
          </p>
        )}

        {/* Layout: table + drawer */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 380px' }}>

          {/* Audit table */}
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-audit-table data-row-count={filtered.length}>
            <table className="w-full text-[12px]">
              <thead style={{ backgroundColor: '#F8FAFC' }}>
                <tr className="text-left text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  <th className="px-3 py-2">{t('page.audit_trail_viewer.col_timestamp_utc')}</th>
                  <th className="px-3 py-2">{t('page.audit_trail_viewer.col_user')}</th>
                  <th className="px-3 py-2">{t('page.audit_trail_viewer.col_action')}</th>
                  <th className="px-3 py-2">{t('page.audit_trail_viewer.col_entity')}</th>
                  <th className="px-3 py-2">{t('page.audit_trail_viewer.col_discipline')}</th>
                  <th className="px-3 py-2">{t('page.audit_trail_viewer.col_ip')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr
                    key={e.id}
                    onClick={() => setSelectedId(e.id)}
                    data-audit-row={e.id}
                    data-selected={e.id === activeEntry?.id || undefined}
                    className="cursor-pointer border-t border-slate-200 hover:bg-slate-50"
                    style={{ backgroundColor: e.id === activeEntry?.id ? PLATFORM_ACCENT.bgTint : undefined }}
                  >
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{formatUTC(e.timestamp)}</td>
                    <td className="px-3 py-2 text-slate-800">{e.userName}</td>
                    <td className="px-3 py-2"><ActionBadge action={e.action} /></td>
                    <td className="px-3 py-2 text-slate-700">{e.entityLabel}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{e.module.toUpperCase()}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{e.ipAddress ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-slate-200 p-2 font-mono text-[11px] text-slate-500" data-count-label>
              {t('page.audit_trail_viewer.showing_entries', { count: filtered.length })}
            </p>
          </section>

          {/* Detail drawer */}
          {activeEntry && (
            <aside className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5" data-detail-drawer data-active-entry={activeEntry.id}>
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.audit_trail_viewer.entry_detail')}</p>
                <p className="mt-1 text-[16px] font-bold text-slate-900" data-active-action>{activeEntry.action}</p>
                <p className="mt-0.5 text-[12px] text-slate-600">{activeEntry.details}</p>
              </div>

              <dl className="grid gap-2 text-[12px]" data-detail-fields>
                {detailFields.map(f => (
                  <div key={f.label} className="grid grid-cols-[140px_1fr] gap-2" data-detail-field={f.label}>
                    <dt className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{f.label}</dt>
                    <dd className="text-slate-800">{f.value}</dd>
                  </div>
                ))}
              </dl>

              {activeEntry.partEleven && (
                <div
                  className="rounded-lg border p-3"
                  style={{ backgroundColor: PLATFORM_ACCENT.bgTint, borderColor: PLATFORM_ACCENT.borderMedium }}
                  data-part-eleven-block
                >
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-widest" style={{ color: PLATFORM_ACCENT.primary }}>{t('page.audit_trail_viewer.part_eleven_signature')}</p>
                  <blockquote
                    className="mt-2 border-l-2 pl-3 text-[12px] italic"
                    style={{ borderColor: PLATFORM_ACCENT.primary, color: PLATFORM_ACCENT.primary }}
                    data-part-eleven-meaning
                  >
                    "{activeEntry.partEleven.meaning}"
                  </blockquote>
                </div>
              )}

              <p
                className="rounded-md p-2 text-[11px] font-mono"
                style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
                data-immutability-note
              >
                {t('page.audit_trail_viewer.record_immutable_note')}
              </p>
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
