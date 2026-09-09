# Aurora — Technical Architecture Document
**Modules A, B & C: Clinical Writing · Scientific Writing · Medical Writing**
**Version 3.0 — September 2026**
*Status: Approved for prototype build. Production deployment decisions deferred to post-5-module prototype phase.*

---

## 0. Document Purpose & Scope

This document defines the technical architecture for Aurora Modules A, B, and C — Clinical Writing, Scientific Writing, and Medical Writing. It covers two phases:

- **Phase 1 (Now):** React prototype — all 27 screens wired as a navigable, demoable application with simulated data and mocked API calls. Nothing is throwaway. Components, data shapes, API contracts, and folder structure are production-quality from the first commit.
- **Phase 2 (Later):** Real backend — the same frontend codebase, same API contract shapes, same data structures. Mocked handlers replaced with real server calls. No component rewrites required if Phase 1 is built correctly.

**Architecture decision — Modular Monolith:** Aurora v0.1 is built as a modular monolith per PRD §5.3. This document implements that decision through: (1) monorepo folder structure with module-scoped code, (2) ESLint `no-restricted-imports` rules enforced in CI, (3) shared platform infrastructure separate from module code. The four PRD discipline rules apply from the first commit — see §10 for enforcement detail. This decision is not open for re-debate during sprint planning.

The key principle: **hardcoded data is the only throwaway**. Everything else — component architecture, state management, API shapes, folder structure, TypeScript types — is built once and carried forward.

---

## 1. Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Frontend framework | React 18 (functional components + hooks) | Prototype screens built in React by CD; CC continues in the same framework |
| Language | TypeScript (strict mode) | Type safety catches data shape mismatches early; types serve as living documentation for the API contract |
| Styling | Tailwind CSS | CD outputs inline styles; CC translates to Tailwind utilities using design system token values. No custom CSS files. |
| State management | Zustand | Minimal boilerplate; works seamlessly with React Query when real API calls replace mocks; easy to inspect in devtools |
| API mocking | MSW (Mock Service Worker) | Intercepts fetch at the service worker level — components call real fetch, MSW intercepts and returns mock responses. When real backend arrives, delete the handler; component is unchanged. |
| Routing | React Router v6 | Standard, well-documented, supports nested routes for the module/screen hierarchy |
| Build tool | Vite | Fast HMR, native TypeScript support, straightforward config |
| Package manager | npm | Consistent with CC's standard environment |
| Backend (Phase 2) | Node.js + TypeScript + Express or Fastify | Same language across stack; CC can scaffold backend when ready |
| Database (Phase 2) | PostgreSQL via Prisma ORM | JSONB for flexible audit payloads; strong transaction support for Part 11; Prisma generates TypeScript types from schema — same types used in frontend |
| Real-time (Phase 2) | Socket.io | Section-level presence (FR-A-053); WebSocket with HTTP fallback |

---

## 2. Repository Structure

One repository, monorepo layout. Enforces the modular boundary discipline from the PRD at the file system level.

```
aurora/
├── apps/
│   ├── web/                          ← React frontend (CC builds here)
│   │   ├── src/
│   │   │   ├── components/           ← Shared UI components (see §3)
│   │   │   ├── panels/               ← Right panel components (see §3)
│   │   │   ├── screens/              ← Screen components (see §3)
│   │   │   ├── modules/              ← Module-scoped logic
│   │   │   │   ├── clinical-writing/ ← Module A (current build)
│   │   │   │   ├── scientific-writing/  ← Module B (future)
│   │   │   │   ├── medical-writing/     ← Module C (future)
│   │   │   │   ├── regulatory-writing/  ← Module D (future)
│   │   │   │   └── ideation/            ← Module E (future)
│   │   │   ├── platform/             ← Shared platform layer (Project, User, Auth)
│   │   │   ├── store/                ← Zustand stores (see §5)
│   │   │   ├── api/                  ← API client layer (see §6)
│   │   │   ├── mocks/                ← MSW handlers (Phase 1 only)
│   │   │   │   ├── handlers/
│   │   │   │   └── browser.ts        ← MSW service worker setup
│   │   │   ├── data/                 ← Static JSON mock data (see §7)
│   │   │   ├── types/                ← Shared TypeScript types (see §4)
│   │   │   ├── utils/                ← Utility functions (see §8)
│   │   │   ├── router/               ← Route definitions (see §9)
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── public/
│   │   │   └── mockServiceWorker.js  ← MSW service worker (generated)
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   └── tailwind.config.ts
│   └── api/                          ← Node.js backend (Phase 2 — scaffold now, build later)
│       ├── src/
│       │   ├── modules/              ← Module-scoped routes + controllers
│       │   │   └── clinical-writing/
│       │   ├── platform/             ← Auth, Project, User routes
│       │   ├── shared/               ← Audit trail engine, e-signature engine, AI connector
│       │   └── index.ts
│       └── tsconfig.json
├── packages/
│   └── types/                        ← Shared TypeScript types (used by both apps/ and api/)
│       └── src/
│           ├── domain.ts             ← Core domain types (Document, Project, User, etc.)
│           ├── api.ts                ← API request/response types
│           └── index.ts
├── package.json                      ← Workspace root
└── turbo.json                        ← Turborepo build config (optional but recommended)
```

**Module boundary rule at the file system level:**
Module A code lives in `modules/clinical-writing/`. It may import from `platform/` and `components/`. It must never import from `modules/scientific-writing/` or any other module folder. This is enforced by an ESLint rule (see §10).

---

## 3. Component Architecture

Components are split into four layers. Each layer may only import from layers below it.

```
Screen components (screens/)
        ↓
Panel components (panels/)
        ↓
UI components (components/)
        ↓
Utility functions + TypeScript types (utils/, types/)
```

### 3.1 UI Components (`/components`)

Stateless or lightly stateful. Receive all data via props. No API calls. No Zustand access.

```
/components
  /layout
    TopNav.tsx          Props: user, notificationCount, onToggleSidebar
    Sidebar.tsx         Props: activeModule, activeProject, subNavItems
    Breadcrumb.tsx      Props: items: {label, href}[]
  /ui
    Button.tsx          Props: variant ('primary'|'secondary'|'destructive'|'text'), size, disabled, onClick
    StatusPill.tsx      Props: status (keys of STATUS_META), size
    FilterChip.tsx      Props: label, active, onClick
    SkeletonRow.tsx     Props: columns: number
    ProgressBar.tsx     Props: value (0–100), label, showPercent
    StatusDot.tsx       Props: state ('complete'|'active'|'pending'|'waived'|'overdue')
    ConfidenceBadge.tsx Props: percent (0–100)
    MonoLabel.tsx       Props: children, colour
    AIBadge.tsx         No props — always renders "AI" in DBEAFE/1D4ED8
    RACIBadge.tsx       Props: raci ('R'|'A'|'C'|'I')
    ToggleSwitch.tsx    Props: checked, onChange, label, subLabel
    PulseIndicator.tsx  Props: colour ('blue'|'green'|'amber'), size (default 8)
    ReferenceDropdown.tsx  Props: activePanel, onSelect, isOpen, onToggle
    Avatar.tsx          Props: initials, colourKey (keys of USER_COLOURS), size
```

### 3.2 Panel Components (`/panels`)

All panels share the `RightPanel` wrapper. Each panel receives its data via props — no direct store access.

```typescript
// RightPanel.tsx — shared shell
interface RightPanelProps {
  isOpen: boolean
  onClose: () => void
  title: string
  icon: React.ReactNode
  defaultWidth?: 280 | 480
  minWidth?: number  // default 260
  maxWidth?: number  // default 760
  children: React.ReactNode
}
```

Individual panels receive typed props from the screen that mounts them:

```typescript
// AIPanel.tsx
interface AIPanelProps {
  section: string
  onAccept: (suggestion: AISuggestion) => void
  onRefine: (prompt: string) => void
  onReject: () => void
}

// ChecklistPanel.tsx
interface ChecklistPanelProps {
  documentId: string
  items: ChecklistItem[]
  onComplete: (itemId: string, completedBy: string) => void
  onWaive: (itemId: string, reason: string) => void
  onAddItem: (text: string) => void
}

// TraceabilityPanel.tsx
interface TraceabilityPanelProps {
  selectedValue: string
  sourceChain: TraceabilitySource[]
  onFlagForQC: () => void
}
```

### 3.3 Screen Components (`/screens`)

Screens are the only layer that connects to Zustand stores and the API layer. They compose UI and panel components.

```typescript
// Pattern every screen follows:
const DocumentEditor: React.FC = () => {
  // 1. Read from store
  const { document, activePanel } = useDocumentStore()
  const { user } = useAuthStore()

  // 2. Local UI state
  const [isPanelOpen, setIsPanelOpen] = useState(false)

  // 3. API calls (Phase 1: returns mock data via MSW)
  const { data, isLoading } = useQuery(['document', documentId], fetchDocument)

  // 4. Render — compose components
  return (
    <EditorLayout>
      <EditorToolbar ... />
      <SectionNavigator ... />
      <EditorContent ... />
      {activePanel === 'ai' && <AIPanel ... />}
    </EditorLayout>
  )
}
```

---

## 4. TypeScript Types

All domain types live in `packages/types/src/domain.ts`. Used by both the frontend and (Phase 2) the backend. This ensures the API contract is enforced by the type system.

```typescript
// packages/types/src/domain.ts

// --- Core domain types ---

export type ProjectStatus = 'initiated' | 'ongoing' | 'on-hold' | 're-open' | 'closed'
export type DocumentStatus = 'in-authoring' | 'in-review' | 'crm-in-progress' | 'pending-signature' | 'signed' | 'not-started'
export type DocumentStage = 'study-start-up' | 'during-study' | 'post-study' | 'cross-functional-review' | 'crm' | 'final-output'
export type DocumentType = 'csr-full' | 'csr-synopsis' | 'protocol' | 'protocol-amendment' | 'ib' | 'icf' | 'safety-narrative' | 'dsur' | 'end-of-study-summary'
export type RACIRole = 'R' | 'A' | 'C' | 'I'
export type PanelMode = 'ai' | 'traceability' | 'voice' | 'checklist' | 'audit' | 'review-assignment' | 'crm-resolution' | 'ich-e3' | 'meddra' | 'tlf' | null
export type SignatureStatus = 'signed' | 'awaiting' | 'queued'
export type SignatureMeaning = 'authored' | 'reviewed' | 'approved'
export type CommentSeverity = 'major' | 'minor' | 'query'
export type CommentStatus = 'open' | 'resolved'
export type ChecklistItemStatus = 'complete' | 'in-progress' | 'pending' | 'waived'
export type ICHSectionStatus = 'complete' | 'in-progress' | 'not-started' | 'warning'
export type TLFItemType = 'T' | 'L' | 'F'
export type ResolutionType = 'accept' | 'accept-with-modification' | 'reject'

export interface User {
  id: string
  name: string
  initials: string
  role: string
  email: string
  colourKey: keyof typeof USER_COLOURS
}

export interface Project {
  id: string
  name: string
  shortTitle: string
  client: string
  therapeuticArea: string
  phase: string
  status: ProjectStatus
  startDate: string
  dataCutoff?: string
  activeModules: string[]
  submissionCountries: string[]  // e.g. ['US', 'EU', 'JP'] — drives §16.4 requirement (FR-A-003)
  team: TeamMember[]
}

export interface TeamMember {
  userId: string
  name: string
  initials: string
  role: string
  raci: RACIRole
  colourKey: string
}

export interface Document {
  id: string
  projectId: string
  type: DocumentType
  title: string
  status: DocumentStatus
  stage: DocumentStage
  version: string
  assigneeId: string
  updatedAt: string | null
  sections: Section[]
}

export interface Section {
  id: string
  number: string
  title: string
  status: ICHSectionStatus
  presenceUserId?: string
  isLocked?: boolean
  lockedByUserId?: string
}

export interface Comment {
  id: string               // CMT-###
  documentId: string
  sectionRef: string
  reviewerId: string
  reviewerName: string
  reviewerInitials: string
  text: string
  severity: CommentSeverity
  status: CommentStatus
  createdAt: string
  age: string              // "3 days ago" — computed
}

export interface ChecklistItem {
  id: string
  templateItemId: string
  text: string
  framework: string
  frameworkMandatory: boolean
  status: ChecklistItemStatus
  completedBy?: string
  completedAt?: string
  waivedBy?: string
  waivedAt?: string
  waiverReason?: string
}

export interface AuditEntry {
  id: string
  timestamp: string
  actor: string
  actorInitials: string
  actorColourKey: string
  action: string
  eventType: 'content-edited' | 'ai-draft' | 'comment-added' | 'comment-resolved' | 'checklist-waived' | 'document-signed'
  detail: string
}

export interface SignatureRecord {
  id: string             // SIG-####-##
  signer: string
  initials: string
  role: string
  meaning: SignatureMeaning
  status: SignatureStatus
  step: number
  timestamp?: string
  authMethod?: string
  documentHash?: string
}

export interface CRMMeeting {
  id: string
  documentId: string
  documentTitle: string
  meetingRef: string        // "CRM-001" — sequential per document
  version: string
  date: string
  startTime: string
  endTime: string
  startedAt?: string
  chair: TeamMember
  attendees: TeamMember[]
  commentIds: string[]
  resolvedIds: string[]
  activeId: string | null
  pendingIds: string[]
}

export interface TLFItem {
  type: TLFItemType
  id: string
  title: string
  linkedSections: string[]
  referenceCount?: number
}

export interface MedDRATerm {
  pt: string
  code: string
  soc: string
  usedInDocument: boolean
  sections?: string[]
}

export interface ICHSection {
  section: string
  title: string
  status: ICHSectionStatus
  note?: string
}

export interface DocumentVersion {
  id: string
  versionNumber: string
  label: string
  createdBy: string
  createdAt: string
  isCurrent: boolean
  contentHash: string
}

export interface VoiceNote {
  id: string
  documentId: string
  sectionRef: string
  actorId: string
  actorName: string
  audioRef: string        // URL to audio file (Phase 2) or blob URL (Phase 1)
  transcript: string
  duration: number        // seconds
  createdAt: string
}

// --- API Request Body Types ---

export interface CreateDocumentBody {
  type: DocumentType
  title: string
  templateId?: string
  assigneeId: string
  targetCompletionDate?: string
  description?: string
}

export interface UpdateSectionBody {
  content: string
  sectionId: string
  aiDrafted?: boolean
  aiModel?: string
  sourceDocs?: string[]
}

export interface CompleteItemBody {
  completedBy: string
}

export interface WaiveItemBody {
  waivedBy: string
  reason: string
}

export interface RestoreSectionsBody {
  sections: Array<{ sectionId: string; fromVersionId: string }>
  reason: string
}

export interface SubmitForReviewBody {
  reviewType: 'parallel' | 'sequential'
  reviewers: Array<{ userId: string; raci: RACIRole }>
  dueDate: string
}

export interface AddCommentBody {
  sectionRef: string
  text: string
  severity: CommentSeverity
}

export interface ResolveCommentBody {
  resolutionType: ResolutionType
  note: string
}

export interface SignDocumentBody {
  meaning: SignatureMeaning
  credentialHash: string    // hashed password — never send plaintext
  scope?: string[]          // sections attested (defaults to whole document)
}

export interface AISuggestBody {
  sectionId: string
  prompt?: string
  context?: string
}

export interface AcceptSuggestionBody {
  sectionId: string
  text: string
  model: string
  sources: string[]
  generatedAt: string
}

// --- Lookup constants ---

export const USER_COLOURS = {
  MW: { bg: '#DBEAFE', text: '#1D4ED8' },
  SC: { bg: '#F0FDF4', text: '#15803D' },
  JO: { bg: '#F5F3FF', text: '#7C3AED' },
  EV: { bg: '#FEF3C7', text: '#D97706' },
  PN: { bg: '#FEE2E2', text: '#DC2626' },
  AH: { bg: '#E0F2FE', text: '#0369A1' },
  RT: { bg: '#FCE7F3', text: '#9D174D' },
  LP: { bg: '#F3F4F6', text: '#374151' },
  AI: { bg: '#F5F3FF', text: '#7C3AED' },
} as const

export const STATUS_META: Record<DocumentStatus, { bg: string; fg: string; label: string }> = {
  'in-authoring':     { bg: '#EFF6FF', fg: '#2563EB', label: 'In Authoring' },
  'in-review':        { bg: '#FFFBEB', fg: '#B45309', label: 'In Review' },
  'crm-in-progress':  { bg: '#F5F3FF', fg: '#7C3AED', label: 'CRM In Progress' },
  'signed':           { bg: '#F0FDF4', fg: '#15803D', label: 'Signed ✓' },
  'not-started':      { bg: '#F8FAFC', fg: '#64748B', label: 'Not Started' },
}

export const RACI_META: Record<RACIRole, { bg: string; fg: string; border?: string }> = {
  R: { bg: '#EFF6FF', fg: '#2563EB' },
  A: { bg: '#F0FDF4', fg: '#15803D' },
  C: { bg: '#F8FAFC', fg: '#64748B', border: '#E2E8F0' },
  I: { bg: '#F8FAFC', fg: '#94A3B8', border: '#E2E8F0' },
}
```

