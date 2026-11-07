// Document.regulatoryRegion → list of regulatory authorities that apply.
//
// The SME Protocol prompt keys submission-time rules off these names
// (not the region codes), so we expand once at brief-generation time.
// 'global' expands to the full tri-authority list; 'other' expands to
// an empty list — the author has opted out of a specific region and
// the model should emit a flag rather than guess.
//
// Add new regions (e.g. 'brazil' → ['ANVISA']) by extending this map;
// the Zod enum lives on the protocol-metadata route and is the
// authoritative gate for valid inputs.

export const JURISDICTIONS_BY_REGION: Record<string, string[]> = {
  us:     ['FDA'],
  eu:     ['EMA'],
  india:  ['CDSCO'],
  global: ['FDA', 'EMA', 'CDSCO'],
  other:  [],
}

export function jurisdictionsFor(region: string | null | undefined): string[] {
  if (!region) return []
  return JURISDICTIONS_BY_REGION[region] ?? []
}
