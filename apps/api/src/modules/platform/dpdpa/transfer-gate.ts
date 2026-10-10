// Cross-border transfer gate — Arc 7.4.
//
// When a tenant has `dataResidency = 'IN'`, writes to blob storage
// buckets or BullMQ queues outside the India government's notified-
// countries allow-list are blocked at the wrapper layer.
//
// Semantics (DPDPA 2023 §16, blacklist model):
//   - Our ap-south-1 bucket maps to 'IN' — always allowed for IN tenants.
//   - Other destinations map to a country code via a region → country
//     lookup. If that country isn't in `allowed_transfer_jurisdictions`,
//     block with CrossBorderBlockedError.
//   - Empty allow-list = all cross-border blocked (safe default until
//     operator loads the MeitY notification list).
//
// Design: a tiny helper, not middleware. Callers that write personal
// data pass the destination descriptor (`region` + optional `bucket`
// or `queue` name) through `assertAllowed()`.

import type { PrismaClient } from '@prisma/client'

// Minimal region → country map. Expand as new regions are used.
// Only lists regions we actually write to; unknown regions block
// cross-border by default (fail closed).
const REGION_TO_COUNTRY: Record<string, string> = {
  'ap-south-1':     'IN',
  'ap-south-2':     'IN',
  'eu-west-1':      'IE',
  'eu-west-2':      'GB',
  'eu-central-1':   'DE',
  'us-east-1':      'US',
  'us-east-2':      'US',
  'us-west-2':      'US',
  'ap-southeast-1': 'SG',
  'ap-southeast-2': 'AU',
  'ap-northeast-1': 'JP',
}

export class CrossBorderBlockedError extends Error {
  readonly code = 'cross_border_blocked'
  constructor(
    public readonly tenantId: string,
    public readonly destinationRegion: string,
    public readonly destinationCountry: string,
  ) {
    super(
      `Cross-border transfer to ${destinationCountry} (region=${destinationRegion}) blocked for IN-residency tenant ${tenantId}: destination not on DPDPA transfer allow-list.`,
    )
  }
}

export interface AssertAllowedArgs {
  tenantId: string
  destinationRegion: string
}

export function createTransferGate(prisma: PrismaClient) {
  async function tenantIsInResidency(tenantId: string): Promise<boolean> {
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { dataResidency: true },
    })
    return t?.dataResidency === 'IN'
  }

  async function assertAllowed(args: AssertAllowedArgs): Promise<void> {
    if (!(await tenantIsInResidency(args.tenantId))) return

    const country = REGION_TO_COUNTRY[args.destinationRegion] ?? 'UNKNOWN'
    if (country === 'IN') return  // in-region write — always fine

    const allowed = await prisma.allowedTransferJurisdiction.findUnique({
      where: { code: country },
    })
    if (!allowed) {
      throw new CrossBorderBlockedError(args.tenantId, args.destinationRegion, country)
    }
  }

  return { tenantIsInResidency, assertAllowed }
}

export type TransferGate = ReturnType<typeof createTransferGate>
