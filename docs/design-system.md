# Aurora — Design System Reference
**For Claude Code (CC) use. Extracted from aurora-all-screens.html — Sessions 1–3.**
Last updated: Session 3 lock. Update this file only when a foundational system change is made (not for screen-specific content fixes).

---

## 1. Stack & Conventions

- **Framework:** React (functional components, hooks)
- **Styling:** Tailwind CSS utility classes for CC builds. Important: Claude Design (CD) outputs inline styles — when converting CD screens to React, translate inline style values to equivalent Tailwind classes using the token values in Section 2. Do not copy CD's inline style strings directly into React components.
- **Data:** Local JSON files in `/src/data/` — no backend, no API calls in prototype
- **AI responses:** Simulated — canned JSON responses, no live API calls
- **File naming:** `ScreenName.jsx` in PascalCase, e.g. `DocumentEditor.jsx`, `TraceabilityPanel.jsx`
- **Component naming:** PascalCase for components, camelCase for props and handlers
- **No form tags:** Use `onClick` / `onChange` handlers directly on buttons and inputs

---

## 2. Colour Tokens

Define these as CSS custom properties in `index.css` or as a `colors.js` constants file.

### Platform Chrome
| Token | Hex | Usage |
|-------|-----|-------|
| `--slate-900` | `#1E293B` | Top nav, sidebar background, primary text |
| `--slate-700` | `#334155` | User avatar background in nav |
| `--slate-600` | `#475569` | Secondary icon colour |
| `--slate-500` | `#64748B` | Secondary text, labels, captions |
| `--slate-400` | `#94A3B8` | Placeholder text, inactive nav items |
| `--slate-300` | `#CBD5E1` | Borders (light), disabled dots |
| `--slate-200` | `#E2E8F0` | Default border colour — use everywhere |
| `--slate-100` | `#F1F5F9` | Hover background, secondary chips |
| `--slate-50` | `#F8FAFC` | Page background, panel backgrounds |
| `--white` | `#FFFFFF` | Card/surface background |

### Module Accent Colours
| Module | Name | Hex | Usage |
|--------|------|-----|-------|
| Clinical Writing | `--blue-600` | `#2563EB` | Primary actions, active states, Module A accent |
| Clinical Writing (dark) | `--blue-700` | `#1D4ED8` | Button hover, link colour |
| Scientific Writing | `--teal-600` | `#0D9488` | Module B accent |
| Medical Writing | `--violet-700` | `#7C3AED` | Module C accent, AI provenance icon |
| Regulatory Writing | `--amber-600` | `#D97706` | Module D accent, warning colour |
| Ideation & Publishing | `--rose-600` | `#E11D48` | Module E accent, notification badge |

### Semantic Colours
| Token | Hex | Usage |
|-------|-----|-------|
| `--green-700` | `#15803D` | Signed status text, success text |
| `--green-600` | `#16A34A` | Complete dot, success indicator |
| `--green-50` | `#F0FDF4` | Signed status pill bg, success banner bg |
| `--green-100` | `#BBF7D0` | Success banner border |
| `--amber-700` | `#B45309` | Warning text (overdue, waived) |
| `--amber-50` | `#FFFBEB` | Warning pill bg, T&C warning bg |
| `--amber-200` | `#FDE68A` | Warning banner border |
| `--red-600` | `#DC2626` | Error, required field asterisk |

### AI & Traceability Colours
| Token | Hex | Usage |
|-------|-----|-------|
| `--blue-100` | `#DBEAFE` | AI badge bg, selected traceable value bg, MFA cursor bg |
| `--blue-200` | `#BFDBFE` | AI Suggest button border, traceability pill border |
| `--blue-50` | `#EFF6FF` | AI Suggest button bg, selected doc type card bg, In Authoring pill bg |
| `--ai-bg` | `#F0F7FF` | AI-drafted paragraph background |
| `--ai-border` | `#93C5FD` | AI-drafted paragraph left border, traceable value underline |
| `--violet-50` | `#F5F3FF` | CRM In Progress pill bg |

---

## 3. Typography

**Primary font:** Plus Jakarta Sans (loaded via Google Fonts)
**Monospace font:** IBM Plex Mono (loaded via Google Fonts)

### Type Scale
| Role | Size | Weight | Line Height | Font | Notes |
|------|------|--------|-------------|------|-------|
| Page title | 24px | 700 | 1.25 | Plus Jakarta Sans | `letter-spacing: -0.02em` |
| Section heading | 22px | 700 | 1.25 | Plus Jakarta Sans | Editor H1 (ICH section) |
| Sub-heading | 20px | 700 | 1.25 | Plus Jakarta Sans | Panel titles |
| Sub-sub-heading | 17px | 700 | 1.35 | Plus Jakarta Sans | Editor H2 |
| Body heading | 15–16px | 700 | 1.35 | Plus Jakarta Sans | Document titles in lists |
| Body text | 14px | 400 | 1.8 | Plus Jakarta Sans | Editor content, descriptions |
| UI label | 13px | 400/600 | 1.35 | Plus Jakarta Sans | Table cells, nav items |
| Small label | 12px | 600 | 1.5 | Plus Jakarta Sans | Field labels, filter chips |
| Caption | 11px | 400/500 | 1.5 | Plus Jakarta Sans | Timestamps, hints |
| Tiny | 10px | 500 | 1.4 | Plus Jakarta Sans | Sub-labels on step indicators |

### IBM Plex Mono Usage
| Context | Size | Weight | Letter Spacing | Case |
|---------|------|--------|----------------|------|
| Section labels (SECTIONS, WORKSPACE) | 10px | 500 | 0.14em | uppercase |
| Event labels (SUGGESTION, REFINE, AI, NEW DOCUMENT) | 10px | 500 | 0.12em | uppercase |
| SOON / INHERITED badges | 9–10px | 500 | 0.08em | uppercase |
| Monospace values (HR = 0.61, version strings) | 12px | 500 | normal | as-is |
| Traceability pill text (HR 0.61) | 13px | 500 | normal | as-is |
| MFA digit boxes | 22px | 600 | normal | as-is |
| Keyboard shortcuts (⌘J) | 9px | 500 | normal | as-is |
| Screen index labels (01a, 02, etc.) | 11px | 500 | 0.1em | as-is |

---

## 4. Spacing Scale

Derived from actual padding and gap values in the screens.

| Token | Value | Common Usage |
|-------|-------|-------------|
| `space-1` | 4px | Tight internal padding (badge padding) |
| `space-2` | 6px | Icon button padding, chip padding |
| `space-3` | 8px | Gap between icon + label, small internal gap |
| `space-4` | 10px | Button padding vertical, standard gap |
| `space-5` | 12px | Card internal padding, form gap |
| `space-6` | 14px | Panel header padding, medium gap |
| `space-7` | 16px | Section padding, standard card padding |
| `space-8` | 20px | Content area left padding, form section gap |
| `space-9` | 24px | Page content padding, large section gap |
| `space-10` | 32px | Inter-section gap |
| `space-11` | 48px | Editor left/right content padding |

---

## 5. Component Specifications

### Buttons

**Primary**
```
background: #2563EB
color: #FFFFFF
border: none
border-radius: 6px
padding: 10px 16px (standard) | 9px 14px (compact) | 8px 14px (toolbar)
font: 600 14px Plus Jakarta Sans (standard) | 600 13px (compact)
hover: background #1D4ED8
```

**Secondary**
```
background: #FFFFFF
color: #1E293B
border: 1px solid #E2E8F0
border-radius: 6px
padding: 10px 16px (standard) | 9px 12px (compact)
font: 600 14px Plus Jakarta Sans (standard) | 600 12px (compact)
hover: background #F8FAFC
```

**Disabled**
```
background: #F1F5F9
color: #94A3B8
border: 1px solid #E2E8F0
cursor: not-allowed
```

**Text link**
```
color: #2563EB
font-weight: 600
font-size: 12–13px
no border, no background
hover: color #1D4ED8, text-decoration underline
```

**Destructive secondary**
```
Same as secondary but color: #DC2626 and border-color: #FCA5A5 on hover
```

### Status Pills

All pills: `border-radius: 999px`, `font-weight: 600`, `padding: 3px 9px` (standard) or `4px 10px` (with dot).
Font-size: `12px` for document status pills (In Authoring, In Review, etc.). `11px` for project-level status pills (Ongoing, On Hold, confidence badges) and comment status.

| Status | Background | Text Colour |
|--------|-----------|-------------|
| In Authoring | `#EFF6FF` | `#2563EB` |
| In Review | `#FFFBEB` | `#B45309` |
| CRM In Progress | `#F5F3FF` | `#7C3AED` |
| Signed ✓ | `#F0FDF4` | `#15803D` |
| Not Started | `#F8FAFC` | `#64748B` |
| Active | `#F0FDF4` | `#15803D` |
| Ongoing | `#F0FDF4` + green dot | `#15803D` |
| On Hold | `#FFFBEB` + amber dot | `#B45309` |
| Open (comment) | `#FFFBEB` | `#B45309` |
| Overdue | no pill — inline `color: #B45309 font-weight: 600` | — |

