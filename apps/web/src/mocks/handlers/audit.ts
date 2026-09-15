import { http, HttpResponse, delay } from 'msw'
import auditTrail from '../../data/auditTrail.json'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

// The auditTrail.json fixture is shaped for the Platform Audit Trail Viewer
// (fields: userName, action, entityType, module …). The Clinical-Writing
// AuditReviewAlert screen expects the Module-A AuditEntry shape
// (fields: actor, actorInitials, eventType, sectionRef, description …).
// Map the platform records into the Module-A shape so the same fixture
// serves both screens without a runtime crash.
interface PlatformAudit {
  id:          string
  timestamp:   string
  userId:      string
  userName:    string
  action:      string
  entityId:    string
  entityLabel: string
  details:     string
  module:      string
  ipAddress:   string | null
}

const EVENT_TYPE_FROM_ACTION: Record<string, string> = {
  SIGNATURE_APPLIED:           'document-signed',
  DOCUMENT_EDITED:             'content-edited',
  ARTEFACT_UPLOADED:           'content-edited',
  ACK2_RECEIVED:               'stage-advanced',
  SUBMISSION_TRANSMITTED:      'stage-advanced',
  MA_APPROVED:                 'checklist-completed',
  CLAIM_CURRENCY_ACKNOWLEDGED: 'checklist-completed',
  COMMENT_ADDED:               'comment-added',
  USER_INVITED:                'content-edited',
  TC_ACCEPTED:                 'checklist-completed',
  FRAMEWORK_ALERT_TRIGGERED:   'stage-advanced',
  STAGE_ADVANCED:              'stage-advanced',
  CONTRADICTION_RESOLVED:      'comment-resolved',
  CONTENT_CARD_TAGGED:         'content-edited',
  RATE_CARD_UPDATED:           'content-edited',
  MA_REVIEW_RESOLVED:          'comment-resolved',
  TA_TAG_CREATED:              'content-edited',
  CLIENT_CREATED:              'content-edited',
  FRAMEWORK_ACKNOWLEDGED:      'checklist-completed',
}

function initialsFor(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

function toModuleAAudit(r: PlatformAudit) {
  const actor = r.userName ?? r.userId ?? 'Unknown'
  return {
    id:             r.id,
    timestamp:      r.timestamp,
    actor,
    actorInitials:  initialsFor(actor),
    actorColourKey: 'blue',
    action:         r.action,
    eventType:      EVENT_TYPE_FROM_ACTION[r.action] ?? 'content-edited',
    sectionRef:     r.entityLabel ?? r.entityId ?? '—',
    description:    r.details ?? '',
    ipAddress:      r.ipAddress,
    module:         r.module,
  }
}

export const auditHandlers = [
  http.get(`${BASE}/documents/:documentId/audit`, async () => {
    await delay(200)
    const entries = (auditTrail as PlatformAudit[]).map(toModuleAAudit)
    return HttpResponse.json({ entries, total: entries.length, limit: 50, offset: 0 })
  }),
]
