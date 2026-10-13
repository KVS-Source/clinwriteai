// MSW worker setup with per-group toggles.
//
// Each handler group is independently togglable via env flags so Phase 2+
// cutover can kill one group at a time and have the frontend fall through
// to the real API without rebuilding the handler file.
//
// Toggle reads (activeMockGroups, anyMocksEnabled) live in ./toggles.ts so
// the UI badge can call them without pulling the handlers into the main
// bundle. This file imports every handler group and must stay dynamic-
// imported from entry code so Vite can keep it out of the main chunk when
// mocks are off.

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
import { activeMockGroups, type ToggleName } from './toggles'

const GROUPS: Record<ToggleName, unknown[]> = {
  AUTH: [...authHandlers],
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

// Admin Panel endpoints the real API doesn't serve yet. Kept mocked even when
// the PROJECTS group is off, otherwise the panel never leaves "Loading…".
const ADMIN_PANEL_MOCK_ONLY = platformHandlers.filter(h =>
  /\/admin\/(config|subscription)$/.test(String((h as { info: { path: unknown } }).info.path)),
)

export function createWorker(): SetupWorker {
  const active = activeMockGroups()
  const handlers = active.flatMap(name => GROUPS[name] as never[])
  if (!active.includes('PROJECTS')) handlers.push(...(ADMIN_PANEL_MOCK_ONLY as never[]))
  return setupWorker(...handlers)
}