### Status Dots (6px circle, border-radius: 50%)
| State | Colour |
|-------|--------|
| Complete | `#16A34A` |
| Active / In Progress | `#2563EB` |
| Pending / Not Started | `#CBD5E1` |
| Waived / Warning | `#D97706` |
| Error / Notification | `#E11D48` |
| Autosave / Live | `#16A34A` |

### Input Fields
```
Standard:
  padding: 10–11px 12px
  border: 1px solid #E2E8F0
  border-radius: 6px
  font: 400 14px Plus Jakarta Sans
  color: #1E293B
  background: #FFFFFF
  
Focus:
  border-color: #2563EB
  box-shadow: 0 0 0 3px rgba(37,99,235,0.12)

Disabled / Inherited:
  background: #F8FAFC
  color: #64748B
  cursor: not-allowed
  Show "INHERITED" IBM Plex Mono 10px badge right-aligned inside field
  
Error:
  border-color: #DC2626
  box-shadow: 0 0 0 3px rgba(220,38,38,0.12)
```

### Confidence Badges (traceability / auto-classification)
```
border-radius: 999px
padding: 3px 9px
font-size: 11px
font-weight: 600
background: #F0FDF4
color: #15803D
```

### Filter Chips
```
Active:
  background: #EFF6FF
  color: #1D4ED8
  border: 1px solid #2563EB
  
Inactive:
  background: #FFFFFF
  color: #475569
  border: 1px solid #E2E8F0

All chips: border-radius 999px, padding 6px 12px, font-size 12px, font-weight 600, cursor pointer
```

### IBM Plex Mono Badges (system labels)
```
Standard system label (SECTIONS, NEW DOCUMENT, SUGGESTION):
  font: 500 10px IBM Plex Mono
  letter-spacing: 0.12–0.14em
  text-transform: uppercase
  color: #64748B
  No background — plain text label

AI badge (inside AI paragraph):
  background: #DBEAFE
  color: #1D4ED8
  border-radius: 4px
  padding: 4px 7px
  font: 500 9px IBM Plex Mono
  Position: absolute top-right of paragraph block

SOON badge (disabled feature):
  background: #F1F5F9
  color: #94A3B8
  border-radius: 3px
  padding: 2px 4px
  font: 500 9px IBM Plex Mono
  letter-spacing: 0.08em

INHERITED badge (read-only field):
  color: #94A3B8
  font: 500 10px IBM Plex Mono
  letter-spacing: 0.06em
  Right-aligned inside field — no background
```

### Checklist Items
```
Row: padding 10px 16px, border-bottom 1px solid #F1F5F9, display flex, align-items flex-start, gap 10px
Hover: background #F8FAFC

Checkbox states (18px square, border-radius 4px):
  Checked:     background #2563EB, white checkmark SVG 10px
  In-progress: background #FFFFFF, border 2px solid #2563EB,
               partial arc SVG: circle cx=9 cy=9 r=6, stroke #2563EB stroke-width 2,
               stroke-dasharray "28 10", transform rotate(-90 9 9), fill none
  Unchecked:   background #FFFFFF, border 1px solid #CBD5E1
  Waived:      background #FFFBEB, border 1px solid #D97706, ⚠ symbol 11px/800 #B45309 centred

Content column (flex:1, display flex, flex-direction column, gap 2px):
  Item name: 13px font-weight 600 #1E293B
  Framework tag: 11px #64748B (plain) or pill (bg #FFFBEB, color #B45309,
    border 1px solid #D97706, border-radius 4px, padding 2px 6px) for waived items
  Status/completer note: 11px, colour by state:
    Complete: #16A34A (includes completer name and date)
    In-progress: #2563EB
    Pending/warning: #B45309
    Waived: #B45309 (includes actor name and date)

Section labels:
  Standard: IBM Plex Mono 10px uppercase #64748B letter-spacing 0.12em, padding 12px 16px 6px
  Waived group: same but color #D97706

"+ Add checklist item" button:
  Full width minus 32px margin (margin 12px 16px)
  Border 1px dashed #CBD5E1, border-radius 6px, padding 10px
  Text centred 13px #64748B, background #FFFFFF, hover background #F8FAFC
```

### Voice Note Waveform
```
Display: flex, align-items flex-end, justify-content center, gap 3px
24 vertical bars, border-radius 2px top, background #CBD5E1 (inactive state)
Bell-curve height sequence (px, left to right):
  4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 19, 18, 20, 19, 18, 16, 14, 12, 10, 8, 6, 5, 4, 4
Active/recording state: bars animate, colour #2563EB
```

### Skeleton Loaders
```
height: 10px
border-radius: 5px
background: #E2E8F0 (primary col) or #EEF2F6 (secondary cols)
animation: auroraShimmer 1.2s ease-in-out infinite

@keyframes auroraShimmer {
  0% { opacity: 0.55; }
  50% { opacity: 1; }
  100% { opacity: 0.55; }
}
```

### Progress Bars
```
Container: height 6px, border-radius 3px, background #E2E8F0, overflow hidden
Fill: height 100%, background #2563EB, width = percentage
Label above bar: font-size 11px, color #64748B
```

### AI Paragraph Block
```
border-left: 3px solid #93C5FD
background: #F0F7FF
border-radius: 0 4px 4px 0
padding: 10px 14px
margin: 12px 0
position: relative
padding-right: 40px (to clear AI badge)

AI badge: position absolute, top 10px, right 10px
  font: 500 9px IBM Plex Mono
  color: #1D4ED8
  background: #DBEAFE
  border-radius: 4px
  padding: 4px 7px
  content: "AI"
```

### Traceable Value Spans
```
Default (clickable, not selected):
  border-bottom: 1.5px solid #93C5FD
  cursor: pointer

Selected (traceability panel open):
  border-bottom: 1.5px solid #93C5FD
  background: #DBEAFE
  cursor: pointer
```

### Source Cards (traceability panel)
```
background: #FFFFFF
border: 1px solid #E2E8F0
border-radius: 6px
padding: 12px
gap: 8px between rows

Row 1: icon (14px SVG) + label (13px bold) + flex spacer + "View source" link (12px)
Row 2: sub-label (12px #64748B)
Row 3: monospace value OR italic excerpt (12px)
  Monospace value: font 500 12px IBM Plex Mono, bg #F8FAFC, border-radius 4px, padding 4px 8px
  Italic excerpt: font-style italic, color #64748B
```

### Document Table Rows
```
Three column configurations in use — pick by context:

Clinical Writing home (Screen 6) — 7 columns:
  grid-template-columns: 2.1fr 1fr 1.2fr 1.1fr 0.9fr 1.1fr 0.8fr
  Columns: Document Title | Type | Stage | Status | Last Updated | Assigned To | Quick Actions

New Document drawer (Screen 7) — 4 columns (condensed):
  grid-template-columns: 2.4fr 1fr 1.1fr 1fr
  Columns: Document Title | Type | Status | Assigned To

All Projects (Screen 3) — 7 columns:
  grid-template-columns: 1.5fr 1.3fr 1fr 1.1fr 0.9fr 1fr 0.9fr
  Columns: Project Name | Client | Therapeutic Area | Modules Active | Status | Last Updated | Quick Actions

All table configs share:
  Row: padding 14–18px 20px, border-bottom 1px solid #E2E8F0, font-size 13–14px
  Hover: background #F8FAFC
  Header row: background #F8FAFC, font-size 12px, font-weight 600, color #64748B
  Sortable columns: display flex, gap 6px, cursor pointer
  Sort arrows: color #94A3B8, font-size 11px
  Assigned To cell: 24px initials avatar (background #F1F5F9, color #475569) + name, overflow ellipsis
  Quick Actions cell: "Open" secondary button (padding 6px 12px) + ••• menu dots
```

### Toggle Switch (Screen 19 — Session 6)
```
Track: width 36px, height 20px, border-radius 999px
ON state:  track background #2563EB, thumb right-aligned
OFF state: track background #E2E8F0, thumb left-aligned
Thumb: width 16px, height 16px, border-radius 50%, background #FFFFFF
Thumb padding inside track: 2px (track padding: 2px, box-sizing: border-box)
Transition: background 0.2s ease on track

Usage: "Notify reviewer" toggle in comment resolution panel (Screen 19)
```

### RACI Badges (Screen 15 — Session 5)
```
All RACI badges: IBM Plex Mono 9px, font-weight 700, border-radius 4px, padding 2px 6px

R (Responsible): background #EFF6FF, color #2563EB, no border
A (Accountable):  background #F0FDF4, color #15803D, no border
C (Consulted):    background #F8FAFC, color #64748B, border 1px solid #E2E8F0
I (Informed):     background #F8FAFC, color #94A3B8, border 1px solid #E2E8F0
```

