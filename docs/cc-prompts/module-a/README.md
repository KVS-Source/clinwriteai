# Module A — CD prompts for missing screens

Written 2026-10-08. Each file in this folder is a ready-to-paste prompt
for Claude Design (CD). Hand one to CD per session.

Design conventions all five prompts assume (so CD matches the existing
Module A look):

- Shell + typography + AppShell chrome identical to the shipped
  Clinical Writing screens — see sA-01 .. sA-23 HTMLs in `docs/A/CC/`
  for reference.
- AppShell is already provided by `apps/web/src/components/layout/
  AppShell.tsx`. CD designs the **content area only** — a single
  component that drops into the editor's right panel OR mounts on a
  route under `/projects/:projectId/clinical-writing/...`.
- Hard-code all structural text (labels, headings, button copy,
  compliance text). Leave data rows + counts + timestamps + user names
  as `{{ }}` template variables for engineering to wire.
- Use the IBM Plex Mono / Plus Jakarta Sans pairing. Inter is NOT
  used.
- Status chips use text + colour + icon — never colour alone (WCAG
  2.1 AA).
- No new third-party deps without flagging in the response.

Index:

| Prompt | Screen | Priority | Notes |
|--------|--------|----------|-------|
| `01-document-upload.md` | Document Upload / Auto-Classification | 🔴 High | Replaces the current `/clinical-writing/classify` placeholder. Needs the dropzone + classification confidence display + override form. |
| `02-ai-assist-panel.md` | AI Suggest side panel | 🔴 High | New right-rail panel (`panelMode = 'ai'`). The textarea engineering lands keeps working without this; AI panel just enriches it. |
| `03-crm-resolution-panel.md` | CRM Resolution side panel | 🟡 Medium | Right-rail panel (`panelMode = 'crm-resolution'`). Lists open comments + lets chair mark resolved during a CRM meeting. |
| `04-traceability-panel.md` | Traceability side panel | 🟡 Medium | Right-rail panel (`panelMode = 'traceability'`). Shows "where did this span come from" — provenance per span. |
| `05-tlf-insert-panel.md` | TLF Insert side panel | 🟡 Medium | Right-rail panel (`panelMode = 'tlf'`). Pick a TLF item from the project's package + insert into the active section. |

Each prompt is self-contained — hand just one file. CD doesn't need
the others to design its screen.

## Not in this folder

- Formatting toolbar (Bold / Italic / Lists / Table) — depends on the
  TipTap integration (Phase 2 of docs/pivot-plan.md). No CD work until
  the editor engine lands.
- Document row ⋯ dropdown — simple enough that eng builds it inline
  from the recommended default list in [docs/decisions/module-a-defaults.md](../../decisions/module-a-defaults.md).