---

## 5. State Management (Zustand)

Five stores. Each store owns one domain concern. Screens read from and write to stores. Components receive store values as props.

```typescript
// store/authStore.ts
interface AuthStore {
  user: User | null
  isAuthenticated: boolean
  hasMFA: boolean
  hasAcceptedTC: boolean
  login: (email: string, password: string) => Promise<void>
  verifyMFA: (code: string) => Promise<void>
  acceptTC: () => void
  logout: () => void
}

// store/projectStore.ts
interface ProjectStore {
  projects: Project[]
  activeProject: Project | null
  isLoading: boolean
  filters: { status: string; ta: string; search: string }
  setActiveProject: (project: Project) => void
  setFilters: (filters: Partial<ProjectStore['filters']>) => void
  fetchProjects: () => Promise<void>
}

// store/documentStore.ts
interface DocumentStore {
  documents: Document[]
  activeDocument: Document | null
  activeSection: string | null          // e.g. "11.4.1"
  activePanel: PanelMode
  panelWidth: number                     // 260–760
  // diffMode is derived: diffVersions !== null means diff is active — no separate boolean
  diffVersions: { from: string; to: string } | null
  selectedForRestore: string[]           // section IDs selected in diff view
  presence: PresenceState[]             // active users per section
  setActivePanel: (panel: PanelMode) => void
  setPanelWidth: (width: number) => void
  setActiveSection: (sectionId: string) => void
  toggleDiffMode: (from: string, to: string) => void
  toggleSectionForRestore: (sectionId: string) => void
  clearRestoreSelection: () => void
  fetchDocuments: (projectId: string) => Promise<void>
}

// store/editorStore.ts
interface EditorStore {
  content: Record<string, string>        // sectionId → HTML content
  versions: DocumentVersion[]
  isDirty: boolean
  lastSavedAt: string | null
  aiSuggestion: AISuggestion | null
  aiState: 'idle' | 'loading' | 'suggestion' | 'refining'
  traceabilityTarget: string | null      // selected traceable value
  updateContent: (sectionId: string, html: string) => void
  acceptAISuggestion: () => void
  refineAISuggestion: (prompt: string) => void
  rejectAISuggestion: () => void
  setTraceabilityTarget: (value: string | null) => void
  save: () => Promise<void>
}

// store/crmStore.ts
interface CRMStore {
  meeting: CRMMeeting | null
  activeCommentId: string | null
  resolutionDraft: Partial<CRMResolution> | null
  setActiveComment: (commentId: string) => void
  saveResolution: (resolution: CRMResolution) => Promise<void>
  endMeeting: () => Promise<void>
}

interface PresenceState {
  userId: string
  sectionId: string
  isLocked: boolean
}

interface AISuggestion {
  text: string
  sources: string[]
  model: string
  generatedAt: string
}

interface DocumentVersion {
  id: string
  versionNumber: string
  label: string
  createdBy: string
  createdAt: string
  isCurrent: boolean
}

interface CRMResolution {
  commentId: string
  type: ResolutionType
  note: string
  resolvedBy: string
  resolvedAt: string
}
```

---

## 6. API Client Layer

The API layer is the boundary between the frontend and the backend (real or mocked). Components never call `fetch` directly — they always go through this layer. This is what makes the Phase 1 → Phase 2 transition seamless.

```typescript
// api/client.ts — base fetch wrapper
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

async function request<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      // Phase 2: add Authorization header here
    },
    ...options,
  })
  if (!response.ok) throw new ApiError(response.status, await response.json())
  return response.json()
}

export const api = {
  get:    <T>(endpoint: string) => request<T>(endpoint),
  post:   <T>(endpoint: string, body: unknown) => request<T>(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  put:    <T>(endpoint: string, body: unknown) => request<T>(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
  patch:  <T>(endpoint: string, body: unknown) => request<T>(endpoint, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(endpoint: string) => request<T>(endpoint, { method: 'DELETE' }),
}
```

```typescript
// api/auth.ts — Authentication
import { api } from './client'
import type { User } from '@platform/types'

export const authApi = {
  login:     (body: { email: string; password: string }) =>
               api.post<{ sessionToken: string; requiresMFA: boolean }>('/auth/login', body),
  verifyMFA: (body: { code: string }) =>
               api.post<{ sessionToken: string }>('/auth/mfa', body),
  me:        () => api.get<User>('/auth/me'),
  logout:    () => api.post<void>('/auth/logout', {}),
}

// api/documents.ts — Module A document API calls
import { api } from './client'
import type { Document, ChecklistItem, AuditEntry, Comment, AISuggestion } from '@platform/types'

export const documentsApi = {
  // Document CRUD
  list:             (projectId: string) =>
                      api.get<Document[]>(`/projects/${projectId}/documents`),
  get:              (documentId: string) =>
                      api.get<Document>(`/documents/${documentId}`),
  create:           (projectId: string, body: CreateDocumentBody) =>
                      api.post<Document>(`/projects/${projectId}/documents`, body),
  updateSection:    (documentId: string, sectionId: string, body: UpdateSectionBody) =>
                      api.patch<Document>(`/documents/${documentId}/sections/${sectionId}`, body),

  // Checklist
  getChecklist:     (documentId: string) =>
                      api.get<ChecklistItem[]>(`/documents/${documentId}/checklist`),
  completeItem:     (documentId: string, itemId: string, body: CompleteItemBody) =>
                      api.patch<ChecklistItem>(`/documents/${documentId}/checklist/${itemId}/complete`, body),
  waiveItem:        (documentId: string, itemId: string, body: WaiveItemBody) =>
                      api.patch<ChecklistItem>(`/documents/${documentId}/checklist/${itemId}/waive`, body),

  // Audit trail
  getAuditTrail:    (documentId: string) =>
                      api.get<AuditEntry[]>(`/documents/${documentId}/audit`),

  // Versioning & diff
  getVersions:      (documentId: string) =>
                      api.get<DocumentVersion[]>(`/documents/${documentId}/versions`),
  restoreSections:  (documentId: string, body: RestoreSectionsBody) =>
                      api.post<Document>(`/documents/${documentId}/restore`, body),

  // Review workflow
  submitForReview:  (documentId: string, body: SubmitForReviewBody) =>
                      api.post<Document>(`/documents/${documentId}/submit-for-review`, body),

  // Comments
  getComments:      (documentId: string) =>
                      api.get<Comment[]>(`/documents/${documentId}/comments`),
  addComment:       (documentId: string, body: AddCommentBody) =>
                      api.post<Comment>(`/documents/${documentId}/comments`, body),
  resolveComment:   (documentId: string, commentId: string, body: ResolveCommentBody) =>
                      api.patch<Comment>(`/documents/${documentId}/comments/${commentId}/resolve`, body),

  // E-signature
  getSignatureChain:(documentId: string) =>
                      api.get<SignatureRecord[]>(`/documents/${documentId}/signature-chain`),
  sign:             (documentId: string, body: SignDocumentBody) =>
                      api.post<SignatureRecord>(`/documents/${documentId}/sign`, body),

  // AI
  aiSuggest:        (documentId: string, body: AISuggestBody) =>
                      api.post<AISuggestion>(`/documents/${documentId}/ai-suggest`, body),
  acceptSuggestion: (documentId: string, body: AcceptSuggestionBody) =>
                      api.post<Document>(`/documents/${documentId}/ai-accept`, body),
}
```

React Query wraps every API call. Components use hooks, not raw API calls.

`queryClient` is instantiated once in `main.tsx` and provided via `QueryClientProvider`:

```typescript
// main.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } }
})

root.render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>
)
```

```typescript
// hooks/useDocument.ts
export const useDocument = (documentId: string) =>
  useQuery(['document', documentId], () => documentsApi.get(documentId))

export const useDocuments = (projectId: string) =>
  useQuery(['documents', projectId], () => documentsApi.list(projectId))

export const useCompleteChecklistItem = () =>
  useMutation(
    ({ documentId, itemId, completedBy }: CompleteItemParams) =>
      documentsApi.completeItem(documentId, itemId, { completedBy }),
    { onSuccess: () => queryClient.invalidateQueries(['checklist']) }
  )
```

---

## 7. MSW Mock Handlers (Phase 1)

MSW intercepts all API calls and returns mock data from the JSON files in `/data`. When Phase 2 begins, delete the handlers — nothing else changes.

```typescript
// mocks/handlers/documents.ts
import { rest } from 'msw'
import documents from '../../data/documents.json'
import checklist from '../../data/checklist.json'
import auditTrail from '../../data/auditTrail.json'

export const documentHandlers = [
  rest.get('/api/projects/:projectId/documents', (req, res, ctx) =>
    res(ctx.delay(200), ctx.json(documents))
  ),
  rest.get('/api/documents/:documentId', (req, res, ctx) => {
    const doc = documents.find(d => d.id === req.params.documentId)
    return doc
      ? res(ctx.delay(150), ctx.json(doc))
      : res(ctx.status(404), ctx.json({ error: 'Not found' }))
  }),
  rest.get('/api/documents/:documentId/checklist', (req, res, ctx) =>
    res(ctx.delay(100), ctx.json(checklist))
  ),
  rest.patch('/api/documents/:documentId/checklist/:itemId/waive', async (req, res, ctx) => {
    const body = await req.json()
    // Simulate updating the item — in Phase 1 just return the body
    return res(ctx.delay(300), ctx.json({ ...body, status: 'waived' }))
  }),
  rest.get('/api/documents/:documentId/audit', (req, res, ctx) =>
    res(ctx.delay(200), ctx.json(auditTrail))
  ),
]

// mocks/browser.ts
import { setupWorker } from 'msw'
import { documentHandlers } from './handlers/documents'
import { projectHandlers } from './handlers/projects'
import { aiHandlers } from './handlers/ai'

export const worker = setupWorker(
  ...documentHandlers,
  ...projectHandlers,
  ...aiHandlers,
)

// main.tsx — start MSW in development only
if (import.meta.env.DEV) {
  const { worker } = await import('./mocks/browser')
  await worker.start({ onUnhandledRequest: 'bypass' })
}
```

---

## 8. Utility Functions