### Resolution Action Cards (Screen 19 — Session 6)
```
Three equal-width cards side by side, gap 8px
Default/unselected: background #FFFFFF, border 1px solid #E2E8F0, border-radius 8px, padding 12px
Hover: background #F8FAFC, border-color #CBD5E1
Selected: border 2px solid #2563EB, background #EFF6FF (for Accept with blue accent)
          border 2px solid #16A34A, background #F0FDF4 (for Accept — green selected)

Card content: title 13px bold #1E293B + sub-label 11px #64748B line-height 1.4
```

### Signature Chain Row (Screen 20 — Session 7)
```
Four signer rows, each: padding 12px 16px, border-bottom 1px solid #F1F5F9

States:
Signed:    background #F0FDF4, border-left 3px solid #16A34A
           Avatar + name + role + "Signed ✓" green + timestamp + SHA-256 verified
Awaiting:  background #FFFFFF, border 2px solid #2563EB, box-shadow 0 0 0 3px rgba(37,99,235,0.08)
           Avatar + name + role + "Awaiting your signature" + "Sign now →" primary button
Queued:    opacity 0.6, background #FFFFFF, border 1px solid #E2E8F0
           Avatar + name + role + "Queued" muted

Chain progress bar: "1 of 4 recorded" label + 6px height bar, border-radius 3px
Cancel voids chain warning: shown below chain as italic note
```

### Meaning of Signature Cards (Screen 20 — Session 7)
```
Three selectable cards stacked, gap 8px
Default: background #FFFFFF, border 1px solid #E2E8F0, border-radius 8px, padding 12px 14px
Selected: background #EFF6FF, border 2px solid #2563EB, blue checkmark circle top-right 16px

Content: title 13px bold + sub-label IBM Plex Mono 9px #64748B
Three meanings: "I have authored this document" / "I have reviewed" / "I approve for submission"
```

### Signed Document Banner (Screen 21 — Session 7)
```
Replaces toolbar on signed/final documents
Height: 36px, background #F0FDF4, border-bottom 1px solid #BBF7D0
Content: shield SVG 14px #15803D + "This document is signed and locked. No further edits are permitted."
         13px #15803D + flex:1 + "View audit trail →" text link 13px #15803D font-weight 600
```

### Signature Chain Banner in Document (Screen 21 — Session 7)
```
White card, border 1px solid #BBF7D0, border-radius 8px, padding 16px 20px, background #F0FDF4
Layout: shield SVG 24px #15803D flex:none + centre column flex:1 + right signatures column

Centre column:
  "Electronically signed document" 14px bold #15803D
  SHA-256 hash IBM Plex Mono 11px #15803D opacity 0.7

Right signatures column (stacked, gap 4px):
  Each: avatar 18px + "Name · Role · DD Mon YYYY HH:MM UTC" 11px #15803D
```

### Diff View Change Types (Screen 24 — Session 8)
```
Inline replacement (word-level):
  Removed: <del> background #FEE2E2, color #DC2626, text-decoration line-through,
           border-radius 2px, padding 0 2px
  Added:   <ins> background #DCFCE7, color #15803D, text-decoration none,
           border-radius 2px, padding 0 2px

Added line (sentence/paragraph-level):
  border-left: 3px solid #16A34A
  background: #F0FDF4
  border-radius: 0 4px 4px 0
  padding: 8px 14px 8px 26px (extra left for + symbol)
  position: relative
  "+" prefix: IBM Plex Mono 11px #16A34A, position absolute left 8px top 8px

AI-accepted addition: same as added line + "AI" badge (IBM Plex Mono 9px, #DBEAFE bg #1D4ED8 text,
  border-radius 4px, padding 2px 6px) positioned right edge of the added line

Unchanged sections (dimmed): opacity 0.4

Section header row for restore:
  display flex, align-items center, gap 12px
  title 15px bold #1E293B flex:1
  "N changes" badge: IBM Plex Mono 9px, #F1F5F9 bg #64748B text, border-radius 4px, padding 2px 6px
  Checkbox 16px square, border-radius 4px
    Unchecked: border 1px solid #CBD5E1, background #FFFFFF
    Checked:   background #2563EB, border #2563EB, white checkmark SVG
  "Restore §X.X from v0.3 →" text link 12px #2563EB (unchecked) /
    "Selected for restore ✓" 12px #16A34A font-weight 600 (checked)
  Selected row: background #F0FDF4, border-radius 6px, padding 8px 12px

Sticky restore bar (appears when sections selected):
  Pinned above provenance bar, spans editor column only (not full viewport)
  Height: 56px, background #FFFFFF
  border-top: 2px solid #2563EB
  box-shadow: 0 -4px 12px rgba(15,23,42,0.08)
  Content: count label + section names IBM Plex Mono 11px + flex:1 + Reason input + Cancel + CTA
  Note below buttons (centred, 11px italic #94A3B8):
    "v0.3 and v0.4 remain permanently in version history. A new v0.5 will be created."
```

### Reference Dropdown Button (Sessions 8 — all editor screens)
```
Style: display flex, align-items center, gap 6px, height 28px, padding 0 10px
       border 1px solid #E2E8F0, border-radius 6px, background #FFFFFF
       font-size 12px, font-weight 600, color #475569

Contents: [book SVG icon 12px] [" Reference "] [chevron SVG 8×8px polygon "1,3 9,3 5,8"]

Active state (any reference panel open):
  background #EFF6FF, border-color #2563EB, color #2563EB (icon and chevron inherit)

Dropdown menu (on click):
  position absolute below button, background #FFFFFF, border 1px solid #E2E8F0
  border-radius 8px, box-shadow 0 8px 20px rgba(15,23,42,0.10), min-width 180px, z-index 10
  Three rows: [icon 12px #64748B] [label 13px #1E293B], padding 9px 14px, border-radius 4px
    hover: background #F8FAFC
  Active row (current open panel): label color #2563EB, font-weight 600
  Three options: "ICH E3 Validator" · "MedDRA Lookup" · "TLF Cross-Reference"

Toolbar position: between table icon and flex spacer
                  (before Voice note, Checklist, Audit trail buttons)
```

### Alert Banner — Full Width (Screen 23 — Session 7)
```
Full width, background #FFFBEB, border-bottom 1px solid #FDE68A
padding: 14px 32px, display flex, align-items center, gap 12px

Content: [warning triangle SVG 18px #D97706 flex:none] [text column flex:1] [action link flex:none]

Text column: title 14px bold #B45309 + body 13px #B45309 line-height 1.5
Action link: "View compliance record →" 13px #2563EB font-weight 600

Warning triangle SVG: D97706 stroke + fill for dot and bar
```

### CRM Meeting Status Pill (Screen 18 — Session 6)
```
"Meeting in progress": background #F0FDF4, border 1px solid #BBF7D0, border-radius 999px
  padding 6px 14px, display flex align-items center gap 8px
  Content: 8px dot (background #16A34A, animation: auroraGreenPulse 2s ease-out infinite)
           + "Meeting in progress" 13px font-weight 600 #15803D

"End meeting" button: background #FFFBEB, color #B45309, border 1px solid #FDE68A
  border-radius 6px, padding 8px 14px, font-size 13px, hover background #FEF3C7
```

---

## 6. Layout Patterns

### Pattern 1 — Platform Shell (all screens)
```
Total width: 1440px
Top nav: height 56px, background #1E293B, position fixed top
  Left: hamburger toggle (28px) + Aurora logo (26px square) + wordmark + divider + tenancy label
  Right: bell icon (32px) with badge + divider + avatar (30px) + name + role

Sidebar: width 224px, flex:none, background #1E293B
  Padding: 16px 0
  Section label: IBM Plex Mono 10px uppercase #64748B, padding 0 20px 10px
  Nav items: 44px height, padding 9px 20px, gap 12px (icon + label)
    Inactive: color #94A3B8, border-left 3px solid transparent
    Semi-active (parent context): background rgba(255,255,255,0.05), white text
    Active: background #334155, color #FFFFFF, border-left 3px solid #2563EB
  Sub-nav (project items): indented 43px, font-size 13px
  Bottom panel: "Validated state" card, margin 12px, bg rgba(255,255,255,0.05)

Main content: flex:1, min-width 0, background #F8FAFC
```

### Pattern 2 — List Screen (Screens 3, 6)
```
[Top nav 56px]
[Sidebar 224px] | [Main content flex:1]
                    [Page header: white, border-bottom, padding 20–26px 32px]
                    [Filter bar: white, border-bottom, padding 16px 32px]
                    [Tab rail (if applicable): white, border-bottom, padding 0 32px]
                    [Scrollable content: padding 24px 32px]
                      [Main table/list card: flex:1]  [Activity panel: 280px flex:none]
```

