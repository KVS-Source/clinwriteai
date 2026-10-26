// AI prompt help panel (sPM-ai-prompt-help).
//
// Opens from the Help button in SectionAIPrompt. Lists suggested prompts
// grouped by document type. Clicking a suggestion fills it into the
// prompt box via an event the SectionAIPrompt listens for.
//
// Lives in the right-rail chassis (PanelMode 'ai-help') for consistency
// with the other panels. Also installs an outside-click handler so the
// panel closes when the user clicks anywhere off the right rail — gives
// users the lightweight-popover feel they asked for while still reusing
// the panel infrastructure.

import { useEffect, useRef } from 'react'
import { suggestedPromptsFor } from '../data/aiPromptLibrary'
import { pickPrompt } from '../screens/clinical-writing/SectionAIPrompt'
import { useDocumentStore } from '../store'

interface Props {
  /** Document type (DocumentType enum) — drives which prompt group shows. */
  documentType?: string
}

export function AIPromptHelpPanel({ documentType }: Props) {
  const setActivePanel = useDocumentStore(s => s.setActivePanel)
  const panelRef = useRef<HTMLDivElement>(null)

  // Outside-click close. We use mousedown rather than click so a selection
  // drag inside the panel doesn't accidentally fire the close.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!panelRef.current) return
      if (panelRef.current.contains(e.target as Node)) return
      // Don't close if the user clicked the Help button that opened us —
      // that button toggles the panel; letting the close race the toggle
      // would reopen the panel on the next render.
      const t = e.target as HTMLElement | null
      if (t?.closest('[data-ai-help-button]')) return
      setActivePanel(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [setActivePanel])

  const groups = suggestedPromptsFor(documentType)

  return (
    <div ref={panelRef} className="flex-1 overflow-y-auto p-4" data-panel="ai-help">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        Prompt library
      </p>
      <p className="mt-1 text-[13px] text-slate-700">
        Click a suggestion to fill the prompt box. Prompts tagged
        <span className="mx-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">selection</span>
        expect you to highlight text in the editor first.
      </p>

      {groups.map(group => (
        <div key={group.title} className="mt-5">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            {group.title}
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {group.prompts.map(p => (
              <li key={p.label}>
                <button
                  type="button"
                  onClick={() => { pickPrompt(p); setActivePanel(null) }}
                  className="flex w-full flex-col items-start gap-1 rounded-md border border-slate-200 bg-white p-3 text-left transition-colors hover:border-blue-400 hover:bg-blue-50"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-slate-900">{p.label}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${p.scope === 'selection' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                      {p.scope}
                    </span>
                  </span>
                  <span className="text-[11px] text-slate-500">{p.prompt}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