```typescript
// utils/simulateAI.ts
const CANNED_RESPONSE = {
  text: "The Kaplan–Meier analysis demonstrated robust separation of PFS curves between the Veloricept combination arm and control from Week 8, with the hazard ratio of 0.61 indicating a 39% reduction in the risk of progression or death.",
  sources: ['Table 14.2.1', 'SAP v2.0 §6.3', 'KM Analysis Dataset'],
  model: 'claude-sonnet',
  generatedAt: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' UTC',
}

export const simulateAI = (prompt: string, delayMs = 1200): Promise<typeof CANNED_RESPONSE> =>
  new Promise(resolve => setTimeout(() => resolve(CANNED_RESPONSE), delayMs))

// utils/simulateRestore.ts
export const simulateRestore = (
  sections: string[],
  fromVersion: string,
  reason: string
): Promise<{ newVersion: string; message: string }> =>
  new Promise(resolve =>
    setTimeout(() => resolve({
      newVersion: 'v0.5',
      message: `${sections.length} section(s) restored from ${fromVersion}. New version v0.5 created.`,
    }), 800)
  )

// utils/statusMeta.ts — re-exports STATUS_META from types for convenience
export { STATUS_META, RACI_META, USER_COLOURS } from '@platform/types'

// utils/formatDate.ts
export const formatDate = (isoString: string): string =>
  new Date(isoString).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

export const formatTimestamp = (isoString: string): string =>
  new Date(isoString).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'

// utils/diffUtils.ts — for Screen 24
export interface DiffChange {
  type: 'unchanged' | 'added' | 'removed' | 'replaced'
  oldText?: string
  newText?: string
  isAIDrafted?: boolean
  sectionId?: string
}

export const computeDiff = (v1: string, v2: string): DiffChange[] => {
  // Phase 1: returns hardcoded VELORA-301 diff for §11.4.1
  // Phase 2: implement real diff algorithm (e.g. diff-match-patch library)
  return MOCK_DIFF_CHANGES
}
```

---

## 9. Routing

React Router v6. Routes mirror the application's navigation hierarchy.

```typescript
// router/index.tsx
import { createBrowserRouter } from 'react-router-dom'

export const router = createBrowserRouter([
  // Auth screens (no shell)
  { path: '/sign-in',     element: <SignIn /> },
  { path: '/mfa',         element: <MFAVerify /> },
  { path: '/terms',       element: <TCGate /> },

  // Authenticated shell
  {
    path: '/',
    element: <AuthGuard><AppShell /></AuthGuard>,
    children: [
      { index: true,                    element: <Navigate to="/projects" /> },
      { path: 'projects',               element: <AllProjects /> },
      { path: 'projects/new',           element: <NewProjectWizard /> },
      {
        path: 'projects/:projectId',
        element: <ProjectDashboard />,
        children: [
          // Module A — Clinical Writing
          {
            path: 'clinical-writing',
            children: [
              { index: true,            element: <ClinicalWritingHome /> },
              { path: 'new',            element: <NewDocumentDrawer /> },
              { path: 'classify',       element: <AutoClassification /> },
              { path: 'comments',       element: <CommentsDashboard /> },
              { path: 'portfolio',      element: <PortfolioDashboard /> },
              { path: 'audit-review',   element: <AuditReviewAlert /> },
              { path: 'crm',            element: <CRMModule /> },
              {
                path: 'documents/:documentId',
                children: [
                  { index: true,        element: <DocumentEditor /> },
                  { path: 'diff',       element: <DiffView /> },
                  { path: 'review',     element: <ReviewerView /> },
                  { path: 'sign',       element: <ESignature /> },
                  { path: 'final',      element: <FinalDocument /> },
                ],
              },
            ],
          },
          // Modules B–E (stub routes — Phase 2+)
          { path: 'scientific-writing', element: <ModuleComingSoon module="Scientific Writing" /> },
          // Module C — Medical Writing: full route tree in §24
          { path: 'regulatory-writing', element: <ModuleComingSoon module="Regulatory Writing" /> },
          { path: 'ideation',           element: <ModuleComingSoon module="Ideation & Publishing" /> },
        ],
      },
    ],
  },

  // Catch-all
  { path: '*', element: <Navigate to="/projects" /> },
])
```

**Navigation triggers per screen transition:**

| From | Action | To |
|------|--------|----|
| Sign-in | Successful auth + MFA | Terms gate (first login) or All Projects |
| Terms gate | Both boxes checked + Continue | All Projects |
| All Projects | Click project row | Project Dashboard |
| All Projects | Click + New Project | New Project Wizard |
| Project Dashboard | Click Open Clinical Writing | Clinical Writing Home |
| Clinical Writing Home | Click document row → Open in editor | Document Editor |
| Clinical Writing Home | Click + New Document | New Document Drawer (overlay) |
| Clinical Writing Home | Click Upload existing | Auto-Classification |
| Document Editor | Click Submit for review | Review Assignment Panel (overlay) |
| Document Editor | Click v0.4 chip | Diff View |
| Document Editor | Click Sign | E-Signature |
| Review Assignment Panel | Submit for review | Clinical Writing Home (status updated) |
| Reviewer View | Approve/Return | Clinical Writing Home |
| E-Signature | Sign complete | Final Document |
| Final Document | — | Read-only, no further navigation |
| Project Dashboard | Click Comments | Comments Dashboard |
| Project Dashboard | Click Portfolio | Portfolio Dashboard |
| Project Dashboard | Click Audit Review | Audit Review Alert |
| Project Dashboard | Click CRM | CRM Module |
| CRM active card | Click Resolve → | Comment Resolution Panel (overlay) |
| Document Editor toolbar | Click Voice note button | Voice Note Panel (overlay — not a route) |
| Document Editor toolbar | Click Checklist button | Checklist Panel (overlay — not a route) |
| Document Editor toolbar | Click Audit trail button | Audit Trail Panel (overlay — not a route) |
| Document Editor toolbar | Reference ▾ → ICH E3 Validator | ICH E3 Validator Panel (overlay — not a route) |
| Document Editor toolbar | Reference ▾ → MedDRA Lookup | MedDRA Lookup Panel (overlay — not a route) |
| Document Editor toolbar | Reference ▾ → TLF Cross-Reference | TLF Cross-Reference Panel (overlay — not a route) |
| Clinical Writing Home | Click Open in editor (Reviewer View) | Reviewer View (same route as Document Editor, role-adapted) |
| Clinical Writing Home | Click Portfolio tab | Portfolio Dashboard |
| Clinical Writing Home | Click Audit Review | Audit Review Alert |

**Note on overlay panels:** `ReviewAssignmentPanel`, `CommentResolutionPanel`, `VoiceNotePanel`, `AuditTrailPanel`, `ICHValidatorPanel`, `MedDRAPanel`, and `TLFPanel` are **not routes**. They are overlay components mounted conditionally by their parent screen based on `activePanel` state in `documentStore`. They appear and disappear without URL changes. This is intentional — a URL change for a panel would break the back button behaviour in the editor flow.

---

## 10. Module Boundary Enforcement (CI)

ESLint rule enforces the monolith discipline from day one. Add to `.eslintrc`:

```json
{
  "rules": {
    "no-restricted-imports": ["error", {
      "patterns": [
        {
          "group": ["*/modules/scientific-writing/*"],
          "message": "Module A must not import from Module B. Use the platform interface layer."
        },
        {
          "group": ["*/modules/medical-writing/*"],
          "message": "Module A must not import from Module C."
        },
        {
          "group": ["*/modules/regulatory-writing/*"],
          "message": "Module A must not import from Module D."
        },
        {
          "group": ["*/modules/ideation/*"],
          "message": "Module A must not import from Module E."
        }
      ]
    }]
  }
}
```

This runs on every `git commit` via a pre-commit hook (Husky + lint-staged) and on every CI run. Violations fail the build — not a warning, an error.

---

## 11. Tailwind Configuration

CSS custom properties defined in `index.css` as fallback; Tailwind config extends the theme with Aurora tokens so utility classes match the design system exactly.

```typescript
// tailwind.config.ts
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Platform chrome
        slate: {
          900: '#1E293B',
          700: '#334155',
          600: '#475569',
          500: '#64748B',
          400: '#94A3B8',
          300: '#CBD5E1',
          200: '#E2E8F0',
          100: '#F1F5F9',
          50:  '#F8FAFC',
        },
      // Module A accent — Clinical Writing
        blue: {
          700: '#1D4ED8',
          600: '#2563EB',
          100: '#DBEAFE',
          50:  '#EFF6FF',
        },
        // Module B accent — Scientific Writing
        teal: {
          600: '#0D9488',
        },
        // Module C accent — Medical Writing (#7C3AED)
        violet: {
          700: '#6D28D9',
          600: '#7C3AED',
          100: '#EDE9FE',
          50:  '#F5F3FF',
        },
        // Module D accent — Regulatory Writing (amber)
        // Module E accent — Ideation & Publishing
        rose: {
          600: '#E11D48',
        },
        // All five module accents for reference:
        // A Clinical Writing:     #2563EB
        // B Scientific Writing:   #0D9488
        // C Medical Writing:      #7C3AED
        // D Regulatory Writing:   #D97706
        // E Ideation & Publishing: #E11D48
        // AI colours
        'ai-bg':     '#F0F7FF',
        'ai-border': '#93C5FD',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      boxShadow: {
        'focus':        '0 0 0 3px rgba(37, 99, 235, 0.12)',
        'panel':        '-16px 0 40px rgba(15, 23, 42, 0.12)',
        'modal':        '0 24px 60px rgba(15, 23, 42, 0.28)',
        'sticky-bar':   '0 -4px 12px rgba(15, 23, 42, 0.08)',
      },
      animation: {
        'shimmer':      'auroraShimmer 1.2s ease-in-out infinite',
        'pulse-blue':   'auroraPulse 2s ease-out infinite',
        'pulse-green':  'auroraGreenPulse 2s ease-out infinite',
        'pulse-amber':  'auroraAmberPulse 2s ease-out infinite',
      },
    },
  },
}
```

---

## 12. Development Setup

```bash
# 1. Clone and install
git clone https://github.com/genbiocat/aurora.git
cd aurora
npm install

# 2. Start web app (MSW runs automatically in dev mode)
cd apps/web
npm run dev
# → http://localhost:5173

# 3. Build check
npm run build

# 4. Type check
npm run typecheck

# 5. Lint (module boundary violations fail here)
npm run lint
```

**Environment variables (apps/web/.env.development):**
```
VITE_API_URL=http://localhost:3000/api
VITE_APP_NAME=Aurora
VITE_MOCK_DELAY_MS=200
```

---

## 13. Phase 1 → Phase 2 Transition Plan

When the 5-module prototype is complete and real backend development begins, the transition is:

| Step | Action | Effort |
|------|--------|--------|
| 1 | Scaffold `apps/api/` with Node.js/TypeScript/Express | 1–2 days |
| 2 | Run `prisma init` with the data model schema (Document 2) | 1 day |
| 3 | Implement API endpoints to match the contracts (Document 3) | Per endpoint |
| 4 | Delete MSW handlers one endpoint at a time as real endpoints go live | Incremental |
| 5 | Add `Authorization` header to `api/client.ts` | 1 hour |
| 6 | Replace `simulateAI()` with real Anthropic API call | 1 day |
| 7 | Add Socket.io for real-time presence (FR-A-053) | 3–5 days |

No component rewrites. No store rewrites. No type changes. The investment made in Phase 1 carries forward completely.

---

## 14. Document Revision History

| Version | Date | Summary |
|---------|------|---------|
| 1.0 | Sept 2026 | Initial version. Covers prototype-to-production architecture. Stack: React + TypeScript + Tailwind + Zustand + MSW + React Query + React Router v6. Module boundary enforcement via ESLint. Phase 1→2 transition plan. |
| 2.0 | Sept 2026 | Module B: Scientific Writing appended. §15–§22 cover Module B routes, types, stores, API client, MSW handlers, shared components, and architectural patterns introduced by Module B screens. |
| 3.0 | Sept 2026 | Module C: Medical Writing appended. §23–§29 cover Module C routes, types, stores, API client, MSW handlers, shared components (FKGaugeBadge, ComplianceTrackChip, ReviewTierBadge, ContentExpiryChip, MLRCommentCard), and six new architectural patterns: pre-MLR + agentic sequential pipeline, Claims Matrix panel, FK readability gate, tier-based MLR routing, content expiry tracking, and ACCME/MLR dual compliance track. |

---

## MODULE B — SCIENTIFIC WRITING
### Appendix to Technical Architecture v1.0

---

## 15. Module B Overview

Module B — Scientific Writing — adds ten screens to the Aurora prototype. It shares the existing platform shell (TopNav, Sidebar, AppShell, AuthGuard) and all Module A UI primitives. Module B introduces four new architectural patterns not present in Module A:

1. **Resizable right panel with drag grip** — imperative DOM resize via `useRef` + `ResizeObserver` (B03, B04)
2. **Congress switcher modal** — full-screen overlay with searchable list (B07)
3. **Cross-module source chip** — compact provenance chip linking Scientific Writing content to Clinical Writing source documents (all cards, B03, B09)
4. **AI footprint tracking** — per-section human/AI ratio, immutable audit record (B03)

Module B is scoped to `modules/scientific-writing/` and must not import from any other module folder. The ESLint boundary rule in §10 is extended in §22.

---

## 16. Module B Routes

The `scientific-writing` stub route in §9 is replaced with a full route tree:

```typescript
// router/index.tsx — scientific-writing subtree (replaces ModuleComingSoon stub)
{
  path: 'scientific-writing',
  children: [
    { index: true,                          element: <ScientificWritingHome /> },        // B01
    { path: 'new',                          element: <NewPublicationWizard /> },         // B02
    { path: 'authors',                      element: <AuthorManagement /> },             // B05
    { path: 'submission-readiness',         element: <JournalSubmissionReadiness /> },   // B06
    { path: 'congress-export',              element: <CongressAbstractExport /> },       // B07
    { path: 'portfolio',                    element: <PortfolioDashboard /> },           // B10
    {
      path: 'publications/:publicationId',
      children: [
        { index: true,                      element: <ManuscriptEditor /> },             // B03
        { path: 'peer-review',              element: <PeerReviewResponse /> },           // B08
        { path: 'final',                    element: <FinalOutput /> },                  // B09
      ],
    },
  ],
}
```

