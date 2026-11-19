// Licensing claim shape + request/response Zod schemas.
//
// The licensing JWT's payload (once signature-verified) must match
// `licenseClaimsSchema`. This narrows the "signed" payload to the
// fields we actually trust for authorization — anything else the
// issuer adds is ignored at authz time (but preserved in the raw
// token for audit).

import { z } from 'zod'

/** Modules the token can authorise. Mirrors the canonical module keys
 *  used by `requireAuth({ modules: [...] })`. Loose string so we can
 *  add new modules without a migration — but the auth path only matches
 *  what it already knows. */
const moduleKey = z.string().min(1).max(40).regex(/^[A-Za-z0-9_\-]+$/)

/** Feature flags the token can authorise (e.g. 'ai_drafter',
 *  'part11_esig', 'section_template_extract'). */
const featureKey = z.string().min(1).max(80).regex(/^[A-Za-z0-9_\-]+$/)

/** The signed claims we trust after JWT verification. The verifier
 *  handles `exp`, `nbf`, `iat`, `iss`; this schema narrows the
 *  licensing-specific body. */
export const licenseClaimsSchema = z.object({
  installId:     z.string().min(1).max(120),
  customerName:  z.string().min(1).max(200),
  modules:       z.array(moduleKey).max(20),
  features:      z.array(featureKey).max(50).default([]),
  // Issued-at + expiry are standard JWT claims (iat/exp) — the verifier
  // enforces them. We echo them here only so the payload stays
  // self-describing when it's rendered on the admin UI.
  iat:           z.number().int().optional(),
  exp:           z.number().int().optional(),
  // Optional metadata the issuer may include; never used for authz.
  maxUsers:      z.number().int().positive().optional(),
  contact:       z.string().max(200).optional(),
}).strict().passthrough()
// passthrough so forward-compatible fields (added by GenBioCa later)
// don't fail validation on older servers. Only the known keys are used.

export type LicenseClaims = z.infer<typeof licenseClaimsSchema>

// --- API request / response schemas --------------------------------------

export const importLicenseSchema = z.object({
  token: z.string().min(1).max(8_000),
}).strict()

export type ImportLicenseInput = z.infer<typeof importLicenseSchema>

export const revokeLicenseSchema = z.object({
  reason: z.string().min(1).max(500),
}).strict()
