# CD prompt — CRM Resolution side panel

## What to design

A right-rail panel that opens during a Comment Resolution Meeting
(CRM) so the chair + attendees can walk through open comments on the
document, mark each as resolved or deferred, and record the resolution.

The panel sits in the same slot as the other right-rail panels
(VoiceNote / Checklist / MedDRA). It opens when `panelMode =
'crm-resolution'`.

Reference: existing panels in `apps/web/src/panels/` for the pattern.

## Behaviour

### Header
- Panel title: "CRM — {{meetingRef}}" (e.g. "CRM-007").
- Chair name + attendee count: "Chair: Marcus Webb · 4 attendees".
- Timer: "Started 09:14 · 42 min elapsed" — a live counter.

### Body — comment list
List of comments ordered by:
1. Comments with `verdict = 'block_approval'` (red icon, pinned top)
2. Comments with `verdict = 'request_changes'` (amber icon)
3. Comments with `verdict = 'approve'` (green icon)
4. Plain comments (no verdict, blue icon)

Within each group, newest first.

Each row renders:
- Reviewer avatar + name
- Section reference (clicking jumps the main editor to that section)
- Comment text excerpt (3 lines, "Show more" expands)
- Current status chip (`open` / `resolved`)
- Three actions:
  - **Resolve** — moves comment to resolved; prompts for resolution
    note.
  - **Defer** — leaves comment open but marks "deferred to next CRM";
    appears in the next CRM meeting's agenda automatically.
  - **Jump to section** — opens the editor at the referenced section.

### Footer
- "Resolved {{resolvedCount}} of {{totalCount}} this meeting"
- CTA: **End meeting** (disabled when any `block_approval` comment is
  still open) — closes the CRM meeting + triggers the signature chain
  gate.

### Blocked state
If one or more `block_approval` comments remain open:
- Footer shows a red banner: "{{n}} blocking issues must be resolved
  before this document can proceed to signature."
- End meeting button is disabled with a tooltip.

## Data wiring (for engineering)

- Panel reads `documentId` + `meetingRef` from URL params.
- `GET /documents/{documentId}/comments?status=open` returns the list.
- `PATCH /documents/{documentId}/comments/{commentId}/resolve` body:
  ```json
  {
    "resolutionNote": "Agreed to reword as discussed",
    "resolutionType": "accepted" | "deferred" | "rejected"
  }
  ```
- `POST /crm-meetings/{meetingRef}/end` to close the meeting.

## Keep as `{{ }}` template variables

- meetingRef, chair name, attendee count, elapsed timer
- comment counts (resolved / total / blocking)
- reviewer names + avatars

## Deliverable

One React component file (`CRMResolutionPanel.tsx`) + a demo HTML.