### Pattern 3 — Document Editor (Screens 9–11)
```
[Top nav 56px — with sidebar collapse toggle added left of logo]
[Sidebar 224px] | [Document header: white, border-bottom, 56px compact]
                   [Toolbar: 40px, #F8FAFC, border-bottom]
                   [Three-panel row: flex:1]
                     [Section navigator: 220px, #F8FAFC, border-right]
                     [Editor: flex:1, white, overflow-y auto]
                     [Right panel: 280px, border-left — AI Suggest OR Traceability]
                   [Provenance bar: 40px, #F8FAFC, border-top]
```

### Pattern 4 — Full-page Modal / Gate (Screens 2, 8)
```
Background: #1E293B (full screen, dark)
Modal card: max-width 760px, white, border-radius 12px
  box-shadow: 0 24px 60px rgba(15,23,42,0.28)
  Cannot be dismissed (T&C gate) or confirmed/discarded (auto-classification)
```

### Pattern 5 — Drawer (Screen 7)
```
Drawer slides in from right over main content
Resize handle: 14px wide, left edge, cursor col-resize, drag bar 3px #CBD5E1
Header: padding 20px 24px 16px, border-bottom
Content: flex:1, overflow-y auto, padding 20px 24px
```

### Pattern 6 — Non-Modal Resizable Right Panel (Screens 12–14)
```
Replaces the fixed right panel pattern for Voice Note, Checklist, and Audit Trail.
position: absolute, right edge of content region, top 0, bottom 0
z-index: 6
box-shadow: -16px 0 40px rgba(15,23,42,0.12)
Editor column stays constant at 995px regardless of panel open/closed/dragging

Drag handle (left edge of panel):
  width: 14px, cursor: col-resize
  Centred vertical bar: 3px wide × 24px tall, background #CBD5E1, border-radius 2px
  Hover: bar colour #94A3B8

Width range: 260px minimum — 760px maximum
Default collapsed: 280px
Expanded (header toggle): 480px
Toggle icon: ⤢ two-arrows-outward (collapsed) / arrows-inward (expanded)
  24px square touch target, border-radius 6px, color #64748B, hover background #F1F5F9

Panel header (all panels, height 48px, flex:none, border-bottom #E2E8F0, padding 14px 16px):
  [panel icon 14px #2563EB] [panel title 14px bold] [flex:1] [expand toggle] [✕ close]
  Both expand and close: 24px square, border-radius 6px, color #64748B, hover #F1F5F9

Panel backgrounds:
  Voice Note: #F8FAFC
  Checklist: #FFFFFF (card-heavy content)
  Audit Trail: #FFFFFF
```

### Pattern 7 — Collaborative Presence (all editor screens, Sessions 4+)
```
Section navigator presence indicators (right edge of each section row):
  Active user (logged-in, editing): 16px circle, #DBEAFE bg, #1D4ED8 text,
    font 700 9px IBM Plex Mono, border-radius 50%
  Other user (locked section): 16px circle, colour varies by user (see below),
    same sizing. Section row text muted to #94A3B8, lock SVG 10px before title.
  Max 2 avatars shown per row, then "+N more"

Section lock overlay (on locked sections in editor content):
  Banner: background #F1F5F9, border-radius 6px, padding 8px 12px, margin-bottom 8px
  Layout: [user avatar 14px] ["{Name} is editing this section" 11px #64748B] [flex:1]
    ["Request section" text link 11px #2563EB]

Document header presence stack (right of autosave, left of Save button):
  Overlapping 24px avatar circles, offset -6px each, box-shadow 0 0 0 2px #FFFFFF
  Logged-in user: additional 2px #2563EB outer ring
  Separator: 1px #E2E8F0, height 20px, margin 0 8px
  "[N] active" label: 12px #64748B

User avatar colour assignments (consistent across all screens):
  Marcus Webb (MW):   #DBEAFE bg / #1D4ED8 text — blue
  Dr. Sarah Chen (SC): #F0FDF4 bg / #15803D text — green
  Dr. James Okonkwo (JO): #F5F3FF bg / #7C3AED text — violet
  Dr. Elena Vasquez (EV): #FEF3C7 bg / #D97706 text — amber
  Dr. Priya Nair (PN): #FEE2E2 bg / #DC2626 text — red
  Dr. Amir Hossain (AH): #E0F2FE bg / #0369A1 text — sky
  Rachel Thorn (RT): #FCE7F3 bg / #9D174D text — pink
  Dr. Linda Park (LP): #F3F4F6 bg / #374151 text — grey
  Aurora AI: #F5F3FF bg, violet spark SVG icon (no initials)

Static prototype state (Screens 9–14):
  §11.4 Efficacy Evaluation: MW editing (logged-in user)
  §12.2 Safety Evaluation: JO locked — muted row, lock icon, locked overlay in editor
  Header stack: MW + JO + EV = "3 active"
```

### Pattern 8 — CRM Module (Screen 18 — Session 6)
```
Three-panel layout, fills full viewport height minus top nav and page header
Total: 1440px. Sidebar 224px + left panel 280px + centre flex:1 (656px) + right panel 280px

Left panel (280px flex:none, #F8FAFC, border-right #E2E8F0, overflow-y auto):
  Four sections: Meeting Details · Attendees · Meeting Progress · Actions
  Each section: padding 16px, border-bottom #E2E8F0
  Section label: IBM Plex Mono 10px uppercase #64748B, margin-bottom 10px

Centre panel (flex:1 min-width 0, #FFFFFF, border-right #E2E8F0, overflow-y auto, padding 24px):
  Title row: "Resolution Queue" 16px bold + meta 12px #64748B + "View document →" link
  Comment cards: stacked, gap 12px
  Card states: resolved (green tint), active (blue 2px border + glow), pending (opacity 0.6)

Right panel (280px flex:none, #F8FAFC, overflow-y auto):
  "RESOLUTION LOG" IBM Plex Mono header
  Log entry cards + dashed placeholder rows
  Footer: "Download minutes draft" button
```

### Pattern 9 — E-Signature Chain (Screen 20 — Session 7)
```
Page has two regions: signature chain (main content, scrollable) + signing panel (right overlay)

Signature chain (centre, flex:1):
  Document card with SHA-256 hash + progress bar
  Four signer rows stacked, each showing state (Signed/Awaiting/Queued)
  Click any row → panel switches to show that row's full Part 11 record

Signing panel (right overlay, 320–760px resizable, default 480px):
  Same overlay pattern as Sessions 4–6 panels
  Three states driven by row selection:
    1. "Signature record" — shows 11-field Part 11 record for a signed row
    2. "Electronic signature" — signing form for current user's row
    3. "Pending signature" — info panel for a queued row
  Panel header shows step context: "STEP 2 OF 4" IBM Plex Mono 10px
```

### Pattern 10 — Diff View (Screen 24 — Session 8)
```
Same editor shell as Screen 9 but:
  Toolbar: all standard buttons present including Reference dropdown
  Editor content replaced with diff content area
  Diff banner: full width, 36px, #F8FAFC, border-bottom #E2E8F0 — sits between toolbar and diff content
  Provenance bar: shows diff provenance ("Diff: v0.3 → v0.4 · section · N changes · ...")
  Sticky restore bar: appears above provenance bar when sections selected for restore

Version chip active state in header:
  background #EFF6FF, border #2563EB, color #2563EB
  Shows "× close" and "Comparing v0.3 → v0.4" label in IBM Plex Mono 11px #64748B
```

### Pattern 11 — Final Document / Read-Only Editor (Screen 21 — Session 7)
```
Same editor shell but:
  Toolbar replaced by signed banner (36px green #F0FDF4 row)
  Editor content: read-only — no AI highlights, no traceable underlines, no cursor placeholder
  No right panel
  Section navigator: all sections green complete, no active highlight, 100% progress bar
  Signature chain banner appears at top of editor content before Section 1
```

---

## 7. Shadow & Elevation Scale

| Level | Value | Usage |
|-------|-------|-------|
| Focus ring | `0 0 0 3px rgba(37,99,235,0.12)` | All focused inputs, active dropdowns |
| Refine card focus | `0 0 0 3px rgba(37,99,235,0.10)` | REFINE card in AI panel |
| Dropdown | `0 12px 28px rgba(15,23,42,0.12–0.14)` | Dropdowns, tooltips |
| Modal | `0 24px 60px rgba(15,23,42,0.28)` | Full-screen modals |
| Side panel | `-16px 0 40px rgba(15,23,42,0.12)` | Resizable detail panel sliding in |

---

## 8. Animation Tokens

