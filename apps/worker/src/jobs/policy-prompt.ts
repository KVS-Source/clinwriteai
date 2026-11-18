// DocumentTypePolicy → system-prompt block, worker-side mirror.
//
// This is a copy of apps/api/src/modules/platform/document-type-policy/
// resolve.ts (the worker is its own package and imports nothing from
// apps/api; the parity test at policy-prompt-parity.test.ts asserts
// the render output matches character-for-character). Keep the two
// files in lock-step — drift here means the initial-draft worker's
// system prompt disagrees with the per-section rewrite's prompt on
// the same document.
//
// Scope — pure. No DB, no clock, no provider SDK. The caller fetches
// the policy row and hands the structured value in.

export interface PolicyPrinciple {
  scope:    string
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export interface PolicyDigest {
  principles: PolicyPrinciple[]
}

export interface PolicySectionRule {
  severity: 'must' | 'should' | 'nice'
  text:     string
}

export type PolicySectionRules = Record<string, PolicySectionRule[]>

export interface PolicyRowForAi {
  id:                 string
  docType:            string
  version:            number
  smePrompt:          string
  bestPracticeDigest: PolicyDigest
  sectionRules:       PolicySectionRules
}

// --- resolver ------------------------------------------------------------

interface PrismaLike {
  documentTypePolicy: {
    findUnique(args: { where: { docType_version: { docType: string; version: number } } }): Promise<unknown>
    findFirst(args: { where: { docType: string; isCurrent: boolean; retiredAt: null } }): Promise<unknown>
  }
  aiPromptRecord: {
    findUnique(args: { where: { id: string } }): Promise<unknown>
    findFirst(args: { where: { docType: string; status: 'approved' }; orderBy: { version: 'desc' } }): Promise<unknown>
  }
  bestPracticeRecord: {
    findUnique(args: { where: { id: string } }): Promise<unknown>
    findFirst(args: { where: { docType: string; status: 'approved' }; orderBy: { version: 'desc' } }): Promise<unknown>
  }
}

/** Mirror of apps/api resolveForDocument.
 *
 *  Resolution precedence (per source entity):
 *
 *  SME prompt + section rules (AiPromptRecord — Phase 1):
 *    1. Document has aiPromptRecordId pinned → load THAT exact row.
 *    2. Latest approved AiPromptRecord for this docType.
 *    3. Legacy fallback → DocumentTypePolicy.smePrompt + .sectionRules.
 *
 *  BP digest (BestPracticeRecord — Phase 2):
 *    1. Document has bestPracticeRecordId pinned → load THAT exact row's digest.
 *    2. Latest approved BestPracticeRecord for this docType → its digest.
 *    3. Legacy fallback → DocumentTypePolicy.bestPracticeDigest. */
export async function resolveForDocument(
  prisma: PrismaLike,
  args:   {
    docType:                string
    policyVersionAtCreate:  number | null
    aiPromptRecordId?:      string | null
    bestPracticeRecordId?:  string | null
  },
): Promise<PolicyRowForAi | null> {
  const docType = args.docType.replace(/-/g, '_')

  const promptRaw = args.aiPromptRecordId
    ? await prisma.aiPromptRecord.findUnique({ where: { id: args.aiPromptRecordId } })
    : await prisma.aiPromptRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })
  const promptRow = promptRaw ? (promptRaw as Record<string, unknown>) : null

  const bpRaw = args.bestPracticeRecordId
    ? await prisma.bestPracticeRecord.findUnique({ where: { id: args.bestPracticeRecordId } })
    : await prisma.bestPracticeRecord.findFirst({
        where:   { docType, status: 'approved' },
        orderBy: { version: 'desc' },
      })
  const bpRow = bpRaw ? (bpRaw as Record<string, unknown>) : null

  const policyRaw = args.policyVersionAtCreate !== null
    ? await prisma.documentTypePolicy.findUnique({
        where: { docType_version: { docType, version: args.policyVersionAtCreate } },
      })
    : await prisma.documentTypePolicy.findFirst({
        where: { docType, isCurrent: true, retiredAt: null },
      })
  const policyRow = policyRaw ? (policyRaw as Record<string, unknown>) : null

  if (!promptRow && !bpRow && !policyRow) return null

  return {
    id:                 String(promptRow?.id        ?? policyRow?.id        ?? bpRow!.id),
    docType:            String(promptRow?.docType   ?? policyRow?.docType   ?? bpRow!.docType),
    version:            Number(promptRow?.version   ?? policyRow?.version   ?? bpRow!.version),
    smePrompt:          String(promptRow?.smePrompt ?? policyRow?.smePrompt ?? ''),
    bestPracticeDigest: ((bpRow?.digest ?? policyRow?.bestPracticeDigest) as PolicyDigest)                     ?? { principles: [] },
    sectionRules:       ((promptRow?.sectionRules ?? policyRow?.sectionRules) as PolicySectionRules)           ?? {},
  }
}

