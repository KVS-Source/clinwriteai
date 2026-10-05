// MSW worker setup with per-group toggles.
//
// Each handler group is independently togglable via env flags so Phase 2+
// cutover can kill one group at a time and have the frontend fall through
// to the real API without rebuilding the handler file.
//
// Flags (default 'on' for backward compat with the prototype demo):
//   VITE_MOCK_AUTH       — auth
//   VITE_MOCK_PROJECTS   — projects + platform admin
//   VITE_MOCK_MODULE_A   — Module A: clinical writing (documents, checklist,
//                          comments, audit, voice-notes, ai, signatures,
//                          crm, reference, presence, qa)
//   VITE_MOCK_MODULE_B   — Module B: scientific writing (publications)
//   VITE_MOCK_MODULE_C   — Module C: medical writing (medContent)
//   VITE_MOCK_MODULE_D   — Module D: regulatory writing
//   VITE_MOCK_MODULE_E   — Module E: ideation + publishing
//
// 'off' leaves no handler registered for that group — fetches fall through to
// the real backend at VITE_API_URL. The special value 'force' means the group
// stays mocked even when the global VITE_API_URL is set (useful for mixing a
// real API with a mocked module during cutover).

import { setupWorker, type SetupWorker } from 'msw/browser'
import { authHandlers }      from './handlers/auth'
import { projectHandlers }   from './handlers/projects'
import { platformHandlers }  from './handlers/platform'
import { documentHandlers }  from './handlers/documents'
import { checklistHandlers } from './handlers/checklist'
import { commentHandlers }   from './handlers/comments'
import { auditHandlers }     from './handlers/audit'
import { voiceNoteHandlers } from './handlers/voice-notes'
import { aiHandlers }        from './handlers/ai'
import { signatureHandlers } from './handlers/signatures'
import { crmHandlers }       from './handlers/crm'
import { referenceHandlers } from './handlers/reference'
import { presenceHandlers }  from './handlers/presence'
import { qaHandlers }        from './handlers/qa'
import { publicationHandlers } from './handlers/publications'
import { medContentHandlers }  from './handlers/medContent'
import { regulatoryWritingHandlers } from './handlers/regulatoryWriting'
import { ideationPublishingHandlers } from './handlers/ideationPublishing'

type ToggleName =
  | 'AUTH' | 'PROJECTS'
  | 'MODULE_A' | 'MODULE_B' | 'MODULE_C' | 'MODULE_D' | 'MODULE_E'

const GROUPS: Record<ToggleName, ReturnType<typeof setupWorker>['listHandlers'] extends never ? never : unknown[]> = {
  AUTH: authHandlers,
  PROJECTS: [...projectHandlers, ...platformHandlers],
  MODULE_A: [
    ...documentHandlers, ...checklistHandlers, ...commentHandlers,
    ...auditHandlers, ...voiceNoteHandlers, ...aiHandlers,
    ...signatureHandlers, ...crmHandlers, ...referenceHandlers,
    ...presenceHandlers, ...qaHandlers,
  ],
  MODULE_B: [...publicationHandlers],
  MODULE_C: [...medContentHandlers],
  MODULE_D: [...regulatoryWritingHandlers],
  MODULE_E: [...ideationPublishingHandlers],
}

function flag(name: ToggleName): 'on' | 'off' | 'force' {
  const raw = (import.meta.env[`VITE_MOCK_${name}`] as string | undefined)?.toLowerCase()
  if (raw === 'off') return 'off'
  if (raw === 'force') return 'force'
  return 'on'
}

export function activeMockGroups(): ToggleName[] {
  return (Object.keys(GROUPS) as ToggleName[]).filter(name => flag(name) !== 'off')
}

export function anyMocksEnabled(): boolean {
  return activeMockGroups().length > 0
}

export function createWorker(): SetupWorker {
  const handlers = activeMockGroups().flatMap(name => GROUPS[name] as never[])
  return setupWorker(...handlers)
}

// Legacy export — kept so existing imports don't break during cutover. The
// handler list reflects whatever toggles are set at import time.
export const worker: SetupWorker = createWorker()
