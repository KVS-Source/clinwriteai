# Aurora — API Contracts
**Modules A, B, C, D & E: All Five Modules**
**Version 4.0 — September 2026**
*Status: Approved for prototype build. MSW handlers implement these contracts in Phase 1. Real backend implements the same contracts in Phase 2.*

---

## 0. Document Purpose & Conventions

This document defines every API endpoint for Aurora Module A. Each endpoint specifies:
- Method + path
- Path and query parameters
- Request body shape (for POST/PATCH/PUT)
- Success response shape
- Error responses
- MSW handler pattern (Phase 1)

**Base URL:** `http://localhost:3000/api` (development) — set via `VITE_API_URL` environment variable.

**Authentication:** All endpoints except `/auth/login` and `/auth/mfa` require a `Bearer` session token in the `Authorization` header. MSW bypasses auth in Phase 1 — the real backend enforces it in Phase 2.

**Conventions:**

| Convention | Meaning |
|-----------|---------|
| `:id` | UUID path parameter |
| `?param` | Optional query parameter |
| `NN` | Required field in request body |
| Response shapes use TypeScript types from `packages/types/src/domain.ts` |
| All timestamps in responses are ISO 8601 UTC strings |
| Error responses always return `{ error: string; code?: string; details?: unknown }` |

**Path parameter conventions:**

| Parameter | Meaning |
|-----------|---------|
| `:projectId` | UUID of a Project record |
| `:documentId` | UUID of a Document record |
| `:itemId` | UUID of a ChecklistInstanceItem record |
| `:commentId` | CMT-### string ID of a Comment record |
| `:meetingId` | UUID of a CRMMeeting record |
| `:sectionId` | Section identifier string (e.g. "11.4.1") |

**Note on the Endpoint Index (§15):** The index uses `:id` as a shorthand for readability (e.g. `/documents/:id`). The actual parameter name in each endpoint section uses the full name (`:documentId`, `:projectId`) which is what CC should use in the MSW handler and API client code.

| HTTP Status | When used |
|------------|-----------|
| 400 | Invalid request body or parameters |
| 401 | Missing or invalid session token |
| 403 | Authenticated but insufficient permissions (RACI) |
| 404 | Resource not found |
| 409 | Conflict (e.g. duplicate, immutable resource) |
| 422 | Business rule violation (e.g. signing a document that is not in `pending-signature` status) |
| 500 | Server error |

---

## 1. Authentication

### `POST /auth/login`

Initiates authentication. Returns whether MFA is required.

**Request body:**
```typescript
{
  email:    string  // NN
  password: string  // NN — never logged
}
```

**Response 200:**
```typescript
{
  sessionToken:  string   // JWT — short-lived (15 min), refreshed by MFA step
  requiresMFA:   boolean
  user: {
    id:       string
    name:     string
    initials: string
    role:     string
  }
}
```

**Errors:** 401 (invalid credentials), 400 (missing fields)

**MSW handler:**
```typescript
rest.post('/api/auth/login', async (req, res, ctx) => {
  const { email } = await req.json()
  if (email === 'marcus.webb@genbiocat.com') {
    return res(ctx.delay(400), ctx.json({
      sessionToken: 'mock-session-token',
      requiresMFA: true,
      user: { id: 'user-MW', name: 'Marcus Webb', initials: 'MW', role: 'Lead Clinical Writer' }
    }))
  }
  return res(ctx.status(401), ctx.json({ error: 'Invalid credentials' }))
})
```

---

### `POST /auth/mfa`

Verifies the MFA code and issues the full session token.

**Request body:**
```typescript
{
  code: string  // NN — 6-digit TOTP code
}
```

**Response 200:**
```typescript
{
  sessionToken: string  // full-access JWT
}
```

**Errors:** 401 (invalid code), 400 (missing code)

**MSW handler:**
```typescript
rest.post('/api/auth/mfa', async (req, res, ctx) => {
  const { code } = await req.json()
  // In Phase 1, any 6-digit code succeeds
  if (/^\d{6}$/.test(code)) {
    return res(ctx.delay(300), ctx.json({ sessionToken: 'mock-full-session-token' }))
  }
  return res(ctx.status(401), ctx.json({ error: 'Invalid MFA code' }))
})
```

---

### `GET /auth/me`

Returns the authenticated user's profile.

**Response 200:** `User`

**Errors:** 401

**MSW handler:**
```typescript
rest.get('/api/auth/me', (req, res, ctx) =>
  res(ctx.delay(100), ctx.json(team.find(u => u.initials === 'MW')))
)
```

---

### `POST /auth/logout`

Invalidates the session token.

**Response 200:** `{}`

**MSW handler:**
```typescript
rest.post('/api/auth/logout', (req, res, ctx) =>
  res(ctx.delay(100), ctx.json({}))
)
```

---

## 2. Projects

### `GET /projects`

Returns all projects visible to the authenticated user.

**Query parameters:**
```
?status=ongoing|initiated|on-hold|closed  (optional)
?ta=Oncology|Cardiology|...               (optional)
?search=string                             (optional — searches name and short_title)
```

**Response 200:** `Project[]`

**MSW handler:**
```typescript
rest.get('/api/projects', (req, res, ctx) => {
  const status = req.url.searchParams.get('status')
  let result = projects
  if (status) result = result.filter(p => p.status === status)
  return res(ctx.delay(200), ctx.json(result))
})
```

---

### `GET /projects/:projectId`

Returns a single project with team members.

**Response 200:** `Project` (includes `team: TeamMember[]`)

**Errors:** 404

**MSW handler:**
```typescript
rest.get('/api/projects/:projectId', (req, res, ctx) => {
  const project = projects.find(p => p.id === req.params.projectId)
  return project
    ? res(ctx.delay(150), ctx.json(project))
    : res(ctx.status(404), ctx.json({ error: 'Project not found' }))
})
```

---

### `POST /projects`

Creates a new project.

**Request body:**
```typescript
{
  name:                 string    // NN
  shortTitle:           string    // NN
  client:               string    // NN
  therapeuticArea:      string    // NN
  phase?:               string
  startDate:            string    // NN — ISO date "2024-03-14"
  submissionCountries?: string[]  // e.g. ['US', 'EU'] — determines whether §16.4 is mandatory (FR-A-003)
  description?:         string
}
```

**Response 201:** `Project`

**Errors:** 400, 422

**MSW handler:**
```typescript
rest.post('/api/projects', async (req, res, ctx) => {
  const body = await req.json()
  const newProject: Project = {
    id: crypto.randomUUID(),
    status: 'initiated',
    activeModules: [],
    team: [],
    dataCutoff: undefined,
    ...body,
  }
  return res(ctx.delay(500), ctx.status(201), ctx.json(newProject))
})
```

---

## 3. Documents

### `POST /projects/:projectId/documents/upload`

Uploads an existing document file and returns AI auto-classification results. Used by Screen 08 (Auto-Classification). The document is **not yet created** — the user reviews the classification and confirms or overrides before creation.

**Request:** `multipart/form-data`
```
file:        File    // NN — PDF, DOCX, or DOC
projectId:   string  // NN — path parameter
```

**Response 200:**
```typescript
{
  uploadId:    string   // temporary ID for the pending upload
  fileName:    string
  fileSizeMB:  number
  virusScanStatus: 'passed' | 'failed' | 'pending'
  classification: {
    documentType:       DocumentType  // detected type
    typeConfidence:     number        // 0–100
    studyTitle:         string        // detected study
    studyConfidence:    number
    version:            string        // detected version
    versionConfidence:  number
    therapeuticArea:    string        // detected TA
    taConfidence:       number
    frameworks:         string[]      // detected frameworks e.g. ["ICH E6(R3)", "21 CFR Part 11"]
  }
}
```

**Errors:** 400 (unsupported file type), 413 (file too large — max 50MB), 422 (virus scan failed)

**MSW handler:**
```typescript
rest.post('/api/projects/:projectId/documents/upload', async (req, res, ctx) => {
  // Phase 1: simulate upload + classification delay
  await new Promise(r => setTimeout(r, 1500))
  return res(ctx.json({
    uploadId: 'upload-' + crypto.randomUUID(),
    fileName: 'GBC-4471_Protocol_v3.2_FINAL.pdf',
    fileSizeMB: 2.4,
    virusScanStatus: 'passed',
    classification: {
      documentType: 'protocol',         typeConfidence: 97,
      studyTitle:   'VELORA-301',       studyConfidence: 99,
      version:      'v3.2',             versionConfidence: 94,
      therapeuticArea: 'Oncology',      taConfidence: 99,
      frameworks: ['ICH E6(R3)', 'ICH E8(R1)', '21 CFR Part 11'],
    }
  }))
})
```

---

### `POST /projects/:projectId/documents/confirm-classification`

Confirms (or overrides) the auto-classification and creates the document record. Called after the user reviews Screen 08.

**Request body:**
```typescript
{
  uploadId:        string        // NN — from the upload response
  documentType:    DocumentType  // NN — confirmed or overridden
  title:           string        // NN
  version:         string        // NN
  therapeuticArea: string        // NN
  assigneeId:      string        // NN
  overrides:       string[]      // fields the user manually corrected, e.g. ["documentType"]
}
```

**Response 201:** `Document`

**Side effects:**
- Creates `document` record
- Creates `checklist_instance` from current master template
- Creates `audit_entry` with event_type `document_created`
- If any `overrides` present: creates additional `audit_entry` noting which fields were manually corrected

**MSW handler:**
```typescript
rest.post('/api/projects/:projectId/documents/confirm-classification', async (req, res, ctx) => {
  const body = await req.json()
  return res(ctx.delay(400), ctx.status(201), ctx.json({
    id: 'DOC-004',
    projectId: req.params.projectId,
    status: 'not-started',
    stage: 'study-start-up',
    version: body.version,
    therapeuticArea: body.therapeuticArea,
    updatedAt: new Date().toISOString(),
    sections: [],
    ...body,
  }))
})
```

---

Returns all documents for a project.

**Query parameters:**
```
?stage=study-start-up|during-study|...  (optional)
?status=in-authoring|in-review|...      (optional)
?type=csr-full|protocol|...             (optional)
```

**Response 200:** `Document[]`

**MSW handler:**
```typescript
rest.get('/api/projects/:projectId/documents', (req, res, ctx) =>
  res(ctx.delay(200), ctx.json(documents))
)
```

---

### `GET /documents/:documentId`

Returns a single document with its sections.

**Response 200:** `Document` (includes `sections: Section[]`)

**Errors:** 404

**MSW handler:**
```typescript
rest.get('/api/documents/:documentId', (req, res, ctx) => {
  const doc = documents.find(d => d.id === req.params.documentId)
  return doc
    ? res(ctx.delay(150), ctx.json(doc))
    : res(ctx.status(404), ctx.json({ error: 'Document not found' }))
})
```

---

### `POST /projects/:projectId/documents`

Creates a new document.

**Request body:** `CreateDocumentBody`
```typescript
{
  type:                   DocumentType  // NN
  title:                  string        // NN
  templateId?:            string
  assigneeId:             string        // NN
  targetCompletionDate?:  string        // ISO date
  description?:           string
}
```

**Response 201:** `Document`

**Side effects:**
- Creates a `checklist_instance` from the current master checklist template for this document type
- Creates an `audit_entry` with event_type `document_created`

**Errors:** 400, 404 (project not found), 403 (not a project member)

**MSW handler:**
```typescript
rest.post('/api/projects/:projectId/documents', async (req, res, ctx) => {
  const body = await req.json()
  const newDoc: Document = {
    id: `DOC-00${documents.length + 1}`,
    projectId: req.params.projectId as string,
    status: 'not-started',
    stage: 'study-start-up',
    therapeuticArea: 'Oncology',
    version: 'v0.1',
    updatedAt: new Date().toISOString(),
    sections: [],
    ...body,
  }
  return res(ctx.delay(600), ctx.status(201), ctx.json(newDoc))
})
```

---

### `PATCH /documents/:documentId/sections/:sectionId`

Updates the content of a specific section. Creates a new document version if content changed.

**Request body:** `UpdateSectionBody`
```typescript
{
  content:      string   // NN — rich text HTML
  sectionId:    string   // NN
  aiDrafted?:   boolean
  aiModel?:     string   // required if aiDrafted = true
  sourceDocs?:  string[] // cited sources
}
```

**Response 200:** `Document` (with updated `sections`)

**Side effects:**
- Creates a new `document_version` if content differs from current version
- Creates a `provenance_record` for the span
- Creates an `audit_entry` with event_type `section_edited` or `ai_draft_accepted`

**Errors:** 404, 403, 409 (section locked by another user)

**MSW handler:**
```typescript
rest.patch('/api/documents/:documentId/sections/:sectionId', async (req, res, ctx) => {
  const body = await req.json()
  // Phase 1: return updated document with new content
  const doc = documents.find(d => d.id === req.params.documentId)
  return res(ctx.delay(300), ctx.json({
    ...doc,
    updatedAt: new Date().toISOString(),
    version: 'v0.4',
  }))
})
```

---

### `GET /documents/:documentId/versions`

Returns the version history for a document.

**Response 200:** `DocumentVersion[]` (sorted newest first)

**MSW handler:**
```typescript
rest.get('/api/documents/:documentId/versions', (req, res, ctx) =>
  res(ctx.delay(150), ctx.json([
    { id: 'v4', versionNumber: 'v0.4', label: 'Draft', createdBy: 'Marcus Webb',
      createdAt: '2024-10-22T09:14:33Z', isCurrent: true,
      contentHash: '3a9f...c4d2' },
    { id: 'v3', versionNumber: 'v0.3', label: 'Draft', createdBy: 'Marcus Webb',
      createdAt: '2024-10-18T11:05:44Z', isCurrent: false,
      contentHash: '2b8e...d3c1' },
  ]))
)
```

---

### `POST /documents/:documentId/restore`

Restores selected sections from a prior version, creating a new version.

**Request body:** `RestoreSectionsBody`
```typescript
{
  sections: Array<{
    sectionId:     string  // NN
    fromVersionId: string  // NN — source version UUID
  }>
  reason: string  // NN — mandatory per FR-A-029b
}
```

**Response 201:** `Document` (the new version)

**Side effects:**
- Creates a new `document_version` with `restore_source` populated
- Creates a `version_restore_job` record
- Creates an `audit_entry` for each restored section

**Errors:** 400 (missing reason), 404, 422 (source version not found)

**MSW handler:**
```typescript
rest.post('/api/documents/:documentId/restore', async (req, res, ctx) => {
  const { sections, reason } = await req.json()
  return res(ctx.delay(800), ctx.status(201), ctx.json({
    ...documents[0],
    version: 'v0.5',
    updatedAt: new Date().toISOString(),
  }))
})
```

---

### `POST /documents/:documentId/submit-for-review`

Submits a document for cross-functional review. Transitions status to `in-review`.

**Request body:** `SubmitForReviewBody`
```typescript
{
  reviewType: 'parallel' | 'sequential'  // NN
  reviewers: Array<{
    userId: string    // NN
    raci:   RACIRole  // NN
  }>
  dueDate: string  // NN — ISO date
}
```

**Response 200:** `Document` (status updated to `'in-review'`)