// --- renderers (parity with apps/api schema.ts render helpers) ----------

function sevOrder(s: 'must' | 'should' | 'nice'): number {
  return s === 'must' ? 0 : s === 'should' ? 1 : 2
}

export function renderWholeDocPrinciples(digest: PolicyDigest): string {
  const whole = digest.principles.filter(p => p.scope === 'whole-doc')
  if (whole.length === 0) return ''
  const ordered = [...whole].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity))
  return ordered.map(p => `[${p.severity.toUpperCase()}] ${p.text}`).join('\n')
}

export function renderSectionRules(
  sectionKey: string,
  digest:     PolicyDigest,
  rules:      PolicySectionRules,
): string {
  const fromDigest = digest.principles.filter(p => p.scope === `section:${sectionKey}`)
  const fromRules  = rules[sectionKey] ?? []
  const all = [
    ...fromDigest.map(p => ({ severity: p.severity, text: p.text })),
    ...fromRules,
  ]
  if (all.length === 0) return ''
  const ordered = [...all].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity))
  return ordered.map(r => `[${r.severity.toUpperCase()}] ${r.text}`).join('\n')
}

/** Mirror of apps/api renderPolicyPromptBlock. */
export function renderPolicyPromptBlock(
  policy:                PolicyRowForAi | null,
  sectionKey:            string | null = null,
  sectionTemplateFormat: SectionTemplateFormat | null = null,
): string {
  if (!policy && !sectionTemplateFormat) return ''
  const parts: string[] = []
  if (policy && policy.smePrompt.trim().length > 0) {
    parts.push(`SME PROMPT (policy v${policy.version})`, policy.smePrompt.trim())
  }
  // BP removed per product decision — BP is author guidance, not AI steering. (M-F.1)
  const whole = "" // was: renderWholeDocPrinciples(policy.bestPracticeDigest)
  if (whole) parts.push('', 'DOCUMENT-WIDE PRINCIPLES', whole)
  if (policy && sectionKey) {
    const sec = renderSectionRules(sectionKey, { principles: [] }, policy.sectionRules)
    if (sec) parts.push('', `SECTION RULES (${sectionKey})`, sec)
  }
  if (sectionKey && sectionTemplateFormat) {
    const tpl = renderSectionTemplateNL(sectionTemplateFormat, sectionKey)
    if (tpl) parts.push('', tpl)
  }
  return parts.join('\n')
}

// --- SectionTemplate renderer (migration 90) ----------------------------
//
// Worker-side mirror of apps/api/src/modules/platform/document-type-policy/
// resolve.ts renderSectionTemplateNL. Types are duplicated (worker is a
// separate package) — the parity test asserts identical output.