```css
@keyframes auroraShimmer {
  0%   { opacity: 0.55; }
  50%  { opacity: 1; }
  100% { opacity: 0.55; }
}
/* Usage: skeleton loader rows, 1.2s ease-in-out infinite */

@keyframes auroraBar {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(320%); }
}
/* Usage: loading progress bar strip, 0.9s linear infinite */

@keyframes auroraPulse {
  0%   { box-shadow: 0 0 0 0 rgba(37,99,235,0.35); }
  70%  { box-shadow: 0 0 0 8px rgba(37,99,235,0); }
  100% { box-shadow: 0 0 0 0 rgba(37,99,235,0); }
}
/* Usage: active stage circle, active section in diff view, 2s ease-out infinite */

@keyframes auroraGreenPulse {
  0%   { box-shadow: 0 0 0 0 rgba(22,163,74,0.4); }
  70%  { box-shadow: 0 0 0 6px rgba(22,163,74,0); }
  100% { box-shadow: 0 0 0 0 rgba(22,163,74,0); }
}
/* Usage: "Meeting in progress" dot on CRM screen (Screen 18), 2s ease-out infinite */

@keyframes auroraAmberPulse {
  0%   { box-shadow: 0 0 0 0 rgba(217,119,6,0.4); }
  70%  { box-shadow: 0 0 0 6px rgba(217,119,6,0); }
  100% { box-shadow: 0 0 0 0 rgba(217,119,6,0); }
}
/* Usage: "Review overdue" dot on Audit Review Alert screen (Screen 23), 2s ease-out infinite */

/* Pulse dot spec (used with all three pulse animations):
   width: 8px, height: 8px, border-radius: 50%
   Colour: #16A34A (green), #2563EB (blue), or #D97706 (amber) per context */
```

---

## 9. Module Naming Rule

**Hard rule: module letters (A, B, C, D, E) never appear as visible UI labels.**

| Internal ID | UI Display Name | Accent Colour |
|-------------|----------------|---------------|
| Module A | Clinical Writing | `#2563EB` |
| Module B | Scientific Writing | `#0D9488` |
| Module C | Medical Writing | `#7C3AED` |
| Module D | Regulatory Writing | `#D97706` |
| Module E | Ideation & Publishing | `#E11D48` |

Module letter may appear ONLY as a tiny IBM Plex Mono 10px identifier on inactive module cards where space is extremely tight. Nowhere else.

---

## 10. Copy & Voice Patterns

### Regulatory footer (all sign-in screens)
```
"For professional use only. Not intended as a substitute for professional regulatory judgement."
font-size: 12px, color: #64748B
Footer links: Terms · Privacy · Validation record
```

### Autosave indicator
Two variants in use — use contextually:
```
Document editor header (precise):
  Format: [green dot] "Autosaved 09:14 UTC"
  font-size: 12px, color: #64748B
  Dot: 6px circle, background #16A34A

List screens / dashboards (relative):
  Format: [green dot] "Autosaved · last change 4 minutes ago"
  Same styling as above
```

### Provenance bar (document editor)
```
Format: "Section [X.X.X] · [N] AI-drafted spans · [N] human-authored span · Last edited [Name] · [Date] [Time] UTC"
Example: "Section 11.4.1 · 2 AI-drafted spans · 1 human-authored span · Last edited Marcus Webb · 22 Oct 2024 09:14 UTC"
font-size: 12px, color: #64748B, white-space: nowrap, overflow: hidden, text-overflow: ellipsis
```

### Validated tenancy label (top nav)
```
Format: "[Client name] · Validated tenancy"
Example: "GenBioCa Therapeutics · Validated tenancy"
font-size: 13px, color: #94A3B8
```

### Sidebar validated state panel
```
Title: "Validated state" — font-size 12px, font-weight 600, color #FFFFFF
Sub: "Release [X.X.X] · IQ/OQ/PQ current" — font-size 11px, color #94A3B8
```

### CRM meeting meta format
```
Header subtitle: "CRM-001 · VELORA-301 CSR · 28 Oct 2024 · 14:00–15:30 UTC"
font-size: 13px, color: #64748B
```

### Signature timestamp format
```
"Signed 28 Oct 2024 · 15:47 UTC"  — in document header after signing
"Marcus Webb · Authored · 28 Oct 2024 15:47 UTC"  — in signature chain banner
IBM Plex Mono 11px #15803D opacity 0.7 for hash display
```

### Part 11 compliance line (signing footer)
```
"By signing you confirm the meaning above under penalty of applicable regulations."
IBM Plex Mono 10px #94A3B8, centred below footer buttons
```

### Diff view provenance bar format
```
"Diff: v0.3 → v0.4 · §11.4.1 · 3 changes · Last edited Marcus Webb · 22 Oct 2024 09:14 UTC"
Same styling as normal provenance bar
```

### Version restore note
```
"v0.3 and v0.4 remain permanently in version history. A new v0.5 will be created."
font-size: 11px, font-style: italic, color: #94A3B8, text-align: centre
Shown in sticky restore bar below button row
```

### QA review cadence format
```
"QA review cadence: 30 days · Last reviewed: 28 Sep 2024"
font-size: 13px, color: #64748B — shown in audit review alert page header
```

### Case conventions
- UI labels and button text: Sentence case ("New document", "Submit for review")
- IBM Plex Mono system labels: UPPER CASE ("SECTIONS", "AI", "SUGGESTION", "REFINE")
- Module names: Title case ("Clinical Writing", not "clinical writing")
- Status pills: Title case ("In Authoring", "In Review", "Not Started")
- No exclamation marks anywhere

---

## 11. Sample Data Reference

All prototype data lives in `/src/data/`. Key entities:

### Study
```json
{
  "studyId": "GBC-ONC-2024-001",
  "shortTitle": "VELORA-301",
  "fullTitle": "A Phase III, Randomised, Double-Blind, Placebo-Controlled Study of Veloricept in Combination with Pembrolizumab in Adults with Advanced Non-Small Cell Lung Cancer (NSCLC)",
  "drug": "Veloricept (GBC-4471)",
  "indication": "Advanced/metastatic NSCLC, PD-L1 ≥50%, second-line",
  "phase": "III",
  "sponsor": "GenBioCa Therapeutics",
  "therapeuticArea": "Oncology",
  "markets": ["US (FDA)", "EU (EMA)", "UK (MHRA)"],
  "status": "Ongoing",
  "startDate": "2022-03-14",
  "dataCutoff": "2024-09-30",
  "enrolled": 386
}
```

### Team (RACI)
```json
[
  { "name": "Dr. Sarah Chen",    "role": "Clinical PM",         "initials": "SC", "raci": "Accountable" },
  { "name": "Marcus Webb",       "role": "Lead Clinical Writer", "initials": "MW", "raci": "Responsible" },
  { "name": "Dr. Priya Nair",    "role": "Biostatistician",     "initials": "PN", "raci": "Responsible" },
  { "name": "Dr. James Okonkwo", "role": "PV Lead",             "initials": "JO", "raci": "Responsible" },
  { "name": "Dr. Elena Vasquez", "role": "Regulatory Affairs",  "initials": "EV", "raci": "Consulted" },
  { "name": "Dr. Amir Hossain",  "role": "Medical Monitor",     "initials": "AH", "raci": "Consulted" },
  { "name": "Rachel Thorn",      "role": "Data Manager",        "initials": "RT", "raci": "Responsible" },
  { "name": "Dr. Linda Park",    "role": "Chief Medical Officer","initials": "LP", "raci": "Informed" }
]
```

### Documents
```json
[
  { "id": "DOC-001", "type": "CSR (Full)",           "title": "Clinical Study Report — VELORA-301",        "stage": "Post-Study", "status": "In Authoring",   "updated": "22 Oct 2024", "assignee": "Marcus Webb" },
  { "id": "DOC-002", "type": "CSR Synopsis",          "title": "Synopsis — VELORA-301",                     "stage": "Post-Study", "status": "Not Started",    "updated": null,           "assignee": "Marcus Webb" },
  { "id": "DOC-003", "type": "Safety Narrative",      "title": "Individual Patient Narratives — SAEs",      "stage": "Post-Study", "status": "In Authoring",   "updated": "18 Oct 2024", "assignee": "Dr. James Okonkwo" },
  { "id": "DOC-004", "type": "Protocol",              "title": "VELORA-301 Protocol v3.2",                  "stage": "Final Output","status": "Signed",        "updated": "02 Sep 2024", "assignee": "Dr. Sarah Chen" },
  { "id": "DOC-005", "type": "Protocol Amendment",    "title": "Amendment 2 — Dose Escalation Cohort",     "stage": "Cross-Functional Review","status": "In Review","updated": "19 Oct 2024","assignee": "Dr. Elena Vasquez" },
  { "id": "DOC-006", "type": "IB",                   "title": "Veloricept Investigator's Brochure v4.0",   "stage": "CRM",        "status": "CRM In Progress","updated": "21 Oct 2024", "assignee": "Dr. Amir Hossain" },
  { "id": "DOC-007", "type": "ICF",                  "title": "US Master ICF v2.1",                        "stage": "Final Output","status": "Signed",        "updated": "14 Aug 2024", "assignee": "Dr. Sarah Chen" },
  { "id": "DOC-008", "type": "DSUR",                 "title": "Development Safety Update Report — Year 3", "stage": "During Study","status": "In Authoring",  "updated": "15 Oct 2024", "assignee": "Dr. James Okonkwo" }
]
```