**Note — B04 Literature & Citation Panel:** B04 is not a route. It is a right panel mounted conditionally inside `ManuscriptEditor` (B03) when `activePanel === 'literature'`, following the same overlay pattern as Module A's AI and TLF panels.

**Navigation triggers — Module B:**

| From | Action | To |
|------|--------|-----|
| Scientific Writing Home (B01) | Click publication card | Manuscript Editor (B03) |
| Scientific Writing Home (B01) | Click + New publication | New Publication Wizard (B02) |
| Scientific Writing Home (B01) | Click Upload existing | New Publication Wizard (B02) step 1 |
| Scientific Writing Home (B01) | Sidebar → Authors & ICMJE | Author Management (B05) |
| Scientific Writing Home (B01) | Sidebar → Portfolio | Portfolio Dashboard (B10) |
| Manuscript Editor (B03) | Click Submit for review → | Review Assignment Panel (reused from Module A) |
| Manuscript Editor (B03) | Toolbar → Literature | Literature & Citation Panel (B04, overlay) |
| Manuscript Editor (B03) | Toolbar → TLF reference | TLF Reference Panel (reused from Module A S27) |
| Manuscript Editor (B03) | Click CONSORT items | CONSORT panel (right panel mode) |
| Manuscript Editor (B03) | Publication toolbar → submission | Journal Submission Readiness (B06) |
| Journal Submission Readiness (B06) | Complete all checks | Congress Abstract Export (B07) |
| Manuscript Editor (B03) | Stage 6 reached | Final Output (B09) |
| Final Output (B09) | Published → portfolio | Portfolio Dashboard (B10) |
| Portfolio Dashboard (B10) | Click publication row | Manuscript Editor (B03) or Final Output (B09) |
| Any screen | Sidebar → Home | Scientific Writing Home (B01) |

---

## 17. Module B TypeScript Types

All Module B types are appended to `packages/types/src/domain.ts`.

```typescript
// ─── Module B domain types ───────────────────────────────────────────────────

// Publication types
export type PublicationType =
  | 'manuscript'
  | 'abstract'
  | 'poster'
  | 'white-paper'
  | 'letter'
  | 'pls'          // plain language summary
  | 'press-release'

export type ManuscriptSubtype = 'original-research' | 'review' | 'case-report'

export type PublicationStage =
  | 'planning'
  | 'authoring'
  | 'review'
  | 'submission'
  | 'published'

export type PublicationStatus =
  | 'not-started'
  | 'in-authoring'
  | 'in-review'
  | 'under-peer-review'
  | 'submitted'
  | 'published'

export type EquatorGuideline = 'CONSORT' | 'STROBE' | 'PRISMA' | 'MOOSE'

export type BAAStatus = 'not-applicable' | 'pending' | 'confirmed' | 'blocked'

export type PanelModeB =
  | 'footprint'
  | 'suggest'
  | 'literature'
  | 'tlf'
  | 'balance'
  | 'consort'
  | null

export type CongressId = 'asco' | 'esmo' | 'ash' | 'aacr' | 'sitc'

export type ReviewerTab = 'r1' | 'r2' | 'r3' | 'ed'

export type PeerReviewStatus = 'not-started' | 'drafting' | 'responded'

// Publication entity
export interface Publication {
  id: string
  projectId: string
  type: PublicationType
  subtype?: ManuscriptSubtype       // only when type === 'manuscript'
  title: string
  stage: PublicationStage
  status: PublicationStatus
  version: string
  guideline: EquatorGuideline
  journal?: string
  targetSubmissionDate?: string
  keyMessage?: string
  baaStatus: BAAStatus
  ownerId: string
  ownerInitials: string
  sourceDocumentId?: string         // linked Clinical Writing CSR (FR-B-025, OQ-B-001)
  sourceDocumentLabel?: string      // e.g. 'VELORA-301 CSR v1.0 · Module A'
  createdAt: string
  updatedAt: string
}

// AI footprint — per section span, immutable once written
export interface AIFootprintSpan {
  spanId: string
  publicationId: string
  sectionId: string
  startOffset: number
  endOffset: number
  model: string
  generatedAt: string
  acceptedBy: string
  acceptedAt: string
}

export interface AIFootprintSummary {
  publicationId: string
  totalChars: number
  aiChars: number
  humanChars: number
  aiPercent: number                 // rounded integer
  bySection: Array<{
    sectionId: string
    sectionLabel: string
    aiPercent: number
  }>
  computedAt: string
}

// Citations
export interface Citation {
  id: string
  publicationId: string
  pmid?: string                     // null for project source documents
  title: string
  shortRef: string                  // e.g. 'Gandhi L et al., NEJM 2018'
  fullRef: string                   // Vancouver-formatted full citation
  locus: string                     // e.g. '§Results ¶1' — where inserted
  label: string                     // computed: '[1]', '[2]', etc.
  isSourceDocument: boolean         // true = Clinical Writing source, cannot remove
  insertedBy: string
  insertedAt: string
}

// ICMJE authorship
export interface ICMJECriterion {
  index: 0 | 1 | 2 | 3             // 0-based; maps to the 4 ICMJE 2023 criteria
  met: boolean
  confirmedBy?: string
  confirmedAt?: string
}

export interface PublicationAuthor {
  id: string
  publicationId: string
  userId?: string                   // null for external KOLs
  name: string
  initials: string
  role: string
  raci: RACIRole
  isExternal: boolean
  icmjeCriteria: ICMJECriterion[]  // always 4 entries
  icmjeAcknowledged: boolean        // publication manager has acknowledged soft gate
  icmjeAcknowledgedBy?: string
  icmjeAcknowledgedAt?: string
  coiStatus: 'submitted' | 'pending'
  coiSubmittedAt?: string
  debarmentStatus: 'clear' | 'flagged' | 'unchecked'
  debarmentCheckedAt?: string
}

// Congress submission
export interface CongressSubmission {
  id: string
  publicationId: string
  congressId: CongressId
  congressName: string
  characterLimit: number
  keywordsRequired: number
  keywordsEntered: number
  deadline: string
  portalUrl: string
  characterCount: number            // computed from abstract content
  status: 'draft' | 'exported' | 'submitted'
  exportedAt?: string
}

// Journal submission readiness checks
export type CheckState = 'pass' | 'warn' | 'ack' | 'block'

export interface SubmissionCheck {
  id: string
  publicationId: string
  groupId: string
  label: string
  state: CheckState
  note: string
  resolvedBy?: string
  resolvedAt?: string
}

// Peer review
export interface PeerReviewRound {
  id: string
  publicationId: string
  roundNumber: number
  journalSubmissionRef: string
  reviewerCount: number
  createdAt: string
}

export interface ReviewerComment {
  id: string
  roundId: string
  reviewerTab: ReviewerTab
  commentNumber: number
  commentText: string
  responseText: string
  status: PeerReviewStatus
  aiDrafted: boolean
  respondedBy?: string
  respondedAt?: string
}

// Portfolio
export interface PortfolioCard {
  id: string
  publicationId: string
  cardType: 'abstract' | 'primary-endpoint' | 'equator-checklist' | 'citation'
  name: string
  note: string
  availableInModules: string[]      // e.g. ['medical-writing', 'ideation']
  createdAt: string
}

// DOI / ORCID (Module E service, Module B consumes — OQ-E-006)
export interface DOIRecord {
  publicationId: string
  doi: string
  registrar: 'crossref'
  registeredAt: string
}

export interface ORCIDVerification {
  authorId: string
  orcid: string
  verified: boolean
  verifiedAt: string
}

// ─── Module B request body types ─────────────────────────────────────────────

export interface CreatePublicationBody {
  type: PublicationType
  subtype?: ManuscriptSubtype
  guideline: EquatorGuideline
  journal?: string
  targetSubmissionDate?: string
  keyMessage?: string
  baaStatus: BAAStatus
  sourceDocumentId?: string
  teamRoles: Array<{ userId: string; raci: RACIRole }>
}

export interface InsertCitationBody {
  pmid?: string
  title: string
  shortRef: string
  fullRef: string
  locus: string
  isSourceDocument?: boolean
}

export interface UpdateICMJEBody {
  criterionIndex: 0 | 1 | 2 | 3
  met: boolean
}

export interface AcknowledgeICMJEBody {
  acknowledgedBy: string
}

export interface DebarmentCheckBody {
  authorIds: string[]
}

export interface CongressExportBody {
  congressId: CongressId
  keywordsEntered: number
}

export interface SubmitResponseLetterBody {
  roundId: string
  commentResponses: Array<{ commentId: string; responseText: string; aiDrafted: boolean }>
  letterVersion: string
}

export interface AcceptAIResponseBody {
  commentId: string
  responseText: string
  model: string
  generatedAt: string
}

// ─── Module B lookup constants ────────────────────────────────────────────────

export const PUBLICATION_STATUS_META: Record<PublicationStatus, { bg: string; fg: string; label: string }> = {
  'not-started':        { bg: '#F8FAFC', fg: '#64748B', label: 'Not Started' },
  'in-authoring':       { bg: '#EFF6FF', fg: '#2563EB', label: 'In Authoring' },
  'in-review':          { bg: '#FFFBEB', fg: '#B45309', label: 'In Review' },
  'under-peer-review':  { bg: '#FFFBEB', fg: '#B45309', label: 'Under Peer Review' },
  'submitted':          { bg: '#F0FDF4', fg: '#15803D', label: 'Submitted ✓' },
  'published':          { bg: '#F0FDF4', fg: '#15803D', label: 'Published ✓' },
}

export const PUBLICATION_TYPE_META: Record<PublicationType, { label: string; bg: string; fg: string }> = {
  'manuscript':     { label: 'MANUSCRIPT',     bg: '#F0FDFA', fg: '#0F766E' },
  'abstract':       { label: 'ABSTRACT',       bg: '#F0FDFA', fg: '#0F766E' },
  'poster':         { label: 'POSTER',         bg: '#F1F5F9', fg: '#64748B' },
  'white-paper':    { label: 'WHITE PAPER',    bg: '#F1F5F9', fg: '#64748B' },
  'letter':         { label: 'LETTER',         bg: '#F1F5F9', fg: '#64748B' },
  'pls':            { label: 'PLS',            bg: '#F1F5F9', fg: '#64748B' },
  'press-release':  { label: 'PRESS RELEASE',  bg: '#F1F5F9', fg: '#64748B' },
}

export const EQUATOR_META: Record<EquatorGuideline, { items: number; year: number }> = {
  CONSORT: { items: 25, year: 2010 },
  STROBE:  { items: 22, year: 2007 },
  PRISMA:  { items: 27, year: 2020 },
  MOOSE:   { items: 35, year: 2000 },
}

export const CONGRESS_META: Record<CongressId, {
  name: string; short: string; limit: number; keywords: number;
  deadline: string; portal: string; sections: string
}> = {
  asco: { name: 'ASCO Annual Meeting 2027', short: 'ASCO 2027', limit: 3000, keywords: 5,
          deadline: 'Deadline 01 Dec 2026', portal: 'abstract.asco.org',
          sections: 'Background / Methods / Results / Conclusions' },
  esmo: { name: 'ESMO Congress 2027', short: 'ESMO 2027', limit: 2500, keywords: 4,
          deadline: 'Deadline 15 Apr 2027', portal: 'esmo.org/abstracts',
          sections: 'Background / Methods / Results / Conclusions' },
  ash:  { name: 'ASH Annual Meeting 2026', short: 'ASH 2026', limit: 3800, keywords: 3,
          deadline: 'Deadline 04 Aug 2026', portal: 'hematology.org/abstracts',
          sections: 'Introduction / Methods / Results / Conclusion' },
  aacr: { name: 'AACR Annual Meeting 2027', short: 'AACR 2027', limit: 2200, keywords: 5,
          deadline: 'Deadline 24 Nov 2026', portal: 'aacr.org/abstracts',
          sections: 'Background / Methods / Results / Conclusions' },
  sitc: { name: 'SITC Annual Meeting 2026', short: 'SITC 2026', limit: 2800, keywords: 4,
          deadline: 'Deadline 12 Jul 2026', portal: 'sitcancer.org/abstracts',
          sections: 'Background / Methods / Results / Conclusions' },
}

export const CHECK_STATE_META: Record<CheckState, { bg: string; fg: string; rule: string; tag: string; tagBg: string; tagFg: string }> = {
  pass:  { bg: '#FFFFFF', fg: '#64748B', rule: 'transparent', tag: 'Pass',         tagBg: '#F0FDF4', tagFg: '#15803D' },
  warn:  { bg: '#FFFBEB', fg: '#475569', rule: '#D97706',     tag: 'Advisory',     tagBg: '#FFFBEB', tagFg: '#B45309' },
  ack:   { bg: '#FFFBEB', fg: '#475569', rule: '#D97706',     tag: 'Acknowledged', tagBg: '#F1F5F9', tagFg: '#475569' },
  block: { bg: '#EFF6FF', fg: '#475569', rule: '#005F8E',     tag: 'Blocking',     tagBg: '#EFF6FF', tagFg: '#005F8E' },
}
```

---

## 18. Module B State Management (Zustand)

Five new stores, scoped to `modules/scientific-writing/store/`. Each follows the same pattern as Module A stores — screens read and write, components receive values as props.

