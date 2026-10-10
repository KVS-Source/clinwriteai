// CDSCO submission pin — Arc 7.5.
//
// DPDPA + Indian regulatory context: when a Module D submission is
// destined for CDSCO (India's Central Drugs Standard Control
// Organization), the submission payload + any uploaded artefacts must
// flow through ap-south-1 storage, regardless of the tenant's default
// data residency setting. This rules out EU/US tenants accidentally
// uploading an Indian HA submission to a non-IN bucket.
//
// Called from the gateway-submission route (apps/api/src/modules/
// regulatory-writing/submissions/*) when the real gateway integration
// lands. Until then, this helper is dormant but tested so flipping
// the switch is a one-line change.

export type SubmissionAuthority = 'FDA' | 'EMA' | 'MHRA' | 'PMDA' | 'CDSCO'

export const AUTHORITY_PINNED_REGION: Partial<Record<SubmissionAuthority, string>> = {
  // India HA — DPDPA mandates in-region storage for personal data in
  // the dossier (investigator contacts, patient refs, HA attendees).
  CDSCO: 'ap-south-1',
  // Other authorities don't have a hard regional pin at this layer;
  // tenant default residency applies.
}

/**
 * Resolve the storage region for a submission based on the destination
 * authority. CDSCO always lands in ap-south-1; everything else honours
 * the tenant default (caller passes it in).
 */
export function resolveSubmissionRegion(args: {
  authority: SubmissionAuthority
  tenantDefaultRegion: string
}): string {
  return AUTHORITY_PINNED_REGION[args.authority] ?? args.tenantDefaultRegion
}