### Comments
```json
[
  { "id": "CMT-041", "section": "§11.4.1", "reviewer": "Dr. Elena Vasquez", "initials": "EV", "text": "CI decimal places — confidence interval should be reported to two decimal places per ICH E3 §11.4", "status": "Open", "age": "6 days ago" },
  { "id": "CMT-042", "section": "§12.2",   "reviewer": "Dr. Amir Hossain",  "initials": "AH", "text": "Patient 0042 cross-reference — pneumonitis incidence should cross-reference the safety narrative", "status": "Open", "age": "4 days ago" },
  { "id": "CMT-043", "section": "§9.1",    "reviewer": "Dr. Sarah Chen",    "initials": "SC", "text": "Screen failure reasons should be presented as a table per Section 16.2.1 checklist requirement", "status": "Resolved", "age": "8 days ago" },
  { "id": "CMT-044", "section": "§12.2",   "reviewer": "Dr. Elena Vasquez", "initials": "EV", "text": "MedDRA v27.0 confirm — confirm coding against MedDRA v27.0 not v26.1", "status": "Open", "age": "3 days ago" }
]
```

### Checklist (DOC-001)
```json
[
  { "item": "Statistical Analysis Plan (SAP v2.0)", "framework": "ICH E3", "mandatory": true, "status": "Complete",     "notes": "Uploaded 02 Sep 2024" },
  { "item": "TLF Package v3",                       "framework": "ICH E3", "mandatory": true, "status": "Complete",     "notes": "Uploaded 10 Oct 2024" },
  { "item": "Protocol v3.2 + All Amendments",       "framework": "ICH E3", "mandatory": true, "status": "Complete",     "notes": "" },
  { "item": "Individual Patient Narratives",        "framework": "ICH E3", "mandatory": true, "status": "In Progress",  "notes": "DOC-003 authoring" },
  { "item": "MedDRA Coding Validation Report",      "framework": "21 CFR Part 11", "mandatory": true, "status": "Pending", "notes": "Awaiting MedDRA v27.0 confirmation" },
  { "item": "16.4 US Patient Data Listings",        "framework": "ICH E3", "mandatory": true, "status": "Waived",      "waiver": { "by": "Marcus Webb", "date": "22 Oct 2024", "reason": "Non-US submission markets only for this study" } }
]
```

### Audit Trail (sample)
```json
[
  { "timestamp": "2024-10-12T09:14:33Z", "actor": "Marcus Webb",       "action": "Content edited",    "detail": "§11.4.1 — AI draft accepted, minor edits to PFS sentence" },
  { "timestamp": "2024-10-12T09:14:33Z", "actor": "Aurora AI",         "action": "AI draft generated","detail": "§11.4.1 — Model: claude-sonnet, Source: Table 14.2.1" },
  { "timestamp": "2024-10-15T14:22:07Z", "actor": "Dr. Elena Vasquez", "action": "Comment added",     "detail": "CMT-041 — CI decimal places, §11.4.1" },
  { "timestamp": "2024-10-18T11:05:44Z", "actor": "Dr. James Okonkwo", "action": "Content authored",  "detail": "§12.2 — Safety summary, human-authored, MedDRA v27.0" },
  { "timestamp": "2024-10-21T08:30:12Z", "actor": "Dr. Sarah Chen",    "action": "Comment resolved",  "detail": "CMT-043 — Screen failure table added to §9.1" },
  { "timestamp": "2024-10-22T16:47:19Z", "actor": "Marcus Webb",       "action": "Checklist item waived","detail": "16.4 US Individual Patient Data Listings — Non-US markets — Framework warning acknowledged: ICH E3 §16" }
]
```

### Signature Chain (DOC-001 CSR)
```json
[
  { "id": "SIG-0417-JO", "signer": "Dr. James Okonkwo", "initials": "JO", "role": "PV Lead", "meaning": "I have reviewed the safety sections of this document", "status": "signed", "timestamp": "2024-10-28T15:32:07Z", "timestampLocal": "16:32 CET", "authMethod": "password re-auth + TOTP", "step": 1 },
  { "id": "SIG-0418-MW", "signer": "Marcus Webb", "initials": "MW", "role": "Lead Clinical Writer", "meaning": "I have authored this document", "status": "awaiting", "step": 2 },
  { "id": "SIG-0419-EV", "signer": "Dr. Elena Vasquez", "initials": "EV", "role": "Regulatory Affairs", "meaning": "I have reviewed this document", "status": "queued", "step": 3 },
  { "id": "SIG-0420-SC", "signer": "Dr. Sarah Chen", "initials": "SC", "role": "Clinical PM", "meaning": "I approve this document for submission", "status": "queued", "step": 4 }
]
```

### CRM Meeting (CRM-001)
```json
{
  "id": "CRM-001",
  "document": "Clinical Study Report — VELORA-301",
  "documentId": "DOC-001",
  "version": "v0.4",
  "date": "2024-10-28",
  "startTime": "14:00 UTC",
  "endTime": "15:30 UTC",
  "startedAt": "14:07 UTC",
  "chair": { "name": "Dr. Sarah Chen", "initials": "SC", "role": "Chair" },
  "attendees": [
    { "name": "Marcus Webb", "initials": "MW", "role": "Author" },
    { "name": "Dr. Elena Vasquez", "initials": "EV", "role": "Reviewer" },
    { "name": "Dr. Amir Hossain", "initials": "AH", "role": "Reviewer" },
    { "name": "Dr. James Okonkwo", "initials": "JO", "role": "Observer" }
  ],
  "comments": ["CMT-041", "CMT-042", "CMT-044"],
  "resolved": ["CMT-041"],
  "active": "CMT-042",
  "pending": ["CMT-044"]
}
```

### ICH E3 Sections
```json
[
  { "section": "§1", "title": "Title Page", "status": "complete" },
  { "section": "§2", "title": "Synopsis", "status": "complete" },
  { "section": "§3", "title": "Table of Contents", "status": "complete", "note": "auto-generated" },
  { "section": "§4", "title": "List of Abbreviations", "status": "complete" },
  { "section": "§5", "title": "Ethics", "status": "complete" },
  { "section": "§6", "title": "Investigators & Study Sites", "status": "complete" },
  { "section": "§7", "title": "Introduction", "status": "complete" },
  { "section": "§8", "title": "Study Objectives", "status": "complete" },
  { "section": "§9", "title": "Investigational Plan", "status": "complete" },
  { "section": "§10", "title": "Study Patients", "status": "complete" },
  { "section": "§11", "title": "Efficacy Evaluation", "status": "inProgress" },
  { "section": "§12", "title": "Safety Evaluation", "status": "inProgress" },
  { "section": "§13", "title": "Discussion & Conclusions", "status": "notStarted" },
  { "section": "§14", "title": "References", "status": "notStarted" },
  { "section": "§16.1", "title": "Appendices", "status": "notStarted" },
  { "section": "§16.2", "title": "Patient Data Listings", "status": "warning", "note": "16.4 waived" },
  { "section": "§16.3", "title": "Case Report Forms", "status": "notStarted" },
  { "section": "§16.4", "title": "Individual Patient Data", "status": "warning", "note": "Waived · ICH E3 §16" }
]
```

### MedDRA Lookup (mock subset — pneumonitis search)
```json
{
  "version": "27.0",
  "totalTerms": 80026,
  "searchResults": [
    { "pt": "Pneumonitis", "code": "10035742", "soc": "Respiratory, thoracic and mediastinal disorders", "usedInDocument": true, "sections": ["§12.2"] },
    { "pt": "Pneumonitis allergic", "code": "10060473", "soc": "Immune system disorders", "usedInDocument": false },
    { "pt": "Interstitial lung disease", "code": "10022611", "soc": "Respiratory, thoracic and mediastinal disorders", "usedInDocument": false },
    { "pt": "Lung infiltration", "code": "10025102", "soc": "Respiratory, thoracic and mediastinal disorders", "usedInDocument": false }
  ],
  "recentlyUsed": [
    { "pt": "Pneumonitis", "code": "10035742", "section": "§12.2" },
    { "pt": "Treatment-emergent adverse event", "code": "10066244", "section": "§12.1" }
  ]
}
```