*Note: When a CRM meeting is subsequently created via `POST /documents/:documentId/crm`, the document status transitions to `'crm-in-progress'`. The Portfolio Dashboard (Screen 22) and Clinical Writing Home (Screen 06) must handle all six status values: `'not-started'`, `'in-authoring'`, `'in-review'`, `'crm-in-progress'`, `'pending-signature'`, `'signed'`.*

**Side effects:**
- Updates `document.status` to `'in-review'`
- Updates `document.submitted_for_review_at`
- Creates `audit_entry` with event_type `document_submitted_for_review`
- Creates `audit_entry` for each `reviewer_assigned`
- Sends notifications to all assigned reviewers (Phase 2 — email)

**Errors:** 400, 403, 422 (document not in `in-authoring` status)

**MSW handler:**
```typescript
rest.post('/api/documents/:documentId/submit-for-review', async (req, res, ctx) => {
  const doc = documents.find(d => d.id === req.params.documentId)
  return res(ctx.delay(500), ctx.json({
    ...doc,
    status: 'in-review',
    updatedAt: new Date().toISOString(),
  }))
})
```

---

## 4. Checklist

### `GET /documents/:documentId/checklist`

Returns the checklist instance for a document.

**Response 200:** `ChecklistItem[]`

**MSW handler:**
```typescript
rest.get('/api/documents/:documentId/checklist', (req, res, ctx) =>
  res(ctx.delay(100), ctx.json(checklist))
)
```

---

### `PATCH /documents/:documentId/checklist/:itemId/complete`

Marks a checklist item as complete.

**Request body:** `CompleteItemBody`
```typescript
{
  completedBy: string  // NN — user ID
}
```

**Response 200:** `ChecklistItem` (status updated to `'complete'`)

**Side effects:**
- Creates `audit_entry` with event_type `checklist_item_completed`

**Errors:** 404, 409 (item already complete or waived)

**MSW handler:**
```typescript
rest.patch('/api/documents/:documentId/checklist/:itemId/complete', async (req, res, ctx) => {
  const body = await req.json()
  const item = checklist.find(i => i.id === req.params.itemId)
  return res(ctx.delay(200), ctx.json({
    ...item,
    status: 'complete',
    completedBy: body.completedBy,
    completedAt: new Date().toISOString(),
  }))
})
```

---

### `PATCH /documents/:documentId/checklist/:itemId/waive`

Waives a checklist item. Framework Mandatory items trigger a warning but can be waived.

**Request body:** `WaiveItemBody`
```typescript
{
  waivedBy: string  // NN — user ID
  reason:   string  // NN — mandatory for all waivers
}
```

**Response 200:** `ChecklistItem` (status updated to `'waived'`)

**Side effects:**
- Creates `audit_entry` with event_type `checklist_item_waived`, including framework flag and reason
- If `frameworkMandatory = true`, adds to Compliance Summary (FR-A-001d)

**Errors:** 400 (missing reason), 404

**MSW handler:**
```typescript
rest.patch('/api/documents/:documentId/checklist/:itemId/waive', async (req, res, ctx) => {
  const { waivedBy, reason } = await req.json()
  const item = checklist.find(i => i.id === req.params.itemId)
  return res(ctx.delay(300), ctx.json({
    ...item,
    status: 'waived',
    waivedBy,
    waivedAt: new Date().toISOString(),
    waiverReason: reason,
  }))
})
```

---

### `POST /documents/:documentId/checklist`

Adds a user-defined checklist item (not from master template).

**Request body:**
```typescript
{
  text:      string  // NN
  framework: string  // NN — e.g. "Custom"
}
```

**Response 201:** `ChecklistItem`

**MSW handler:**
```typescript
rest.post('/api/documents/:documentId/checklist', async (req, res, ctx) => {
  const body = await req.json()
  return res(ctx.delay(200), ctx.status(201), ctx.json({
    id: crypto.randomUUID(),
    templateItemId: null,
    framework: body.framework || 'Custom',
    frameworkMandatory: false,
    status: 'pending',
    isUserAdded: true,
    text: body.text,
  }))
})
```

---

## 5. Comments

### `GET /documents/:documentId/comments`

Returns all comments for a document.

**Query parameters:**
```
?status=open|resolved    (optional)
?sectionRef=§11.4.1      (optional)
?severity=major|minor|query  (optional)
```

**Response 200:** `Comment[]` (sorted newest first)

**MSW handler:**
```typescript
rest.get('/api/documents/:documentId/comments', (req, res, ctx) =>
  res(ctx.delay(150), ctx.json(comments))
)
```

---

### `POST /documents/:documentId/comments`

Adds a new comment to a specific document section.

**Request body:** `AddCommentBody`
```typescript
{
  sectionRef: string          // NN — e.g. "§11.4.1"
  text:       string          // NN
  severity:   CommentSeverity // NN — 'major'|'minor'|'query'
}
```

**Response 201:** `Comment`

**Side effects:**
- Generates CMT-### ID (application-side, sequential per document)
- Creates `audit_entry` with event_type `comment_added`

**MSW handler:**
```typescript
rest.post('/api/documents/:documentId/comments', async (req, res, ctx) => {
  const body = await req.json()
  const newComment: Comment = {
    id: `CMT-0${String(comments.length + 45).padStart(2, '0')}`,
    documentId: req.params.documentId as string,
    reviewerId: 'user-EV',
    reviewerName: 'Dr. Elena Vasquez',
    reviewerInitials: 'EV',
    status: 'open',
    createdAt: new Date().toISOString(),
    age: 'Just now',
    ...body,
  }
  return res(ctx.delay(300), ctx.status(201), ctx.json(newComment))
})
```

---

### `PATCH /documents/:documentId/comments/:commentId/resolve`

Resolves a comment. Comments are never deleted.

**Request body:** `ResolveCommentBody`
```typescript
{
  resolutionType: ResolutionType  // NN — 'accept'|'accept_with_modification'|'reject'
  note:           string          // NN — resolution rationale
}
```

**Response 200:** `Comment` (status updated to `'resolved'`)

**Side effects:**
- Creates `audit_entry` with event_type `comment_resolved`

**Errors:** 404, 409 (already resolved)

**MSW handler:**
```typescript
rest.patch('/api/documents/:documentId/comments/:commentId/resolve', async (req, res, ctx) => {
  const body = await req.json()
  const comment = comments.find(c => c.id === req.params.commentId)
  return res(ctx.delay(300), ctx.json({
    ...comment,
    status: 'resolved',
    resolved_by: 'user-MW',
    resolved_at: new Date().toISOString(),
    resolution_note: body.note,
  }))
})
```

---

## 6. Audit Trail

### `GET /documents/:documentId/audit`

Returns the audit trail for a document.

**Query parameters:**
```
?eventType=section_edited|ai_draft_generated|...  (optional)
?actorId=uuid                                      (optional)
?from=2024-10-01T00:00:00Z                         (optional — ISO timestamp)
?to=2024-10-31T23:59:59Z                           (optional)
?limit=50                                           (optional — default 50, max 200)
?offset=0                                           (optional)
```

**Response 200:**
```typescript
{
  entries: AuditEntry[]
  total:   number        // total matching entries (for pagination)
  limit:   number
  offset:  number
}
```

**MSW handler:**
```typescript
rest.get('/api/documents/:documentId/audit', (req, res, ctx) =>
  res(ctx.delay(200), ctx.json({
    entries: auditTrail,
    total: auditTrail.length,
    limit: 50,
    offset: 0,
  }))
)
```

---

## 7. Voice Notes

### `GET /documents/:documentId/voice-notes`

Returns all voice notes for a document.

**Query parameters:**
```
?sectionRef=§11.4.1  (optional)
```

**Response 200:** `VoiceNote[]`

**MSW handler:**
```typescript
rest.get('/api/documents/:documentId/voice-notes', (req, res, ctx) =>
  res(ctx.delay(100), ctx.json([]))  // empty in prototype — no pre-recorded notes
)
```

---

### `POST /documents/:documentId/voice-notes`

Saves a voice note with its transcript.

**Request body:**
```typescript
{
  sectionRef:           string  // NN
  audioBase64:          string  // NN — base64-encoded audio (Phase 1: stored in memory)
  transcript:           string  // NN — from transcription engine
  durationSeconds:      number  // NN
  transcriptionEngine:  string  // NN — 'claude-audio'|'whisper'|'google-stt'
}
```

**Response 201:** `VoiceNote`

**Side effects:**
- Stores audio (Phase 2: S3 with region enforcement per NFR §8.3)
- Creates `audit_entry` with event_type `voice_note_added`

**MSW handler:**
```typescript
rest.post('/api/documents/:documentId/voice-notes', async (req, res, ctx) => {
  const body = await req.json()
  return res(ctx.delay(400), ctx.status(201), ctx.json({
    id: crypto.randomUUID(),
    documentId: req.params.documentId,
    authorId: 'user-MW',
    audioRef: 'blob:mock-audio-url',
    audioRegion: 'us-east-1',
    transcriptStatus: 'complete',
    createdAt: new Date().toISOString(),
    insertedAt: null,
    ...body,
  }))
})
```

---

## 8. AI

### `POST /documents/:documentId/ai-suggest`

Requests an AI draft suggestion for a document section.

**Request body:** `AISuggestBody`
```typescript
{
  sectionId: string   // NN
  prompt?:   string   // optional user instruction
  context?:  string   // optional additional context
}
```

**Response 200:** `AISuggestion`
```typescript
{
  text:        string    // suggested text
  sources:     string[]  // cited sources (e.g. ["Table 14.2.1", "SAP v2.0 §6.3"])
  model:       string    // "claude-sonnet"
  generatedAt: string    // timestamp
}
```

**Errors:** 503 (AI engine unavailable)

**MSW handler:**
```typescript
rest.post('/api/documents/:documentId/ai-suggest', async (req, res, ctx) => {
  // Simulate AI thinking time
  await ctx.delay(1200)
  return res(ctx.json({
    text: "The Kaplan–Meier analysis demonstrated robust separation of PFS curves between the Veloricept combination arm and control from Week 8, with the hazard ratio of 0.61 indicating a 39% reduction in the risk of progression or death.",
    sources: ['Table 14.2.1', 'SAP v2.0 §6.3', 'KM Analysis Dataset'],
    model: 'claude-sonnet',
    generatedAt: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' UTC',
  }))
})
```

---

### `POST /documents/:documentId/ai-accept`

Records acceptance of an AI suggestion. Creates a provenance record.

**Request body:** `AcceptSuggestionBody`
```typescript
{
  sectionId:   string    // NN
  text:        string    // NN — the accepted text (may differ from original suggestion after editing)
  model:       string    // NN
  sources:     string[]  // NN
  generatedAt: string    // NN
}
```

**Response 200:** `Document`

**Side effects:**
- Creates `provenance_record` linking the span to the AI model and sources
- Creates `audit_entry` with event_type `ai_draft_accepted`

**MSW handler:**
```typescript
rest.post('/api/documents/:documentId/ai-accept', async (req, res, ctx) => {
  const doc = documents.find(d => d.id === req.params.documentId)
  return res(ctx.delay(200), ctx.json({
    ...doc,
    updatedAt: new Date().toISOString(),
  }))
})
```

---

## 9. E-Signature

### `GET /documents/:documentId/signature-chain`

Returns the current signature chain for a document.

**Response 200:** `SignatureRecord[]` (sorted by `step` ascending)

**MSW handler:**
```typescript
rest.get('/api/documents/:documentId/signature-chain', (req, res, ctx) =>
  res(ctx.delay(150), ctx.json(signatureChain))
)

// signatureChain mock data shape (data/signatureChain.json):
// [
//   { id: 'SIG-0417-JO', signer: 'Dr. James Okonkwo', initials: 'JO',
//     role: 'PV Lead', meaning: 'reviewed', status: 'signed', step: 1,
//     timestamp: '2024-10-28T15:32:07Z', authMethod: 'password re-auth + TOTP',
//     documentHash: '3a9f...c4d2', version_at_signing: 'v0.4' },
//   { id: 'SIG-0418-MW', signer: 'Marcus Webb', initials: 'MW',
//     role: 'Lead Clinical Writer', meaning: 'authored', status: 'awaiting', step: 2 },
//   { id: 'SIG-0419-EV', signer: 'Dr. Elena Vasquez', initials: 'EV',
//     role: 'Regulatory Affairs', meaning: 'reviewed', status: 'queued', step: 3 },
//   { id: 'SIG-0420-SC', signer: 'Dr. Sarah Chen', initials: 'SC',
//     role: 'Clinical PM', meaning: 'approved', status: 'queued', step: 4 },
// ]
```

---

### `POST /documents/:documentId/sign`

Records the authenticated user's signature. Advances the chain.

**Request body:** `SignDocumentBody`
```typescript
{
  meaning:        SignatureMeaning  // NN — 'authored'|'reviewed'|'approved'
  credentialHash: string           // NN — SHA-256 of password (never plaintext)
  scope?:         string[]         // section IDs attested (null = whole document)
}
```

**Response 200:** `SignatureRecord` (the created record)

**Side effects:**
- Creates `signature_record` with full 11-field Part 11 data
- Creates `audit_entry` with event_type `document_signed`
- If all chain steps complete: updates `document.status` to `'signed'`, sets `document.watermarked = false`, bumps version to `v1.0` (the final signed version number)
- If sequential chain: notifies next signer

**Errors:** 400, 401 (credential mismatch), 403 (not a chain participant), 422 (chain not in progress, or step not yet reached)

**MSW handler:**
```typescript
rest.post('/api/documents/:documentId/sign', async (req, res, ctx) => {
  const { meaning } = await req.json()
  const newRecord: SignatureRecord = {
    id: 'SIG-0418-MW',
    signer: 'Marcus Webb',
    initials: 'MW',
    role: 'Lead Clinical Writer',
    meaning,
    status: 'signed',
    step: 2,
    timestamp: new Date().toISOString(),
    authMethod: 'password re-auth + TOTP',
    documentHash: '3a9f...c4d2',
    version_at_signing: 'v0.4',  // version that was signed
  }
  return res(ctx.delay(600), ctx.json(newRecord))
})
```

---

## 10. CRM

### `GET /documents/:documentId/crm`

Returns the CRM meetings for a document.

**Response 200:** `CRMMeeting[]`

**MSW handler:**
```typescript
rest.get('/api/documents/:documentId/crm', (req, res, ctx) =>
  res(ctx.delay(150), ctx.json([crmMeeting]))
)
```

---

### `POST /documents/:documentId/crm`

Creates a new CRM meeting for a document.

**Request body:**
```typescript
{
  chairId:       string    // NN
  attendeeIds:   string[]  // NN
  scheduledDate: string    // NN — ISO date
  startTime:     string    // NN — "14:00 UTC"
  endTime:       string    // NN — "15:30 UTC"
}
```

**Response 201:** `CRMMeeting`

**Side effects:**
- Generates meeting_ref "CRM-###" (sequential per document)
- Creates `audit_entry` with event_type `crm_meeting_started`
- Updates `document.status` to `'crm-in-progress'`

**Errors:** 400, 403, 422 (document not in `in-review` status)

**MSW handler:**
```typescript
rest.post('/api/documents/:documentId/crm', async (req, res, ctx) => {
  const body = await req.json()
  return res(ctx.delay(400), ctx.status(201), ctx.json({
    ...crmMeeting,
    id: crypto.randomUUID(),
    documentId: req.params.documentId as string,
    meetingRef: 'CRM-001',
    status: 'in_progress',
    startedAt: new Date().toISOString(),
    resolvedIds: [],
    activeId: null,
    pendingIds: ['CMT-041', 'CMT-042', 'CMT-044'],
    ...body,
  }))
})
```

