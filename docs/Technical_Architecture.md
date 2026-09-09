# Aurora — Technical Architecture Document
**Module A: Clinical Writing**
**Version 1.0 — September 2026**
*Status: Approved for prototype build. Production deployment decisions deferred to post-5-module prototype phase.*

---

## 0. Document Purpose & Scope

This document defines the technical architecture for Aurora Module A — Clinical Writing. It covers two phases:

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
import type { User } from '@aurora/types'

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
import type { Document, ChecklistItem, AuditEntry, Comment, AISuggestion } from '@aurora/types'

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
export { STATUS_META, RACI_META, USER_COLOURS } from '@aurora/types'

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
          { path: 'medical-writing',    element: <ModuleComingSoon module="Medical Writing" /> },
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
        // Module C accent — Medical Writing (violet already in blue/purple range)
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