```typescript
// modules/scientific-writing/store/publicationStore.ts
interface PublicationStore {
  publications: Publication[]
  activePublication: Publication | null
  activePanel: PanelModeB
  panelWidth: number                        // 280–760, default 280
  isLoading: boolean
  filters: { stage: PublicationStage | 'all'; type: PublicationType | 'all'; search: string }
  setActivePublication: (pub: Publication) => void
  setActivePanel: (panel: PanelModeB) => void
  setPanelWidth: (width: number) => void
  setFilters: (f: Partial<PublicationStore['filters']>) => void
  fetchPublications: (projectId: string) => Promise<void>
}

// modules/scientific-writing/store/citationStore.ts
interface CitationStore {
  citations: Citation[]               // ordered; index + 1 = Vancouver label number
  isLoading: boolean
  pubmedQuery: string
  pubmedResults: PubMedResult[]
  insertCitation: (publicationId: string, body: InsertCitationBody) => Promise<void>
  removeCitation: (publicationId: string, citationId: string) => Promise<void>
  searchPubMed: (query: string) => Promise<void>
  fetchCitations: (publicationId: string) => Promise<void>
}

interface PubMedResult {
  id: string                          // internal ID key
  pmid: string
  title: string
  source: string                      // 'Author et al. · Journal · Year'
  abstractText: string
  keys: string                        // keyword string for client-side search
  isInserted: boolean                 // derived: true if PMID in citationStore.citations
}

// modules/scientific-writing/store/authorStore.ts
interface AuthorStore {
  authors: PublicationAuthor[]
  openAuthorId: string | null         // which row is expanded
  isCheckingDebarment: boolean
  debarmentLastRun: string | null
  setOpenAuthor: (authorId: string | null) => void
  toggleICMJE: (authorId: string, criterionIndex: number) => Promise<void>
  acknowledgeICMJE: (authorId: string, body: AcknowledgeICMJEBody) => Promise<void>
  runDebarmentCheck: (publicationId: string) => Promise<void>
  sendReminder: (authorId: string) => Promise<void>
  fetchAuthors: (publicationId: string) => Promise<void>
}

// modules/scientific-writing/store/reviewStore.ts
interface ReviewStore {
  rounds: PeerReviewRound[]
  activeRound: PeerReviewRound | null
  comments: ReviewerComment[]
  activeReviewerTab: ReviewerTab
  activeCommentId: string | null
  previewOpen: boolean
  draftText: Record<string, string>   // commentId → draft response text
  aiDrafted: Record<string, boolean>  // commentId → whether AI-drafted
  setActiveTab: (tab: ReviewerTab) => void
  setActiveComment: (commentId: string) => void
  updateDraft: (commentId: string, text: string) => void
  draftWithAI: (commentId: string) => Promise<void>
  markComplete: (commentId: string, respondedBy: string) => Promise<void>
  reopenComment: (commentId: string) => void
  togglePreview: () => void
  submitLetter: (body: SubmitResponseLetterBody) => Promise<void>
  fetchRound: (publicationId: string) => Promise<void>
}

// modules/scientific-writing/store/congressStore.ts
interface CongressStore {
  activeCongressId: CongressId
  keywordsEntered: number
  switcherOpen: boolean
  characterCount: number              // computed from abstract content
  setActiveCongress: (id: CongressId) => void
  setKeywords: (n: number) => void
  setSwitcherOpen: (open: boolean) => void
  downloadExport: (publicationId: string) => Promise<void>
}
```

---

## 19. Module B API Client Layer

New file `modules/scientific-writing/api/publications.ts`. Follows the same `api.get/post/patch/delete` pattern as Module A.

```typescript
// modules/scientific-writing/api/publications.ts
import { api } from '../../../../api/client'
import type {
  Publication, Citation, PublicationAuthor, CongressSubmission,
  SubmissionCheck, PeerReviewRound, ReviewerComment, AIFootprintSummary,
  PortfolioCard, DOIRecord, ORCIDVerification,
  CreatePublicationBody, InsertCitationBody, UpdateICMJEBody,
  AcknowledgeICMJEBody, DebarmentCheckBody, CongressExportBody,
  SubmitResponseLetterBody, AcceptAIResponseBody,
} from '@platform/types'

export const publicationsApi = {
  // Publications CRUD
  list:                   (projectId: string) =>
                            api.get<Publication[]>(`/projects/${projectId}/publications`),
  get:                    (pubId: string) =>
                            api.get<Publication>(`/publications/${pubId}`),
  create:                 (projectId: string, body: CreatePublicationBody) =>
                            api.post<Publication>(`/projects/${projectId}/publications`, body),
  advanceStage:           (pubId: string) =>
                            api.post<Publication>(`/publications/${pubId}/advance-stage`, {}),

  // AI footprint
  getFootprint:           (pubId: string) =>
                            api.get<AIFootprintSummary>(`/publications/${pubId}/footprint`),

  // Citations
  getCitations:           (pubId: string) =>
                            api.get<Citation[]>(`/publications/${pubId}/citations`),
  insertCitation:         (pubId: string, body: InsertCitationBody) =>
                            api.post<Citation>(`/publications/${pubId}/citations`, body),
  removeCitation:         (pubId: string, citationId: string) =>
                            api.delete<void>(`/publications/${pubId}/citations/${citationId}`),
  searchPubMed:           (query: string) =>
                            api.get<PubMedResult[]>(`/pubmed/search?q=${encodeURIComponent(query)}`),

  // Authors + ICMJE
  getAuthors:             (pubId: string) =>
                            api.get<PublicationAuthor[]>(`/publications/${pubId}/authors`),
  updateICMJE:            (pubId: string, authorId: string, body: UpdateICMJEBody) =>
                            api.patch<PublicationAuthor>(`/publications/${pubId}/authors/${authorId}/icmje`, body),
  acknowledgeICMJE:       (pubId: string, authorId: string, body: AcknowledgeICMJEBody) =>
                            api.post<PublicationAuthor>(`/publications/${pubId}/authors/${authorId}/icmje/acknowledge`, body),
  runDebarmentCheck:      (pubId: string, body: DebarmentCheckBody) =>
                            api.post<{ checkedAt: string; results: Array<{ authorId: string; status: 'clear' | 'flagged' }> }>(`/publications/${pubId}/debarment-check`, body),
  sendAuthorReminder:     (pubId: string, authorId: string) =>
                            api.post<void>(`/publications/${pubId}/authors/${authorId}/remind`, {}),

  // Submission readiness
  getChecks:              (pubId: string) =>
                            api.get<SubmissionCheck[]>(`/publications/${pubId}/submission-checks`),
  runChecks:              (pubId: string) =>
                            api.post<SubmissionCheck[]>(`/publications/${pubId}/submission-checks/run`, {}),
  acknowledgeCheck:       (pubId: string, checkId: string, body: { acknowledgedBy: string }) =>
                            api.patch<SubmissionCheck>(`/publications/${pubId}/submission-checks/${checkId}/acknowledge`, body),

  // Congress abstract export
  getCongressSubmission:  (pubId: string) =>
                            api.get<CongressSubmission>(`/publications/${pubId}/congress`),
  exportCongress:         (pubId: string, body: CongressExportBody) =>
                            api.post<CongressSubmission>(`/publications/${pubId}/congress/export`, body),

  // Peer review
  getRound:               (pubId: string) =>
                            api.get<PeerReviewRound>(`/publications/${pubId}/review-rounds/latest`),
  getComments:            (roundId: string) =>
                            api.get<ReviewerComment[]>(`/review-rounds/${roundId}/comments`),
  updateResponse:         (roundId: string, commentId: string, body: { responseText: string; aiDrafted: boolean }) =>
                            api.patch<ReviewerComment>(`/review-rounds/${roundId}/comments/${commentId}`, body),
  acceptAIResponse:       (roundId: string, commentId: string, body: AcceptAIResponseBody) =>
                            api.post<ReviewerComment>(`/review-rounds/${roundId}/comments/${commentId}/ai-accept`, body),
  markCommentComplete:    (roundId: string, commentId: string, body: { respondedBy: string }) =>
                            api.patch<ReviewerComment>(`/review-rounds/${roundId}/comments/${commentId}/complete`, body),
  submitLetter:           (pubId: string, body: SubmitResponseLetterBody) =>
                            api.post<{ letterVersion: string; submittedAt: string }>(`/publications/${pubId}/response-letter`, body),

  // Final output — compliance provenance record included per OQ-B-002 (21 CFR Part 11, Final Output only)
  getFinalRecord:         (pubId: string) =>
                            api.get<{ publication: Publication; doi: DOIRecord; orcids: ORCIDVerification[]; libraryCards: PortfolioCard[] }>(`/publications/${pubId}/final`),
  downloadPackage:        (pubId: string) =>
                            api.post<{ downloadUrl: string }>(`/publications/${pubId}/final/download`, {}),

  // Portfolio
  getPortfolio:           (projectId: string, scope?: string) =>
                            api.get<Publication[]>(`/projects/${projectId}/publications/portfolio${scope ? `?scope=${scope}` : ''}`),
  exportGPPReport:        (projectId: string) =>
                            api.post<{ downloadUrl: string }>(`/projects/${projectId}/publications/gpp-report`, {}),
}
```

---

## 20. Module B MSW Handlers (Phase 1)

New handler file `mocks/handlers/publications.ts`. Must be added to `mocks/browser.ts`.

