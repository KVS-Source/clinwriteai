// DPDPA write-gate helper — Arc 7.3.
//
// Routes that write personal data for a tenant with
// `dataResidency = 'IN'` must assert that an active ConsentRecord
// exists for the (subjectType, subjectId, purpose) tuple before
// committing the write. Returns the consent row on pass, throws on
// fail (caller translates to 428 Precondition Required).
//
// Non-IN tenants pass through unconditionally — DPDPA scope is India
// only. GDPR consent handling for EU tenants lives elsewhere.
//
// Design: a tiny pure helper used from inside Fastify route handlers
// via `app.dpdpa.requireConsent(...)`. Doesn't ship as middleware
// because the subject id isn't always on the URL — some writes
// (POST /voice-notes) carry it in the body.

import type { PrismaClient } from '@prisma/client'

export type SubjectType = 'user' | 'kol_contact' | 'ma_contact' | 'voice_note'

export type ConsentPurpose =
  | 'service_delivery'
  | 'medical_review'
  | 'publication_authoring'
  | 'kol_engagement'
  | 'voice_transcription'

export class ConsentRequiredError extends Error {
  readonly code = 'consent_required'
  constructor(
    public readonly subjectType: SubjectType,
    public readonly subjectId: string,
    public readonly purpose: ConsentPurpose,
    public readonly intakeUrl: string,
  ) {
    super(`Consent required for ${subjectType}:${subjectId} purpose=${purpose}`)
  }
}

export interface RequireConsentArgs {
  tenantId: string
  subjectType: SubjectType
  subjectId: string
  purpose: ConsentPurpose
}

export function createDpdpaGate(prisma: PrismaClient) {
  async function tenantRequiresDpdpa(tenantId: string): Promise<boolean> {
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { dataResidency: true },
    })
    return t?.dataResidency === 'IN'
  }

  async function requireConsent(args: RequireConsentArgs): Promise<void> {
    if (!(await tenantRequiresDpdpa(args.tenantId))) return

    const active = await prisma.consentRecord.findFirst({
      where: {
        tenantId: args.tenantId,
        subjectType: args.subjectType,
        subjectId: args.subjectId,
        purpose: args.purpose,
        revokedAt: null,
      },
      select: { id: true },
    })

    if (!active) {
      // Intake URL is a well-known SPA route; the frontend handles the
      // consent-capture flow and POSTs the ConsentRecord via the API.
      const intakeUrl = `/consent/intake?subject=${encodeURIComponent(
        `${args.subjectType}:${args.subjectId}`,
      )}&purpose=${encodeURIComponent(args.purpose)}&tenant=${encodeURIComponent(args.tenantId)}`
      throw new ConsentRequiredError(args.subjectType, args.subjectId, args.purpose, intakeUrl)
    }
  }

  return { tenantRequiresDpdpa, requireConsent }
}

export type DpdpaGate = ReturnType<typeof createDpdpaGate>
