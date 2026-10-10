# CD prompt — TLF Insert side panel

## What to design

A right-rail panel that lets the writer browse the project's TLF
(Tables / Listings / Figures) package and insert a reference into the
active section with one click.

Right-rail panel. Opens when `panelMode = 'tlf'`. Pattern: match the
MedDRAPanel in `apps/web/src/panels/MedDRAPanel.tsx` for the "browse
+ insert into section" interaction.

## Behaviour

### Header
- Panel title: "Tables, Listings, Figures"
- Package version chip: "Package v1.2 · validated by Dr. Chen · 02 Oct"
- Search input + filter chips: `Table` / `Listing` / `Figure` (toggles).

### Body — item list
Scrollable list of TLF items filtered by the active chips + search.
Each row:
- Type icon + ref (e.g. "Table 14.2.1")
- Title ("Primary Efficacy Analysis — ITT Population")
- Linked sections count: "{{n}} sections cite this" (empty if 0)
- "Insert" button on the right.
- Expand chevron reveals a thumbnail preview (first 10 rows of the
  table / mini chart for figures).

### Insert action
Clicking Insert:
- Inserts a reference span into the active section's cursor position
  (or at end of section if the editor doesn't track cursor yet).
- Reference format: `[Table 14.2.1]` with a hover tooltip showing the
  item title.
- Updates the "linked sections" count for that item.
- Fires an audit event: `tlf.item_inserted`.

### Empty states
- No package: "No TLF package validated for this project yet. Ask a
  statistician to upload one."
- No items match filter: "No {{type}} items match '{{query}}'."

## Data wiring (for engineering)

- `GET /projects/{projectId}/tlf-packages?current=true` returns the
  package + items.
- `POST /documents/{documentId}/sections/{sectionId}/tlf-link` body:
  ```json
  {
    "tlfItemId": "tlf-...",
    "sectionRef": "§11.4.1"
  }
  ```
- The reference span is added to section content as:
  `<span data-tlf-ref="tlf-..." class="tlf-ref">Table 14.2.1</span>`

## Keep as `{{ }}` template variables

- Package version + validator name + date
- Item ref codes + titles
- Linked-sections counts

## Deliverable

One React component file (`TLFInsertPanel.tsx`) + a demo HTML.
