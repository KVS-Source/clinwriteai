import { useEffect } from 'react'
import { create } from 'zustand'

// The section open inside a page with its own tabs (Administrative Panel: "AI engine", Reports: "Dashboard"), for the
// top bar to show after the page's name: "Administrative Panel / AI engine". The tab is the page's own state, not in
// the URL, so the page reports it here while it is on screen.
interface TopNavSectionState {
  section: { path: string; label: string } | null
  set: (section: { path: string; label: string } | null) => void
}

export const useTopNavSectionStore = create<TopNavSectionState>(set => ({
  section: null,
  set: section => set({ section }),
}))

/** Shows `label` after the page's name in the top bar while the page at `path` is open. */
export function useTopNavSection(path: string, label: string | null) {
  const setSection = useTopNavSectionStore(s => s.set)
  useEffect(() => {
    setSection(label ? { path, label } : null)
    return () => setSection(null)
  }, [path, label, setSection])
}

/** The section to show for the page at `pathname`, if that page has reported one. */
export function useTopNavSectionFor(pathname: string): string | null {
  const section = useTopNavSectionStore(s => s.section)
  return section && section.path === pathname ? section.label : null
}
