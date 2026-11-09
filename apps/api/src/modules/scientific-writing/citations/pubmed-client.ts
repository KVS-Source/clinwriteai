// NCBI E-utilities client for the Scientific Writing citation editor.
//
// Public endpoints — no API key required at 3 req/s. Setting
// `NCBI_API_KEY` env var bumps the ceiling to 10 req/s (NCBI returns it
// in the `X-RateLimit-Limit` response header). We don't enforce a
// client-side throttle here: the UI's search autocomplete is debounced
// and the per-user call rate is well under 3/s. If a deploy sees 429s
// from NCBI, the fallback-to-stub path kicks in so the UX stays
// functional.
//
// Shape of the return value matches PubmedRecord expected by the web UI
// (apps/web/src/screens/scientific-writing/CitationSearch.tsx) so the
// route can swap the stub for this without the UI noticing. Abstracts
// require a separate efetch call — skipped from the list response to
// stay under the 5s budget; the UI fetches the abstract on "preview"
// click instead (not yet wired; `abstractText: ''` for now).

const ESEARCH_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi'
const ESUMMARY_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi'

/** One row in the shape the UI expects. */
export interface PubmedRecord {
  id:           string      // `pm-<pmid>` — stable + de-duplicable
  pmid:         string
  title:        string
  source:       string      // journal + year, UI-friendly
  shortRef:     string      // "Smith T, et al. J Clin Oncol 2025;43:988-1000."
  fullRef:      string      // Vancouver-style full reference
  abstractText: string      // empty for now (efetch is a separate round-trip)
  keys:         string      // comma-joined keywords for client-side filter
}

export interface PubmedSearchResult {
  /** Underlying source. `ncbi` = real call succeeded. `stub` = fell
   *  back to fixtures because NCBI was unreachable / threw. */
  source:  'ncbi' | 'stub'
  query:   string
  results: PubmedRecord[]
  /** Set when `source='stub'` — one-line reason the real call failed. */
  reason?: string
}

interface EsearchResponse {
  esearchresult?: { idlist?: string[] }
}

interface EsummaryEntry {
  uid?:             string
  title?:           string
  authors?:         Array<{ name: string }>
  fulljournalname?: string
  source?:          string
  pubdate?:         string              // '2025 Mar 12' or '2025'
  volume?:          string
  issue?:           string
  pages?:           string
  elocationid?:     string              // "doi: 10.xxxx/yyy" sometimes
  articleids?:      Array<{ idtype: string; value: string }>
}

interface EsummaryResponse {
  result?: Record<string, EsummaryEntry | string[] | undefined>
}

// --- helpers -------------------------------------------------------------

function yearFromPubdate(pubdate: string | undefined): string {
  if (!pubdate) return ''
  const m = /^(\d{4})/.exec(pubdate.trim())
  return m ? m[1]! : ''
}

function doiFromEntry(e: EsummaryEntry): string | undefined {
  // Prefer articleids.doi; fall back to elocationid when it starts with 'doi:'.
  const byId = e.articleids?.find(x => x.idtype === 'doi')?.value
  if (byId) return byId
  const el = e.elocationid?.trim()
  if (el?.toLowerCase().startsWith('doi:')) return el.slice(4).trim()
  return undefined
}

function authorsShort(authors: Array<{ name: string }> | undefined): string {
  if (!authors || authors.length === 0) return 'Anon'
  const first = authors[0]!.name
  return authors.length === 1 ? first : `${first}, et al`
}

function authorsFull(authors: Array<{ name: string }> | undefined): string {
  if (!authors || authors.length === 0) return 'Anon'
  // Vancouver: list up to the first 6 authors; otherwise first 3 + "et al".
  if (authors.length <= 6) return authors.map(a => a.name).join(', ')
  return `${authors.slice(0, 3).map(a => a.name).join(', ')}, et al`
}

