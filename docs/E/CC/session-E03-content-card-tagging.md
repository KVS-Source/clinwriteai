# Session E03 — Content Card Tagging
**Screen:** sE03 · Content Card Tagging
**Route:** `/projects/:projectId/ideation-publishing/projects/:ideationProjectId/tagging`
**Component:** `src/modules/ideation-publishing/screens/ContentCardTagging.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/E/design/aurora-sE03-content-card-tagging-atomisation.html`
**Data:** `src/data/ideationArtefacts.json`, `src/data/ideationContentCards.json`, `src/data/atomisedContent.json`
**Store:** `ideationStore`, `atomisationStore`

---

## What to Build

Stage 2 — tag passages from the source artefact as content cards, then atomise per channel. Three-panel layout: left source viewer (read-only), centre card list, right atomisation panel. Busiest screen in Module E.

---

## Screen Anatomy

Three panels: Left source (~340px, read-only) · Centre card list (~340px) · Right atomisation.

**Left — Source document (DD-E-001 — always read-only):**
- Header: "VELORA-301 KOL Advisory Board Summary v1.0 · Source document — read-only"
- Document text renders in full. Clicking a passage shows a `+ Tag` affordance button — no cursor/edit.
- Three passages are already tagged (highlighted teal `#CCFBF1`): §3.2, §4.1, §3.4.

**Centre — Content card list (3 cards from `ideationContentCards.json`):**

Each card shows `ProvenanceChip` fully visible without any interaction:

**c-001 — Primary PFS Efficacy Result:**
- Status pill: `Approved` · teal
- ProvenanceChain: `"Source: KOL Summary §3.2 → CSR v1.0 · Table 14.2.1 → Module A · Clinical Writing"`
- Channels: LinkedIn · Blog · HCP · Email chips
- `ClaimCurrencyBadge`: `current` (green)
- KOL: `✓ Prof. James Hartley` · MA: `✓ Dr Rebecca Morton`

**c-002 — Safety Profile:**
- Status pill: `Approved` · teal
- ProvenanceChain: `"Source: KOL Summary §4.1 → CSR v1.0 · Table 12.2.4 → Module A · Clinical Writing"`
- Channels: HCP · Medical Affairs
- `ClaimCurrencyBadge`: `current` (green)

**c-003 — Subgroup Consistency:**
- Status pill: `Approved` · teal
- ProvenanceChain: `"Source: KOL Summary §3.4 → CSR v1.0 · Table 14.2.7.1 → Module A · Clinical Writing"`
- Channels: LinkedIn · HCP
- `ClaimCurrencyBadge`: `potentially-superseded` (amber `#D97706`) — most prominent visual differentiator on this card
- Acknowledged note: "Flag acknowledged · Ms Priya Nair · 19 Oct"

**Right — Atomisation panel (for c-001, active):**

Source passage (read-only, `#F8FAFC` bg):
> "Veloricept plus pembrolizumab demonstrated a statistically significant improvement in progression-free survival (hazard ratio 0.61; 95% CI 0.48–0.77; p<0.001)..."

**Channel adaptations — `ChannelAdaptationCard` per channel (DD-E-004: one per channel):**

LinkedIn (ac-001): Text editable by Ideation Lead. Compliance fix chip: "1 fix applied — 'transformative' removed per MLR guidance §4.2". AI footprint chip: "✦ AI".

Blog (ac-002): Editable. No compliance fixes.

HCP (ac-003): Editable. No compliance fixes.

Email (ac-004): Editable. No compliance fixes.

"Generate ✦" button per channel fires `atomise(cardId, channel)` (DD-E-004 — one call per channel, individual spinner).
- `AtomisationSpinner` component shows per-channel loading state — one spinner per `ChannelFormat` in `generatingChannels`.

---

## Data Wiring

```typescript
const { cards, fetchCards } = useIdeationStore()
const { adaptations, atomise, generatingChannels } = useAtomisationStore()

// Cards
useEffect(() => {
  ideationStore.fetchCards(ideationProjectId)
}, [ideationProjectId])
// MSW: GET /api/ideation/ip-001/cards → ideationContentCards.json

// Adaptations — filter by active card
const activeCardId = 'c-001'
const cardAdaptations = Object.values(adaptations).filter(
  a => a?.ideationContentCardId === activeCardId
)
// MSW: GET adaptations from atomisedContent.json filtered to c-001

// Atomise — one call per channel (DD-E-004)
const handleAtomise = (channel: ChannelFormat) => {
  atomise(activeCardId, channel)  // fires single API call + shows channel-specific spinner
}

// Conflicting claim check (DD-E-003)
// c-003 claimCurrencyStatus = 'potentially-superseded' → show amber badge, allow tagging
// If status were 'conflicting' → tag action absent entirely (AC-E-003)
// None of the demo cards are 'conflicting' — just amber warning on c-003
```

---

## Navigation

- "Proceed to compliance →" → navigate to `compliance` (sE04)

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. Left source panel shows "Source document — read-only" label. No edit controls. Clicking text shows `+` tag affordance. Sections §3.2, §4.1, §3.4 are highlighted teal.
2. All three `ProvenanceChip` components are visible on each card without any click or expand action.
3. c-003 shows an amber `ClaimCurrencyBadge` (potentially-superseded) and the acknowledged note. c-001 and c-002 show green current badges.
4. The LinkedIn `ChannelAdaptationCard` for c-001 shows the compliance fix chip: "'transformative' removed per MLR guidance §4.2". The card text is editable.
5. Clicking "Generate ✦" for LinkedIn fires a single API call with a LinkedIn-specific spinner. Blog, HCP, and Email each have their own independent spinner — a single shared spinner does not appear.

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/E/CC/session-E03-content-card-tagging.md and execute.
Build ContentCardTagging exactly as specified, run all 3 validation passes, and report results.
```
