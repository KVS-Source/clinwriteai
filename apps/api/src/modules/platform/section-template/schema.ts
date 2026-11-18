// SectionTemplateFormat — the JSON that captures per-section formatting
// so AI drafter/rewriter can preserve it on every pass. Shipping coverage
// is the top .docx (OOXML) axes an AI needs to produce faithful output:
// page/section properties, run (font) properties, paragraph properties,
// heading/numbering, list, table, references. Extensible toward full
// OOXML parity (headers/footers content, drawing anchors, content
// controls) without migrations — every field is optional.
//
// The NL renderer in resolve.ts translates the structured shape into
// prose the model follows reliably (Claude is more consistent about
// NL formatting rules than nested JSON — see M-F.4 design decision).

import { z } from 'zod'

// --- primitives ----------------------------------------------------------

/** Hex color like #RRGGBB or #RGB. Case-insensitive. */
const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, { message: 'color must be #RGB or #RRGGBB' })

/** Points — the canonical .docx length unit. Admins think in pt; the
 *  renderer can convert to twips (pt * 20) for .docx export. */
const points = z.number().min(0).max(2_000)

/** A positive integer or zero — used for weight levels, indent steps, etc. */
const nonNegInt = z.number().int().min(0)

// --- page / section properties ------------------------------------------

export const pageMarginsSchema = z.object({
  top:    points.optional(),
  right:  points.optional(),
  bottom: points.optional(),
  left:   points.optional(),
}).partial().strict()

export const pageHeaderFooterSchema = z.object({
  enabled:    z.boolean().optional(),
  text:       z.string().max(500).optional(),
  font:       z.string().max(80).optional(),
  size:       points.optional(),
  pageNumber: z.boolean().optional(),      // for footer: include page X of Y
}).partial().strict()

export const pageSchema = z.object({
  size:        z.enum(['A4', 'Letter', 'Legal']).optional(),
  orientation: z.enum(['portrait', 'landscape']).optional(),
  margins:     pageMarginsSchema.optional(),
  columns:     z.number().int().min(1).max(4).optional(),
  header:      pageHeaderFooterSchema.optional(),
  footer:      pageHeaderFooterSchema.optional(),
}).partial().strict()

// --- run (font) properties -----------------------------------------------

export const fontSchema = z.object({
  family:    z.string().max(80).optional(),
  size:      points.optional(),
  color:     hexColor.optional(),
  weight:    z.union([z.enum(['normal', 'bold']), z.number().int().min(100).max(900)]).optional(),
  style:     z.enum(['normal', 'italic']).optional(),
  underline: z.enum(['none', 'single', 'double']).optional(),
}).partial().strict()

// --- paragraph properties ------------------------------------------------

export const paragraphIndentSchema = z.object({
  firstLine: points.optional(),
  left:      points.optional(),
  right:     points.optional(),
}).partial().strict()

export const paragraphSchema = z.object({
  alignment:    z.enum(['left', 'center', 'right', 'justify']).optional(),
  lineHeight:   z.number().min(0.8).max(3).optional(),  // multiplier (1.0 = single, 1.15 = tight, 2.0 = double)
  spaceBefore:  points.optional(),
  spaceAfter:   points.optional(),
  indent:       paragraphIndentSchema.optional(),
  keepTogether: z.boolean().optional(),                 // don't break paragraph across pages
  keepWithNext: z.boolean().optional(),                 // keep with following paragraph (headings)
}).partial().strict()

// --- heading --------------------------------------------------------------

export const headingSchema = z.object({
  level:        z.number().int().min(1).max(6).optional(),
  font:         fontSchema.optional(),
  spaceBefore:  points.optional(),
  spaceAfter:   points.optional(),
  numbering: z.object({
    format:  z.string().max(40).optional(),             // e.g. '%1.%2'
    startAt: nonNegInt.optional(),
  }).partial().strict().optional(),
}).partial().strict()

// --- list ----------------------------------------------------------------

export const listLevelSchema = z.object({
  marker: z.string().max(10),                           // '•', '1.', 'a.', '◦'
  indent: points,
}).strict()

export const listSchema = z.object({
  type:   z.enum(['bullet', 'numbered', 'none']).optional(),
  marker: z.string().max(10).optional(),                // single-level shortcut
  levels: z.array(listLevelSchema).max(9).optional(),   // multi-level
}).partial().strict()

// --- table ---------------------------------------------------------------

export const tableHeaderRowSchema = z.object({
  fill:       hexColor.optional(),
  fontWeight: z.enum(['normal', 'bold']).optional(),
  fontColor:  hexColor.optional(),
}).partial().strict()

export const tableSchema = z.object({
  borderStyle:  z.enum(['solid', 'dashed', 'dotted', 'double', 'none']).optional(),
  borderWidth:  points.optional(),
  borderColor:  hexColor.optional(),
  headerRow:    tableHeaderRowSchema.optional(),
  cellPadding:  points.optional(),
  rowBanding: z.object({
    enabled: z.boolean(),
    altFill: hexColor.optional(),
  }).strict().optional(),
  columnWidths: z.array(points).max(20).optional(),
}).partial().strict()

// --- references ----------------------------------------------------------

export const referencesSchema = z.object({
  style:     z.enum(['superscript', 'bracket', 'parenthesis']).optional(),
  separator: z.string().max(5).optional(),              // ', ' | '; ' | ''
}).partial().strict()

// --- numbering (auto section numbers) -----------------------------------

export const numberingSchema = z.object({
  sections: z.boolean().optional(),
  format:   z.string().max(40).optional(),              // e.g. '%1.%2' → "6.2"
  startAt:  nonNegInt.optional(),
}).partial().strict()

// --- top-level ----------------------------------------------------------

/** The format JSON stored on SectionTemplate.formatJson and snapshotted
 *  onto SectionContent.templateFormatJson. Every top-level key is
 *  optional — admins can author a minimal template (e.g. just font) and
 *  the NL renderer just skips empty blocks. */
export const sectionTemplateFormatSchema = z.object({
  page:       pageSchema.optional(),
  font:       fontSchema.optional(),
  paragraph:  paragraphSchema.optional(),
  heading:    headingSchema.optional(),
  list:       listSchema.optional(),
  table:      tableSchema.optional(),
  references: referencesSchema.optional(),
  numbering:  numberingSchema.optional(),
  // Free-form notes the admin wants to pass to the AI verbatim — appended
  // under "ADDITIONAL FORMATTING NOTES" in the rendered block. Use sparingly
  // (every char is tokens on every rewrite); prefer structured fields above.
  notes:      z.string().max(2_000).optional(),
}).partial().strict()

export type SectionTemplateFormat = z.infer<typeof sectionTemplateFormatSchema>

// --- API request/response schemas ---------------------------------------

export const createSectionTemplateSchema = z.object({
  docType:    z.string().min(1).max(80),
  sectionKey: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_.\-§]+$/),
  formatJson: sectionTemplateFormatSchema.default({}),
}).strict()

export const updateSectionTemplateDraftSchema = z.object({
  formatJson: sectionTemplateFormatSchema,
}).strict()

export const retireSectionTemplateSchema = z.object({
  reason: z.string().min(1).max(500),
}).strict()

export type CreateSectionTemplateInput         = z.infer<typeof createSectionTemplateSchema>
export type UpdateSectionTemplateDraftInput    = z.infer<typeof updateSectionTemplateDraftSchema>
