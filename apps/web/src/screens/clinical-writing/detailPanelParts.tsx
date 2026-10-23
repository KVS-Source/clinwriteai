// Small presentational pieces shared by the right-hand detail panels
// (source document, document).

import type { ReactNode } from 'react'

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
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} at ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

export function fmtDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  )
}
