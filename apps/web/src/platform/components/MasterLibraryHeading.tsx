// Lets each Master Library page put its own title + subtitle into the shell's header (above the tab bar),
// in the place the generic "Master Library" heading used to occupy.
//
// How: the shell renders an empty slot <div> and shares it through this context. A page wraps its heading
// in <MasterLibraryHeading>, which portals the heading into that slot. Outside the shell (no provider)
// the heading simply renders in place, so a page still looks right if it is ever shown on its own.
//
//   undefined → no shell: render inline
//   null      → inside the shell, slot not mounted yet: render nothing for that first moment
//   element   → portal the heading into the shell's header

import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export const MasterLibrarySlotContext = createContext<HTMLElement | null | undefined>(undefined)

export function MasterLibraryHeading({ children }: { children: ReactNode }) {
  const slot = useContext(MasterLibrarySlotContext)
  if (slot === undefined) return <>{children}</>
  if (slot === null) return null
  return createPortal(children, slot)
}