### TLF Package (v3)
```json
{
  "version": "v3",
  "validatedBy": "Rachel Thorn",
  "validatedDate": "2024-10-10",
  "items": [
    { "type": "T", "id": "Table 14.1.1", "title": "Patient Disposition", "linkedSections": ["§9.1"] },
    { "type": "T", "id": "Table 14.1.2", "title": "Protocol Deviations", "linkedSections": [] },
    { "type": "T", "id": "Table 14.2.1", "title": "Primary Efficacy Analysis — PFS by Treatment Arm", "linkedSections": ["§11.4.1"], "referenceCount": 3 },
    { "type": "T", "id": "Table 14.2.2", "title": "Kaplan-Meier Analysis — PFS Curves", "linkedSections": ["§11.4.1"], "referenceCount": 1 },
    { "type": "T", "id": "Table 14.3.1", "title": "TEAE Summary", "linkedSections": ["§12.2"] },
    { "type": "L", "id": "Listing 16.2.7.1", "title": "SAE Listing", "linkedSections": ["§12.2"] },
    { "type": "F", "id": "Figure 11.1", "title": "Forest Plot — PFS Subgroup Analyses", "linkedSections": ["§11.4.1"], "referenceCount": 1 },
    { "type": "F", "id": "Figure 14.1", "title": "Patient Flow (CONSORT)", "linkedSections": ["§9.1"] }
  ]
}
```

### Simulated AI Suggestion
```json
{
  "model": "claude-sonnet",
  "generated": "09:12 UTC",
  "text": "The Kaplan–Meier analysis demonstrated robust separation of PFS curves between the Veloricept combination arm and control from Week 8, with the hazard ratio of 0.61 indicating a 39% reduction in the risk of progression or death.",
  "sources": ["Table 14.2.1", "SAP v2.0 §6.3", "KM Analysis Dataset"]
}
```

---

## 12. Simulated AI Response Pattern

For all screens with AI suggestions, use a `simulateAI(prompt, delayMs = 1200)` utility:

```javascript
// src/utils/simulateAI.js
const CANNED_RESPONSES = {
  default: {
    text: "The Kaplan–Meier analysis demonstrated robust separation of PFS curves between the Veloricept combination arm and control from Week 8, with the hazard ratio of 0.61 indicating a 39% reduction in the risk of progression or death.",
    sources: ["Table 14.2.1", "SAP v2.0 §6.3", "KM Analysis Dataset"],
    model: "claude-sonnet",
    generated: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' UTC'
  }
}

export const simulateAI = (prompt, delayMs = 1200) =>
  new Promise(resolve =>
    setTimeout(() => resolve(CANNED_RESPONSES.default), delayMs)
  )
```

Show a loading skeleton in the suggestion card during the delay. On resolve, animate the text in.

---

## 13. Per-Screen Handover Notes

### Screens 1–5 (Platform Shell)
Files: `SignIn.jsx`, `MFAVerify.jsx`, `TCGate.jsx`, `AllProjects.jsx`, `NewProjectWizard.jsx`, `ProjectDashboard.jsx`

- `TCGate.jsx`: Both checkboxes must be ticked to enable "Continue to Aurora" button. Timestamp appears only when both are checked. State: `cb1, cb2, bothChecked`.
- `AllProjects.jsx`: Implement filter chips (Status, TA), search, sort arrows, lazy-load skeleton rows, "Load more results" button. Filter state resets via "Reset filters" link (show only when `filtersDirty === true`).
- `NewProjectWizard.jsx`: 4-step wizard, show Step 1 only. TA dropdown mandatory — "Next: Module Selection" disabled until TA selected and Project Name filled.
- `ProjectDashboard.jsx`: Inactive module cards use dashed border. Active module card uses `border-top: 3px solid #2563EB`. "Needs your attention" panel inside active card. Performance panel below inactive cards.

### Screens 6–8 (Clinical Writing Entry)
Files: `ClinicalWritingHome.jsx`, `NewDocumentDrawer.jsx`, `AutoClassification.jsx`

- `ClinicalWritingHome.jsx`: Stage rail + tab rail. Active tab = "Post-Study / Data Analysis". Document table with 7 columns. Right activity panel (280px) shows Open Comments + Checklist status. Document row click opens resizable detail drawer from right (replaces activity panel).
- `NewDocumentDrawer.jsx`: Slides in from right over document list. 2-step flow: type selector grid (3 cols, 9 types) → document details form. Step connector half-fills on Step 1 active.
- `AutoClassification.jsx`: Shows after "Upload existing" flow. 5 classification rows with confidence badges. Each row has "Edit" secondary button. "Override all fields" secondary button bottom-left. Virus scan status line below filename.

### Screens 9–11 (Document Editor)
Files: `DocumentEditor.jsx`, `SectionNavigator.jsx`, `EditorToolbar.jsx`, `AIPanel.jsx`, `TraceabilityPanel.jsx`

- `DocumentEditor.jsx`: Three-panel layout. Sidebar collapse toggle in top nav. AI panel and Traceability panel are mutually exclusive — one `panelMode` state: `null | 'ai' | 'trace'`.
- `SectionNavigator.jsx`: Scrollable section list. Active section has blue left border. Progress bar pinned to bottom.
- `EditorToolbar.jsx`: B/I/U icon buttons + Heading dropdown + Bullet/Numbered list + Table + AI Suggest (⌘J) + Insert citation (disabled, SOON badge). AI Suggest button opens/closes AI panel via `panelMode`.
- `AIPanel.jsx`: Two states — `default` (shows suggestion card with Accept/Refine/Reject) and `refine` (shows dimmed original + REFINE card with textarea). Cancel refinement returns to `default`. Accepting adds provenance record to audit trail (simulated).
- `TraceabilityPanel.jsx`: Opens when user clicks a traceable value span. `selectedValue` prop drives the panel. Three source cards: Table 14.2.1 (blue icon), SAP v2.0 §6.3 (grey icon), AI-drafted (violet icon, no View source link). Immutability note + Flag for QC button + Close link.

### Screens 12–14 (Right Panel States — Session 4)
Files: `VoiceNotePanel.jsx`, `ChecklistPanel.jsx`, `AuditTrailPanel.jsx`

All three share a common `RightPanel.jsx` wrapper:
```jsx
// RightPanel.jsx — shared overlay panel shell
// Props: isOpen, onClose, title, icon, defaultWidth=280, children
// Implements: position absolute, z-index 6, drag-resize 260–760px,
//             expand/collapse toggle (280↔480), drag handle left edge
```

- `VoiceNotePanel.jsx`: Three blocks — Record (section target, record button, timer, waveform), Last Transcription (card with Insert + Copy actions), Past Recordings (collapsed list). Record button state: `isRecording` boolean. Waveform bars: static array of 24 heights, animate colour on `isRecording`.
- `ChecklistPanel.jsx`: Completion summary bar (progress % from items data). Two sections: Framework Mandatory items, Framework Mandatory Waived items. Item states: `checked | inProgress | unchecked | waived`. Waived item hover shows "View waiver reason" link. All team members can complete items (no role gate in prototype).
- `AuditTrailPanel.jsx`: Default expanded (480px). Filter chips: All/Edits/Comments/AI/System — `activeFilter` state. Date range inputs (uncontrolled in prototype). Six entries from `auditTrail.json` in reverse chronological order. Load more = static "Showing 6 of 24". Export and Download as PDF = non-functional in prototype (show buttons only).

Collaborative presence (all editor screens):
- `PresenceStack.jsx`: Renders overlapping avatars in document header. Props: `users` array.
- `SectionNavigator.jsx` update: Each section row accepts optional `presenceUser` prop — renders 16px avatar on right edge. Locked sections: `isLocked` + `lockedBy` props — muted text, lock icon, locked overlay banner in editor.

### Screens 15–17 (Review Flow — Session 5)
Files: `ReviewAssignmentPanel.jsx`, `ReviewerView.jsx`, `CommentsDashboard.jsx`

