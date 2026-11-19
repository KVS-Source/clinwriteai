// Branding + Localisation Zod schemas for PlatformSettings (Phase 3,
// migration 93). All fields optional on the wire so admins can save a
// partial update without echoing every value.

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
}).strict()

export type Branding     = z.infer<typeof brandingSchema>
export type Localisation = z.infer<typeof localisationSchema>

/** Composite view returned by GET /platform-settings. */
export const platformSettingsSchema = z.object({
  branding:     brandingSchema,
  localisation: localisationSchema,
  updatedBy:    z.string().nullable(),
  updatedAt:    z.string(),
}).strict()

export type PlatformSettingsView = z.infer<typeof platformSettingsSchema>

/** Request bodies — PATCH-style; only the changed section is sent. */
export const updateBrandingSchema     = brandingSchema
export const updateLocalisationSchema = localisationSchema
