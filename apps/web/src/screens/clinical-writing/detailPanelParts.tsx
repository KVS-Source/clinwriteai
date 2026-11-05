// Small presentational pieces shared by the right-hand detail panels
// (source document, document).

import type { ReactNode } from 'react'
import i18n from '../../i18n'
import { dateLocale } from '../../utils/formatDate'

export function MetaSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="border-t border-slate-200 px-5 py-4 first:border-t-0">
      <h3 className="mb-2.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</h3>
      {children}
    </section>
  )
}

export function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1 text-[13px]">
      <span className="w-[112px] flex-none text-slate-500">{label}</span>
      <span className="min-w-0 flex-1 break-words text-slate-900">{children}</span>
    </div>
  )
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return i18n.t('page.detail_panel_parts.em_dash')
  const d = new Date(iso)
  const date = d.toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
  return i18n.t('page.detail_panel_parts.datetime_at', { date, time })
}

export function fmtDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short', year: 'numeric' }) : i18n.t('page.detail_panel_parts.em_dash')
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return i18n.t('page.detail_panel_parts.size_bytes', { bytes })
  if (bytes < 1024 * 1024) return i18n.t('page.detail_panel_parts.size_kb', { value: (bytes / 1024).toFixed(1) })
  return i18n.t('page.detail_panel_parts.size_mb', { value: (bytes / 1024 / 1024).toFixed(1) })
}

export function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  )
}
