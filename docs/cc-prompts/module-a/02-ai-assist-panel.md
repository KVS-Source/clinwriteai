# CD prompt — AI Assist side panel

## What to design

A right-rail panel that opens when the user clicks the AI icon in the
Clinical Writing editor toolbar. The panel sits in the same slot as
the VoiceNote / Checklist / MedDRA panels (same width, same close
button in the header).

Three progressive states:

1. **Idle** — "Ask AI to draft or improve this section" + 3-4 preset
   intents as pill buttons.
2. **Generating** — streaming response area with a shimmer / cursor
   indicator; "Cancel" button.
3. **Suggestion ready** — the AI output in a card below the preset
   row, with Accept / Edit / Reject actions + a provenance footer
   showing model name + token cost + "AI-drafted" label.

Reference: the shipped VoiceNotePanel (`apps/web/src/panels/
VoiceNotePanel.tsx`) for the pattern of a side panel with header +
body + action row.

## Behaviour

### Preset intents
Three default pills visible from idle state:
- **Draft from source** — generates a draft of the active section
  from the project's linked source documents (CSR, Protocol, IB).
- **Tighten this section** — rewrites the current content for
  clarity; keeps all data points.
- **Explain this section** — summarises in plain English (useful for
  reviewers unfamiliar with the stats).

Plus a free-text input: "Or describe what you need…" with a Send
button.

### Suggestion card
When the AI returns:
- Model + cost footer: "claude-opus-4-7 · 2,340 tokens · $0.03"
- Three actions:
  - **Accept** — replaces the section's content with the suggestion.
    Creates a provenance span marked `ai-drafted` + records the
    `aiModel` field (required for Part 11 §11.70).
  - **Edit before accepting** — opens the suggestion in an inline
    textarea for the user to tweak, then Accept.
  - **Reject** — discards the suggestion. Audit event recorded so
    reviewers see the AI was consulted even when declined.
- "View diff" link toggles between the suggestion and a side-by-side
  diff against the current section.

### Guardrails
- If the quota is near its cap, show a yellow banner: "This tenant has
  used 92% of its monthly AI budget."
- If the quota is at cap, show a red banner + disable the Send button:
  "AI budget reached — upgrade or wait for next month."
- If the classifier flag indicates PII was scrubbed from the prompt,
  show a small chip under the Send button: "2 PII categories scrubbed
  before sending to AI."

## Data wiring (for engineering)

- Panel reads `documentId` + `activeSection` from the document store.
- `POST /documents/{documentId}/sections/{sectionId}/ai-suggest` body:
  ```json
  {
    "intent": "draft_from_source" | "tighten" | "explain" | "custom",
    "customPrompt": "...",   // when intent == 'custom'
    "model": "claude-opus-4-7"
  }
  ```
  Response is a `ChatResult`-shaped object from
  `apps/api/src/modules/platform/ai-gateway/service.ts`:
  ```json
  {
    "responseText": "...",
    "model": "claude-opus-4-7",
    "inputTokens": 1245,
    "outputTokens": 1095,
    "costUsd": 0.028,
    "limitDecision": "allowed" | "allowed_approaching_cap" | "rejected_cap",
    "piiScrubbed": true,
    "piiCategories": ["email", "mrn"],
    "recordId": "aicall-..."
  }
  ```
- Accept action: `PATCH /documents/{documentId}/sections/{sectionId}`
  with `{ contentHtml, aiDrafted: true, aiModel }`. API creates a
  new DocumentVersion automatically.

## Keep as `{{ }}` template variables

- Model name string
- Cost + token numbers
- Quota percentage + remaining budget
- Scrubbed PII category list

## Deliverable

One standalone React component file (`AIAssistPanel.tsx`) + a demo HTML.