---

### `PATCH /crm/:meetingId/resolve`

Logs a resolution for a comment within a CRM meeting.

**Request body:**
```typescript
{
  commentId:      string              // NN
  resolutionType: CRMResolutionType   // NN
  note:           string              // NN
}
```

**Response 200:**
```typescript
{
  meeting:    CRMMeeting
  resolution: CRMResolution
}
```

**Side effects:**
- Creates `crm_resolution` record
- Updates `comment.status` to `'resolved'`
- Creates `audit_entry` with event_type `crm_resolution_logged`

**MSW handler:**
```typescript
rest.patch('/api/crm/:meetingId/resolve', async (req, res, ctx) => {
  const body = await req.json()
  return res(ctx.delay(400), ctx.json({
    meeting: { ...crmMeeting, resolvedIds: [...crmMeeting.resolvedIds, body.commentId] },
    resolution: {
      id: crypto.randomUUID(),
      meetingId: req.params.meetingId,
      ...body,
      resolvedBy: 'user-MW',
      resolvedAt: new Date().toISOString(),
    }
  }))
})
```

---

## 11. Reference Tools

### `GET /documents/:documentId/tlf`

Returns the TLF package linked to the document's project, with section linkage data.

**Response 200:**
```typescript
{
  package: {
    version:       string
    validatedBy:   string
    validatedDate: string
  }
  items: Array<TLFItem & {
    referenceCount: number   // times cited in current document
  }>
}
```

**MSW handler:**
```typescript
rest.get('/api/documents/:documentId/tlf', (req, res, ctx) =>
  res(ctx.delay(150), ctx.json(tlf))
)
```

---

### `GET /meddra/search`

Searches MedDRA terms. Phase 1: filters mock subset. Phase 2: queries `meddra_terms` table.

**Query parameters:**
```
?q=pneumonitis    (NN — search term, min 3 chars)
?version=27.0     (optional — defaults to current)
?limit=10         (optional — default 10, max 50)
```

**Response 200:**
```typescript
{
  version: string
  results: MedDRATerm[]
}
```

**Errors:** 400 (query too short), 503 (subscription not active)

**MSW handler:**
```typescript
rest.get('/api/meddra/search', (req, res, ctx) => {
  const q = req.url.searchParams.get('q')?.toLowerCase() || ''
  const results = meddra.searchResults.filter(t =>
    t.pt.toLowerCase().includes(q) || t.soc.toLowerCase().includes(q)
  )
  return res(ctx.delay(300), ctx.json({ version: '27.0', results }))
})
```

---

### `GET /documents/:documentId/ich-e3`

Returns ICH E3 compliance status for all 18 mandatory sections.

**Response 200:**
```typescript
{
  completionPercent: number       // 0–100
  completeSections:  number
  totalSections:     number       // always 18
  sections:          ICHSection[]
}
```

**MSW handler:**
```typescript
rest.get('/api/documents/:documentId/ich-e3', (req, res, ctx) =>
  res(ctx.delay(100), ctx.json({
    completionPercent: 61,
    completeSections: 11,
    totalSections: 18,
    sections: ichSections,
  }))
)
```

---

## 12. Presence

### `POST /documents/:documentId/presence`

Registers or updates the authenticated user's presence in a section. Called every 15 seconds.

**Request body:**
```typescript
{
  sectionId: string           // NN
  status:    PresenceStatus   // NN — 'active'|'locked'|'idle'
}
```

**Response 200:**
```typescript
{
  activeSessions: Array<{
    userId:    string
    sectionId: string
    status:    PresenceStatus
    initials:  string
    colourKey: string
  }>
}
```

**Notes:** Phase 1 — MSW returns the hardcoded presence state (MW on §11.4, JO locked on §12.2). Phase 2 — Socket.io replaces this polling endpoint entirely.

**MSW handler:**
```typescript
rest.post('/api/documents/:documentId/presence', (req, res, ctx) =>
  res(ctx.delay(50), ctx.json({
    activeSessions: [
      { userId: 'user-MW', sectionId: '11.4', status: 'active',  initials: 'MW', colourKey: 'MW' },
      { userId: 'user-JO', sectionId: '12.2', status: 'locked',  initials: 'JO', colourKey: 'JO' },
      { userId: 'user-EV', sectionId: null,   status: 'idle',    initials: 'EV', colourKey: 'EV' },
    ]
  }))
)
```

---

### `DELETE /documents/:documentId/presence`

Ends the authenticated user's presence session (called on unmount or tab close).

**Response 200:** `{}`

**MSW handler:**
```typescript
rest.delete('/api/documents/:documentId/presence', (req, res, ctx) =>
  res(ctx.delay(50), ctx.json({}))
)
```

---

## 13. QA Review

### `GET /documents/:documentId/qa-review`

Returns the QA review status for a document (FR-A-065a).

**Response 200:**
```typescript
{
  cadenceDays:     number      // Admin-configured — default 30
  lastReviewedAt:  string | null
  lastReviewedBy:  string | null
  nextDueAt:       string
  isOverdue:       boolean
  daysOverdue:     number      // 0 if not overdue
  reviewHistory:   Array<{
    reviewedAt: string
    reviewedBy: string
    auditEntryId: string
  }>
}
```

**MSW handler:**
```typescript
rest.get('/api/documents/:documentId/qa-review', (req, res, ctx) =>
  res(ctx.delay(100), ctx.json({
    cadenceDays: 30,
    lastReviewedAt: '2024-09-28T00:00:00Z',
    lastReviewedBy: 'Dr. Linda Park',
    nextDueAt: '2024-10-28T00:00:00Z',
    isOverdue: true,
    daysOverdue: 0,
    reviewHistory: [],
  }))
)
```

---

### `POST /documents/:documentId/qa-review`

Logs a completed QA review event (FR-A-065a).

**Request body:**
```typescript
{
  reviewedBy:  string    // NN — user ID
  notes?:      string    // optional review notes
}
```

**Response 201:**
```typescript
{
  auditEntryId: string   // the created audit trail entry ID
  nextDueAt:    string   // next review due date
}
```

**Side effects:**
- Creates `audit_entry` with event_type `qa_review_completed`
- Clears the overdue alert for this document

**Errors:** 400 (missing reviewedBy), 403 (not a QA role)

**MSW handler:**
```typescript
rest.post('/api/documents/:documentId/qa-review', async (req, res, ctx) => {
  const { reviewedBy } = await req.json()
  const nextDue = new Date()
  nextDue.setDate(nextDue.getDate() + 30)
  return res(ctx.delay(300), ctx.status(201), ctx.json({
    auditEntryId: crypto.randomUUID(),
    nextDueAt: nextDue.toISOString(),
  }))
})
```

---

## 14. Complete MSW Setup

All handlers combined for `mocks/browser.ts`:

```typescript
// mocks/browser.ts
import { setupWorker } from 'msw'

// Import all handler groups
import { authHandlers }     from './handlers/auth'
import { projectHandlers }  from './handlers/projects'
import { documentHandlers } from './handlers/documents'
import { checklistHandlers }from './handlers/checklist'
import { commentHandlers }  from './handlers/comments'
import { auditHandlers }    from './handlers/audit'
import { aiHandlers }       from './handlers/ai'
import { signatureHandlers }from './handlers/signatures'
import { crmHandlers }      from './handlers/crm'
import { referenceHandlers }from './handlers/reference'
import { presenceHandlers } from './handlers/presence'
import { qaHandlers }       from './handlers/qa'

export const worker = setupWorker(
  ...authHandlers,
  ...projectHandlers,
  ...documentHandlers,
  ...checklistHandlers,
  ...commentHandlers,
  ...auditHandlers,
  ...aiHandlers,
  ...signatureHandlers,
  ...crmHandlers,
  ...referenceHandlers,
  ...presenceHandlers,
  ...qaHandlers,
)
```

**Handler file structure:**
```
/src/mocks/
  browser.ts                ← worker setup (above)
  /handlers/
    auth.ts                 ← POST /auth/login, /auth/mfa, GET /auth/me, POST /auth/logout
    projects.ts             ← GET/POST /projects, GET /projects/:id
    documents.ts            ← GET/POST /documents, PATCH /sections, GET/POST /versions, POST /restore, POST /submit-for-review, POST /upload, POST /confirm-classification
    checklist.ts            ← GET checklist, PATCH complete/waive, POST add item
    comments.ts             ← GET/POST comments, PATCH resolve
    audit.ts                ← GET audit trail
    voice-notes.ts          ← GET/POST voice notes
    ai.ts                   ← POST ai-suggest, POST ai-accept
    signatures.ts           ← GET signature-chain, POST sign
    crm.ts                  ← GET/POST crm, PATCH crm/:meetingId/resolve
    reference.ts            ← GET tlf, GET meddra/search, GET ich-e3
    presence.ts             ← POST/DELETE presence
    qa.ts                   ← GET/POST qa-review
```

---

## 15. Endpoint Index

| Method | Path | Section | Screen(s) |
|--------|------|---------|-----------|
| POST | `/auth/login` | §1 | Sign-in (01a) |
| POST | `/auth/mfa` | §1 | MFA (01b) |
| GET | `/auth/me` | §1 | All authenticated screens |
| POST | `/auth/logout` | §1 | Any screen |
| GET | `/projects` | §2 | All Projects (03) |
| GET | `/projects/:id` | §2 | Project Dashboard (05) |
| POST | `/projects` | §2 | New Project Wizard (04) |
| POST | `/projects/:id/documents/upload` | §3 | Auto-Classification (08) — upload step |
| POST | `/projects/:id/documents/confirm-classification` | §3 | Auto-Classification (08) — confirm step |
| GET | `/projects/:id/documents` | §3 | Clinical Writing Home (06), Portfolio Dashboard (22) |
| GET | `/documents/:id` | §3 | Document Editor (09), Final Document (21) |
| POST | `/projects/:id/documents` | §3 | New Document Drawer (07) |
| PATCH | `/documents/:id/sections/:sectionId` | §3 | Document Editor (09) |
| GET | `/documents/:id/versions` | §3 | Diff View (24) |
| POST | `/documents/:id/restore` | §3 | Diff View (24) |
| POST | `/documents/:id/submit-for-review` | §3 | Review Assignment (15) |
| GET | `/documents/:id/checklist` | §4 | Checklist Panel (13) |
| PATCH | `/documents/:id/checklist/:itemId/complete` | §4 | Checklist Panel (13) |
| PATCH | `/documents/:id/checklist/:itemId/waive` | §4 | Checklist Panel (13) |
| POST | `/documents/:id/checklist` | §4 | Checklist Panel (13) |
| GET | `/documents/:id/comments` | §5 | Comments Dashboard (17), Reviewer View (16) |
| POST | `/documents/:id/comments` | §5 | Reviewer View (16) |
| PATCH | `/documents/:id/comments/:commentId/resolve` | §5 | Comments Dashboard (17), CRM (18) |
| GET | `/documents/:id/audit` | §6 | Audit Trail Panel (14), Audit Review Alert (23) |
| GET | `/documents/:id/voice-notes` | §7 | Voice Note Panel (12) |
| POST | `/documents/:id/voice-notes` | §7 | Voice Note Panel (12) |
| POST | `/documents/:id/ai-suggest` | §8 | AI Panel (09, 10) |
| POST | `/documents/:id/ai-accept` | §8 | AI Panel (09) |
| GET | `/documents/:id/signature-chain` | §9 | E-Signature (20), Final Document (21) |
| POST | `/documents/:id/sign` | §9 | E-Signature (20) |
| GET | `/documents/:id/crm` | §10 | CRM Module (18) |
| POST | `/documents/:id/crm` | §10 | CRM Module (18) |
| PATCH | `/crm/:meetingId/resolve` | §10 | CRM Module (18), Comment Resolution (19) |
| GET | `/documents/:id/tlf` | §11 | TLF Panel (27) |
| GET | `/meddra/search` | §11 | MedDRA Panel (26) |
| GET | `/documents/:id/ich-e3` | §11 | ICH E3 Panel (25) |
| POST | `/documents/:id/presence` | §12 | All editor screens (09–16, 19–21, 24–27) |
| DELETE | `/documents/:id/presence` | §12 | On component unmount |
| GET | `/documents/:id/qa-review` | §13 | Audit Review Alert (23) |
| POST | `/documents/:id/qa-review` | §13 | Audit Review Alert (23) |

**Total: 40 endpoint entries across 13 domain groups (39 unique endpoints — GET /documents/:id appears twice in the index because it serves both the Document Editor and Final Document screens).**

*Note: `:id` in this table is shorthand — use the full parameter name (`:documentId`, `:projectId`) in code. See §0 conventions for full parameter names.*

---

## 16. Document Revision History

| Version | Date | Summary |
|---------|------|---------|
| 1.0 | Sept 2026 | Initial version. 38 endpoints across 13 groups. Full request/response shapes, error codes, MSW handler patterns, and screen mapping for all 27 Module A screens. |
| 2.0 | Sept 2026 | Module B: Scientific Writing appended. §16–§29 add 30 endpoints across 14 domain groups. Endpoint index updated in §30. Path parameter table extended for Module B identifiers. |
| 4.0 | Sept 2026 | Modules D & E appended. §44–§56 add 32 Module D endpoints across 12 domain groups. §57–§65 add 20 Module E endpoints across 9 domain groups. Combined total: 153 endpoints across all five modules. Path parameter table extended. |
| 3.0 | Sept 2026 | Module C: Medical Writing appended. §30–§43 add 34 endpoints across 12 domain groups. Combined total: 103 endpoints. Path parameter table extended for Module C identifiers. |

---

## MODULE B — SCIENTIFIC WRITING
### API Contracts Appendix to v1.0

---

## Module B Path Parameters (append to §0)

