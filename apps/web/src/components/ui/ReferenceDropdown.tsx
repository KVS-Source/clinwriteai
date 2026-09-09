import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { PanelMode } from '@platform/types'
import { useDocumentStore } from '../../store'

type ReferenceMode = 'ich-e3' | 'meddra' | 'tlf'

const OPTIONS: { mode: ReferenceMode; label: string; Icon: () => React.ReactElement }[] = [
  {
    mode: 'ich-e3',
    label: 'ICH E3 Validator',
    Icon: () => (
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
        <rect x="1.2" y="1.8" width="3.6" height="3.6" rx="0.9" />
        <rect x="1.2" y="8.2" width="3.6" height="3.6" rx="0.9" />
        <rect x="6.2" y="2.9" width="6.6" height="1.3" rx="0.65" fill="currentColor" stroke="none" />
        <rect x="6.2" y="9.3" width="6.6" height="1.3" rx="0.65" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    mode: 'meddra',
    label: 'MedDRA Lookup',
    Icon: () => (
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
        <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <line x1="9.2" y1="9.2" x2="12" y2="12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    mode: 'tlf',
    label: 'TLF Cross-Reference',
    Icon: () => (
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
        <rect x="1.2" y="2.2" width="11.6" height="9.6" rx="1.2" />
        <line x1="1.2" y1="6.2" x2="12.8" y2="6.2" />
        <line x1="7"   y1="2.2" x2="7"    y2="11.8" />
      </svg>
    ),
  },
]

function BookIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M1.6 2.4h4a1.4 1.4 0 0 1 1.4 1.4v7.8a1.1 1.1 0 0 0-1.1-1.1H1.6z" />
      <path d="M12.4 2.4h-4A1.4 1.4 0 0 0 7 3.8v7.8a1.1 1.1 0 0 1 1.1-1.1h4.3z" />
    </svg>
  )
}

function CaretDownIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 10 10" className="flex-none">
      <polygon points="1,3 9,3 5,8" fill="currentColor" />
    </svg>
  )
}

const REFERENCE_MODES: ReferenceMode[] = ['ich-e3', 'meddra', 'tlf']

export function ReferenceDropdown() {
  const activePanel    = useDocumentStore(s => s.activePanel)
  const setActivePanel = useDocumentStore(s => s.setActivePanel)
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const isReferenceActive = activePanel !== null && REFERENCE_MODES.includes(activePanel as ReferenceMode)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.document.addEventListener('mousedown', handler)
    return () => window.document.removeEventListener('mousedown', handler)
  }, [open])

  const selectOption = (mode: ReferenceMode) => {
    setActivePanel(mode as NonNullable<PanelMode>)
    setOpen(false)
  }

  return (
    <div ref={wrapperRef} className="relative flex-none" data-reference-dropdown>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title="Reference sources"
        data-reference-toggle
        data-active={isReferenceActive || undefined}
        className="flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition-colors hover:bg-slate-100"
        style={{
          borderColor:     isReferenceActive ? '#2563EB' : '#E2E8F0',
          backgroundColor: isReferenceActive ? '#EFF6FF' : '#FFFFFF',
          color:           isReferenceActive ? '#2563EB' : '#475569',
        }}
      >
        <BookIcon />
        Reference
        <CaretDownIcon />
      </button>

      {open && (
        <div
          className="absolute left-0 z-10 flex flex-col rounded-lg bg-white p-1.5"
          style={{
            top: '100%',
            marginTop: 6,
            minWidth: 200,
            border: '1px solid #E2E8F0',
            boxShadow: '0 8px 20px rgba(15,23,42,0.10)',
          }}
          data-reference-menu
        >
          {OPTIONS.map(({ mode, label, Icon }) => {
            const isActive = activePanel === mode
            return (
              <button
                key={mode}
                type="button"
                onClick={() => selectOption(mode)}
                data-reference-option={mode}
                data-active={isActive || undefined}
                className="flex items-center gap-2 rounded px-3.5 py-2.5 text-left transition-colors hover:bg-slate-50"
              >
                <span
                  className="flex flex-none"
                  style={{ color: isActive ? '#2563EB' : '#64748B' }}
                >
                  <Icon />
                </span>
                <span
                  className="text-[13px]"
                  style={{
                    color: isActive ? '#2563EB' : '#1E293B',
                    fontWeight: isActive ? 700 : 400,
                  }}
                >
                  {label}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
