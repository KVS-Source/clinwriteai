// Shared layout state for the docked AI Debug panel + the editor shell
// + the drafting progress toast. One source of truth for "is the panel
// open, how wide is it right now, is it collapsed to a thin tab".
//
// Why a context (not just local state in AiDebugPanel):
//   - DocumentEditor needs to know the effective panel width so it can
//     push its main content left (A) instead of having the panel overlay
//     the sections.
//   - AiDraftingProgressToast needs to know whether the panel is open so
//     it can hide itself (Z) — the panel renders its own equivalent
//     status footer when open.
//   - The user's chosen width + collapsed state persist to localStorage
//     so reopening the editor restores their preference.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

const WIDTH_KEY     = 'ai-debug-panel-width'
const COLLAPSED_KEY = 'ai-debug-panel-collapsed'

export const AI_DEBUG_DEFAULT_WIDTH = 480  // (C) default narrower than the previous 720
export const AI_DEBUG_MIN_WIDTH     = 320
export const AI_DEBUG_MAX_WIDTH     = 960
export const AI_DEBUG_COLLAPSED_PX  = 36   // (D) width of the thin tab when collapsed

export interface AiDebugLayout {
  /** Is the panel mounted (open vs closed)? Writer closed = 0 width contribution. */
  isOpen:     boolean
  /** User's chosen expanded width in px (ignored when collapsed). */
  width:      number
  /** When true, the panel renders as a thin vertical tab. */
  collapsed:  boolean
  /** The effective horizontal space the panel occupies right now.
   *  0 when closed, AI_DEBUG_COLLAPSED_PX when collapsed, `width` otherwise.
   *  DocumentEditor adds this as right-side padding/margin on its main body. */
  effectivePx: number

  setOpen:      (open: boolean) => void
  setWidth:     (px: number) => void
  setCollapsed: (collapsed: boolean) => void
}

const Ctx = createContext<AiDebugLayout | null>(null)

function readInt(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback
  const raw = window.localStorage.getItem(key)
  if (!raw) return fallback
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}
function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  const raw = window.localStorage.getItem(key)
  return raw === null ? fallback : raw === '1'
}

export function AiDebugLayoutProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpenState]       = useState(false)
  const [width, setWidthState]       = useState(() => clampWidth(readInt(WIDTH_KEY, AI_DEBUG_DEFAULT_WIDTH)))
  const [collapsed, setCollapsedSt]  = useState(() => readBool(COLLAPSED_KEY, false))

  const setWidth = useCallback((px: number) => {
    const clamped = clampWidth(px)
    setWidthState(clamped)
    try { window.localStorage.setItem(WIDTH_KEY, String(clamped)) } catch { /* localStorage disabled */ }
  }, [])
  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedSt(next)
    try { window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0') } catch { /* localStorage disabled */ }
  }, [])
  const setOpen = useCallback((next: boolean) => setOpenState(next), [])

  const effectivePx = !isOpen ? 0 : collapsed ? AI_DEBUG_COLLAPSED_PX : width

  // Keep CSS custom property in sync so any component that just wants to
  // react to the width (without subscribing to context) can
  // `padding-right: var(--ai-debug-px)`.
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.style.setProperty('--ai-debug-px', `${effectivePx}px`)
  }, [effectivePx])

  const value = useMemo<AiDebugLayout>(
    () => ({ isOpen, width, collapsed, effectivePx, setOpen, setWidth, setCollapsed }),
    [isOpen, width, collapsed, effectivePx, setOpen, setWidth, setCollapsed],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Required consumer — throws when used outside the provider so missing
 *  wiring fails loudly rather than silently falling back to defaults. */
export function useAiDebugLayout(): AiDebugLayout {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAiDebugLayout must be used inside <AiDebugLayoutProvider>')
  return v
}

/** Optional consumer — returns null when no provider is mounted. Use
 *  for components that render outside the editor (e.g. a global toast)
 *  but still want to adapt when the panel is open. */
export function useAiDebugLayoutOptional(): AiDebugLayout | null {
  return useContext(Ctx)
}

function clampWidth(px: number): number {
  return Math.max(AI_DEBUG_MIN_WIDTH, Math.min(AI_DEBUG_MAX_WIDTH, Math.round(px)))
}
