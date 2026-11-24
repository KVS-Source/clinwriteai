// TBD auto-fill — read every [TBD: X] marker in the current version,
// ask Claude to resolve each one from the attached source PDFs, and
// return a split list: items we can answer (ready to apply via
// replaceAcrossSections) + items we can't, each with a diagnostic
// reason so the writer knows what to fix (missing source, conflicting
// values, out-of-scope ask, etc.).
//
// Design notes:
//   - Pure helper — never writes. The route applies answers via the
//     existing tbd-replace service + emits a single audit line.
//   - Source text is extracted via extractTextFromBlob with a tight
//     per-file budget so the prompt stays under Claude's context
//     window even on a 10-PDF Protocol library.
//   - We never guess: the system prompt explicitly instructs Claude
//     to use UNANSWERABLE with a reason rather than fabricate.

import type { PrismaClient } from '@prisma/client'
import { extractTextFromBlob } from './extract-text.js'

export interface TbdAutofillItem {
  /** The TBD text inside the brackets — e.g. "protocol number". */
  tbd:    string
  /** Full placeholder string the user would see — "[TBD: protocol number]". */
  marker: string
}

export interface TbdAutofillAnswer {
  /** Original TBD text (matches input item.tbd). */
  tbd:    string
  /** Placeholder the applier passes to replaceAcrossSections. */
  marker: string
  /** When resolvable: the value to swap in. */
  value?: string
  /** When unresolvable: one-line diagnostic. */
  reason?: string
}

export interface TbdAutofillResult {
  filled:       TbdAutofillAnswer[]
  unresolvable: TbdAutofillAnswer[]
  /** Items the model simply didn't return — we treat them as unresolvable
   *  with a "model did not answer" reason so the UI shows them. */
  missed:       TbdAutofillAnswer[]
}

/** Budget for extracted source text per PDF — tight enough that 10
 *  attached PDFs still fit under Claude's effective context limit
 *  alongside the TBD list + the system prompt. */
const PER_FILE_CHARS = 4_000
const MAX_FILES      = 10

export interface SourceSnapshot {
  id:          string
  title:       string
  text:        string
  truncated:   boolean
  reason:      string | null
}

export interface BlobLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(bucket: any, key: string): Promise<{ body: Buffer | Uint8Array }>
}