```typescript
// mocks/handlers/publications.ts
import { rest } from 'msw'
import publications from '../../data/publications.json'
import authors from '../../data/publicationAuthors.json'
import citations from '../../data/citations.json'
import submissionChecks from '../../data/submissionChecks.json'
import reviewRound from '../../data/reviewRound.json'
import reviewComments from '../../data/reviewComments.json'

export const publicationHandlers = [
  // Publications list
  rest.get('/api/projects/:projectId/publications', (req, res, ctx) =>
    res(ctx.delay(200), ctx.json(publications))
  ),
  rest.get('/api/publications/:pubId', (req, res, ctx) => {
    const pub = publications.find(p => p.id === req.params.pubId)
    return pub
      ? res(ctx.delay(150), ctx.json(pub))
      : res(ctx.status(404), ctx.json({ error: 'Not found' }))
  }),
  rest.post('/api/projects/:projectId/publications', async (req, res, ctx) => {
    const body = await req.json()
    return res(ctx.delay(400), ctx.json({ id: 'pub-new', ...body, stage: 'planning', status: 'not-started', version: 'v0.1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }))
  }),
  rest.post('/api/publications/:pubId/advance-stage', (req, res, ctx) =>
    res(ctx.delay(300), ctx.json({ ...publications[0], stage: 'authoring' }))
  ),

  // Footprint
  rest.get('/api/publications/:pubId/footprint', (req, res, ctx) =>
    res(ctx.delay(150), ctx.json({ publicationId: req.params.pubId, totalChars: 8420, aiChars: 2863, humanChars: 5557, aiPercent: 34, bySection: [{ sectionId: 'methods', sectionLabel: 'Methods', aiPercent: 45 }, { sectionId: 'results', sectionLabel: 'Results', aiPercent: 52 }], computedAt: new Date().toISOString() }))
  ),

  // Citations
  rest.get('/api/publications/:pubId/citations', (req, res, ctx) =>
    res(ctx.delay(100), ctx.json(citations))
  ),
  rest.post('/api/publications/:pubId/citations', async (req, res, ctx) => {
    const body = await req.json()
    return res(ctx.delay(300), ctx.json({ id: `cit-${Date.now()}`, publicationId: req.params.pubId, label: '[3]', insertedBy: 'Marcus Webb', insertedAt: new Date().toISOString(), ...body }))
  }),
  rest.delete('/api/publications/:pubId/citations/:citationId', (req, res, ctx) =>
    res(ctx.delay(200), ctx.status(204))
  ),
  rest.get('/api/pubmed/search', (req, res, ctx) => {
    const q = req.url.searchParams.get('q') || ''
    const results = q.length < 3 ? [] : [
      { id: 'gandhi', pmid: 'PMID: 29658856', title: 'Pembrolizumab plus chemotherapy in metastatic non–small-cell lung cancer', source: 'Gandhi L et al. · N Engl J Med · 2018', abstractText: 'Phase III trial, 616 patients...', keys: 'pembrolizumab chemotherapy nsclc metastatic survival progression', isInserted: false },
      { id: 'socinski', pmid: 'PMID: 33764809', title: 'First-line pembrolizumab plus pemetrexed and platinum in lung cancer', source: 'Socinski M et al. · J Clin Oncol · 2021', abstractText: 'Updated PFS analysis...', keys: 'pembrolizumab pemetrexed platinum first-line lung progression-free survival', isInserted: true },
    ].filter(r => q.split(' ').some(t => t.length > 2 && r.keys.includes(t.toLowerCase())))
    return res(ctx.delay(400), ctx.json(results))
  }),

  // Authors + ICMJE
  rest.get('/api/publications/:pubId/authors', (req, res, ctx) =>
    res(ctx.delay(150), ctx.json(authors))
  ),
  rest.patch('/api/publications/:pubId/authors/:authorId/icmje', async (req, res, ctx) => {
    const body = await req.json()
    return res(ctx.delay(200), ctx.json({ ...body }))
  }),
  rest.post('/api/publications/:pubId/authors/:authorId/icmje/acknowledge', async (req, res, ctx) => {
    const body = await req.json()
    return res(ctx.delay(200), ctx.json({ icmjeAcknowledged: true, icmjeAcknowledgedBy: body.acknowledgedBy, icmjeAcknowledgedAt: new Date().toISOString() }))
  }),
  rest.post('/api/publications/:pubId/debarment-check', (req, res, ctx) =>
    res(ctx.delay(1500), ctx.json({ checkedAt: new Date().toISOString(), results: authors.map((a: { id: string }) => ({ authorId: a.id, status: 'clear' })) }))
  ),
  rest.post('/api/publications/:pubId/authors/:authorId/remind', (req, res, ctx) =>
    res(ctx.delay(200), ctx.status(204))
  ),

  // Submission readiness
  rest.get('/api/publications/:pubId/submission-checks', (req, res, ctx) =>
    res(ctx.delay(200), ctx.json(submissionChecks))
  ),
  rest.post('/api/publications/:pubId/submission-checks/run', (req, res, ctx) =>
    res(ctx.delay(1600), ctx.json(submissionChecks))
  ),
  rest.patch('/api/publications/:pubId/submission-checks/:checkId/acknowledge', async (req, res, ctx) => {
    const body = await req.json()
    return res(ctx.delay(200), ctx.json({ state: 'ack', resolvedBy: body.acknowledgedBy, resolvedAt: new Date().toISOString() }))
  }),

  // Congress export
  rest.get('/api/publications/:pubId/congress', (req, res, ctx) =>
    res(ctx.delay(150), ctx.json({ congressId: 'asco', characterCount: 2847, keywordsEntered: 4, status: 'draft' }))
  ),
  rest.post('/api/publications/:pubId/congress/export', async (req, res, ctx) => {
    const body = await req.json()
    return res(ctx.delay(600), ctx.json({ ...body, status: 'exported', exportedAt: new Date().toISOString() }))
  }),

  // Peer review
  rest.get('/api/publications/:pubId/review-rounds/latest', (req, res, ctx) =>
    res(ctx.delay(150), ctx.json(reviewRound))
  ),
  rest.get('/api/review-rounds/:roundId/comments', (req, res, ctx) =>
    res(ctx.delay(100), ctx.json(reviewComments))
  ),
  rest.patch('/api/review-rounds/:roundId/comments/:commentId', async (req, res, ctx) => {
    const body = await req.json()
    return res(ctx.delay(200), ctx.json({ ...body }))
  }),
  rest.post('/api/review-rounds/:roundId/comments/:commentId/ai-accept', async (req, res, ctx) => {
    const body = await req.json()
    return res(ctx.delay(1200), ctx.json({ aiDrafted: true, responseText: body.responseText, updatedAt: new Date().toISOString() }))
  }),
  rest.patch('/api/review-rounds/:roundId/comments/:commentId/complete', async (req, res, ctx) => {
    const body = await req.json()
    return res(ctx.delay(200), ctx.json({ status: 'responded', respondedBy: body.respondedBy, respondedAt: new Date().toISOString() }))
  }),
  rest.post('/api/publications/:pubId/response-letter', async (req, res, ctx) => {
    const body = await req.json()
    return res(ctx.delay(800), ctx.json({ letterVersion: body.letterVersion, submittedAt: new Date().toISOString() }))
  }),

  // Final output
  rest.get('/api/publications/:pubId/final', (req, res, ctx) =>
    res(ctx.delay(200), ctx.json({
      publication: { ...publications[0], stage: 'published', status: 'published' },
      doi: { publicationId: req.params.pubId, doi: '10.1200/JCO.2026.VELORA301', registrar: 'crossref', registeredAt: '2027-01-14T00:00:00Z' },
      orcids: [
        { authorId: 'webb', orcid: '0000-0002-1825-0097', verified: true, verifiedAt: '2027-01-14T00:00:00Z' },
        { authorId: 'hartley', orcid: '0000-0001-5109-3700', verified: true, verifiedAt: '2027-01-14T00:00:00Z' },
        { authorId: 'chen', orcid: '0000-0003-2707-9852', verified: true, verifiedAt: '2027-01-14T00:00:00Z' },
        { authorId: 'vasquez', orcid: '0000-0002-9079-5933', verified: true, verifiedAt: '2027-01-14T00:00:00Z' },
        { authorId: 'nair', orcid: '0000-0001-7205-4462', verified: true, verifiedAt: '2027-01-14T00:00:00Z' },
      ],
      libraryCards: [
        { id: 'lc-1', publicationId: req.params.pubId, cardType: 'abstract', name: 'Manuscript abstract', note: 'Tagged: Oncology · NSCLC · Phase III', availableInModules: ['medical-writing', 'ideation'], createdAt: '2027-01-14T00:00:00Z' },
        { id: 'lc-2', publicationId: req.params.pubId, cardType: 'primary-endpoint', name: 'Primary endpoint result', note: 'HR 0.61 (95% CI 0.48–0.77) · source Table 14.2.1', availableInModules: ['medical-writing', 'ideation'], createdAt: '2027-01-14T00:00:00Z' },
        { id: 'lc-3', publicationId: req.params.pubId, cardType: 'equator-checklist', name: 'EQUATOR checklist record', note: 'CONSORT 2010 · complete', availableInModules: ['medical-writing'], createdAt: '2027-01-14T00:00:00Z' },
        { id: 'lc-4', publicationId: req.params.pubId, cardType: 'citation', name: 'Publication citation', note: 'DOI 10.1200/JCO.2026.VELORA301', availableInModules: ['medical-writing', 'ideation'], createdAt: '2027-01-14T00:00:00Z' },
      ],
    }))
  ),
  rest.post('/api/publications/:pubId/final/download', (req, res, ctx) =>
    res(ctx.delay(600), ctx.json({ downloadUrl: '/mock-downloads/velora301-publication-package.zip' }))
  ),

  // Portfolio
  rest.get('/api/projects/:projectId/publications/portfolio', (req, res, ctx) => {
    const scope = req.url.searchParams.get('scope')
    const filtered = scope && scope !== 'All projects'
      ? publications.filter((p: { project: string }) => p.project === scope)
      : publications
    return res(ctx.delay(200), ctx.json(filtered))
  }),
  rest.post('/api/projects/:projectId/publications/gpp-report', (req, res, ctx) =>
    res(ctx.delay(800), ctx.json({ downloadUrl: '/mock-downloads/gpp-2022-report.pdf' }))
  ),
]

// mocks/browser.ts — add to existing worker registration:
// import { publicationHandlers } from './handlers/publications'
// ...
// export const worker = setupWorker(
//   ...documentHandlers,
//   ...projectHandlers,
//   ...aiHandlers,
//   ...publicationHandlers,   // ← add this line
// )
```

**New JSON fixture files required in `/data`:**

| File | Contents |
|------|----------|
| `publications.json` | 3 sample publications (manuscript In Authoring, abstract In Review, PLS Submitted) |
| `publicationAuthors.json` | 4 authors — MW, SC, Prof. Hartley (external, ICMJE incomplete), EV |
| `citations.json` | 3 citations — Socinski, Hellmann + VELORA-301 CSR source document |
| `submissionChecks.json` | 30 checks across 6 groups — 1 blocking (word count), 1 advisory (CONSORT), 1 ack (ICMJE Hartley), rest pass |
| `reviewRound.json` | Round 1, NEJM submission #NEJM-2026-28471, 3 reviewers + editor |
| `reviewComments.json` | 11 comments — R1×4, R2×4, R3×2, Editor×1; 6 pre-responded |

---

## 21. Module B Shared Components

New components added to `components/ui/` and `components/layout/` for Module B. These are platform-level because they will be reused in Modules C–E.

### 21.1 ResizablePanel

Replaces Module A's `RightPanel` for Module B screens. Implements drag-to-resize via imperative DOM refs as seen in B03 and B04. Module A's `RightPanel` remains unchanged.

```typescript
// components/ui/ResizablePanel.tsx
interface ResizablePanelProps {
  isOpen: boolean
  onClose: () => void
  title: string
  icon: React.ReactNode
  badge?: React.ReactNode                   // e.g. 'PubMed · NCBI' chip
  defaultWidth?: number                     // default 280
  minWidth?: number                         // default 280
  maxWidth?: number                         // default 760
  regionRef: React.RefObject<HTMLDivElement> // parent container for width calc
  children: React.ReactNode
}
```

**Resize mechanics (must be implemented exactly):**

```typescript
// Internal implementation pattern — CC must follow this precisely
const panelRef = useRef<HTMLDivElement>(null)
const gripRef = useRef<HTMLDivElement>(null)
const gripBarRef = useRef<HTMLDivElement>(null)
const panelWidthRef = useRef(defaultWidth ?? 280)

useEffect(() => {
  const grip = gripRef.current
  if (!grip) return

  const measureRange = () => {
    const region = regionRef.current
    const room = (region ? region.clientWidth : 1160) - 224  // subtract section nav
    const max = Math.max(320, Math.min(760, room - 260))
    const min = Math.min(280, max)
    return { min, max, resizable: max - min > 8 }
  }

  const applyWidth = (w: number) => {
    const width = Math.max(280, Math.round(w))
    panelWidthRef.current = width
    if (panelRef.current) {
      panelRef.current.style.width = width + 'px'
      panelRef.current.style.minWidth = width + 'px'
    }
  }

  const startResize = (e: MouseEvent) => {
    e.preventDefault()
    const region = regionRef.current
    if (!region) return
    const rect = region.getBoundingClientRect()
    const range = measureRange()
    if (!range.resizable) return
    const move = (ev: MouseEvent) =>
      applyWidth(Math.round(Math.max(range.min, Math.min(range.max, rect.right - ev.clientX))))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const resetWidth = () => applyWidth(280)
  grip.addEventListener('mousedown', startResize)
  grip.addEventListener('dblclick', resetWidth)
  return () => {
    grip.removeEventListener('mousedown', startResize)
    grip.removeEventListener('dblclick', resetWidth)
  }
}, [regionRef, defaultWidth])
```

### 21.2 AIFootprintChip

Shared across all Module B manuscript screens.

```typescript
// components/ui/AIFootprintChip.tsx
interface AIFootprintChipProps {
  aiPercent: number    // 0–100 integer
}
// Renders: ✦ {aiPercent}% AI · {100-aiPercent}% human
// Style: background #F0FDFA, border #99F6E4, text #0F766E, font-weight 600, 12px
// Icon: 8-point star SVG, fill #0D9488
```

### 21.3 SourceChip

Cross-module source provenance chip (OQ-B-001). Used on publication cards and in the citation panel.

```typescript
// components/ui/SourceChip.tsx
interface SourceChipProps {
  label: string        // e.g. 'VELORA-301 CSR v1.0 · Module A'
  moduleColour: string // e.g. '#2563EB' for Clinical Writing
}
// Renders: ● {label}
// Style: background #F0FDFA, border 1px solid #99F6E4, text #0F766E, 11px mono font
// Dot: 5×5px circle, fill = moduleColour prop
```

### 21.4 auroraSpin keyframe

`auroraSpin` is a new CSS animation introduced by Module B (B05 debarment spinner, B06 run-checks spinner). Add to `index.css` alongside existing aurora keyframes:

```css
@keyframes auroraSpin {
  to { transform: rotate(360deg); }
}
```

Add to `tailwind.config.ts` animations:
```typescript
'spin-aurora': 'auroraSpin 0.7s linear infinite',
```

---

## 22. Module B ESLint Boundary Update

Extend the `no-restricted-imports` rule in `.eslintrc` to add Module B's own boundary:

```json
{
  "rules": {
    "no-restricted-imports": ["error", {
      "patterns": [
        { "group": ["*/modules/scientific-writing/*"], "message": "Module A must not import from Module B. Use the platform interface layer." },
        { "group": ["*/modules/clinical-writing/*"],   "message": "Module B must not import from Module A. Use the platform interface layer." },
        { "group": ["*/modules/medical-writing/*"],    "message": "Modules A and B must not import from Module C." },
        { "group": ["*/modules/regulatory-writing/*"], "message": "Modules A and B must not import from Module D." },
        { "group": ["*/modules/ideation/*"],           "message": "Modules A and B must not import from Module E." }
      ]
    }]
  }
}
```

**Cross-module data access rule:** Module B reads Clinical Writing source documents (CSR, TLF) through the platform API layer (`/projects/:projectId/tlf`, `/projects/:projectId/documents/:id`) — not by importing Module A code. The `sourceDocumentId` field on `Publication` is the link; the API resolves it server-side.


---

## MODULE C — MEDICAL WRITING
### Appendix to Technical Architecture v3.0

---

## 23. Module C Overview

Module C — Medical Writing — adds ten screens to the Aurora prototype (sC01–sC10). It shares the existing platform shell and all Module A/B UI primitives. Module C introduces six architectural patterns not present in Modules A or B:

1. **Pre-MLR + agentic sequential pipeline** — two-pass AI compliance check (FR-C-015 → FR-C-016) separated by a visual divider; pre-MLR runs first, agentic only if pre-MLR passes (DD-C-002)
2. **Claims Matrix panel** — live, auto-populated claim-by-claim table with similarity detection against the Master Library (FR-C-014, FR-C-018)
3. **FK readability gate** — real-time Flesch-Kincaid scoring with a hard gate (≤8) on patient-facing content only; hidden for non-patient-facing types (FR-C-009)
4. **Tier-based MLR routing** — automatic review tier classification (Tier 1/2/3) from Claims Matrix reuse percentage (FR-C-017)
5. **Content expiry tracking** — all approved content carries a default 24-month expiry date with 60/30-day alert cadence (FR-C-026)
6. **ACCME/MLR dual compliance track** — mutually exclusive compliance paths selected at Stage 1 and locked from Stage 2 onward; ACCME Checklist tab only visible on ACCME track content (DD-C-001)

Module C is scoped to `modules/medical-writing/` and must not import from any other module folder. The ESLint boundary rule in §10 and §22 is extended in §29.

---

## 24. Module C Routes

The `medical-writing` stub route in §9 is replaced with a full route tree:

