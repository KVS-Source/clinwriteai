// PlatformSettings service — single-row branding + localisation.
//
// Reads tolerate a missing row (fresh install before migration seed
// runs) by returning {} / {} with a synthetic `updatedAt`. Writes
// upsert on the fixed 'default' id.

import type { PrismaClient, Prisma } from '@prisma/client'
import type { Branding, Localisation, PlatformSettingsView } from './schema.js'

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
        updatedBy:    null,
        updatedAt:    new Date(0).toISOString(),
      }
    }
    return {
      branding:     (row.branding     as unknown as Branding)     ?? {},
      localisation: (row.localisation as unknown as Localisation) ?? {},
      updatedBy:    row.updatedBy,
      updatedAt:    row.updatedAt.toISOString(),
    }
  }

  async updateBranding(patch: Branding, actorId: string): Promise<PlatformSettingsView> {
    const current = await this.prisma.platformSettings.findUnique({ where: { id: SINGLETON_ID } })
    const merged = { ...(current?.branding as unknown as Branding ?? {}), ...patch }
    await this.prisma.platformSettings.upsert({
      where:  { id: SINGLETON_ID },
      create: {
        id:          SINGLETON_ID,
        branding:    merged as unknown as Prisma.InputJsonValue,
        localisation: (current?.localisation as unknown as Prisma.InputJsonValue) ?? {},
        updatedBy:   actorId,
      },
      update: {
        branding:  merged as unknown as Prisma.InputJsonValue,
        updatedBy: actorId,
      },
    })
    return this.get()
  }

  async updateLocalisation(patch: Localisation, actorId: string): Promise<PlatformSettingsView> {
    const current = await this.prisma.platformSettings.findUnique({ where: { id: SINGLETON_ID } })
    const merged = { ...(current?.localisation as unknown as Localisation ?? {}), ...patch }
    await this.prisma.platformSettings.upsert({
      where:  { id: SINGLETON_ID },
      create: {
        id:          SINGLETON_ID,
        branding:    (current?.branding as unknown as Prisma.InputJsonValue) ?? {},
        localisation: merged as unknown as Prisma.InputJsonValue,
        updatedBy:   actorId,
      },
      update: {
        localisation: merged as unknown as Prisma.InputJsonValue,
        updatedBy:    actorId,
      },
    })
    return this.get()
  }
}