export async function loadSourceSnapshots(
  prisma:    PrismaClient,
  blob:      BlobLike,
  documentId: string,
): Promise<SourceSnapshot[]> {
  const links = await prisma.documentSource.findMany({
    where:  { documentId },
    select: { uploadId: true },
  })
  if (links.length === 0) return []
  const uploads = await prisma.documentUpload.findMany({
    where: { id: { in: links.map(l => l.uploadId) } },
    select: {
      id: true, fileName: true, title: true, blobKey: true, contentType: true, fileSizeBytes: true,
    },
  })
  const usable = uploads
    .filter(u => (u.contentType ?? '').toLowerCase() === 'application/pdf')
    .slice(0, MAX_FILES)

  return Promise.all(usable.map(async (u): Promise<SourceSnapshot> => {
    try {
      const got = await blob.get('documents', u.blobKey)
      const buf = got.body instanceof Buffer ? got.body : Buffer.from(got.body)
      const extract = await extractTextFromBlob(buf, u.contentType, { maxChars: PER_FILE_CHARS })
      return {
        id:        u.id,
        title:     u.title ?? u.fileName,
        text:      extract.text,
        truncated: extract.returned < extract.bytes,
        reason:    extract.ok ? null : extract.reason,
      }
    } catch (err) {
      return {
        id:        u.id,
        title:     u.title ?? u.fileName,
        text:      '',
        truncated: false,
        reason:    `blob fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }))
}

/** Build the Claude prompt. Returned as a plain string that the caller
 *  passes to aiGateway.chat as the `prompt`. The model is asked to
 *  reply with strict JSON so parsing is deterministic; refusals and
 *  unanswerable items both land in the structured output. */
export function buildAutofillPrompt(
  items:   TbdAutofillItem[],
  sources: SourceSnapshot[],
): string {
  const sourceBlock = sources.length === 0
    ? 'NO SOURCE DOCUMENTS ARE ATTACHED.'
    : sources.map((s, i) => {
        const header = `=== SOURCE ${i + 1}: ${s.title} ===`
        if (s.reason) return `${header}\n[text unavailable: ${s.reason}]`
        return `${header}\n${s.text}${s.truncated ? '\n[…truncated…]' : ''}`
      }).join('\n\n')

  const tbdList = items.map((it, i) => `${i + 1}. ${it.tbd}`).join('\n')

  return [
    'You are helping a medical writer resolve TBD placeholders in a regulated document.',
    '',
    'Below are source documents the writer attached to this draft. For each TBD, decide whether the sources actually contain the answer. Do NOT guess — if the answer is not in the sources, say so with a specific reason.',
    '',
    'SOURCES:',
    sourceBlock,
    '',
    'TBDS TO RESOLVE:',
    tbdList,
    '',
    'Respond with STRICT JSON only (no prose, no fences), matching this schema:',
    '{',
    '  "items": [',
    '    { "tbd": "<exact tbd text from the list>", "value": "<concise answer>" },',
    '    { "tbd": "<...>", "unresolvable": "<one-line reason: e.g. \'protocol number not stated in any source\', \'two sources disagree: 50mg vs 100mg\', \'requires clinical team decision — not a data lookup\'>" }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- Every TBD from the list must appear in items[] exactly once.',
    '- Use "value" OR "unresolvable", never both.',
    '- Values must be short (≤ 200 chars) — a phrase or number, not a paragraph.',
    '- If a TBD can only be answered by a decision (not a data lookup), mark it unresolvable with that reason.',
    '- If two sources disagree, mark it unresolvable and say which sources.',
  ].join('\n')
}

/** Parse Claude's JSON response and align it with the input items.
 *  Items the model didn't answer land in `missed` with a fixed reason. */
export function parseAutofillResponse(
  raw:   string,
  items: TbdAutofillItem[],
): TbdAutofillResult {
  const byTbd = new Map<string, TbdAutofillItem>()
  for (const it of items) byTbd.set(it.tbd.toLowerCase(), it)

  const filled:       TbdAutofillAnswer[] = []
  const unresolvable: TbdAutofillAnswer[] = []
  const seen = new Set<string>()

  // Claude sometimes wraps JSON in ```json fences even when asked not to;
  // strip them before parsing so a cosmetic deviation doesn't throw.
  const stripped = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')

  let parsed: unknown
  try { parsed = JSON.parse(stripped) }
  catch {
    // Model returned prose or malformed JSON — treat everything as missed.
    return {
      filled: [],
      unresolvable: [],
      missed: items.map(it => ({ tbd: it.tbd, marker: it.marker, reason: 'Model did not return parseable JSON.' })),
    }
  }

  const list = (parsed as { items?: unknown }).items
  if (!Array.isArray(list)) {
    return {
      filled: [],
      unresolvable: [],
      missed: items.map(it => ({ tbd: it.tbd, marker: it.marker, reason: 'Model response did not include an items array.' })),
    }
  }

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const { tbd, value, unresolvable: reason } = entry as { tbd?: unknown; value?: unknown; unresolvable?: unknown }
    if (typeof tbd !== 'string') continue
    const match = byTbd.get(tbd.toLowerCase())
    if (!match) continue
    if (seen.has(match.tbd)) continue
    seen.add(match.tbd)
    if (typeof value === 'string' && value.trim()) {
      filled.push({ tbd: match.tbd, marker: match.marker, value: value.trim().slice(0, 500) })
    } else if (typeof reason === 'string' && reason.trim()) {
      unresolvable.push({ tbd: match.tbd, marker: match.marker, reason: reason.trim().slice(0, 300) })
    } else {
      unresolvable.push({ tbd: match.tbd, marker: match.marker, reason: 'Model returned an item with neither value nor reason.' })
    }
  }

  const missed = items
    .filter(it => !seen.has(it.tbd))
    .map(it => ({ tbd: it.tbd, marker: it.marker, reason: 'Model did not return an answer for this TBD.' }))

  return { filled, unresolvable, missed }
}