| Parameter | Meaning |
|-----------|---------|
| `:publicationId` | UUID of a Publication record |
| `:authorId` | UUID of a PublicationAuthor record |
| `:citationId` | UUID of a Citation record |
| `:checkId` | UUID of a SubmissionCheck record |
| `:congressSubmissionId` | UUID of a CongressSubmission record |
| `:roundId` | UUID of a PeerReviewRound record |
| `:commentId` | UUID of a ReviewerComment record (Module B — distinct from Module A CMT-### string IDs) |

---

## 16. Publications

### `GET /projects/:projectId/publications`

Returns all publications for a project. Used by Scientific Writing Home (B01) and Portfolio Dashboard (B10).

**Query parameters:**
- `?stage` — filter by `PublicationStage` (optional)
- `?type` — filter by `PublicationType` (optional)
- `?search` — title substring match (optional)

**Response 200:**
```typescript
Publication[]
```

**MSW handler:**
```typescript
rest.get('/api/projects/:projectId/publications', (req, res, ctx) => {
  const stage = req.url.searchParams.get('stage')
  const type  = req.url.searchParams.get('type')
  const search = req.url.searchParams.get('search')?.toLowerCase()
  let results = publications
  if (stage)  results = results.filter(p => p.stage === stage)
  if (type)   results = results.filter(p => p.type === type)
  if (search) results = results.filter(p => p.title.toLowerCase().includes(search))
  return res(ctx.delay(200), ctx.json(results))
})
```

---

### `GET /publications/:publicationId`

Returns a single publication. Used by all B screens that show a specific publication.

**Response 200:**
```typescript
Publication
```

**Errors:** 404 if not found.

**MSW handler:**
```typescript
rest.get('/api/publications/:publicationId', (req, res, ctx) => {
  const pub = publications.find(p => p.id === req.params.publicationId)
  return pub
    ? res(ctx.delay(150), ctx.json(pub))
    : res(ctx.status(404), ctx.json({ error: 'Publication not found' }))
})
```

---

### `POST /projects/:projectId/publications`

Creates a new publication from the New Publication Wizard (B02).

**Request body:**
```typescript
{
  type:                  PublicationType        // NN
  subtype?:              ManuscriptSubtype      // required when type === 'manuscript'
  guideline:             EquatorGuideline       // NN
  journal?:              string
  targetSubmissionDate?: string                 // ISO date
  keyMessage?:           string
  baaStatus:             BAAStatus              // NN
  sourceDocumentId?:     string                 // UUID of linked Clinical Writing CSR
  teamRoles:             Array<{                // NN — at least one entry
    userId: string
    raci:   RACIRole
  }>
}
```

**Response 201:**
```typescript
Publication
```

**Errors:**
- 400 if `type === 'manuscript'` and `subtype` is absent
- 422 if `baaStatus === 'not_applicable'` and `subtype === 'case_report'`

**MSW handler:**
```typescript
rest.post('/api/projects/:projectId/publications', async (req, res, ctx) => {
  const body = await req.json()
  const newPub: Publication = {
    id: crypto.randomUUID(),
    projectId: req.params.projectId as string,
    stage: 'planning',
    status: 'not_started',
    version: 'v0.1',
    ownerId: 'user-mw',
    ownerInitials: 'MW',
    createdBy: 'user-mw',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...body,
  }
  return res(ctx.delay(400), ctx.status(201), ctx.json(newPub))
})
```

---

### `POST /publications/:publicationId/advance-stage`

Advances a publication to the next stage. Called when the publication manager confirms stage progression.

**Request body:** `{}` (empty — stage transition is determined server-side)

**Response 200:**
```typescript
Publication  // with updated stage and status
```

**Errors:** 422 if the publication's current stage does not permit advancement (e.g. blocking submission checks remain unresolved).

**MSW handler:**
```typescript
rest.post('/api/publications/:publicationId/advance-stage', (req, res, ctx) => {
  const pub = publications.find(p => p.id === req.params.publicationId)
  const stageOrder: PublicationStage[] = ['planning','authoring','review','submission','published']
  const next = stageOrder[stageOrder.indexOf(pub?.stage ?? 'planning') + 1] ?? 'published'
  return res(ctx.delay(300), ctx.json({ ...pub, stage: next }))
})
```

---

## 17. AI Footprint

### `GET /publications/:publicationId/footprint`

Returns the computed AI footprint summary for a publication. Used by the footprint panel in Manuscript Editor (B03).

**Response 200:**
```typescript
{
  publicationId: string
  totalChars:    number
  aiChars:       number
  humanChars:    number
  aiPercent:     number          // rounded integer 0–100
  bySection: Array<{
    sectionId:    string
    sectionLabel: string
    aiPercent:    number
  }>
  computedAt: string             // ISO timestamp
}
```

**MSW handler:**
```typescript
rest.get('/api/publications/:publicationId/footprint', (req, res, ctx) =>
  res(ctx.delay(150), ctx.json({
    publicationId: req.params.publicationId,
    totalChars: 8420, aiChars: 2863, humanChars: 5557, aiPercent: 34,
    bySection: [
      { sectionId: 'methods',    sectionLabel: 'Methods',    aiPercent: 45 },
      { sectionId: 'results',    sectionLabel: 'Results',    aiPercent: 52 },
      { sectionId: 'intro',      sectionLabel: 'Introduction', aiPercent: 0 },
      { sectionId: 'discussion', sectionLabel: 'Discussion', aiPercent: 0 },
    ],
    computedAt: new Date().toISOString(),
  }))
)
```

---

## 18. Citations

### `GET /publications/:publicationId/citations`

Returns all citations for a publication in insertion order. Vancouver label `[N]` is computed from array position by the client. Used by Literature & Citation Panel (B04). Source document citations (from Clinical Writing) carry `isSourceDocument: true` and render as source chips per OQ-B-001.

**Response 200:**
```typescript
Citation[]   // ordered by insertedAt ASC; removed citations (removed_at IS NOT NULL) excluded
```

**MSW handler:**
```typescript
rest.get('/api/publications/:publicationId/citations', (req, res, ctx) =>
  res(ctx.delay(100), ctx.json(citations))
)
```

---

### `POST /publications/:publicationId/citations`

Inserts a new citation. Triggers Vancouver renumbering (all labels recomputed by client from new array order).

**Request body:**
```typescript
{
  pmid?:             string   // absent for source documents
  title:             string   // NN
  shortRef:          string   // NN — 'Gandhi L et al., NEJM 2018'
  fullRef:           string   // NN — full Vancouver citation
  locus:             string   // NN — '§Results ¶1'
  isSourceDocument?: boolean  // default false
}
```

**Response 201:**
```typescript
Citation   // includes generated id, insertedBy, insertedAt, computed label
```

**Errors:** 409 if PMID already inserted in this publication.

**MSW handler:**
```typescript
rest.post('/api/publications/:publicationId/citations', async (req, res, ctx) => {
  const body = await req.json()
  return res(ctx.delay(300), ctx.status(201), ctx.json({
    id: crypto.randomUUID(),
    publicationId: req.params.publicationId,
    label: `[${citations.length + 1}]`,
    insertedBy: 'Marcus Webb',
    insertedAt: new Date().toISOString(),
    removedAt: null,
    ...body,
  }))
})
```

---

### `DELETE /publications/:publicationId/citations/:citationId`

Soft-removes a citation. Source document citations return 422. Client recomputes Vancouver labels after removal.

**Response 204:** No content.

**Errors:**
- 404 if citation not found
- 422 if `isSourceDocument === true` — source documents cannot be removed

**MSW handler:**
```typescript
rest.delete('/api/publications/:publicationId/citations/:citationId', (req, res, ctx) => {
  const cit = citations.find(c => c.id === req.params.citationId)
  if (cit?.isSourceDocument) {
    return res(ctx.status(422), ctx.json({ error: 'Source document citations cannot be removed while the publication is active.' }))
  }
  return res(ctx.delay(200), ctx.status(204))
})
```

---

### `GET /pubmed/search`

Proxies a PubMed keyword search. Used by Literature & Citation Panel (B04). Returns client-side filterable results.

**Query parameters:**
- `?q` — search query string (NN, minimum 3 characters)

**Response 200:**
```typescript
Array<{
  id:           string   // internal key
  pmid:         string   // 'PMID: 29658856'
  title:        string
  source:       string   // 'Gandhi L et al. · N Engl J Med · 2018'
  abstractText: string
  isInserted:   boolean  // true if PMID already in publication's citations
}>
```

**Errors:** 400 if `q` is fewer than 3 characters.

**MSW handler:**
```typescript
rest.get('/api/pubmed/search', (req, res, ctx) => {
  const q = req.url.searchParams.get('q') ?? ''
  if (q.length < 3) return res(ctx.status(400), ctx.json({ error: 'Query must be at least 3 characters.' }))
  const terms = q.toLowerCase().split(/\s+/).filter(t => t.length > 2)
  const results = PUBMED_RECORDS.filter(r =>
    terms.some(t => (r.title + ' ' + r.keys).toLowerCase().includes(t))
  ).map(r => ({ ...r, isInserted: citations.some(c => c.pmid === r.pmid) }))
  return res(ctx.delay(400), ctx.json(results))
})
```

---

## 19. Authors & ICMJE

### `GET /publications/:publicationId/authors`

Returns all authors with ICMJE criteria and COI status. Used by Author Management (B05) and New Publication Wizard step 4 (B02).

**Response 200:**
```typescript
Array<PublicationAuthor & {
  icmjeCriteria: ICMJECriterion[]         // always 4 entries
  icmjeAcknowledged: boolean
  icmjeAcknowledgedBy?: string
  icmjeAcknowledgedAt?: string
}>
```

**MSW handler:**
```typescript
rest.get('/api/publications/:publicationId/authors', (req, res, ctx) =>
  res(ctx.delay(150), ctx.json(publicationAuthors))
)
```

---

### `PATCH /publications/:publicationId/authors/:authorId/icmje`

Toggles a single ICMJE criterion for an author. Logged to audit trail.

**Request body:**
```typescript
{
  criterionIndex: 0 | 1 | 2 | 3  // NN
  met:            boolean          // NN
}
```

**Response 200:**
```typescript
ICMJECriterion   // updated criterion row
```

**MSW handler:**
```typescript
rest.patch('/api/publications/:publicationId/authors/:authorId/icmje', async (req, res, ctx) => {
  const body = await req.json()
  return res(ctx.delay(200), ctx.json({
    criterionIndex: body.criterionIndex,
    met: body.met,
    confirmedBy: body.met ? 'Marcus Webb' : undefined,
    confirmedAt: body.met ? new Date().toISOString() : undefined,
    updatedAt: new Date().toISOString(),
  }))
})
```

---

### `POST /publications/:publicationId/authors/:authorId/icmje/acknowledge`

Publication manager acknowledges a soft gate — author has incomplete ICMJE criteria but manuscript may proceed (OQ-B-003). Written to audit trail.

**Request body:**
```typescript
{
  acknowledgedBy: string  // NN — user name
}
```

**Response 200:**
```typescript
{
  icmjeAcknowledged:    true
  icmjeAcknowledgedBy:  string
  icmjeAcknowledgedAt:  string   // ISO timestamp
  missingCriteria:      number[] // e.g. [2, 3]
}
```

**MSW handler:**
```typescript
rest.post('/api/publications/:publicationId/authors/:authorId/icmje/acknowledge', async (req, res, ctx) => {
  const body = await req.json()
  return res(ctx.delay(200), ctx.json({
    icmjeAcknowledged: true,
    icmjeAcknowledgedBy: body.acknowledgedBy,
    icmjeAcknowledgedAt: new Date().toISOString(),
    missingCriteria: [2, 3],
  }))
})
```

---

### `POST /publications/:publicationId/debarment-check`

Runs an FDA/OIG debarment check against all named authors. Simulates a 1,500ms latency for the external call. Used by Author Management (B05).

**Request body:**
```typescript
{
  authorIds: string[]  // NN — UUIDs of PublicationAuthor records to check
}
```

**Response 200:**
```typescript
{
  checkedAt: string   // ISO timestamp
  results: Array<{
    authorId:   string
    authorName: string
    status:     'clear' | 'flagged'
  }>
}
```

**MSW handler:**
```typescript
rest.post('/api/publications/:publicationId/debarment-check', async (req, res, ctx) => {
  const body = await req.json()
  return res(ctx.delay(1500), ctx.json({
    checkedAt: new Date().toISOString(),
    results: body.authorIds.map((id: string) => ({
      authorId: id,
      authorName: publicationAuthors.find(a => a.id === id)?.name ?? 'Unknown',
      status: 'clear',
    })),
  }))
})
```

---

### `POST /publications/:publicationId/authors/:authorId/remind`

Sends an ICMJE/COI reminder to an author. Fire-and-forget — logs to audit trail. Used by Author Management (B05).

**Request body:** `{}` (empty)

**Response 204:** No content.

**MSW handler:**
```typescript
rest.post('/api/publications/:publicationId/authors/:authorId/remind', (req, res, ctx) =>
  res(ctx.delay(200), ctx.status(204))
)
```

---

## 20. Journal Submission Readiness

### `GET /publications/:publicationId/submission-checks`

Returns all pre-submission checks for a publication. Used by Journal Submission Readiness (B06).

**Response 200:**
```typescript
Array<{
  id:          string
  groupId:     string      // 'format'|'words'|'equator'|'figures'|'statements'|'plagiarism'|'refs'
  label:       string
  state:       CheckState  // 'pass'|'warn'|'ack'|'block'
  note:        string
  lastRunAt:   string | null
  resolvedBy?: string
  resolvedAt?: string
}>
```

**MSW handler:**
```typescript
rest.get('/api/publications/:publicationId/submission-checks', (req, res, ctx) =>
  res(ctx.delay(200), ctx.json(submissionChecks))
)
```

---

### `POST /publications/:publicationId/submission-checks/run`

Re-runs all 30 pre-submission checks. Simulates 1,600ms latency. Returns updated check array.

**Request body:** `{}` (empty)

**Response 200:**
```typescript
Array<SubmissionCheck>   // same shape as GET — all checks with updated states and lastRunAt
```

**MSW handler:**
```typescript
rest.post('/api/publications/:publicationId/submission-checks/run', (req, res, ctx) =>
  res(ctx.delay(1600), ctx.json(
    submissionChecks.map(c => ({ ...c, lastRunAt: new Date().toISOString() }))
  ))
)
```

---

### `PATCH /publications/:publicationId/submission-checks/:checkId/acknowledge`

Acknowledges an advisory check — transitions `state` from `'warn'` to `'ack'`. Used for duplicate publication confirmation (B06) and ICMJE soft-gate acknowledgement in submission readiness.

**Request body:**
```typescript
{
  acknowledgedBy: string  // NN
}
```

**Response 200:**
```typescript
{
  id:          string
  state:       'ack'
  resolvedBy:  string
  resolvedAt:  string
}
```

**MSW handler:**
```typescript
rest.patch('/api/publications/:publicationId/submission-checks/:checkId/acknowledge', async (req, res, ctx) => {
  const body = await req.json()
  return res(ctx.delay(200), ctx.json({
    id: req.params.checkId,
    state: 'ack',
    resolvedBy: body.acknowledgedBy,
    resolvedAt: new Date().toISOString(),
  }))
})
```

---

## 21. Congress Abstract Export

### `GET /publications/:publicationId/congress`

Returns the current congress submission state for a publication. Used by Congress Abstract Export (B07).

**Response 200:**
```typescript
{
  congressId:       CongressId
  congressName:     string
  characterLimit:   number
  keywordsRequired: number
  keywordsEntered:  number
  deadline:         string      // 'Deadline 01 Dec 2026'
  portalUrl:        string
  characterCount:   number      // computed from current abstract content
  status:           CongressSubmissionStatus
  exportedAt?:      string
}
```

**MSW handler:**
```typescript
rest.get('/api/publications/:publicationId/congress', (req, res, ctx) =>
  res(ctx.delay(150), ctx.json({
    congressId: 'asco', congressName: 'ASCO Annual Meeting 2027',
    characterLimit: 3000, keywordsRequired: 5, keywordsEntered: 4,
    deadline: 'Deadline 01 Dec 2026', portalUrl: 'abstract.asco.org',
    characterCount: 2847, status: 'draft', exportedAt: null,
  }))
)
```

---

### `POST /publications/:publicationId/congress/export`

Generates the export package for a congress. Logs to audit trail. Per OQ-B-004: formatted export only, no live portal API.

**Request body:**
```typescript
{
  congressId:      CongressId  // NN — may differ from current if user switched congress
  keywordsEntered: number      // NN
}
```

**Response 200:**
```typescript
{
  congressId:   CongressId
  status:       'exported'
  exportedAt:   string        // ISO timestamp
  downloadUrl:  string        // mock URL for prototype
  packageFiles: string[]      // ['abstract.docx', 'abstract.pdf', 'disclosures.pdf', 'consort.pdf', 'provenance.pdf']
}
```

**MSW handler:**
```typescript
rest.post('/api/publications/:publicationId/congress/export', async (req, res, ctx) => {
  const body = await req.json()
  return res(ctx.delay(600), ctx.json({
    congressId: body.congressId,
    status: 'exported',
    exportedAt: new Date().toISOString(),
    downloadUrl: `/mock-downloads/${body.congressId}-abstract-package.zip`,
    packageFiles: ['abstract.docx','abstract.pdf','disclosures.pdf','consort.pdf','provenance.pdf'],
  }))
})
```

---

## 22. Peer Review

### `GET /publications/:publicationId/review-rounds/latest`

Returns the most recent peer review round. Used by Peer Review Response (B08).

**Response 200:**
```typescript
{
  id:                   string
  publicationId:        string
  roundNumber:          number
  journalSubmissionRef: string   // 'NEJM-2026-28471'
  reviewerCount:        number
  createdAt:            string
}
```

**MSW handler:**
```typescript
rest.get('/api/publications/:publicationId/review-rounds/latest', (req, res, ctx) =>
  res(ctx.delay(150), ctx.json(reviewRound))
)
```

---

### `GET /review-rounds/:roundId/comments`

Returns all reviewer comments for a round, grouped by reviewer tab. Used by Peer Review Response (B08).

**Response 200:**
```typescript
ReviewerComment[]   // ordered by reviewerTab, then commentNumber ASC
```

**MSW handler:**
```typescript
rest.get('/api/review-rounds/:roundId/comments', (req, res, ctx) =>
  res(ctx.delay(100), ctx.json(reviewComments))
)
```

---

### `PATCH /review-rounds/:roundId/comments/:commentId`

Updates the response draft for a reviewer comment (auto-save on textarea blur).

**Request body:**
```typescript
{
  responseText: string   // NN — current draft text
  aiDrafted:    boolean  // NN — true if AI-assisted
}
```

**Response 200:**
```typescript
{
  id:           string
  responseText: string
  aiDrafted:    boolean
  updatedAt:    string
}
```

**MSW handler:**
```typescript
rest.patch('/api/review-rounds/:roundId/comments/:commentId', async (req, res, ctx) => {
  const body = await req.json()
  return res(ctx.delay(200), ctx.json({
    id: req.params.commentId,
    responseText: body.responseText,
    aiDrafted: body.aiDrafted,
    updatedAt: new Date().toISOString(),
  }))
})
```

---

### `POST /review-rounds/:roundId/comments/:commentId/ai-accept`

Accepts an AI-drafted response. Records AI provenance to audit trail. Simulates 1,200ms generation latency.

**Request body:**
```typescript
{
  responseText: string   // NN — the AI-generated text being accepted
  model:        string   // NN — 'claude-sonnet-4-6'
  generatedAt:  string   // NN — ISO timestamp when AI generated it
}
```

**Response 200:**
```typescript
{
  id:            string
  aiDrafted:     true
  responseText:  string
  aiModel:       string
  aiGeneratedAt: string
  aiAcceptedBy:  string
  aiAcceptedAt:  string
}
```

**MSW handler:**
```typescript
rest.post('/api/review-rounds/:roundId/comments/:commentId/ai-accept', async (req, res, ctx) => {
  const body = await req.json()
  return res(ctx.delay(1200), ctx.json({
    id: req.params.commentId,
    aiDrafted: true,
    responseText: body.responseText,
    aiModel: body.model,
    aiGeneratedAt: body.generatedAt,
    aiAcceptedBy: 'Marcus Webb',
    aiAcceptedAt: new Date().toISOString(),
  }))
})
```

---

### `PATCH /review-rounds/:roundId/comments/:commentId/complete`

Marks a comment as responded. Enables the submit button when all comments in the round are complete.

**Request body:**
```typescript
{
  respondedBy: string  // NN — user name
}
```

**Response 200:**
```typescript
{
  id:           string
  status:       'responded'
  respondedBy:  string
  respondedAt:  string
}
```

**MSW handler:**
```typescript
rest.patch('/api/review-rounds/:roundId/comments/:commentId/complete', async (req, res, ctx) => {
  const body = await req.json()
  return res(ctx.delay(200), ctx.json({
    id: req.params.commentId,
    status: 'responded',
    respondedBy: body.respondedBy,
    respondedAt: new Date().toISOString(),
  }))
})
```

---

### `POST /publications/:publicationId/response-letter`

Submits the completed response letter. All comments must be in `'responded'` status. Creates a `response_letter_versions` record.

**Request body:**
```typescript
{
  roundId:      string   // NN
  letterVersion: string  // NN — 'v1.11'
  commentResponses: Array<{
    commentId:    string
    responseText: string
    aiDrafted:    boolean
  }>
}
```

**Response 200:**
```typescript
{
  letterVersion: string
  submittedAt:   string
  auditRef:      string   // audit trail entry ID
}
```

**Errors:** 422 if any comment in the round has `status !== 'responded'`.

**MSW handler:**
```typescript
rest.post('/api/publications/:publicationId/response-letter', async (req, res, ctx) => {
  const body = await req.json()
  return res(ctx.delay(800), ctx.json({
    letterVersion: body.letterVersion,
    submittedAt: new Date().toISOString(),
    auditRef: `AE-${Date.now()}`,
  }))
})
```

---

## 23. Final Output

### `GET /publications/:publicationId/final`

Returns the complete final publication record — citation, DOI, ORCIDs, package contents, compliance provenance chain, and master library cards. Used by Final Output (B09). Per OQ-B-002: compliance provenance section included in final output only. DOI and ORCID data is provided by the Module E shared service per OQ-E-006 (CrossRef + ORCID integration owned by Module E, consumed by Module B).

**Response 200:**
```typescript
{
  publication:   Publication                  // stage = 'published', status = 'published'
  citation: {
    formatted:   string                        // full Vancouver citation string
    journal:     string
    publishedAt: string                        // '14 Jan 2027'
  }
  doi: {
    doi:          string                       // '10.1200/JCO.2026.VELORA301'
    registrar:    'crossref'
    registeredAt: string
  }
  orcids: Array<{
    authorId:   string
    name:       string
    initials:   string
    orcid:      string
    verified:   boolean
    verifiedAt: string
    avatarBg:   string
    avatarFg:   string
  }>
  packageFiles: Array<{
    name:          string
    note:          string
    crossModule:   boolean   // true = involves Clinical Writing → Scientific Writing chain (OQ-B-002)
  }>
  provenanceChain: {
    sourceRecord: Array<{ label: string; meta: string }>   // Clinical Writing documents
    pubRecord:    Array<{ label: string; meta: string; current: boolean }>  // publication milestones
  }
  libraryCards:  PortfolioCard[]
  statusRows:    Array<{ label: string; value: string; fg: string }>
}
```

**MSW handler:**
```typescript
rest.get('/api/publications/:publicationId/final', (req, res, ctx) =>
  res(ctx.delay(200), ctx.json({
    publication: { ...publications[0], stage: 'published', status: 'published' },
    citation: {
      formatted: 'Webb M, Hartley J, Chen S, Vasquez E, Nair P. PFS benefit of veloricept plus pembrolizumab in advanced NSCLC: results of the Phase III VELORA-301 trial. J Clin Oncol. 2027;45(3):289–301.',
      journal: 'Journal of Clinical Oncology',
      publishedAt: '14 Jan 2027',
    },
    doi: { doi: '10.1200/JCO.2026.VELORA301', registrar: 'crossref', registeredAt: '2027-01-14T00:00:00Z' },
    orcids: [
      { authorId: 'user-mw', name: 'Marcus Webb',       initials: 'MW', orcid: '0000-0002-1825-0097', verified: true, verifiedAt: '2027-01-14T00:00:00Z', avatarBg: '#CCFBF1', avatarFg: '#0F766E' },
      { authorId: 'user-jh', name: 'Prof. James Hartley', initials: 'JH', orcid: '0000-0001-5109-3700', verified: true, verifiedAt: '2027-01-14T00:00:00Z', avatarBg: '#F1F5F9', avatarFg: '#475569' },
      { authorId: 'user-sc', name: 'Dr Sarah Chen',     initials: 'SC', orcid: '0000-0003-2707-9852', verified: true, verifiedAt: '2027-01-14T00:00:00Z', avatarBg: '#F5F3FF', avatarFg: '#7C3AED' },
      { authorId: 'user-ev', name: 'Dr Elena Vasquez',  initials: 'EV', orcid: '0000-0002-9079-5933', verified: true, verifiedAt: '2027-01-14T00:00:00Z', avatarBg: '#DBEAFE', avatarFg: '#1D4ED8' },
      { authorId: 'user-pn', name: 'Dr Priya Nair',     initials: 'PN', orcid: '0000-0001-7205-4462', verified: true, verifiedAt: '2027-01-14T00:00:00Z', avatarBg: '#FEF3C7', avatarFg: '#B45309' },
    ],
    packageFiles: [
      { name: 'Final accepted manuscript (PDF)', note: 'Formatted to JCO specification', crossModule: false },
      { name: 'EQUATOR checklist (PDF)', note: 'CONSORT 2010 · 25/25 items complete', crossModule: false },
      { name: 'Author COI disclosures (PDF)', note: '5 authors · ICMJE format', crossModule: false },
      { name: 'ICMJE contribution statements (PDF)', note: 'All four criteria confirmed', crossModule: false },
      { name: 'GPP 2022 publication record (PDF)', note: 'Full audit trail export', crossModule: false },
      { name: 'Compliance provenance record (PDF)', note: 'Cross-module 21 CFR Part 11 audit chain', crossModule: true },
    ],
    provenanceChain: {
      sourceRecord: [
        { label: 'VELORA-301 clinical study report v1.0', meta: 'Signed 28 Oct 2026' },
        { label: 'Statistical analysis plan v2.0', meta: 'Signed 15 Sep 2026' },
        { label: 'TLF package v3', meta: 'Validated 10 Oct 2026' },
        { label: 'Audit trail reference', meta: 'AE-006 → AE-012' },
      ],
      pubRecord: [
        { label: 'Manuscript v0.1 created', meta: '05 Nov 2026 · Marcus Webb', current: false },
        { label: 'Internal review completed', meta: '20 Nov 2026', current: false },
        { label: 'External author review completed', meta: '02 Dec 2026', current: false },
        { label: 'Steering committee approval', meta: '05 Dec 2026 · e-signature on file', current: false },
        { label: 'Submitted to Journal of Clinical Oncology', meta: '15 Dec 2026', current: false },
        { label: 'Published', meta: '14 Jan 2027', current: true },
      ],
    },
    libraryCards: [
      { id: 'lc-1', publicationId: req.params.publicationId, cardType: 'abstract', name: 'Manuscript abstract', note: 'Tagged: Oncology · NSCLC · Phase III', availableInModules: ['medical-writing','ideation'], pushedBy: 'system', pushedAt: '2027-01-14T00:00:00Z' },
      { id: 'lc-2', publicationId: req.params.publicationId, cardType: 'primary-endpoint', name: 'Primary endpoint result', note: 'HR 0.61 (95% CI 0.48–0.77) · source Table 14.2.1', availableInModules: ['medical-writing','ideation'], pushedBy: 'system', pushedAt: '2027-01-14T00:00:00Z' },
      { id: 'lc-3', publicationId: req.params.publicationId, cardType: 'equator-checklist', name: 'EQUATOR checklist record', note: 'CONSORT 2010 · complete', availableInModules: ['medical-writing'], pushedBy: 'system', pushedAt: '2027-01-14T00:00:00Z' },
      { id: 'lc-4', publicationId: req.params.publicationId, cardType: 'citation', name: 'Publication citation', note: 'DOI 10.1200/JCO.2026.VELORA301', availableInModules: ['medical-writing','ideation'], pushedBy: 'system', pushedAt: '2027-01-14T00:00:00Z' },
    ],
    statusRows: [
      { label: 'Stage', value: 'Stage 6 · final output', fg: '#1E293B' },
      { label: 'Planning → published', value: '71 days', fg: '#1E293B' },
      { label: 'GPP 2022', value: 'Compliant ✓', fg: '#15803D' },
      { label: 'ICMJE', value: 'Compliant ✓', fg: '#15803D' },
      { label: '21 CFR Part 11', value: 'Audit chain complete ✓', fg: '#15803D' },
    ],
  }))
)
```

---

### `POST /publications/:publicationId/final/download`

Generates the full publication package ZIP. Logs to audit trail.

**Request body:** `{}` (empty)

**Response 200:**
```typescript
{
  downloadUrl: string   // mock path for prototype
  fileCount:   number   // 6
  generatedAt: string
}
```

**MSW handler:**
```typescript
rest.post('/api/publications/:publicationId/final/download', (req, res, ctx) =>
  res(ctx.delay(600), ctx.json({
    downloadUrl: '/mock-downloads/velora301-publication-package.zip',
    fileCount: 6,
    generatedAt: new Date().toISOString(),
  }))
)
```

---

## 24. Portfolio Dashboard

### `GET /projects/:projectId/publications/portfolio`

Returns all publications for the portfolio view, optionally filtered by project scope. Used by Portfolio Dashboard (B10).

**Query parameters:**
- `?scope` — project name filter, e.g. `'VELORA-301'` (optional; omit or `'All projects'` for unfiltered)

**Response 200:**
```typescript
Array<Publication & {
  doi?:     string    // present when stage = 'published'
  gpp2022?: 'published' | 'submitted' | 'progress'
  aiLabel?: string    // e.g. '41% AI' — present when footprint computed
  warning?: string    // e.g. 'ICMJE 2/4 — 1 author' — present when soft gate unresolved
  due?:     string    // e.g. 'Response due 15 Feb 2027'
}>
```

**MSW handler:**
```typescript
rest.get('/api/projects/:projectId/publications/portfolio', (req, res, ctx) => {
  const scope = req.url.searchParams.get('scope')
  const filtered = (scope && scope !== 'All projects')
    ? portfolioPublications.filter(p => p.project === scope)
    : portfolioPublications
  return res(ctx.delay(200), ctx.json(filtered))
})
```

---

### `POST /projects/:projectId/publications/gpp-report`

Generates the GPP 2022 compliance report PDF for all publications in scope. Used by Portfolio Dashboard (B10) "Export GPP 2022 report" button.

**Request body:**
```typescript
{
  scope?: string   // project name filter; omit for all projects
}
```

**Response 200:**
```typescript
{
  downloadUrl:      string
  publicationCount: number
  compliancePct:    number   // e.g. 83
  generatedAt:      string
}
```

**MSW handler:**
```typescript
rest.post('/api/projects/:projectId/publications/gpp-report', async (req, res, ctx) => {
  const body = await req.json()
  return res(ctx.delay(800), ctx.json({
    downloadUrl: '/mock-downloads/gpp-2022-report.pdf',
    publicationCount: body.scope && body.scope !== 'All projects' ? 2 : 6,
    compliancePct: 83,
    generatedAt: new Date().toISOString(),
  }))
})
```

---

## 25. Module B MSW Handler Registration

Add to `mocks/browser.ts`:

```typescript
// mocks/browser.ts — updated worker registration
import { setupWorker } from 'msw'
import { documentHandlers }    from './handlers/documents'
import { projectHandlers }     from './handlers/projects'
import { aiHandlers }          from './handlers/ai'
import { publicationHandlers } from './handlers/publications'   // ← Module B

export const worker = setupWorker(
  ...documentHandlers,
  ...projectHandlers,
  ...aiHandlers,
  ...publicationHandlers,
)
```

All 30 Module B endpoints are implemented in `mocks/handlers/publications.ts` (defined in §20 of the Technical Architecture document).

---

## 26. Module B Endpoint Index

| Method | Path | Section | Screen(s) |
|--------|------|---------|-----------|
| GET | `/projects/:id/publications` | §16 | Scientific Writing Home (B01), Portfolio Dashboard (B10) |
| GET | `/publications/:id` | §16 | All B screens |
| POST | `/projects/:id/publications` | §16 | New Publication Wizard (B02) |
| POST | `/publications/:id/advance-stage` | §16 | Manuscript Editor (B03), Journal Submission Readiness (B06) |
| GET | `/publications/:id/footprint` | §17 | Manuscript Editor — footprint panel (B03) |
| GET | `/publications/:id/citations` | §18 | Literature & Citation Panel (B04) |
| POST | `/publications/:id/citations` | §18 | Literature & Citation Panel (B04) |
| DELETE | `/publications/:id/citations/:citationId` | §18 | Literature & Citation Panel (B04) |
| GET | `/pubmed/search` | §18 | Literature & Citation Panel (B04) |
| GET | `/publications/:id/authors` | §19 | Author Management (B05), New Publication Wizard step 4 (B02) |
| PATCH | `/publications/:id/authors/:authorId/icmje` | §19 | Author Management (B05) |
| POST | `/publications/:id/authors/:authorId/icmje/acknowledge` | §19 | Author Management (B05) |
| POST | `/publications/:id/debarment-check` | §19 | Author Management (B05) |
| POST | `/publications/:id/authors/:authorId/remind` | §19 | Author Management (B05) |
| GET | `/publications/:id/submission-checks` | §20 | Journal Submission Readiness (B06) |
| POST | `/publications/:id/submission-checks/run` | §20 | Journal Submission Readiness (B06) |
| PATCH | `/publications/:id/submission-checks/:checkId/acknowledge` | §20 | Journal Submission Readiness (B06) |
| GET | `/publications/:id/congress` | §21 | Congress Abstract Export (B07) |
| POST | `/publications/:id/congress/export` | §21 | Congress Abstract Export (B07) |
| GET | `/publications/:id/review-rounds/latest` | §22 | Peer Review Response (B08) |
| GET | `/review-rounds/:id/comments` | §22 | Peer Review Response (B08) |
| PATCH | `/review-rounds/:id/comments/:commentId` | §22 | Peer Review Response (B08) |
| POST | `/review-rounds/:id/comments/:commentId/ai-accept` | §22 | Peer Review Response (B08) |
| PATCH | `/review-rounds/:id/comments/:commentId/complete` | §22 | Peer Review Response (B08) |
| POST | `/publications/:id/response-letter` | §22 | Peer Review Response (B08) |
| GET | `/publications/:id/final` | §23 | Final Output (B09) |
| POST | `/publications/:id/final/download` | §23 | Final Output (B09) |
| GET | `/projects/:id/publications/portfolio` | §24 | Portfolio Dashboard (B10) |
| POST | `/projects/:id/publications/gpp-report` | §24 | Portfolio Dashboard (B10) |

**Module B total: 29 endpoints across 9 domain groups (§16–§24).**

**Combined Module A + B total: 69 endpoints.**

*Note: Module C API contracts are appended in §30–§43 below, adding 34 endpoints for a combined total of 103 endpoints across Modules A, B, and C.*


---

## MODULE C — MEDICAL WRITING
### API Contracts Appendix to v2.0

---

## Module C Path Parameters (append to §0)

| Parameter | Meaning |
|-----------|---------|
| `:contentId` | UUID of a MedContentItem record |
| `:claimId` | UUID of a Claim record |
| `:issueId` | UUID of a PreMLRIssue record |
| `:failureId` | UUID of a WCAGFailure record |
| `:commentId` | UUID of a MLRComment record (Module C — `MLR-C-###` format, distinct from Module A `CMT-###`) |
| `:sessionId` | UUID of a KOLSession record |
| `:localeId` | UUID of a LocalisedVersion record |

---

## 30. Medical Writing Content Items

### `GET /projects/:projectId/med-content`

Returns all content items for a project. Used by Medical Writing Home (sC01) and Content Portfolio (sC10).

**Query parameters:** `?status`, `?type`, `?ta`, `?search` (all optional)

**Response 200:** `MedContentItem[]`

**MSW handler:**
```typescript
rest.get('/api/projects/:projectId/med-content', (req, res, ctx) =>
  res(ctx.delay(200), ctx.json(medContentItems))
)
```

---

### `GET /med-content/:contentId`

Returns a single content item. Used by all sC screens.

**Response 200:** `MedContentItem`

**Errors:** 404

---

### `POST /projects/:projectId/med-content`

Creates a new content item. Compliance track is set at creation and cannot be changed once Stage 2 is reached (DD-C-001).

**Request body:** `CreateMedContentBody`

**Response 201:** `MedContentItem`

**Side effects:** Creates audit entry `med_content_created`; if PIL or EU-CTR-PLS, immediately creates `fk_score_record` with null score.

**Errors:** 400 (missing taTag or sourceModuleAProjectId), 422 (referenced Module A project not found)

---

### `POST /med-content/:contentId/advance-stage`

Advances content to next stage. Gate rules enforced server-side.

**Request body:** `{}` (empty)

**Response 200:** `MedContentItem` with updated stage and status

**Gate rules per stage transition:**
- Stage 1 → 2: title set, content type selected, compliance track confirmed, source docs linked
- Stage 2 → 3: session notes captured, insights report generated, messaging framework created
- Stage 3 → 4: pre-MLR check passed (zero must-fix); for patient-facing content, FK score ≤ 8
- Stage 4 → 5: all reviewers submitted; MLR Lead has signed decision
- Stage 5 → 6: WCAG check passed for all digital formats; all channel tags applied

**Errors:** 422 with `{ gateFailures: string[] }` listing unmet conditions

---

### `POST /med-content/:contentId/archive`

Archives a content item. Creates an immutable audit record. Used when compliance track must change (DD-C-001).

**Request body:** `{ reason: string }`

**Response 200:** `MedContentItem` with status `'archived'`

**Errors:** 422 if item is `'final-output'` — final output items cannot be archived, only expired

---

## 31. Claims Matrix

### `GET /med-content/:contentId/claims`

Returns the full claims matrix for a content item. Used by sC07 and the Claims panel in sC04 and sC06.

**Response 200:** `Claim[]`

**MSW handler:**
```typescript
rest.get('/api/med-content/:contentId/claims', (req, res, ctx) =>
  res(ctx.delay(100), ctx.json(medClaims))
)
```

---

### `POST /med-content/:contentId/claims/harvest`

Runs claims harvesting and similarity detection. Simulates 1,200ms latency (AI call). Updates all claims with similarity percentages against the Master Library.

**Request body:** `{}` (empty)

**Response 200:** `Claim[]` (updated with similarity scores)

**Side effects:** Creates audit entry `claims_harvested`; updates `review_tier_record` with new reuse percentage

---

### `POST /med-content/:contentId/claims/adopt`

Adopts an approved library claim text. Sets `approvalStatus` to `'approved'` without requiring MLR re-review. Logged to audit trail.

**Request body:** `AdoptLibraryClaimBody`
```typescript
{
  claimId:          string  // NN — claim being updated
  approvedText:     string  // NN — the approved library wording to adopt
  librarySourceRef: string  // NN — e.g. 'Master Library · VELORA-301 · Oncology · Oct 2026'
}
```

**Response 200:** `Claim` with `approvalStatus: 'approved'` and `adoptedAt` set

**Side effects:** Creates audit entry `claim_library_adopted` — records that the adoption bypassed MLR re-review; recalculates tier if reuse percentage crosses a tier boundary

---

## 32. Review Tier

### `GET /med-content/:contentId/review-tier`

Returns the current tier record. Used by sC02 (Scope Summary), sC05 (Pre-MLR), and sC06 (MLR Review).

**Response 200:** `ReviewTierRecord`

---

### `POST /med-content/:contentId/review-tier/override`

MLR Lead manually overrides the calculated tier. Requires MLR Lead role. Creates audit record.

**Request body:** `OverrideTierBody`
```typescript
{
  tier:       ReviewTier  // NN — new tier
  reason:     string      // NN — mandatory rationale
  approvedBy: string      // NN — MLR Lead user ID
}
```

**Response 200:** `ReviewTierRecord` with `overriddenBy` and `overrideReason` set

**Side effects:** Creates audit entry `tier_overridden` — preserves original calculated tier and reason for override; e-signature from MLR Lead required (Phase 2)

**Errors:** 403 (not MLR Lead role)

**Note:** DD-C-003 (tier override is a routing indicator, not a bypass — Tier 1 content still goes through all MLR reviewers with an abbreviated checklist; no reviewer is removed from the chain).

---

## 33. FK Readability

### `GET /med-content/:contentId/fk-score`

Returns the current FK readability score. Only meaningful for patient-facing content types (PIL, EU-CTR-PLS). For non-patient-facing types, returns `null` score and `passed: true` — client must suppress FK display for non-patient-facing types.

**Response 200:** `FKScoreRecord`

```typescript
rest.get('/api/med-content/:contentId/fk-score', (req, res, ctx) =>
  res(ctx.delay(100), ctx.json({
    score: 7.2, passed: true, calculatedAt: new Date().toISOString(),
    bySection: [
      { sectionId: 'main', sectionLabel: 'Main content', score: 7.2 },
      { sectionId: 'side-effects', sectionLabel: 'Side effects section', score: 8.1 },
    ]
  }))
)
```

**Gate rule:** `advance-stage` from Stage 3 → 4 returns 422 for patient-facing content if `fkScore > 8`. FK score must be ≤ 8 before content can be submitted for Pre-MLR.

---

## 34. Pre-MLR Check

### `POST /med-content/:contentId/pre-mlr/run`

Runs the pre-MLR automated quality-check pass. Simulates 2,000ms latency. Sequential to agentic report — agentic report is only generated if pre-MLR passes (DD-C-002).

**Request body:** `RunPreMLRBody` `{ contentItemId: string }`

**Response 200:** `PreMLRCheckResult`

**Side effects:** Creates audit entry `pre_mlr_check_run` with full issue list and pass/fail status

**Gate rule:** `submit-to-mlr` returns 422 if `mustFixCount > 0`

---

### `PATCH /med-content/:contentId/pre-mlr/issues/:issueId/acknowledge`

Acknowledges a Should Fix or Note issue. Must Fix issues cannot be acknowledged — they must be resolved before submission.

**Request body:** `AcknowledgePreMLRIssueBody` `{ issueId: string; acknowledgedBy: string }`

**Response 200:** `PreMLRIssue` with `acknowledged: true`

**Errors:** 422 if issue severity is `'must-fix'`

---

### `GET /med-content/:contentId/agentic-report`

Returns the agentic MLR Pre-Review Report. Only available once pre-MLR has passed. Used by sC05 and the Agentic Report tab in sC06.

**Response 200:** `AgenticMLRReport`

**Notes:** The agentic report is advisory only — it does not approve or reject content. The `model` field identifies which AI engine generated the report (`claude-sonnet-4-6` default). All findings and the generation event are logged to the audit trail automatically when the report is generated server-side.

---

### `POST /med-content/:contentId/submit-to-mlr`

Submits content to the MLR review team after pre-MLR passes. Assigns reviewers. Transitions status to `'in-mlr-review'`.

**Request body:** `SubmitToMLRBody` `{ contentItemId: string; reviewerIds: string[] }`

**Response 200:** `MedContentItem` with `status: 'in-mlr-review'`

**Side effects:** Creates audit entry `submitted_to_mlr`; creates `mlr_reviewer` records; sends notifications to all assigned reviewers

**Errors:** 422 if pre-MLR `mustFixCount > 0`, or if reviewerIds is empty

---

## 35. MLR Review

### `GET /med-content/:contentId/mlr-reviewers`

Returns all assigned MLR reviewers and their submission status. Used by sC06 right panel.

**Response 200:** `MLRReviewer[]`

---

### `GET /med-content/:contentId/mlr-comments`

Returns all MLR review comments. Used by sC06 content review tab.

**Response 200:** `MLRComment[]` sorted by created_at ASC

---

### `POST /med-content/:contentId/mlr-comments`

Adds an MLR review comment. Generates `MLR-C-###` ID.

**Request body:** `{ text: string; tag: 'Must Fix' | 'Should Fix' | 'Note' }`

**Response 201:** `MLRComment`

---

### `PATCH /med-content/:contentId/mlr-comments/:commentId/escalate`

Escalates a Should Fix comment (typically from the agentic report) to Must Fix. Creates escalation record in audit trail. Used when a reviewer promotes an agentic finding.

**Request body:** `{ escalatedBy: string }`

**Response 200:** `MLRComment` with `tag: 'Must Fix'`, `escalatedFromAgentic: true`, `escalatedBy`, `escalatedAt`

**Side effects:** Creates audit entry `mlr_comment_escalated` — records original severity, escalated-by identity, and timestamp. This is the human-override-of-AI-finding record (sC06 fix 4).

---

### `POST /med-content/:contentId/mlr-decision`

Submits the MLR Lead's decision. Requires fresh credential (21 CFR Part 11). All reviewers must have submitted before this is callable.

**Request body:** `SubmitMLRDecisionBody`
```typescript
{
  decision:        MLRDecision  // NN
  decisionNote:    string       // NN
  credentialHash:  string       // NN — SHA-256 of password; never stored in plaintext
  meaning:         string       // NN — 'I approve this content for external distribution'
}
```

**Response 200:** `MedContentItem` with updated status; `'mlr-approved'` for approve decisions, `'in-authoring'` for return-to-author.

**Side effects:** Creates `mlr_decision_record`; creates `signature_record` with Part 11 fields; creates audit entry `mlr_decision_signed`; if decision = `'return-to-author'`: reverts status to `'in-authoring'` and notifies author with all MLR comments attached; if decision = `'reject'`: creates `content_rejection_record` and archives the item.

**Errors:** 403 (not MLR Lead), 422 (not all reviewers submitted), 401 (credential mismatch)

**Note on ACCME Checklist tab:** The ACCME Checklist tab in the MLR review screen (sC06) is only surfaced when `compliance_track = 'accme'`. The MLR decision endpoint enforces this server-side: if `compliance_track = 'mlr'` and the request includes ACCME checklist data, the server ignores the ACCME payload. The tab visibility is a client-side conditional — see DD-C-001.

---

## 36. WCAG Accessibility

### `GET /med-content/:contentId/wcag`

Returns the most recent WCAG 2.1 Level AA test result for content outputs. Used by sC08.

**Response 200:** `WCAGTestResult`

Note: WCAG 2.1 is the standard for content outputs. The platform UI itself is WCAG 2.2 AA — these are separate. The `format` field indicates which output format was tested (`'html'`, `'pdf'`, `'pptx'`). HTML is the primary gated format — HTML must pass before Stage 6 is unlocked.

---

### `POST /med-content/:contentId/wcag/run`

Re-runs WCAG 2.1 AA check. Simulates 3,000ms latency. Returns updated result with specific contrast ratios and fix guidance.

**Request body:** `RunWCAGBody` `{ contentItemId: string; format: string }`

**Response 200:** `WCAGTestResult`

**Side effects:** Creates audit entry `wcag_check_run`

**Gate rule:** `advance-stage` from Stage 5 → 6 returns 422 if HTML format WCAG result has `passed: false`

---

### `PATCH /med-content/:contentId/wcag/failures/:failureId/fix`

Marks a specific WCAG failure as fixed and re-checks that criterion. Used by the "Apply suggested fix" action in sC08.

**Response 200:** `WCAGTestResult` with the specific failure's `fixed: true`

---

## 37. Final Output & Master Library

### `GET /med-content/:contentId/final`

Returns the complete final record — approved item, library cards, compliance chain, and signatures. Used by sC09.

**Response 200:**
```typescript
{
  item:             MedContentItem          // stage 6, status 'final-output'
  libraryCards:     object[]                // 5 cards pushed: claims, slide, MI paragraph, framework, messaging framework
  complianceChain: {
    modules:        string[]                // ['A', 'C']
    frameworks:     string[]                // regulatory frameworks applied
    milestones:     Array<{ label: string; date: string; stage: number }>
    disclaimer:     string                  // AURORA regulatory disclaimer text
  }
  signatures:       SignatureRecord[]       // MLR Lead Part 11 signature record
  expirySchedule: {
    expiryDate:     string
    alert60d:       string                  // ISO date for 60-day alert
    alert30d:       string                  // ISO date for 30-day alert
    alertRecipients: string[]               // names of alert recipients
  }
}
```

---

### `POST /med-content/:contentId/library/push`

Pushes approved content cards to the Master Library. Called at Stage 6 Final Output.

**Request body:** `PushToLibraryBody`
```typescript
{
  contentItemId: string    // NN
  cardTypes:     string[]  // NN — e.g. ['claim', 'slide', 'mi-paragraph', 'framework']
  expiryDate:    string    // NN — ISO date, default +24 months from approvedAt
  taTag:         string    // NN
  channels:      string[]  // NN
}
```

**Response 200:** `{ cardsCreated: number }`

**Side effects:** Creates `master_library_card` records; creates audit entry `library_cards_pushed`; cards available immediately in Module D (Regulatory Writing) and Module E (Ideation & Publishing)

---

## 38. KOL Session

### `GET /med-content/:contentId/kol-session`

Returns the KOL advisory board session for a content item. Used by sC03.

**Response 200:** `KOLSession`

---

### `POST /kol-sessions/:sessionId/insights/generate`

Generates the AI-powered KOL Insights Report and Messaging Framework from session notes and transcripts. Simulates 3,000ms latency (AI call). Both the Insights Report and Messaging Framework are returned as a single object.

**Request body:** `{}` (empty)

**Response 200:** `KOLInsightsReport` (includes `messagingFramework: MessagingFrameworkRow[]`)

**Side effects:** Creates audit entry `kol_insights_generated` — model, generation timestamp, and session ID logged; insights report is NOT approved until KOL quote approval is confirmed (quotes require per-quote approval before use in Stage 3 drafting)

---

### `POST /kol-sessions/:sessionId/quotes/request-approval`

Sends approval requests to the named KOLs for their quoted statements. Each KOL receives an email with a secure link to approve or reject their quotes.

**Request body:** `RequestKOLQuoteApprovalBody` `{ sessionId: string; kolIds: string[] }`

**Response 204:** No content.

**Side effects:** Creates audit entry `kol_quote_approval_requested`; sends email notifications to each KOL in `kolIds` with their specific quoted statements highlighted

---

## 39. Localisation

### `GET /med-content/:contentId/locales`

Returns all localised versions for a content item. Used by sC08 Localisation section.

**Response 200:** `LocalisedVersion[]`

Note: Localisation follows the browser-native model (OQ-C-001 resolution). No translation API is called. The platform supports human translation workflow — the content item is packaged and routed to country affiliates for translation and local MLR sign-off. Localised cards push to the shared Master Library under the parent TA tag on local MLR approval.

---

### `POST /med-content/:contentId/locales`

Adds a localisation target for a content item.

**Request body:** `{ languageCode: string; countryCode: string; affiliate: string }`

**Response 201:** `LocalisedVersion` with `status: 'local-mlr-pending'`

**Side effects:** Creates audit entry `locale_added`; notifies affiliate team

---

## 40. Content Portfolio

### `GET /projects/:projectId/med-content/portfolio`

Returns portfolio summary with all content items across lanes, MLR compliance metrics, expiry data, and Master Library stats. Used by sC10.

**Query parameters:** `?scope` — project name filter (optional)

**Response 200:**
```typescript
{
  projectId:           string
  scope:               string | null
  items:               MedContentItem[]
  mlrCompliancePct:    number
  nextExpiry:          { title: string; daysUntil: number; date: string } | null
  masterLibraryCards:  number
  masterLibraryProjects: number
  upcomingDeadlines:   Array<{ label: string; date: string }>
  expiryRows:          Array<{ title: string; status: 'current' | 'alert' | 'expired'; date: string; daysUntil: number }>
}
```

---

### `POST /projects/:projectId/med-content/compliance-report`

Generates the MLR compliance report PDF across the selected scope. Used by the "Export compliance report" button in sC10.

**Request body:** `{ scope?: string }`

**Response 200:** `{ downloadUrl: string }`

The report covers: all content items in scope with MLR approval status, claims counts, expiry dates, WCAG results, and 21 CFR Part 11 audit references. Intended for the Medical Affairs Lead and Compliance team.

---

## 41. Module C MSW Browser Registration

```typescript
// mocks/browser.ts — updated worker registration
import { setupWorker } from 'msw'
import { documentHandlers }    from './handlers/documents'
import { projectHandlers }     from './handlers/projects'
import { aiHandlers }          from './handlers/ai'
import { publicationHandlers } from './handlers/publications'
import { medContentHandlers }  from './handlers/medContent'   // ← Module C

export const worker = setupWorker(
  ...documentHandlers,
  ...projectHandlers,
  ...aiHandlers,
  ...publicationHandlers,
  ...medContentHandlers,
)
```

---

## 42. Module C Endpoint Index

| Method | Path | Section | Screen(s) |
|--------|------|---------|-----------|
| GET | `/projects/:id/med-content` | §30 | Medical Writing Home (sC01), Portfolio (sC10) |
| GET | `/med-content/:id` | §30 | All sC screens |
| POST | `/projects/:id/med-content` | §30 | Content Briefing (sC02) — new item |
| POST | `/med-content/:id/advance-stage` | §30 | All stage gate screens |
| POST | `/med-content/:id/archive` | §30 | Content Briefing (sC02) — track change |
| GET | `/med-content/:id/claims` | §31 | Claims Matrix (sC07), Editor (sC04), MLR (sC06) |
| POST | `/med-content/:id/claims/harvest` | §31 | Claims Matrix (sC07) |
| POST | `/med-content/:id/claims/adopt` | §31 | Claims Matrix (sC07) |
| GET | `/med-content/:id/review-tier` | §32 | Content Briefing (sC02), Pre-MLR (sC05), MLR (sC06) |
| POST | `/med-content/:id/review-tier/override` | §32 | Pre-MLR (sC05), MLR (sC06) |
| GET | `/med-content/:id/fk-score` | §33 | Content Editor (sC04) — FK panel |
| POST | `/med-content/:id/pre-mlr/run` | §34 | Pre-MLR Check (sC05) |
| PATCH | `/med-content/:id/pre-mlr/issues/:issueId/acknowledge` | §34 | Pre-MLR Check (sC05) |
| GET | `/med-content/:id/agentic-report` | §34 | Pre-MLR (sC05), MLR Agentic tab (sC06) |
| POST | `/med-content/:id/submit-to-mlr` | §34 | Pre-MLR Check (sC05) |
| GET | `/med-content/:id/mlr-reviewers` | §35 | MLR Review (sC06) |
| GET | `/med-content/:id/mlr-comments` | §35 | MLR Review (sC06) |
| POST | `/med-content/:id/mlr-comments` | §35 | MLR Review (sC06) |
| PATCH | `/med-content/:id/mlr-comments/:commentId/escalate` | §35 | MLR Review (sC06) |
| POST | `/med-content/:id/mlr-decision` | §35 | MLR Review (sC06) |
| GET | `/med-content/:id/wcag` | §36 | Formatting & Accessibility (sC08) |
| POST | `/med-content/:id/wcag/run` | §36 | Formatting & Accessibility (sC08) |
| PATCH | `/med-content/:id/wcag/failures/:failureId/fix` | §36 | Formatting & Accessibility (sC08) |
| GET | `/med-content/:id/final` | §37 | Final Output (sC09) |
| POST | `/med-content/:id/library/push` | §37 | Final Output (sC09) |
| GET | `/med-content/:id/kol-session` | §38 | KOL Advisory Board Session (sC03) |
| POST | `/kol-sessions/:id/insights/generate` | §38 | KOL Advisory Board Session (sC03) |
| POST | `/kol-sessions/:id/quotes/request-approval` | §38 | KOL Advisory Board Session (sC03) |
| GET | `/med-content/:id/locales` | §39 | Formatting & Accessibility (sC08) |
| POST | `/med-content/:id/locales` | §39 | Formatting & Accessibility (sC08) |
| GET | `/projects/:id/med-content/portfolio` | §40 | Content Portfolio (sC10) |
| POST | `/projects/:id/med-content/compliance-report` | §40 | Content Portfolio (sC10) |

**Module C total: 32 endpoints across 11 domain groups (§30–§40).**

**Combined Module A + B + C total: 101 endpoints.**

---

## 43. Module C Audit Event Types (append to §2 enum in Data Model)

The following event types are added to `audit_event_type` for Module C:

```sql
-- Module C events (append to audit_event_type enum)
'med_content_created', 'med_content_status_changed', 'med_content_archived',
'claims_harvested', 'claim_library_adopted',
'tier_calculated', 'tier_overridden',
'pre_mlr_check_run', 'pre_mlr_issue_acknowledged',
'agentic_report_generated',
'submitted_to_mlr', 'mlr_reviewer_assigned',
'mlr_comment_added', 'mlr_comment_resolved', 'mlr_comment_escalated',
'mlr_decision_signed',
'wcag_check_run', 'wcag_failure_fixed',
'library_cards_pushed',
'kol_insights_generated', 'kol_quote_approval_requested', 'kol_quote_approved',
'locale_added', 'locale_mlr_approved',
'content_expiry_alert_sent'
```


---

## MODULE D — REGULATORY WRITING
### API Contracts Appendix

---

## Module D Path Parameters (append to §0)

| Parameter | Meaning |
|-----------|---------|
| `:submissionId` | UUID of a `regulatory_submission` record |
| `:contradictionId` | UUID of a `consistency_contradiction` record |
| `:questionId` | UUID of an HA correspondence question record |

---

## 44. Regulatory Submissions

### `GET /projects/:projectId/regulatory-submissions`
Returns all submissions for a project. Used by sD01.
**Response 200:** `RegulatorySubmission[]`

### `POST /projects/:projectId/regulatory-submissions`
Creates a new submission. Requires `sourceModuleAProjectId` — Module D must link to Module A.
**Request body:** `{ submissionType, targetHAs, ectdVersion, taTag, sourceModuleAProjectId }`
**Response 201:** `RegulatorySubmission`
**Errors:** 422 if `sourceModuleAProjectId` not found or Module A project status < 'signed'

### `POST /regulatory-submissions/:submissionId/advance-stage`
Advances to next stage. Gate rules enforced server-side:
- Stage 1→2: CMC Readiness acknowledged
- Stage 2→3: Zero unresolved Major contradictions (DD-D-002)
- Stage 3→4: CMC Lead + Nonclinical Lead sign-off
- Stage 4→5: All 6 RACI roles signed + zero unresolved Major contradictions
- Stage 5→6: eCTD validation critical=0 + major=0 + all PPD/CCI confirmed
**Errors:** 422 with `{ gateFailures: string[] }`

---

## 45. Canonical JSON Layer

### `POST /regulatory-submissions/:submissionId/canonical-json/index`
Indexes Module A source documents (CSR, IB, SAP, TLF) into the canonical JSON layer. Simulates 2,000ms latency. Returns count of extracted data points.
**Response 200:** `{ dataPoints: number; indexedAt: string }`
**Side effects:** Creates audit entry `canonical_json_indexed`

---

## 46. eCTD Granularity Map

### `GET /regulatory-submissions/:submissionId/ectd-map`
Returns full eCTD tree with all node statuses. Live — updates as sections lock.
**Response 200:** `ECTDGranularityNode[]`

### `PATCH /regulatory-submissions/:submissionId/ectd-map/nodes/:nodeId/status`
Updates a node status (e.g., 'in-authoring' → 'signed'). Triggers continuous publishing if 'signed' (FR-D-019).
**Response 200:** `ECTDGranularityNode`
**Errors:** 422 if node is Module 5 (read-only, DD-D-001) or system-generated (2.1, 2.2)

---

## 47. CMC Data Readiness

### `GET /regulatory-submissions/:submissionId/cmc-readiness`
Returns CMC readiness report with completeness score and missing items.
**Response 200:** `CMCReadinessReport`

### `POST /regulatory-submissions/:submissionId/cmc-readiness/acknowledge`
Ideation Lead acknowledges CMC readiness (partial readiness accepted with risk note). Required before Stage 2.
**Request body:** `{ acknowledgedBy: string; riskNote: string }`
**Response 200:** `CMCReadinessReport` with `acknowledgedBy` and `acknowledgedAt` set

---

## 48. Cross-Module Consistency Check (DD-D-002 — Hard Gate)

### `POST /regulatory-submissions/:submissionId/consistency-check/run`
Runs the cross-module consistency check between CTD 2.5/2.7 and Module 5 TFLs. Simulates 120s latency. Hard gate: Stage 4 sign-off blocked until all Major contradictions resolved.
**Response 200:** `ConsistencyCheckResult`
**Side effects:** Creates audit entry `consistency_check_run`

### `PATCH /regulatory-submissions/:submissionId/consistency-check/contradictions/:contradictionId/resolve`
Marks a contradiction as resolved with a resolution note.
**Request body:** `{ resolvedBy: string; resolutionNote: string }`
**Response 200:** `ConsistencyContradiction` with `resolved: true`
**Errors:** 422 if severity is 'major' and note is empty (major contradictions require documented resolution)

---

## 49. PPD/CCI Redaction (DD-D-003 — Irreversible After Stage 5)

### `GET /regulatory-submissions/:submissionId/redaction`
Returns redaction record with all PPD and CCI instances detected.
**Response 200:** `RedactionRecord`

### `PATCH /regulatory-submissions/:submissionId/redaction/:type/:itemId/confirm`
Confirms a single PPD or CCI redaction. Irreversible after Stage 5 gate is crossed (DD-D-003).
**Request body:** `{ confirmedBy: string }`
**Response 200:** Updated item with `confirmed: true`
**Errors:** 422 if stage > 5 (cannot un-redact after submission)

---

## 50. eCTD Validation

### `POST /regulatory-submissions/:submissionId/ectd-validation/run`
Runs eCTD validation via Admin-configured engine (EXTEDO default). Simulates 300s latency. Hard gate: Stage 6 blocked until critical=0 and major=0.
**Response 200:** `{ passed: boolean; critical: number; major: number; minor: number; errors: object[] }`
**Side effects:** Audit entry `ectd_validation_run`

---

## 51. Gateway Submission (FR-D-021 — Part 11 Required)

### `POST /regulatory-submissions/:submissionId/gateway/transmit`
Transmits the eCTD package to the specified gateway. **Requires inline Part 11 confirmation before this endpoint is called** — the `PartElevenConfirm` component gates the API call client-side; the server also validates `credentialHash`.
**Request body:** `{ gateway: GatewayTarget; credentialHash: string; meaning: string }`
**Response 200:** `GatewaySubmissionRecord`
**Errors:** 401 (credential mismatch), 422 (eCTD not validated or PPD/CCI not confirmed), 403 (not Reg Affairs Lead or eCTD Specialist)
**Gateway priorities:** FDA ESG (Priority 1), EMA CESP (Priority 2), CDSCO (Priority 3), MHRA (Priority 4 — prototype UI only per OQ-D-008 resolution; `apiReady: false` in GATEWAY_PRIORITY constant)
**Side effects:** Audit entry `gateway_transmission`; ACK polling begins

### `GET /regulatory-submissions/:submissionId/gateway/status`
Returns current ACK status for all gateway submissions.
**Response 200:** `GatewaySubmissionRecord[]`

---

## 52. HA Correspondence & Response Drafting

### `POST /regulatory-submissions/:submissionId/ha-correspondence/loq`
Uploads a LoQ document and auto-parses questions (DD-D-004).
**Response 200:** `{ questionsExtracted: number; questions: object[] }`

### `POST /regulatory-submissions/:submissionId/ha-response/:questionId/generate`
AI-drafts a response for a LoQ question grounded in canonical JSON layer (DD-D-004). Simulates 5,000ms latency.
**Response 200:** `{ draftText: string; sourceRefs: string[]; aiFootprintPct: number }`

---

## 53. Regulatory Intelligence (FR-D-024 — Cross-Module Shared Service)

### `GET /regulatory-alerts`
Returns all active regulatory framework alerts. Cross-module — accessible to all five modules.
**Response 200:** `RegAlert[]`

### `PATCH /regulatory-alerts/:alertId/acknowledge`
Marks an alert as acknowledged by the current user.
**Response 200:** `RegAlert` with user ID added to `acknowledgedByIds`

---

## 54. Master Library Push (FR-D-027)

### `POST /regulatory-submissions/:submissionId/library/push`
Pushes approved dossier sections and labels to the Master Library after ACK2 confirmation.
**Request body:** `{ cardTypes: string[]; taTag: string; submissionType: string; haTarget: string }`
**Response 200:** `{ cardsCreated: number }`

---

## 55. Module D Endpoint Index

| Method | Path | Section |
|--------|------|---------|
| GET | `/projects/:id/regulatory-submissions` | §44 |
| POST | `/projects/:id/regulatory-submissions` | §44 |
| POST | `/regulatory-submissions/:id/advance-stage` | §44 |
| POST | `/regulatory-submissions/:id/canonical-json/index` | §45 |
| GET | `/regulatory-submissions/:id/ectd-map` | §46 |
| PATCH | `/regulatory-submissions/:id/ectd-map/nodes/:nodeId/status` | §46 |
| GET | `/regulatory-submissions/:id/cmc-readiness` | §47 |
| POST | `/regulatory-submissions/:id/cmc-readiness/acknowledge` | §47 |
| POST | `/regulatory-submissions/:id/consistency-check/run` | §48 |
| PATCH | `/regulatory-submissions/:id/consistency-check/contradictions/:id/resolve` | §48 |
| GET | `/regulatory-submissions/:id/redaction` | §49 |
| PATCH | `/regulatory-submissions/:id/redaction/:type/:itemId/confirm` | §49 |
| POST | `/regulatory-submissions/:id/ectd-validation/run` | §50 |
| POST | `/regulatory-submissions/:id/gateway/transmit` | §51 |
| GET | `/regulatory-submissions/:id/gateway/status` | §51 |
| POST | `/regulatory-submissions/:id/ha-correspondence/loq` | §52 |
| POST | `/regulatory-submissions/:id/ha-response/:questionId/generate` | §52 |
| GET | `/regulatory-alerts` | §53 |
| PATCH | `/regulatory-alerts/:alertId/acknowledge` | §53 |
| POST | `/regulatory-submissions/:id/library/push` | §54 |

**Module D total: 20 endpoints across 10 domain groups.**

---

## MODULE E — IDEATION & PUBLISHING
### API Contracts Appendix

---

## Module E Path Parameters (append to §0)

| Parameter | Meaning |
|-----------|---------|
| `:artefactId` | UUID of an `ideation_artefact` record |
| `:cardId` | UUID of an `ideation_content_card` record |
| `:entryId` | UUID of a `calendar_entry` record |
| `:token` | One-time KOL review JWT (public route — no auth required) |

---

## 56. Ideation Projects & Artefacts

### `GET /projects/:projectId/ideation`
Returns all ideation projects for a project.
**Response 200:** `IdeationProject[]`

### `POST /projects/:projectId/ideation`
Creates a new ideation project. TA tag mandatory.
**Request body:** `{ sourceType, taTag, artefact: { title, sourceModule, originalApprovalDate } }`
**Response 201:** `IdeationProject`

---

## 57. Source Checks (Sequential — Stage 1)

### `POST /ideation-artefacts/:artefactId/source-gate`
Checks approval status of platform-authored artefacts (FR-E-003, DD-E-002). Hard block if status < Signed/Final/Submitted. External uploads: returns 'requires-confirmation'.
**Response 200:** `{ passed: boolean; status?: string; reason?: string }`
**Side effects:** Audit entry `source_gate_checked`

### `POST /ideation-artefacts/:artefactId/source-currency`
Detects whether the artefact has been superseded (FR-E-005). For Master Library cards pushed within 90 days: bypassed automatically. Cards older than 90 days: lightweight check runs.
**Response 200:** `{ status: SourceCurrencyStatus; warnings: string[] }`

### `POST /ideation-artefacts/:artefactId/claim-currency`
Checks all claims in the artefact against the current approved label (FR-E-004). Simulates 30s latency.
**Response 200:** `{ claims: Array<{ text: string; status: ClaimCurrencyStatus }> }`
**Side effects:** Audit entry `claim_currency_checked`

### `PATCH /ideation-artefacts/:artefactId/flags/:flagId/acknowledge`
Acknowledges a claim currency or source currency flag with a resolution note.
**Request body:** `{ acknowledgedBy: string; note: string }`
**Response 200:** Flag with `acknowledged: true`

---

## 58. Content Cards & Atomisation

### `GET /ideation/:projectId/cards`
Returns all content cards for a project with `overallStatus` pre-computed.
**Response 200:** `IdeationContentCard[]`

### `POST /ideation/:projectId/cards`
Tags a new content card from a source passage.
**Request body:** `{ sourceSection, sourcePassage, channelFormats, provenance }`
**Response 201:** `IdeationContentCard` with `overallStatus: 'uploaded'`

### `POST /ideation-cards/:cardId/atomise`
Generates one channel-specific adaptation (FR-E-007, DD-E-004). One call per channel — never batch. Simulates 10s latency per channel.
**Request body:** `{ channel: ChannelFormat }`
**Response 200:** `AtomisedContent` — editable by Ideation Lead before KOL review (DD-E-001: only channel adaptations are editable; source document is always read-only)
**Side effects:** Audit entry `content_atomised`; token usage logged

### `POST /ideation-cards/:cardId/compliance-screen`
Runs pre-review compliance screening (FR-E-008). Simulates 30s latency. Returns Must Fix (blocks KOL) and Advisory (informational).
**Response 200:** `{ mustFix: object[]; advisory: object[] }`

---

## 59. KOL Review (Guest Route — No Auth)

### `POST /ideation/:projectId/kol/invite`
Sends KOL invitation email + SMS with one-time review link (FR-E-010, FR-E-020). Token expires in 7 days.
**Response 200:** `{ linkSentAt: string; tokenExpiresAt: string }`
**Side effects:** Audit entry `kol_invited`; SMS sent if mobile captured

### `POST /kol-review/:token/submit`
Public endpoint — no authentication. KOL submits review decisions per card (FR-E-010, FR-E-011). Token is validated and invalidated on use.
**Request body:** `{ decisions: Array<{ cardId: string; decision: 'approved'|'rejected'|'modification-requested'; comment?: string }>; signOff: { name: string; email: string } }`
**Response 200:** `{ submittedAt: string }`
**Errors:** 401 (token expired or already used), 422 (not all cards reviewed)
**Side effects:** Audit entry `kol_review_submitted`; Ideation Lead notified

---

## 60. Medical Affairs Approval (Stage 4)

### `POST /ideation/:projectId/ma/approve`
MA Team Lead signs off approved content cards (FR-E-012, FR-E-014). Digital approval stamp (not full 21 CFR Part 11 e-signature per PRD E v0.3 §8.1).
**Request body:** `{ cardIds: string[]; approvedBy: string; approverRole: string; timestamp: string }`
**Response 200:** Updated `IdeationProject` with `status: 'approved'`
**Side effects:** Audit entry `ma_approval_stamped`; Content Calendar Manager notified (FR-E-020)

---

## 61. Content Calendar (FR-E-015, FR-E-016)

### `GET /ideation-calendar/month`
Returns calendar entries for a given month.
**Query params:** `?month=2026-10&scope=all`
**Response 200:** `CalendarEntry[]`

### `POST /ideation-calendar/schedule`
Schedules an approved content card to a publishing date and channel.
**Request body:** `{ cardId: string; channel: ChannelFormat; scheduledDate: string; assignedCreativeId: string }`
**Response 201:** `CalendarEntry`
**Side effects:** MA 3-day advance notification scheduled (FR-E-020)

### `POST /ideation-calendar/:entryId/mark-published`
Creative team member marks content as published (DD-E-005 — human-executed, not direct API publishing).
**Request body:** `{ publishedBy: string; utmParams: string; seoMetadata: object }`
**Response 200:** `PublishRecord`

---

## 62. Standards & Metadata (FR-E-019)

### `POST /ideation-cards/:cardId/doi/register`
Registers a DOI via CrossRef API (FR-E-019, DD-E-006). Eligible content types: long-form articles, white papers, formal medical affairs communications. Short-form social posts return 422.
**Request body:** `{ title: string; creators: string[]; url: string; rights: string }`
**Response 200:** `DOIRecord`
**Errors:** 422 if content type not eligible for DOI (e.g., LinkedIn post, tweet)

### `GET /orcid/verify/:orcid`
Verifies an ORCID iD via ORCID Member API (FR-E-019, OQ-E-006 — Module E owns this service).
**Response 200:** `{ orcid: string; name: string; verified: boolean }`

### `POST /ideation-cards/:cardId/dublin-core/tag`
Applies Dublin Core metadata to a published artefact (FR-E-019). Embeds in PDF/HTML output.
**Request body:** 15 Dublin Core elements (dc:title through dc:rights)
**Response 200:** `DublinCoreMetadata`

### `POST /ideation-cards/:cardId/wcag/run`
Runs WCAG 2.1 Level AA accessibility check on published content outputs (FR-E-019). Uses Module C WCAG engine. Note: WCAG 2.1 for content outputs, not 2.2 (which is the platform UI standard).
**Request body:** `{ format: 'pdf' | 'html' }`
**Response 200:** `{ passed: boolean; failures: object[] }`

---

## 63. Master Library Push (FR-E-002 — 90-Day Rule)

### `POST /ideation/:projectId/library/push`
Pushes published ideation cards to the Master Library. Master Library cards older than 90 days when subsequently pulled into a new project will receive a lightweight currency check (FR-E-002 v0.3 fix).
**Request body:** `{ cardIds: string[]; taTag: string; channels: string[] }`
**Response 200:** `{ cardsCreated: number }`

---

## 64. Module E Endpoint Index

| Method | Path | Section |
|--------|------|---------|
| GET | `/projects/:id/ideation` | §56 |
| POST | `/projects/:id/ideation` | §56 |
| POST | `/ideation-artefacts/:id/source-gate` | §57 |
| POST | `/ideation-artefacts/:id/source-currency` | §57 |
| POST | `/ideation-artefacts/:id/claim-currency` | §57 |
| PATCH | `/ideation-artefacts/:id/flags/:flagId/acknowledge` | §57 |
| GET | `/ideation/:projectId/cards` | §58 |
| POST | `/ideation/:projectId/cards` | §58 |
| POST | `/ideation-cards/:id/atomise` | §58 |
| POST | `/ideation-cards/:id/compliance-screen` | §58 |
| POST | `/ideation/:projectId/kol/invite` | §59 |
| POST | `/kol-review/:token/submit` | §59 |
| POST | `/ideation/:projectId/ma/approve` | §60 |
| GET | `/ideation-calendar/month` | §61 |
| POST | `/ideation-calendar/schedule` | §61 |
| POST | `/ideation-calendar/:id/mark-published` | §61 |
| POST | `/ideation-cards/:id/doi/register` | §62 |
| GET | `/orcid/verify/:orcid` | §62 |
| POST | `/ideation-cards/:id/dublin-core/tag` | §62 |
| POST | `/ideation-cards/:id/wcag/run` | §62 |
| POST | `/ideation/:projectId/library/push` | §63 |

**Module E total: 21 endpoints across 8 domain groups.**

---

## 65. Combined Endpoint Totals

| Module | Endpoints | Sections |
|--------|-----------|---------|
| A — Clinical Writing | 38 | §1–§14 |
| B — Scientific Writing | 30 | §16–§29 |
| C — Medical Writing | 32 | §30–§43 |
| D — Regulatory Writing | 20 | §44–§54 |
| E — Ideation & Publishing | 21 | §56–§63 |
| **Combined total** | **141** | |

---

## 66. Module D + E Audit Event Types (append to §2 Data Model enum)

```sql
-- Module D events
'canonical_json_indexed', 'submission_stage_advanced',
'consistency_check_run', 'contradiction_resolved',
'cmc_readiness_acknowledged', 'ectd_node_signed',
'ppd_redaction_confirmed', 'cci_redaction_confirmed',
'ectd_validation_run', 'gateway_transmission',
'ha_loq_uploaded', 'ha_response_generated', 'ha_response_signed',
'regulatory_alert_acknowledged', 'odd_assessment_completed',
'regulatory_library_cards_pushed',

-- Module E events
'source_gate_checked', 'source_currency_checked', 'claim_currency_checked',
'claim_flag_acknowledged', 'content_card_created', 'content_atomised',
'compliance_screen_run', 'kol_invited', 'kol_review_submitted',
'kol_reminder_sent', 'kol_escalated',
'ma_approval_stamped', 'content_scheduled',
'content_published', 'content_overdue_alert',
'doi_registered', 'orcid_verified', 'dublin_core_tagged',
'wcag_check_run', 'ideation_library_cards_pushed'
```
