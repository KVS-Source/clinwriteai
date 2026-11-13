// Pulls the real ICH guideline list from ICH's own site and writes it into the framework registry.
//
// Source: https://www.ich.org/page/ich-guidelines. That site is an Angular app whose pages come from ICH's public
// content API at admin.ich.org. Each of the four guideline pages (Quality, Safety, Efficacy, Multidisciplinary)
// returns every guideline on it: code, title, ICH step, step date and PDF links.
//
// Mapping into regulatory_frameworks (one row per guideline, matched by name, e.g. "ICH E6(R3)"):
//   name          'ICH ' + the code ICH publishes
//   description   the guideline title
//   version       the ICH step ('Step 5', 'Step 4', …)
//   category      quality | safety | efficacy | multidisciplinary
//   effectiveDate the date of the step ICH lists
//   sourceUrl     the guideline PDF on database.ich.org (else the ICH page it is listed on)
//   retiredAt     set when ICH lists the guideline as Withdrawn
// Entries without a step date are working groups still in progress (no guideline yet); they are skipped and
// reported. Rows not from ICH are never touched, and a framework already superseded stays superseded.

export const ICH_API_BASE = 'https://admin.ich.org'
export const ICH_CATEGORIES = ['quality', 'safety', 'efficacy', 'multidisciplinary'] as const
export type IchCategory = (typeof ICH_CATEGORIES)[number]

export const ichPageUrl = (category: IchCategory) => `https://www.ich.org/page/${category}-guidelines`
const ichApiUrl = (category: IchCategory) =>
  `${ICH_API_BASE}/api/v1/nodes?loadEntities%5B%5D=paragraph&alias=/page/${category}-guidelines`

export interface IchGuideline {
  code:      string           // 'E6(R3)'
  title:     string
  step:      string           // 'Step 5' | 'Withdrawn' | ''
  stepDate:  string | null    // ISO date (yyyy-mm-dd)
  category:  IchCategory
  sourceUrl: string
}

interface RawItem {
  code?: string; title?: string; status?: string
  details?: { stepDate?: string }
  fileGroups?: Array<{ files?: Array<{ uri?: string; mimetype?: string }> }>
}

const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
// '27 October 1994' → '1994-10-27'. Anything else → null.
export function parseIchDate(s: string | undefined): string | null {
  const m = clean(s).match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/)
  if (!m) return null
  const month = MONTHS.indexOf(m[2]!.toLowerCase())
  if (month < 0) return null
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
}

// Every guideline item on one category page's JSON (they sit in 'guideline' paragraphs, at any depth).
export function parseIchPage(json: unknown, category: IchCategory): IchGuideline[] {
  const out: IchGuideline[] = []
  const walk = (o: unknown) => {
    if (Array.isArray(o)) { o.forEach(walk); return }
    if (!o || typeof o !== 'object') return
    const rec = o as Record<string, unknown>
    const info = rec.entityInfo as { bundle?: string } | undefined
    if (info?.bundle === 'guideline' && Array.isArray(rec.items)) {
      for (const it of rec.items as RawItem[]) {
        const code = clean(it.code)
        if (!code) continue
        const pdf = it.fileGroups?.flatMap(g => g.files ?? []).find(f => f.mimetype === 'application/pdf' && f.uri)?.uri
        out.push({
          code,
          title:     clean(it.title),
          step:      clean(it.status),
          stepDate:  parseIchDate(it.details?.stepDate),
          category,
          sourceUrl: pdf ?? ichPageUrl(category),
        })
      }
    }
    Object.values(rec).forEach(walk)
  }
  walk(json)
  return out
}

export type FetchJson = (url: string) => Promise<unknown>

const defaultFetchJson: FetchJson = async (url) => {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`ICH responded ${res.status} for ${url}`)
  return res.json()
}

export async function fetchIchGuidelines(fetchJson: FetchJson = defaultFetchJson): Promise<IchGuideline[]> {
  const pages = await Promise.all(ICH_CATEGORIES.map(async c => parseIchPage(await fetchJson(ichApiUrl(c)), c)))
  return pages.flat()
}

export interface IchSyncResult {
  fetched:  number
  created:  string[]
  updated:  string[]
  unchanged: number
  withdrawn: string[]
  skipped:  Array<{ code: string; reason: string }>
}

interface FrameworkRowLike {
  id: string; name: string; version: string; category: string; description: string | null
  sourceUrl: string | null; effectiveDate: Date; retiredAt: Date | null
}
interface PrismaLike {
  regulatoryFramework: {
    findMany: (args: { where: { jurisdiction: string } }) => Promise<FrameworkRowLike[]>
    create:   (args: { data: Record<string, unknown> }) => Promise<unknown>
    update:   (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>
  }
}

export async function syncIchGuidelines(prisma: PrismaLike, actorId: string, fetchJson?: FetchJson): Promise<IchSyncResult> {
  const guidelines = await fetchIchGuidelines(fetchJson)
  const result: IchSyncResult = { fetched: guidelines.length, created: [], updated: [], unchanged: 0, withdrawn: [], skipped: [] }

  // One row per name. ICH lists a few guidelines on two pages (e.g. Q13); the first, dated listing wins.
  const byName = new Map<string, IchGuideline>()
  for (const g of guidelines) {
    if (!g.stepDate) { result.skipped.push({ code: g.code, reason: g.step ? `${g.step}, no step date yet` : 'in progress, no step date yet' }); continue }
    const name = `ICH ${g.code}`
    if (byName.has(name)) { result.skipped.push({ code: g.code, reason: 'listed twice by ICH; kept the first listing' }); continue }
    byName.set(name, g)
  }

  const existing = new Map((await prisma.regulatoryFramework.findMany({ where: { jurisdiction: 'ICH' } })).map(r => [r.name, r]))
  for (const [name, g] of byName) {
    const withdrawn = g.step.toLowerCase() === 'withdrawn'
    const data = {
      description:   g.title,
      version:       g.step || 'Step 5',
      category:      g.category,
      effectiveDate: new Date(`${g.stepDate}T00:00:00.000Z`),
      sourceUrl:     g.sourceUrl,
    }
    const row = existing.get(name)
    if (!row) {
      await prisma.regulatoryFramework.create({ data: { name, jurisdiction: 'ICH', createdBy: actorId, ...data, retiredAt: withdrawn ? new Date() : null } })
      result.created.push(name)
      if (withdrawn) result.withdrawn.push(name)
      continue
    }
    const changed = row.description !== data.description || row.version !== data.version || row.category !== data.category
      || row.sourceUrl !== data.sourceUrl || row.effectiveDate.toISOString().slice(0, 10) !== g.stepDate
    const retire = withdrawn && !row.retiredAt
    if (!changed && !retire) { result.unchanged++; continue }
    await prisma.regulatoryFramework.update({ where: { id: row.id }, data: { ...data, ...(retire && { retiredAt: new Date() }) } })
    result.updated.push(name)
    if (retire) result.withdrawn.push(name)
  }
  return result
}
