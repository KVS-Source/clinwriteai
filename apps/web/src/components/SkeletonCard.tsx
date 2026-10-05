// SkeletonCard — generic loading placeholder for any card/list surface.
//
// MSW returns in < 10ms so the prototype never flashed a loading state.
// Real API responses are 50-500ms; without a skeleton, every table/panel
// flashes empty-state briefly before data arrives. This component is the
// drop-in during loading.
//
// Variants:
//   'card'  — single rectangular block (default); use for a single pane
//   'row'   — one horizontal line; use inside list items
//   'table' — multiple rows; use for data tables
//   'stat'  — small block for KPI tiles

import { memo } from 'react'

export interface SkeletonProps {
  variant?: 'card' | 'row' | 'table' | 'stat'
  rows?: number     // only for variant='table'
  height?: string   // CSS height for card/stat; defaults vary per variant
  width?: string    // CSS width; defaults to '100%'
  'aria-label'?: string
}

const base = {
  background: 'linear-gradient(90deg, #f0f0f0 0px, #e8e8e8 40px, #f0f0f0 80px)',
  backgroundSize: '200% 100%',
  animation: 'skeleton-pulse 1.6s ease-in-out infinite',
  borderRadius: '6px',
}

// Keyframes injected via a one-time style tag so the component works without
// a global stylesheet import. Idempotent — the id check skips re-insertion.
const KEYFRAMES_ID = 'skeleton-card-keyframes'
function ensureKeyframes() {
  if (typeof document === 'undefined') return
  if (document.getElementById(KEYFRAMES_ID)) return
  const style = document.createElement('style')
  style.id = KEYFRAMES_ID
  style.textContent = `
    @keyframes skeleton-pulse {
      0% { background-position: 100% 50%; }
      100% { background-position: -100% 50%; }
    }
    @media (prefers-reduced-motion: reduce) {
      @keyframes skeleton-pulse { 0%, 100% { background-position: 50% 50%; } }
    }
  `
  document.head.appendChild(style)
}

export const SkeletonCard = memo(function SkeletonCard(props: SkeletonProps) {
  const { variant = 'card', rows = 5, height, width = '100%' } = props
  ensureKeyframes()

  const label = props['aria-label'] ?? 'Loading'

  if (variant === 'row') {
    return <div role="status" aria-label={label} aria-busy="true" style={{ ...base, height: height ?? '14px', width }} />
  }
  if (variant === 'stat') {
    return (
      <div role="status" aria-label={label} aria-busy="true" style={{ width }}>
        <div style={{ ...base, height: '12px', width: '40%', marginBottom: '8px' }} />
        <div style={{ ...base, height: height ?? '28px', width: '70%' }} />
      </div>
    )
  }
  if (variant === 'table') {
    return (
      <div role="status" aria-label={label} aria-busy="true" style={{ width }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} style={{ ...base, height: '18px', marginBottom: '10px', width: i === rows - 1 ? '60%' : '100%' }} />
        ))}
      </div>
    )
  }
  // card (default)
  return (
    <div role="status" aria-label={label} aria-busy="true" style={{ width, padding: '16px', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
      <div style={{ ...base, height: '14px', width: '30%', marginBottom: '12px' }} />
      <div style={{ ...base, height: height ?? '72px', width: '100%' }} />
    </div>
  )
})