```typescript
// router/index.tsx — medical-writing subtree
{
  path: 'medical-writing',
  children: [
    { index: true,                          element: <MedicalWritingHome /> },          // sC01
    { path: 'kol-session',                  element: <KOLAdvisoryBoardSession /> },     // sC03
    { path: 'claims-matrix',                element: <ClaimsMatrixPanel /> },           // sC07
    { path: 'portfolio',                    element: <ContentPortfolio /> },             // sC10
    {
      path: 'content/:contentId',
      children: [
        { index: true,                      element: <ContentBriefing /> },              // sC02
        { path: 'editor',                   element: <ContentEditor /> },                // sC04
        { path: 'pre-mlr',                  element: <PreMLRCheckPanel /> },             // sC05
        { path: 'mlr-review',               element: <MLRReview /> },                   // sC06
        { path: 'formatting',               element: <FormattingAccessibility /> },      // sC08
        { path: 'final',                    element: <FinalOutput /> },                  // sC09
      ],
    },
  ],
}
```

**Note — sC07 Claims Matrix:** sC07 is accessible as a standalone route and as a right panel within sC04 (Content Editor) and sC06 (MLR Review). When opened from within the editor or MLR review, it mounts as an overlay panel (`activePanel === 'claims'`) rather than navigating to its own route.

**Navigation triggers — Module C:**

| From | Action | To |
|------|--------|-----|
| Medical Writing Home (sC01) | Click content item row | Content Briefing (sC02) |
| Medical Writing Home (sC01) | Click + New Content Item | Content Briefing (sC02) — new |
| Medical Writing Home (sC01) | Sidebar → KOL Sessions | KOL Advisory Board Session (sC03) |
| Medical Writing Home (sC01) | Sidebar → Content Portfolio | Content Portfolio (sC10) |
| Content Briefing (sC02) | Stage 2 readiness complete → Proceed | KOL Advisory Board Session (sC03) |
| KOL Advisory Board Session (sC03) | Stage 3 readiness complete → Proceed | Content Editor (sC04) |
| Content Editor (sC04) | Submit for Pre-MLR → | Pre-MLR Check Panel (sC05) |
| Content Editor (sC04) | Toolbar → Claims | Claims Matrix Panel (sC07, overlay) |
| Pre-MLR Check Panel (sC05) | Submit to MLR team → | MLR Review (sC06) |
| MLR Review (sC06) | Toolbar → Claims Matrix | Claims Matrix Panel (sC07, overlay) |
| MLR Review (sC06) | MLR decision signed → | Formatting & Accessibility (sC08) |
| Formatting & Accessibility (sC08) | Proceed to Stage 6 → | Final Output (sC09) |
| Content Portfolio (sC10) | Click content card | Relevant stage screen |

---

## 25. Module C TypeScript Types

All Module C types are appended to `packages/types/src/domain.ts`.

```typescript
// ─── Module C domain types ────────────────────────────────────────────────────

export type MedContentType =
  | 'hcp-slide-deck'
  | 'mi-letter'
  | 'pil'
  | 'cme-module'
  | 'disease-dossier'
  | 'eu-ctr-pls'
  | 'advisory-report'

export type ComplianceTrack = 'mlr' | 'accme'

export type MedContentStatus =
  | 'briefing'
  | 'kol-session'
  | 'in-authoring'
  | 'pre-mlr'
  | 'in-mlr-review'
  | 'mlr-approved'
  | 'formatting'
  | 'final-output'
  | 'expired'

export type ReviewTier = 1 | 2 | 3

export type ClaimStatus = 'approved' | 'modified' | 'new' | 'must-fix'

export type PreMLRSeverity = 'must-fix' | 'should-fix' | 'note'

export type MLRDecision =
  | 'approve'
  | 'approve-with-revisions'
  | 'return-to-author'
  | 'reject'

export type PortfolioLane = 'briefing' | 'authoring' | 'review' | 'approved'

export interface MedContentItem {
  id: string
  projectId: string
  sourceModuleAProjectId: string
  sourceModuleBPublicationId?: string
  type: MedContentType
  title: string
  status: MedContentStatus
  stage: 1 | 2 | 3 | 4 | 5 | 6
  complianceTrack: ComplianceTrack         // locked from Stage 2 (DD-C-001)
  taTag: string
  version: string
  reviewTier?: ReviewTier
  reviewTierOverriddenBy?: string
  fkScore?: number
  fkPassed?: boolean
  aiFootprintPct?: number
  expiryDate?: string                      // ISO date — default +24 months from MLR approval
  approvedAt?: string
  channels: string[]
  ownerId: string
  createdAt: string
  updatedAt: string
}

export interface Claim {
  id: string
  contentItemId: string
  claimText: string
  sourceRef: string
  sourceType: 'smpc' | 'csr' | 'publication' | 'label'
  location: string
  approvalStatus: ClaimStatus
  reviewerId?: string
  similarityPct?: number
  approvedLibraryText?: string
  adoptedAt?: string
}

export interface PreMLRCheckResult {
  id: string
  contentItemId: string
  runAt: string
  mustFixCount: number
  shouldFixCount: number
  noteCount: number
  passed: boolean
  issues: PreMLRIssue[]
}

export interface PreMLRIssue {
  id: string
  severity: PreMLRSeverity
  slide?: string
  title: string
  detail: string
  suggestedFix?: string
  acknowledged: boolean
  acknowledgedBy?: string
  acknowledgedAt?: string
}

export interface AgenticMLRReport {
  id: string
  contentItemId: string
  runAt: string
  model: string
  findings: AgenticFinding[]
  passedToMLRTeamAt?: string
}

export interface AgenticFinding {
  n: number
  slide: string
  severity: PreMLRSeverity
  title: string
  detail: string
  escalatedToMustFix?: boolean
  escalatedBy?: string
  escalatedAt?: string
}

export interface ReviewTierRecord {
  id: string
  contentItemId: string
  tier: ReviewTier
  reusePct: number
  calculatedAt: string
  overriddenBy?: string
  overrideReason?: string
}

export interface FKScoreRecord {
  id: string
  contentItemId: string
  score: number
  calculatedAt: string
  passed: boolean
  bySection: Array<{ sectionId: string; sectionLabel: string; score: number }>
}

export interface MLRReviewer {
  id: string
  contentItemId: string
  userId: string
  name: string
  initials: string
  role: string
  submittedAt?: string
  decision?: MLRDecision
  decisionNote?: string
}

export interface MLRComment {
  id: string                               // 'MLR-C-###'
  contentItemId: string
  reviewerId: string
  reviewerName: string
  text: string
  tag: 'Must Fix' | 'Should Fix' | 'Note'
  resolvedAt?: string
  resolvedBy?: string
  escalatedFromAgentic?: boolean
  escalatedBy?: string
  escalatedAt?: string
}

export interface WCAGTestResult {
  id: string
  contentItemId: string
  format: string
  runAt: string
  failures: WCAGFailure[]
  passed: boolean
}

export interface WCAGFailure {
  id: string
  criterion: string
  description: string
  slide?: string
  contrastRatio?: string
  required?: string
  suggestedFix?: string
  fixed: boolean
}

export interface ContentExpiryRecord {
  id: string
  contentItemId: string
  expiryDate: string
  alert60dSentAt?: string
  alert30dSentAt?: string
  expired: boolean
}

export interface KOLAttendee {
  name: string
  affiliation: string
  gdprConsent: 'confirmed' | 'internal' | 'pending'
  role: 'Chair' | 'Faculty' | 'Facilitator'
}

export interface KOLQuote {
  id: string
  speaker: string
  text: string
  approvalStatus: 'approved' | 'pending' | 'rejected'
  approvedBy?: string
  approvedAt?: string
}

export interface MessagingFrameworkRow {
  claim: string
  evidenceSource: string
  targetAudience: string
  approvalStatus: 'approved' | 'pending'
}

export interface KOLInsightsReport {
  id: string
  sessionId: string
  generatedAt: string
  model: string
  themes: string[]
  unmetNeeds: string[]
  evidenceGaps: string[]
  quotes: KOLQuote[]
  messagingFramework: MessagingFrameworkRow[]
  approvalRequestedAt?: string
}

export interface KOLSession {
  id: string
  contentItemId: string
  date: string
  attendees: KOLAttendee[]
  preReads: string[]
  voiceNoteIds: string[]
  transcriptRef?: string
  insightsReport?: KOLInsightsReport
}

export interface LocalisedVersion {
  id: string
  parentContentItemId: string
  languageCode: string
  countryCode: string
  affiliate: string
  localMLRSignOffId?: string
  status: 'pending' | 'local-mlr-pending' | 'approved'
  assignedAt: string
}

// ─── Module C request body types ──────────────────────────────────────────────

export interface CreateMedContentBody {
  type: MedContentType
  title: string
  complianceTrack: ComplianceTrack
  taTag: string
  sourceModuleAProjectId: string
  sourceModuleBPublicationId?: string
  channels: string[]
  targetAudience: string[]
  medicalAffairsPlanId?: string
  publicationPlanId?: string
}

export interface RunPreMLRBody { contentItemId: string }

export interface AcknowledgePreMLRIssueBody { issueId: string; acknowledgedBy: string }

export interface SubmitToMLRBody { contentItemId: string; reviewerIds: string[] }

export interface SubmitMLRDecisionBody {
  decision: MLRDecision
  decisionNote: string
  credentialHash: string
  meaning: string
}

export interface RunWCAGBody { contentItemId: string; format: string }

export interface PushToLibraryBody {
  contentItemId: string
  cardTypes: string[]
  expiryDate: string
  taTag: string
  channels: string[]
}

export interface AdoptLibraryClaimBody {
  claimId: string
  approvedText: string
  librarySourceRef: string
}

export interface RequestKOLQuoteApprovalBody { sessionId: string; kolIds: string[] }

export interface OverrideTierBody { tier: ReviewTier; reason: string; approvedBy: string }

// ─── Module C lookup constants ─────────────────────────────────────────────────

export const MED_CONTENT_TYPE_META: Record<MedContentType, { label: string; code: string; bg: string; fg: string; patientFacing: boolean }> = {
  'hcp-slide-deck':  { label: 'HCP Slide Deck',                    code: 'HCP SLIDE DECK',  bg: '#F5F3FF', fg: '#7C3AED', patientFacing: false },
  'mi-letter':       { label: 'Medical Information Letter',         code: 'MI LETTER',       bg: '#F1F5F9', fg: '#64748B', patientFacing: false },
  'pil':             { label: 'Patient Information Leaflet',        code: 'PIL',             bg: '#F5F3FF', fg: '#7C3AED', patientFacing: true  },
  'cme-module':      { label: 'CME Module',                         code: 'CME MODULE',      bg: '#F5F3FF', fg: '#7C3AED', patientFacing: false },
  'disease-dossier': { label: 'Disease Dossier / GVD',              code: 'DISEASE DOSSIER', bg: '#F5F3FF', fg: '#7C3AED', patientFacing: false },
  'eu-ctr-pls':      { label: 'EU CTR Plain Language Summary',      code: 'EU CTR PLS',      bg: '#F5F3FF', fg: '#7C3AED', patientFacing: true  },
  'advisory-report': { label: 'Advisory Board Report',              code: 'ADVISORY REPORT', bg: '#F5F3FF', fg: '#7C3AED', patientFacing: false },
}

export const MED_CONTENT_STATUS_META: Record<MedContentStatus, { bg: string; fg: string; label: string }> = {
  'briefing':       { bg: '#F8FAFC', fg: '#64748B', label: 'In Briefing'    },
  'kol-session':    { bg: '#F5F3FF', fg: '#7C3AED', label: 'KOL Session'    },
  'in-authoring':   { bg: '#EFF6FF', fg: '#2563EB', label: 'In Authoring'   },
  'pre-mlr':        { bg: '#F5F3FF', fg: '#5B21B6', label: 'Pre-MLR Check'  },
  'in-mlr-review':  { bg: '#FFFBEB', fg: '#B45309', label: 'In MLR Review'  },
  'mlr-approved':   { bg: '#F0FDF4', fg: '#15803D', label: 'MLR Approved ✓' },
  'formatting':     { bg: '#EFF6FF', fg: '#2563EB', label: 'Formatting'     },
  'final-output':   { bg: '#F0FDF4', fg: '#15803D', label: 'Final Output'   },
  'expired':        { bg: '#FFF1F2', fg: '#BE123C', label: 'Expired ⚠'      },
}

export const REVIEW_TIER_META: Record<ReviewTier, { label: string; threshold: string; bg: string; fg: string }> = {
  1: { label: 'Tier 1 — Expedited Review', threshold: '≥80% reused claims',       bg: '#F0FDF4', fg: '#15803D' },
  2: { label: 'Tier 2 — Standard Review',  threshold: '40–80% reused claims',     bg: '#FFFBEB', fg: '#B45309' },
  3: { label: 'Tier 3 — Full Review',      threshold: '<40% reused or new data',  bg: '#EFF6FF', fg: '#005F8E' },
}

export const MLR_DECISION_META: Record<MLRDecision, { label: string; bg: string; fg: string; border: string }> = {
  'approve':                { label: 'Approve for distribution',                     bg: '#F0FDF4', fg: '#15803D', border: '#BBF7D0' },
  'approve-with-revisions': { label: 'Approve with minor revisions — author to resolve', bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A' },
  'return-to-author':       { label: 'Return to author — major revisions required',  bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A' },
  'reject':                 { label: 'Reject — fundamental issues',                  bg: '#FFF1F2', fg: '#BE123C', border: '#FECDD3' },
}
```

---

## 26. Module C State Management (Zustand)

Six new stores scoped to `modules/medical-writing/store/`. Each follows the same pattern as Modules A and B — screens read and write, components receive values as props.

