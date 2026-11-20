// PlatformSettings service — single-row branding + localisation + voice + sso.
//
// Reads tolerate a missing row (fresh install before migration seed
// runs) by returning empty sections with a synthetic `updatedAt`. Writes
// upsert on the fixed 'default' id.

import type { PrismaClient, Prisma } from '@prisma/client'
import type { Branding, Localisation, PlatformSettingsView, Voice, Sso } from './schema.js'

const SINGLETON_ID = 'default'

export class PlatformSettingsService {
  constructor(private readonly prisma: PrismaClient) {}

  async get(): Promise<PlatformSettingsView> {
    const row = await this.prisma.platformSettings.findUnique({ where: { id: SINGLETON_ID } })
    if (!row) {
      // Fresh install before migration seed landed. Return an empty-but-
      // well-shaped view so the admin UI can still render — the first
      // PATCH will upsert the row.
      return {
        branding:     {},
        localisation: {},
        voice:        {},
        sso:          {},
        updatedBy:    null,
        updatedAt:    new Date(0).toISOString(),
      }
    }
    return {
      branding:     (row.branding     as unknown as Branding)     ?? {},
      localisation: (row.localisation as unknown as Localisation) ?? {},
      voice:        (row.voice        as unknown as Voice)        ?? {},
      sso:          (row.sso          as unknown as Sso)          ?? {},
      updatedBy:    row.updatedBy,
      updatedAt:    row.updatedAt.toISOString(),
    }
  }

  // One shared upsert helper — every section update needs to carry the
  // other sections' current values on CREATE (fresh install path), and only
  // the touched section + updatedBy on UPDATE. Keeps the per-section
  // methods a one-liner.
  private async upsertSection(
    section: 'branding' | 'localisation' | 'voice' | 'sso',
    merged:  unknown,
    actorId: string,
  ): Promise<void> {
    const current = await this.prisma.platformSettings.findUnique({ where: { id: SINGLETON_ID } })
    await this.prisma.platformSettings.upsert({
      where:  { id: SINGLETON_ID },
      create: {
        id:           SINGLETON_ID,
        branding:     section === 'branding'     ? (merged as Prisma.InputJsonValue) : ((current?.branding     as Prisma.InputJsonValue) ?? {}),
        localisation: section === 'localisation' ? (merged as Prisma.InputJsonValue) : ((current?.localisation as Prisma.InputJsonValue) ?? {}),
        voice:        section === 'voice'        ? (merged as Prisma.InputJsonValue) : ((current?.voice        as Prisma.InputJsonValue) ?? {}),
        sso:          section === 'sso'          ? (merged as Prisma.InputJsonValue) : ((current?.sso          as Prisma.InputJsonValue) ?? {}),
        updatedBy:    actorId,
      },
      update: {
        [section]: merged as Prisma.InputJsonValue,
        updatedBy: actorId,
      },
    })
  }

  async updateBranding(patch: Branding, actorId: string): Promise<PlatformSettingsView> {
    const current = await this.prisma.platformSettings.findUnique({ where: { id: SINGLETON_ID } })
    const merged = { ...(current?.branding as unknown as Branding ?? {}), ...patch }
    await this.upsertSection('branding', merged, actorId)
    return this.get()
  }

  async updateLocalisation(patch: Localisation, actorId: string): Promise<PlatformSettingsView> {
    const current = await this.prisma.platformSettings.findUnique({ where: { id: SINGLETON_ID } })
    const merged = { ...(current?.localisation as unknown as Localisation ?? {}), ...patch }
    await this.upsertSection('localisation', merged, actorId)
    return this.get()
  }

  async updateVoice(patch: Voice, actorId: string): Promise<PlatformSettingsView> {
    const current = await this.prisma.platformSettings.findUnique({ where: { id: SINGLETON_ID } })
    const merged = { ...(current?.voice as unknown as Voice ?? {}), ...patch }
    await this.upsertSection('voice', merged, actorId)
    return this.get()
  }

  async updateSso(patch: Sso, actorId: string): Promise<PlatformSettingsView> {
    const current = await this.prisma.platformSettings.findUnique({ where: { id: SINGLETON_ID } })
    const merged = { ...(current?.sso as unknown as Sso ?? {}), ...patch }
    await this.upsertSection('sso', merged, actorId)
    return this.get()
  }
}
