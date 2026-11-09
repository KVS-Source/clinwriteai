// CrossRef client for Ideation & Publishing DOI registration.
//
// CrossRef splits into two surfaces:
//   - Public read API at api.crossref.org — no credentials. Used here
//     to VALIDATE an existing DOI (sanity check before storing it) +
//     to look up published metadata when the UI wants to display it.
//   - Deposit API at doi.crossref.org/servlet/deposit — requires a
//     registered depositor account (CROSSREF_API_USER +
//     CROSSREF_API_PASSWORD) and signed XML deposit files. That's
//     procurement-gated (same blocker Module B flagged).
//
// This file wraps both. Callers pick: `lookup()` works out of the
// box; `mint()` returns a result that reports {source: 'stub'} when
// credentials are missing, so the audit entry distinguishes a
// real-CrossRef mint from a local placeholder.
//
// The deposit flow is intentionally the LAST hop — we always call
// lookup() first to confirm the DOI isn't already minted somewhere
// else, and mint() short-circuits to {source: 'stub'} when creds are
// absent rather than silently pretending to deposit.

const CROSSREF_LOOKUP_URL = 'https://api.crossref.org/works'

export interface CrossRefLookupResult {
  /** True when the DOI resolves against CrossRef's public API. */
  found:    boolean
  /** Title / journal / year pulled from the public record when found. */
  title?:   string
  journal?: string
  year?:    number
  /** One-line reason — HTTP status, parse failure, network error. */
  reason?:  string
}

export interface CrossRefMintArgs {
  /** The suggested DOI to mint. The real deposit flow allocates
   *  within your registered prefix; the caller passes it so we don't
   *  invent prefixes at runtime. */
  doi:   string
  /** Title + URL + resource metadata CrossRef needs in the deposit XML. */
  title: string
  url:   string
  /** Author names in Vancouver order. CrossRef wants given + family. */
  authors?: Array<{ given: string; family: string }>
}

export interface CrossRefMintResult {
  /** `crossref` = authenticated deposit succeeded.
   *  `stub`     = creds missing / network failure — DOI was NOT deposited. */
  source: 'crossref' | 'stub'
  doi:    string
  /** Deposit submission ID from CrossRef when `source='crossref'`. */
  submissionId?: string
  reason?: string
}

export interface CrossRefClientOpts {
  apiUser?:     string                  // CROSSREF_API_USER
  apiPassword?: string                  // CROSSREF_API_PASSWORD
  fetchImpl?:   typeof fetch
  timeoutMs?:   number
}

// --- lookup -----------------------------------------------------------

export async function crossRefLookup(doi: string, opts: CrossRefClientOpts = {}): Promise<CrossRefLookupResult> {
  const trimmed = doi.trim()
  if (!trimmed) return { found: false, reason: 'empty_doi' }

  const f         = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? 5_000
  const url       = `${CROSSREF_LOOKUP_URL}/${encodeURIComponent(trimmed)}`
  try {
    const ac = new AbortController()
    const to = setTimeout(() => ac.abort(), timeoutMs)
    const r  = await f(url, { signal: ac.signal, headers: { 'User-Agent': 'aurora-clinwrite/1.0 (mailto:ops@clinwrite.ai)' } })
    clearTimeout(to)
    if (r.status === 404) return { found: false, reason: 'not_in_crossref' }
    if (!r.ok) return { found: false, reason: `http ${r.status}` }
    const json = await r.json() as { message?: { title?: string[]; 'container-title'?: string[]; issued?: { 'date-parts'?: number[][] } } }
    const message = json.message
    return {
      found:   true,
      title:   message?.title?.[0],
      journal: message?.['container-title']?.[0],
      year:    message?.issued?.['date-parts']?.[0]?.[0],
    }
  } catch (err) {
    return { found: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

// --- mint -------------------------------------------------------------

/**
 * Attempts to mint a DOI against CrossRef. Returns {source: 'stub'}
 * when credentials aren't configured (CROSSREF_API_USER +
 * CROSSREF_API_PASSWORD) — the caller still persists the suggested
 * DOI so the content has a stable identifier downstream, but the
 * audit entry records that no real deposit happened.
 *
 * The actual deposit XML + signed form POST to
 * https://doi.crossref.org/servlet/deposit is deliberately NOT
 * implemented here — it requires:
 *   - A registered CrossRef depositor account
 *   - Prefix allocation + tested deposit XML schema conformance
 *   - A sandbox run against the CrossRef test endpoint first
 * When procurement completes, the implementation goes in this
 * function body behind the creds check; the public contract stays
 * the same.
 */
export async function crossRefMint(args: CrossRefMintArgs, opts: CrossRefClientOpts = {}): Promise<CrossRefMintResult> {
  const creds = (opts.apiUser ?? process.env.CROSSREF_API_USER) && (opts.apiPassword ?? process.env.CROSSREF_API_PASSWORD)
  if (!creds) {
    return { source: 'stub', doi: args.doi, reason: 'crossref_credentials_not_configured' }
  }
  // Real deposit lands here when procurement completes. Shape of the
  // return value is already locked so no caller change is needed.
  return { source: 'stub', doi: args.doi, reason: 'deposit_implementation_pending' }
}
