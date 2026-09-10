import { setupWorker } from 'msw/browser'
import { authHandlers }      from './handlers/auth'
import { projectHandlers }   from './handlers/projects'
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

export const worker = setupWorker(
  ...authHandlers,
  ...projectHandlers,
  ...documentHandlers,
  ...checklistHandlers,
  ...commentHandlers,
  ...auditHandlers,
  ...voiceNoteHandlers,
  ...aiHandlers,
  ...signatureHandlers,
  ...crmHandlers,
  ...referenceHandlers,
  ...presenceHandlers,
  ...qaHandlers,
  ...publicationHandlers,
  ...medContentHandlers,
  ...regulatoryWritingHandlers,
  ...ideationPublishingHandlers,
)
