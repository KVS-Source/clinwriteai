// Autosave hook for the editor (sPM-autosave).
//
// Fires `save` on three triggers, which cover the common failure modes:
//   1. Idle debounce (default 2000ms after last change) — the common case.
//   2. Immediate flush when the editor is told to flush (e.g. on blur, on
//      section switch, when the lock mode changes).
//   3. `pagehide` fallback — tab close, hard-nav, back/forward cache. Fires
//      sync so the browser can observe the request before killing the tab.
//
// Design notes:
//   - The hook is stateless w.r.t. content: the caller passes `getPayload`
//     (returns the current HTML) rather than keeping its own copy. This
//     avoids a stale closure after a React render.
//   - When `enabled` is false (no section open, foreign lock held, editor
//     is read-only) all triggers are no-ops — but the hook is still mounted
//     so transitions in → out don't lose a pending save.
//   - `save` is expected to return a promise. The hook ignores failures but
//     surfaces the latest status via the returned object so the caller can
//     render "Saving…" / "Saved HH:MM" / "Save failed — retrying" pills.
//
// Not handled here: lock acquisition. useSectionLock is a sibling hook; the
// editor coordinates them (autosave is `enabled` iff lock mode === 'owned').

import { useCallback, useEffect, useRef, useState } from 'react'

export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export interface AutosaveState {
  status:       AutosaveStatus
  lastSavedAt:  Date | null
  lastError:    Error | null
  /** Manual flush. Returns the save promise so callers can await. */
  flush:        () => Promise<void>
  /** Mark the content dirty — the hook debounces + saves after `debounceMs`. */
  markDirty:    () => void
}

export interface UseAutosaveOpts {
  enabled:    boolean
  debounceMs?: number
  save:       (html: string) => Promise<unknown>
  getPayload: () => string
}

export function useAutosave(opts: UseAutosaveOpts): AutosaveState {
  const { enabled, save, getPayload } = opts
  const debounceMs = opts.debounceMs ?? 2_000

  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [lastError,   setLastError]   = useState<Error | null>(null)

  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef   = useRef<Promise<void> | null>(null)
  const lastSavedRef  = useRef<string | null>(null)
  const enabledRef    = useRef(enabled)
  const saveRef       = useRef(save)
  const getPayloadRef = useRef(getPayload)

  // Keep refs synced each render so the stable callbacks below always see
  // the current closure values (classic debounce pitfall).
  useEffect(() => { enabledRef.current    = enabled    }, [enabled])
  useEffect(() => { saveRef.current       = save       }, [save])
  useEffect(() => { getPayloadRef.current = getPayload }, [getPayload])

  const doSave = useCallback(async (): Promise<void> => {
    if (!enabledRef.current) return
    const payload = getPayloadRef.current()
    if (payload === lastSavedRef.current) {
      // Nothing to save (we just saved this exact content). Keep whatever
      // status the UI is currently showing.
      return
    }
    if (inFlightRef.current) {
      // A save is already in flight. Await it, then re-check: if more
      // typing happened during the save, that payload will differ and we
      // start a fresh save.
      await inFlightRef.current
      if (getPayloadRef.current() === lastSavedRef.current) return
    }

    setStatus('saving')
    const myPromise: Promise<void> = (async () => {
      try {
        await saveRef.current(payload)
        lastSavedRef.current = payload
        setStatus('saved')
        setLastSavedAt(new Date())
        setLastError(null)
      } catch (err) {
        setStatus('error')
        setLastError(err instanceof Error ? err : new Error('save_failed'))
      } finally {
        inFlightRef.current = null
      }
    })()
    inFlightRef.current = myPromise
    return myPromise
  }, [])

  const markDirty = useCallback(() => {
    if (!enabledRef.current) return
    setStatus(prev => (prev === 'saving' ? prev : 'dirty'))
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { void doSave() }, debounceMs)
  }, [debounceMs, doSave])

  const flush = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    await doSave()
  }, [doSave])

  // `pagehide` runs on tab close / hard-nav / bfcache. Fire a sync save.
  // The browser gives us a brief grace window; our best bet is to kick off
  // the fetch synchronously here and let the server receive it.
  useEffect(() => {
    const onPageHide = () => { void doSave() }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [doSave])

  // On unmount, flush any pending debounce (section switch is the common case).
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        void doSave()
      }
    }
  }, [doSave])

  // When the hook flips to disabled (foreign lock acquired mid-session,
  // section closed), cancel any pending debounce — we don't own the write.
  useEffect(() => {
    if (!enabled && debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [enabled])

  return { status, lastSavedAt, lastError, flush, markDirty }
}