export interface SectionTemplateFormat {
  page?: {
    size?:        'A4' | 'Letter' | 'Legal'
    orientation?: 'portrait' | 'landscape'
    margins?:     { top?: number; right?: number; bottom?: number; left?: number }
    columns?:     number
    header?:      { enabled?: boolean; text?: string; font?: string; size?: number; pageNumber?: boolean }
    footer?:      { enabled?: boolean; text?: string; font?: string; size?: number; pageNumber?: boolean }
  }
  font?: {
    family?:    string
    size?:      number
    color?:     string
    weight?:    'normal' | 'bold' | number
    style?:     'normal' | 'italic'
    underline?: 'none' | 'single' | 'double'
  }
  paragraph?: {
    alignment?:    'left' | 'center' | 'right' | 'justify'
    lineHeight?:   number
    spaceBefore?:  number
    spaceAfter?:   number
    indent?:       { firstLine?: number; left?: number; right?: number }
    keepTogether?: boolean
    keepWithNext?: boolean
  }
  heading?: {
    level?:       number
    font?:        { family?: string; size?: number; color?: string; weight?: 'normal' | 'bold' | number }
    spaceBefore?: number
    spaceAfter?:  number
    numbering?:   { format?: string; startAt?: number }
  }
  list?: {
    type?:   'bullet' | 'numbered' | 'none'
    marker?: string
    levels?: Array<{ marker: string; indent: number }>
  }
  table?: {
    borderStyle?: 'solid' | 'dashed' | 'dotted' | 'double' | 'none'
    borderWidth?: number
    borderColor?: string
    headerRow?:   { fill?: string; fontWeight?: 'normal' | 'bold'; fontColor?: string }
    cellPadding?: number
    rowBanding?:  { enabled: boolean; altFill?: string }
    columnWidths?: number[]
  }
  references?: { style?: 'superscript' | 'bracket' | 'parenthesis'; separator?: string }
  numbering?:  { sections?: boolean; format?: string; startAt?: number }
  notes?:      string
}