function toRecord(e: EsummaryEntry, pmid: string): PubmedRecord {
  const year        = yearFromPubdate(e.pubdate)
  const journalFull = e.fulljournalname || e.source || ''
  const journalAbbr = e.source || e.fulljournalname || ''
  const vip         = [e.volume, e.issue && `(${e.issue})`, e.pages && `:${e.pages}`].filter(Boolean).join('')
  const doi         = doiFromEntry(e)

  // Year + volume/issue/pages render as one token so the semicolon
  // sits flush ("2026;395:812-824"); joining them separately leaves a
  // stray space ("2026 ;395:812-824").
  const yearVip = year + (vip ? `;${vip}` : '')
  const shortRef = [
    authorsShort(e.authors),
    journalAbbr,
    yearVip,
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() + '.'

  const fullRef = [
    authorsFull(e.authors) + '.',
    e.title ? e.title.replace(/\.$/, '') + '.' : '',
    journalAbbr,
    yearVip + '.',
    doi ? `doi:${doi}` : '',
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()

  return {
    id:           `pm-${pmid}`,
    pmid,
    title:        e.title ?? '(no title)',
    source:       journalFull && year ? `${journalFull} · ${year}` : (journalFull || year),
    shortRef,
    fullRef,
    abstractText: '',
    keys:         '',
  }
}

// --- the client ----------------------------------------------------------

export interface FetchPubmedOptions {
  /** NCBI API key — present ⇒ higher rate ceiling (10 req/s). */
  apiKey?:  string
  /** Max results per query. NCBI's esearch default is 20; capped to 20 here. */
  retmax?:  number
  /** Per-request timeout. Default 5s. */
  timeoutMs?: number
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch
}

/** Searches PubMed and returns records in the shape the UI expects.
 *  Never throws — a network / parse / rate-limit failure returns
 *  `source: 'stub'` with a short reason so the caller can keep working. */
export async function fetchPubmedSearch(
  query: string,
  opts: FetchPubmedOptions = {},
): Promise<Omit<PubmedSearchResult, 'query'>> {
  const q = query.trim()
  if (q.length === 0) return { source: 'ncbi', results: [] }

  const f         = opts.fetchImpl ?? fetch
  const retmax    = Math.min(opts.retmax ?? 10, 20)
  const timeoutMs = opts.timeoutMs ?? 5_000

  const params = new URLSearchParams({
    db:      'pubmed',
    term:    q,
    retmode: 'json',
    retmax:  String(retmax),
  })
  if (opts.apiKey) params.set('api_key', opts.apiKey)

  // --- esearch — PMIDs ---
  let pmids: string[]
  try {
    const ac = new AbortController()
    const to = setTimeout(() => ac.abort(), timeoutMs)
    const r = await f(`${ESEARCH_URL}?${params}`, { signal: ac.signal })
    clearTimeout(to)
    if (!r.ok) return { source: 'stub', results: [], reason: `esearch http ${r.status}` }
    const json = await r.json() as EsearchResponse
    pmids = (json.esearchresult?.idlist ?? []).filter(x => /^\d+$/.test(x))
  } catch (err) {
    return { source: 'stub', results: [], reason: `esearch failed: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (pmids.length === 0) return { source: 'ncbi', results: [] }

  // --- esummary — metadata ---
  const sumParams = new URLSearchParams({
    db:      'pubmed',
    id:      pmids.join(','),
    retmode: 'json',
  })
  if (opts.apiKey) sumParams.set('api_key', opts.apiKey)

  try {
    const ac = new AbortController()
    const to = setTimeout(() => ac.abort(), timeoutMs)
    const r = await f(`${ESUMMARY_URL}?${sumParams}`, { signal: ac.signal })
    clearTimeout(to)
    if (!r.ok) return { source: 'stub', results: [], reason: `esummary http ${r.status}` }
    const json = await r.json() as EsummaryResponse
    const result = json.result ?? {}
    const records = pmids
      .map(pmid => {
        const entry = result[pmid]
        if (!entry || Array.isArray(entry)) return null       // uids array, not an entry
        return toRecord(entry, pmid)
      })
      .filter((r): r is PubmedRecord => r !== null)
    return { source: 'ncbi', results: records }
  } catch (err) {
    return { source: 'stub', results: [], reason: `esummary failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}
