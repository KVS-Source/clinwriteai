// Branding + Localisation + Voice + SSO Zod schemas for PlatformSettings
// (Phase 3, migrations 93 + 96). All fields optional on the wire so admins
// can save a partial update without echoing every value.

import { z } from 'zod'

const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, { message: 'color must be #RGB or #RRGGBB' })

/** Branding — what the UI shows as "our install". */
export const brandingSchema = z.object({
  companyName:   z.string().min(1).max(120).optional(),
  primaryColor:  hexColor.optional(),
  logoUrl:       z.string().max(2_000).url().optional().or(z.literal('')),
  emailFromName: z.string().min(1).max(120).optional(),
}).strict()

/** Localisation — install-wide locale defaults. Users may override in
 *  their own profile (not in scope today). */
export const localisationSchema = z.object({
  timezone:   z.string().min(1).max(60).optional(),           // IANA tz, e.g. 'Asia/Kolkata'
  country:    z.string().length(2).toUpperCase().optional(),  // ISO-3166-1 alpha-2
  dateFormat: z.string().min(1).max(40).optional(),           // e.g. 'yyyy-MM-dd'
  timeFormat: z.enum(['24h', '12h']).optional(),
  currency:   z.string().length(3).toUpperCase().optional(),  // ISO-4217
  /** 1 US dollar in `currency`, for showing AI costs (billed in USD) in the local currency. */
  usdRate:    z.number().positive().max(1_000_000).optional(),
}).strict()

/** Voice transcription — engine choice + GDPR jurisdiction + retention
 *  policy. API keys are stored separately on ExternalApiCredential with
 *  apiId = `voice-<engine>` (same encryption-at-rest trust boundary as
 *  every other secret the admin pastes). */
export const voiceSchema = z.object({
  engine:               z.string().min(1).max(60).optional(),
  gdprJurisdiction:     z.enum(['EU', 'UK', 'US', 'APAC']).optional(),
  audioRetentionPolicy: z.enum(['delete-immediately', 'retain-30d', 'retain-90d']).optional(),
}).strict()

/** SSO — IT admin's identity provider setup for the install. Non-secret
 *  fields only; the OIDC clientSecret is stored on ExternalApiCredential
 *  with apiId = 'sso-oidc'. */
const oidcSchema = z.object({
  issuerUrl: z.string().max(500).url(),
  clientId:  z.string().min(1).max(200),
  scopes:    z.array(z.string().min(1).max(60)).max(20).optional(),
}).strict()

const samlSchema = z.object({
  entityId:    z.string().min(1).max(500),
  metadataUrl: z.string().max(500).url().optional(),
  acsUrl:      z.string().max(500).url().optional(),
}).strict()

export const ssoSchema = z.object({
  enabled:       z.boolean().optional(),
  protocol:      z.enum(['oidc', 'saml']).nullable().optional(),
  /** Login emails ending in one of these domains get routed through SSO
   *  (e.g. ["acme.com", "acme.co.in"]). Empty list = SSO available but
   *  domain-routing off (all users prompted to choose). */
  emailDomains:  z.array(z.string().min(2).max(120)).max(50).optional(),
  oidc:          oidcSchema.optional().nullable(),
  saml:          samlSchema.optional().nullable(),
}).strict()

export type Branding     = z.infer<typeof brandingSchema>
export type Localisation = z.infer<typeof localisationSchema>
export type Voice        = z.infer<typeof voiceSchema>
export type Sso          = z.infer<typeof ssoSchema>

/** Composite view returned by GET /platform-settings. */
export const platformSettingsSchema = z.object({
  branding:     brandingSchema,
  localisation: localisationSchema,
  voice:        voiceSchema,
  sso:          ssoSchema,
  updatedBy:    z.string().nullable(),
  updatedAt:    z.string(),
}).strict()

export type PlatformSettingsView = z.infer<typeof platformSettingsSchema>

/** Request bodies — PATCH-style; only the changed section is sent. */
export const updateBrandingSchema     = brandingSchema
export const updateLocalisationSchema = localisationSchema
export const updateVoiceSchema        = voiceSchema
export const updateSsoSchema          = ssoSchema