```typescript
// modules/medical-writing/store/medContentStore.ts
interface MedContentStore {
  items: MedContentItem[]
  activeItem: MedContentItem | null
  activePanel: 'claims' | 'fk' | 'suggest' | 'a11y' | 'pao' | null
  panelWidth: number                        // 280–760, default 280
  isLoading: boolean
  filters: { status: MedContentStatus | 'all'; type: MedContentType | 'all'; ta: string; search: string }
  setActiveItem: (item: MedContentItem) => void
  setActivePanel: (panel: MedContentStore['activePanel']) => void
  setPanelWidth: (width: number) => void
  setFilters: (f: Partial<MedContentStore['filters']>) => void
  fetchItems: (projectId: string) => Promise<void>
}

// modules/medical-writing/store/claimsStore.ts
interface ClaimsStore {
  claims: Claim[]
  filter: ClaimStatus | 'all'
  query: string
  selectedClaimId: string | null
  gateStats: { approved: number; modified: number; new: number; mustFix: number; total: number }
  setFilter: (f: ClaimsStore['filter']) => void
  setQuery: (q: string) => void
  selectClaim: (id: string | null) => void
  adoptLibraryClaim: (body: AdoptLibraryClaimBody) => Promise<void>
  runHarvest: (contentItemId: string) => Promise<void>
  fetchClaims: (contentItemId: string) => Promise<void>
}

// modules/medical-writing/store/preMLRStore.ts
interface PreMLRStore {
  result: PreMLRCheckResult | null
  agenticReport: AgenticMLRReport | null
  isRunning: boolean
  runPreMLR: (body: RunPreMLRBody) => Promise<void>
  acknowledgeIssue: (body: AcknowledgePreMLRIssueBody) => Promise<void>
  submitToMLR: (body: SubmitToMLRBody) => Promise<void>
}

// modules/medical-writing/store/mlrStore.ts
interface MLRStore {
  reviewers: MLRReviewer[]
  comments: MLRComment[]
  activeTab: 'content' | 'claims' | 'agentic' | 'accme'
  decisionDraft: MLRDecision | null
  decisionNote: string
  confirmingSignature: boolean             // true when inline Part 11 confirmation expanded
  setActiveTab: (tab: MLRStore['activeTab']) => void
  setDecision: (decision: MLRDecision | null) => void
  setDecisionNote: (note: string) => void
  setConfirmingSignature: (v: boolean) => void
  resolveComment: (contentId: string, commentId: string) => Promise<void>
  escalateComment: (contentId: string, commentId: string, escalatedBy: string) => Promise<void>
  submitDecision: (contentId: string, body: SubmitMLRDecisionBody) => Promise<void>
  overrideTier: (contentId: string, body: OverrideTierBody) => Promise<void>
  fetchReviewers: (contentItemId: string) => Promise<void>
  fetchComments: (contentItemId: string) => Promise<void>
}

// modules/medical-writing/store/kolStore.ts
interface KOLStore {
  session: KOLSession | null
  insightsReport: KOLInsightsReport | null
  messagingFramework: MessagingFrameworkRow[]
  activeTab: 'insights' | 'framework'
  isGenerating: boolean
  setActiveTab: (tab: 'insights' | 'framework') => void
  generateInsights: (sessionId: string) => Promise<void>
  requestQuoteApproval: (body: RequestKOLQuoteApprovalBody) => Promise<void>
  fetchSession: (contentItemId: string) => Promise<void>
}

// modules/medical-writing/store/formattingStore.ts
interface FormattingStore {
  wcagResult: WCAGTestResult | null
  locales: LocalisedVersion[]
  isRunning: boolean
  channels: Record<string, boolean>
  runWCAG: (body: RunWCAGBody) => Promise<void>
  applyFix: (contentId: string, failureId: string) => Promise<void>
  addLocale: (contentId: string, body: Omit<LocalisedVersion, 'id' | 'status' | 'assignedAt'>) => Promise<void>
  toggleChannel: (channel: string) => void
  fetchWCAGResult: (contentItemId: string) => Promise<void>
}
```

---

## 27. Module C API Client Layer

New file `modules/medical-writing/api/medContent.ts`. Follows the same `api.get/post/patch/delete` pattern as Modules A and B.

```typescript
// modules/medical-writing/api/medContent.ts
import { api } from '../../../../api/client'
import type { MedContentItem, Claim, PreMLRCheckResult, AgenticMLRReport,
  ReviewTierRecord, FKScoreRecord, MLRReviewer, MLRComment, WCAGTestResult,
  KOLSession, KOLInsightsReport, LocalisedVersion, SignatureRecord,
  CreateMedContentBody, RunPreMLRBody, AcknowledgePreMLRIssueBody,
  SubmitToMLRBody, SubmitMLRDecisionBody, RunWCAGBody, PushToLibraryBody,
  AdoptLibraryClaimBody, RequestKOLQuoteApprovalBody, OverrideTierBody,
} from '@platform/types'

export const medContentApi = {
  list:                   (projectId: string) =>
                            api.get<MedContentItem[]>(`/projects/${projectId}/med-content`),
  get:                    (contentId: string) =>
                            api.get<MedContentItem>(`/med-content/${contentId}`),
  create:                 (projectId: string, body: CreateMedContentBody) =>
                            api.post<MedContentItem>(`/projects/${projectId}/med-content`, body),
  advanceStage:           (contentId: string) =>
                            api.post<MedContentItem>(`/med-content/${contentId}/advance-stage`, {}),
  archiveContent:         (contentId: string, reason: string) =>
                            api.post<MedContentItem>(`/med-content/${contentId}/archive`, { reason }),
  getClaims:              (contentId: string) =>
                            api.get<Claim[]>(`/med-content/${contentId}/claims`),
  runHarvest:             (contentId: string) =>
                            api.post<Claim[]>(`/med-content/${contentId}/claims/harvest`, {}),
  adoptLibraryClaim:      (contentId: string, body: AdoptLibraryClaimBody) =>
                            api.post<Claim>(`/med-content/${contentId}/claims/adopt`, body),
  getTier:                (contentId: string) =>
                            api.get<ReviewTierRecord>(`/med-content/${contentId}/review-tier`),
  overrideTier:           (contentId: string, body: OverrideTierBody) =>
                            api.post<ReviewTierRecord>(`/med-content/${contentId}/review-tier/override`, body),
  getFKScore:             (contentId: string) =>
                            api.get<FKScoreRecord>(`/med-content/${contentId}/fk-score`),
  runPreMLR:              (contentId: string, body: RunPreMLRBody) =>
                            api.post<PreMLRCheckResult>(`/med-content/${contentId}/pre-mlr/run`, body),
  acknowledgePreMLRIssue: (contentId: string, body: AcknowledgePreMLRIssueBody) =>
                            api.patch<PreMLRIssue>(`/med-content/${contentId}/pre-mlr/issues/${body.issueId}/acknowledge`, body),
  getAgenticReport:       (contentId: string) =>
                            api.get<AgenticMLRReport>(`/med-content/${contentId}/agentic-report`),
  submitToMLR:            (contentId: string, body: SubmitToMLRBody) =>
                            api.post<MedContentItem>(`/med-content/${contentId}/submit-to-mlr`, body),
  getMLRReviewers:        (contentId: string) =>
                            api.get<MLRReviewer[]>(`/med-content/${contentId}/mlr-reviewers`),
  getMLRComments:         (contentId: string) =>
                            api.get<MLRComment[]>(`/med-content/${contentId}/mlr-comments`),
  addMLRComment:          (contentId: string, body: { text: string; tag: MLRComment['tag'] }) =>
                            api.post<MLRComment>(`/med-content/${contentId}/mlr-comments`, body),
  resolveMLRComment:      (contentId: string, commentId: string) =>
                            api.patch<MLRComment>(`/med-content/${contentId}/mlr-comments/${commentId}/resolve`, {}),
  escalateMLRComment:     (contentId: string, commentId: string, escalatedBy: string) =>
                            api.patch<MLRComment>(`/med-content/${contentId}/mlr-comments/${commentId}/escalate`, { escalatedBy }),
  submitMLRDecision:      (contentId: string, body: SubmitMLRDecisionBody) =>
                            api.post<MedContentItem>(`/med-content/${contentId}/mlr-decision`, body),
  getWCAGResult:          (contentId: string) =>
                            api.get<WCAGTestResult>(`/med-content/${contentId}/wcag`),
  runWCAG:                (contentId: string, body: RunWCAGBody) =>
                            api.post<WCAGTestResult>(`/med-content/${contentId}/wcag/run`, body),
  applyWCAGFix:           (contentId: string, failureId: string) =>
                            api.patch<WCAGTestResult>(`/med-content/${contentId}/wcag/failures/${failureId}/fix`, {}),
  pushToLibrary:          (contentId: string, body: PushToLibraryBody) =>
                            api.post<{ cardsCreated: number }>(`/med-content/${contentId}/library/push`, body),
  getFinalRecord:         (contentId: string) =>
                            api.get<{ item: MedContentItem; libraryCards: object[]; complianceChain: object; signatures: SignatureRecord[] }>(`/med-content/${contentId}/final`),
  getKOLSession:          (contentId: string) =>
                            api.get<KOLSession>(`/med-content/${contentId}/kol-session`),
  generateInsights:       (sessionId: string) =>
                            api.post<KOLInsightsReport>(`/kol-sessions/${sessionId}/insights/generate`, {}),
  requestKOLApproval:     (sessionId: string, body: RequestKOLQuoteApprovalBody) =>
                            api.post<void>(`/kol-sessions/${sessionId}/quotes/request-approval`, body),
  getLocales:             (contentId: string) =>
                            api.get<LocalisedVersion[]>(`/med-content/${contentId}/locales`),
  addLocale:              (contentId: string, body: Omit<LocalisedVersion, 'id' | 'status' | 'assignedAt'>) =>
                            api.post<LocalisedVersion>(`/med-content/${contentId}/locales`, body),
  getPortfolio:           (projectId: string, scope?: string) =>
                            api.get<object>(`/projects/${projectId}/med-content/portfolio${scope ? `?scope=${encodeURIComponent(scope)}` : ''}`),
  exportComplianceReport: (projectId: string, scope?: string) =>
                            api.post<{ downloadUrl: string }>(`/projects/${projectId}/med-content/compliance-report`, { scope }),
}
```

---

## 28. Module C MSW Handlers (Phase 1)

New handler file `mocks/handlers/medContent.ts`. Add to `mocks/browser.ts`:

```typescript
// mocks/browser.ts — updated registration
import { medContentHandlers } from './handlers/medContent'
export const worker = setupWorker(
  ...documentHandlers, ...projectHandlers, ...aiHandlers,
  ...publicationHandlers,
  ...medContentHandlers,   // ← Module C
)
```

**New JSON fixture files required in `/data`:**

| File | Contents |
|------|----------|
| `medContent.json` | 4 content items: HCP Slide Deck (In Authoring, Tier 2, MLR track), PIL (In Authoring, Tier 3, FK 7.2 ✓, PAO assigned), CME Module (In MLR Review, ACCME track, Tier 1, overdue), MI Letter (MLR Approved, expires 2028-10-05) |
| `medClaims.json` | 8 claims: 6 Approved (with library similarity matches), 1 Modified, 1 Must Fix (unsubstantiated) |
| `medPreMLR.json` | Pre-MLR result: 0 must-fix, 3 should-fix, 1 note. All should-fix acknowledged. |
| `medAgenticReport.json` | 2 findings: Finding 1 Fair-balance Slide 12 escalated to Must Fix by Dr Morton, Finding 2 Comparative claim Slide 19 Should Fix |
| `medMLRReviewers.json` | 4 reviewers: Dr Rebecca Morton (submitted), Mr David Chen (submitted), Ms Sarah Price (in progress), Dr James Hartley / you (not yet submitted) |
| `medMLRComments.json` | 2 comments: MLR-C-001 Must Fix escalated from agentic (Dr Morton, 15 Oct 10:23), MLR-C-002 Should Fix (Dr Morton) |
| `medKOLSession.json` | Session 14 Oct 2026, 4 attendees with GDPR consent, 3 pre-reads uploaded, voice note transcribed (OpenAI Whisper), no insights report generated yet |

---

## 29. Module C ESLint Boundary Update

```json
{
  "rules": {
    "no-restricted-imports": ["error", {
      "patterns": [
        { "group": ["*/modules/scientific-writing/*"],  "message": "Module A must not import from Module B." },
        { "group": ["*/modules/clinical-writing/*"],    "message": "Module B must not import from Module A." },
        { "group": ["*/modules/medical-writing/*"],     "message": "Modules A and B must not import from Module C." },
        { "group": ["*/modules/regulatory-writing/*"],  "message": "Modules A, B, and C must not import from Module D." },
        { "group": ["*/modules/ideation/*"],            "message": "Modules A, B, and C must not import from Module E." }
      ]
    }]
  }
}
```

**Cross-module data access rule:** Module C reads Module A source documents (CSR, SmPC/IB) and Module B publications through the platform API layer — not by importing Module A or B code. `sourceModuleAProjectId` and `sourceModuleBPublicationId` on `MedContentItem` are the links; the API resolves them server-side.

**Module C shared components added to `components/ui/`:**

| Component | Props | Purpose |
|-----------|-------|---------|
| `FKGaugeBadge.tsx` | `{ score: number; passed: boolean }` | Live FK grade display; amber >8, green ≤8 |
| `ComplianceTrackChip.tsx` | `{ track: ComplianceTrack; locked: boolean }` | MLR (blue) / ACCME (green) chip with lock indicator |
| `ReviewTierBadge.tsx` | `{ tier: ReviewTier; overridden: boolean }` | Tier 1/2/3 badge with threshold label |
| `ContentExpiryChip.tsx` | `{ expiryDate: string }` | Expiry chip: green >6mo, amber ≤60d, red ≤30d |
| `MLRCommentCard.tsx` | `{ comment: MLRComment }` | MLR-C-### comment card with escalation chip support |