- `ReviewAssignmentPanel.jsx`: Non-modal overlay panel, default 480px. Document summary card with status transition arrow. Parallel/Sequential review type selector (two selectable cards). Six RACI rows with R/A/C/I badges, assignee avatars, remove ✕ icons (no remove on owner row). Notification preview with 5-reviewer avatar stack. Footer: "Save as draft" + "Submit for review →" + lock warning note italic.
- `ReviewerView.jsx`: Same editor shell as Screen 9 but logged-in user switches to EV (Dr. Elena Vasquez). Toolbar stripped of authoring tools — only Add comment (⌘K), Flag section, Checklist (view only), Audit trail, Reference dropdown. Document header: "In Review" status, "v0.4 · For Review", Approve section (green) + Return for revision (amber) buttons, review due date. Section navigator shows "IN REVIEW" IBM Plex Mono label on active section. Comment composition box: static blue border + box-shadow (focused state), severity Minor pill, "Post comment" button. Comments right panel open with 3 CMT cards showing CMT IDs in IBM Plex Mono 9px #64748B.
- `CommentsDashboard.jsx`: List screen (Pattern 2). Four comment cards with RACI badge letters (C/A), severity pills (Major #FEE2E2/#DC2626, Minor #FFFBEB/#B45309, Query #EFF6FF/#2563EB), CMT IDs, resolution note for CMT-043 (#F0FDF4 bg). Right summary panel: review progress (2 of 5 at 40%), by-severity breakdown, "Ready for CRM?" blue-bordered card.

### Screens 18–19 (CRM — Session 6)
Files: `CRMModule.jsx`, `CommentResolutionPanel.jsx`

- `CRMModule.jsx`: Pattern 8 (three-panel CRM layout). Left panel: 4 sections (Meeting Details, Attendees, Progress, Actions). Centre panel: Resolution Queue with 3 comment cards (resolved/active/pending states). Right panel: Resolution Log with one entry card + two dashed placeholder rows. Page header: "Meeting in progress" green pulse pill + "End meeting" amber button. `auroraGreenPulse` on meeting dot and "In discussion" blue dot.
- `CommentResolutionPanel.jsx`: Non-modal overlay, default 480px, z-index 6. Three panel states driven by which chain row is selected: `signatureRecord` (11-field Part 11 record for signed row), `signingForm` (default — active user's signing form), `pendingInfo` (queued row info). Footer: Cancel + "Sign and confirm resolution" 14px + Part 11 line IBM Plex Mono 10px. `flex:none` pinned footer, body `flex:1 overflow-y auto`.

### Screens 20–23 (Final Output — Session 7)
Files: `ESignature.jsx`, `FinalDocument.jsx`, `PortfolioDashboard.jsx`, `AuditReviewAlert.jsx`

- `ESignature.jsx`: Two regions — signature chain (centre, Pattern 9) + signing panel (right overlay 320–760px). Chain shows 4 signers in RACI order. Panel has 3 states: `signatureRecord` / `signingForm` / `pendingInfo`. "Cancel signing" amber button in document header. Toggle switch ON state for notify reviewer.
- `FinalDocument.jsx`: Pattern 11 (read-only editor). Signed banner replaces toolbar (36px #F0FDF4). Section navigator: all green, 100%. Signature chain banner at top of editor content. No right panels. Content: read-only §11.4.1 — no AI highlights, no traceable underlines, no cursor.
- `PortfolioDashboard.jsx`: Pattern 2 (list screen). Documents grouped by stage with stage header rows. 8 documents with type icon (32px rounded #F8FAFC), status pills, assignee avatars. "NEW" badge on CSR (IBM Plex Mono 9px #EFF6FF/#2563EB). Right panel: stage overview with 4px coloured mini bars, performance stats, blue-bordered next steps card.
- `AuditReviewAlert.jsx`: Pattern 2 (list screen). Logged-in user: Dr. Sarah Chen (SC #F0FDF4/#15803D). Full-width amber alert banner (Pattern: Alert Banner). `auroraAmberPulse` on overdue dot. 8 audit entries with DOCUMENT SIGNED badge (#F0FDF4/#15803D). Right panel: amber-bordered review status card, QA checklist (6 unchecked items), compliance record. 1120px frame height.

### Screens 24–27 (Reference Tools — Session 8)
Files: `DiffView.jsx`, `ICHValidatorPanel.jsx`, `MedDRAPanel.jsx`, `TLFPanel.jsx`

- `DiffView.jsx`: Triggered by version chip click. Editor content replaced by diff content area. Diff banner above content (36px, legend + change count + "Exit diff view" link). Three change types: `<del>` inline, `<ins>` inline, added-line block (left border #16A34A). Section header rows with checkbox + restore link. Sticky restore bar above provenance bar when `selectedSections.length > 0`. `simulateRestore()` utility creates v0.5 from selected sections (prototype: shows success state).
- `ICHValidatorPanel.jsx`: 18 ICH E3 section rows. Status: `complete` (green checkmark circle) / `inProgress` (blue partial arc SVG stroke-dasharray) / `notStarted` (grey empty circle) / `warning` (amber ⚠). Two note cards: amber waiver + blue auto-generated. "Export ICH E3 report" footer button. "Open in editor →" link on in-progress rows navigates to section in editor.
- `MedDRAPanel.jsx`: Search input with real-time filter (prototype: pre-filled "pneumonitis"). Result cards with PT code, SOC hierarchy, "✓ Used in document" for active term. Selected result: blue 2px border + #EFF6FF bg. "Copy PT" + "Insert into §X.X" action buttons. Recently used section below results. Version display (v27.0). Subscription expiry in footer.
- `TLFPanel.jsx`: Filter chips (All/Tables/Listings/Figures). "LINKED TO §X.X.X" section — current-section cards with blue border. Full TLF list below with type badges (T/L/F). Section tags: blue for current section (#EFF6FF/#2563EB), grey for others (#F1F5F9/#64748B). "Upload new TLF package" link in footer.

**Reference dropdown (all editor screens):**
```jsx
// ReferenceDropdown.jsx — shared across all editor screens
// Props: activePanel ('ich' | 'meddra' | 'tlf' | null), onSelect(panel)
// Renders: book icon + "Reference" + chevron SVG
// Dropdown: three options with icons, active option highlighted in #2563EB
```

---

## 14. File Structure (Proposed)

```
/src
  /components
    /layout
      TopNav.jsx              ← with presence avatar stack, bell badge, collapse toggle
      Sidebar.jsx             ← with sub-nav, validated state panel
      Breadcrumb.jsx
    /ui
      Button.jsx              ← primary, secondary, destructive, disabled, text link
      StatusPill.jsx          ← all status variants from statusMeta.js
      FilterChip.jsx          ← active/inactive states
      SkeletonRow.jsx         ← with auroraShimmer animation
      ProgressBar.jsx         ← with label and percentage
      StatusDot.jsx           ← complete/active/pending/waived/overdue
      ConfidenceBadge.jsx
      MonoLabel.jsx           ← IBM Plex Mono uppercase labels
      AIBadge.jsx             ← "AI" badge on AI-drafted content
      RACIBadge.jsx           ← R/A/C/I letter badges
      ToggleSwitch.jsx        ← ON/OFF 36×20px
      PulseIndicator.jsx      ← blue/green/amber pulse dots
      ReferenceDropdown.jsx   ← book icon + chevron + dropdown menu
  /panels
    RightPanel.jsx            ← shared overlay panel shell (z-index 6, drag-resize 260–760px)
    AIPanel.jsx               ← AI Suggest + Refine states
    TraceabilityPanel.jsx     ← Source chain with 3 cards
    VoiceNotePanel.jsx        ← Record + Transcription + Past recordings
    ChecklistPanel.jsx        ← Master template items + waiver flow
    AuditTrailPanel.jsx       ← Filter chips + entries + export footer
    ReviewAssignmentPanel.jsx ← RACI rows + notification preview
    CommentResolutionPanel.jsx ← 3 states: record/form/pending
    ICHValidatorPanel.jsx     ← 18 section rows + note cards
    MedDRAPanel.jsx           ← Search + results + recently used
    TLFPanel.jsx              ← Linked items + full TLF list
  /screens
    /shell
      SignIn.jsx
      MFAVerify.jsx
      TCGate.jsx
      AllProjects.jsx
      NewProjectWizard.jsx
      ProjectDashboard.jsx
    /clinical-writing
      ClinicalWritingHome.jsx
      NewDocumentDrawer.jsx
      AutoClassification.jsx
      DocumentEditor.jsx      ← with Reference dropdown, presence indicators
      SectionNavigator.jsx    ← with presence avatars, lock state
      EditorToolbar.jsx       ← B/I/U · Heading · lists · table · Reference ▾ · Voice · Checklist · Audit · AI Suggest · SOON
      DiffView.jsx            ← inline unified diff, section restore, sticky bar
      FinalDocument.jsx       ← read-only, signed banner, signature chain
    /review
      ReviewerView.jsx        ← reviewer-adapted toolbar, comment composition
      CommentsDashboard.jsx   ← stage-less list, severity pills, summary panel
    /crm
      CRMModule.jsx           ← three-panel layout, card states
    /output
      ESignature.jsx          ← chain + panel (3 states)
      PortfolioDashboard.jsx  ← stage-grouped docs, performance panel
      AuditReviewAlert.jsx    ← amber alert, QA checklist, compliance record
  /presence
    PresenceStack.jsx         ← overlapping avatars in header
    SectionPresence.jsx       ← 16px avatars on section rows
    LockedSectionBanner.jsx   ← "X is editing" overlay in editor
  /data
    study.json
    team.json
    documents.json
    comments.json
    checklist.json
    auditTrail.json
    aiResponses.json
    tlf.json                  ← TLF package items for TLFPanel
    meddra.json               ← MedDRA lookup terms (mock subset)
    ichSections.json          ← 18 ICH E3 section definitions with status
    signatureChain.json       ← 4-signer chain for ESignature screen
    crmMeeting.json           ← CRM-001 meeting data
  /utils
    simulateAI.js             ← canned AI response with delay
    simulateRestore.js        ← section restore creates new version (prototype)
    formatDate.js
    statusMeta.js             ← status pill colours/labels lookup
    raci.js                   ← RACI badge colours/labels lookup
  App.jsx
  index.css                   ← CSS custom properties (colour tokens) + animation keyframes
```

---

*End of Aurora Design System Reference v1.0 — Session 3 lock.*
*Next update trigger: any change to colours, typography, spacing scale, or core component patterns.*