export function renderSectionTemplateNL(
  fmt:        SectionTemplateFormat,
  sectionKey: string,
): string {
  const lines: string[] = [`SECTION TEMPLATE (${sectionKey}) — follow these formatting rules`]
  const { page, font, paragraph, heading, list, table, references, numbering, notes } = fmt

  if (page) {
    const bits: string[] = []
    if (page.size)        bits.push(`${page.size}`)
    if (page.orientation) bits.push(page.orientation)
    if (page.columns && page.columns > 1) bits.push(`${page.columns} columns`)
    const m = page.margins
    if (m && (m.top || m.right || m.bottom || m.left)) {
      bits.push(`margins top/right/bottom/left ${m.top ?? '-'}/${m.right ?? '-'}/${m.bottom ?? '-'}/${m.left ?? '-'}pt`)
    }
    if (bits.length) lines.push(`Page: ${bits.join(', ')}.`)
    if (page.header?.enabled) {
      const t = page.header.text ? ` text "${page.header.text}"` : ''
      lines.push(`Header: enabled${t}.`)
    }
    if (page.footer?.enabled) {
      const pn = page.footer.pageNumber ? ', include page number' : ''
      const t  = page.footer.text ? ` text "${page.footer.text}"` : ''
      lines.push(`Footer: enabled${t}${pn}.`)
    }
  }

  if (font) {
    const bits: string[] = []
    if (font.family) bits.push(font.family)
    if (font.size)   bits.push(`${font.size}pt`)
    if (font.weight && font.weight !== 'normal') bits.push(typeof font.weight === 'number' ? `weight ${font.weight}` : font.weight)
    if (font.style  && font.style  !== 'normal') bits.push(font.style)
    if (font.underline && font.underline !== 'none') bits.push(`${font.underline} underline`)
    if (font.color)  bits.push(font.color)
    if (bits.length) lines.push(`Font: ${bits.join(', ')}.`)
  }

  if (paragraph) {
    const bits: string[] = []
    if (paragraph.alignment)           bits.push(paragraph.alignment)
    if (paragraph.lineHeight)          bits.push(`${paragraph.lineHeight} line-height`)
    if (paragraph.spaceBefore)         bits.push(`${paragraph.spaceBefore}pt before`)
    if (paragraph.spaceAfter)          bits.push(`${paragraph.spaceAfter}pt after`)
    const ind = paragraph.indent
    if (ind && (ind.firstLine || ind.left || ind.right)) {
      bits.push(`indent first-line/left/right ${ind.firstLine ?? 0}/${ind.left ?? 0}/${ind.right ?? 0}pt`)
    }
    if (paragraph.keepTogether) bits.push('keep paragraph together')
    if (paragraph.keepWithNext) bits.push('keep with next')
    if (bits.length) lines.push(`Paragraphs: ${bits.join(', ')}.`)
  }

  if (heading) {
    const bits: string[] = []
    if (heading.level)       bits.push(`H${heading.level}`)
    if (heading.font?.size)  bits.push(`${heading.font.size}pt`)
    if (heading.font?.weight && heading.font.weight !== 'normal') bits.push(typeof heading.font.weight === 'number' ? `weight ${heading.font.weight}` : `${heading.font.weight}`)
    if (heading.font?.color) bits.push(heading.font.color)
    if (heading.spaceBefore) bits.push(`${heading.spaceBefore}pt before`)
    if (heading.spaceAfter)  bits.push(`${heading.spaceAfter}pt after`)
    if (heading.numbering?.format) bits.push(`numbering "${heading.numbering.format}"`)
    if (bits.length) lines.push(`Headings: ${bits.join(', ')}.`)
  }

  if (list) {
    const bits: string[] = []
    if (list.type && list.type !== 'none') bits.push(`${list.type} list`)
    if (list.marker) bits.push(`marker "${list.marker}"`)
    if (list.levels?.length) {
      bits.push(`${list.levels.length}-level nesting`)
    }
    if (bits.length) lines.push(`Lists: ${bits.join(', ')}.`)
  }

  if (table) {
    const bits: string[] = []
    if (table.borderStyle && table.borderStyle !== 'none') {
      bits.push(`${table.borderStyle} ${table.borderWidth ?? 0.5}pt ${table.borderColor ?? '#000000'} borders`)
    }
    if (table.headerRow?.fill) {
      bits.push(`header row fill ${table.headerRow.fill}` + (table.headerRow.fontWeight === 'bold' ? ' bold' : ''))
    }
    if (table.cellPadding) bits.push(`${table.cellPadding}pt cell padding`)
    if (table.rowBanding?.enabled) {
      bits.push(`row banding${table.rowBanding.altFill ? ` alt-fill ${table.rowBanding.altFill}` : ''}`)
    }
    if (bits.length) lines.push(`Tables: ${bits.join(', ')}.`)
  }

  if (references?.style) {
    const sep = references.separator ? ` separator "${references.separator}"` : ''
    lines.push(`References: ${references.style} style${sep}.`)
  }

  if (numbering?.sections) {
    const fmtStr = numbering.format ? `, format "${numbering.format}"` : ''
    const start  = numbering.startAt ? `, starts at ${numbering.startAt}` : ''
    lines.push(`Section numbering: auto${fmtStr}${start}.`)
  }

  if (notes) lines.push('', 'ADDITIONAL FORMATTING NOTES', notes.trim())

  return lines.length > 1 ? lines.join('\n') : ''
}

/** Fixed product-level grounding rules for every single-section AI call.
 *  Mirror of apps/api resolve.ts SECTION_GROUNDING_RULES. Keep in
 *  lock-step — parity test fails on drift. */
export const SECTION_GROUNDING_RULES = [
  'SECTION GROUNDING RULES (product guardrails — always applied)',
  '- The attached source documents are the authoritative primary references for every fact, figure, date, numeric value, name, and citation in this section. Prefer verbatim quote or close paraphrase from the attachments over anything you can derive on your own.',
  '- When the attached sources genuinely do not contain information the section needs, insert a bracketed placeholder — [TBD: what is needed] — rather than fabricating. Never invent numbers, patient counts, dates, trial identifiers, or citations.',
  '- You are rewriting a single section only. Do not rewrite other sections or expand this one beyond its scope. Any "Additional context" below is reference material, not an edit target.',
  '- Preserve existing reference markers (superscripts, [1], §9.4 Table 3, etc.) unless the instruction says otherwise. A new claim that cites an attached source needs a visible reference.',
].join('\n')
