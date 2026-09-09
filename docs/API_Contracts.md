# Aurora — API Contracts
**Module A: Clinical Writing**
**Version 1.0 — September 2026**
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
