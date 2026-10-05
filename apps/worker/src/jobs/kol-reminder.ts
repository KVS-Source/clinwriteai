// Module E KOL reminder scheduler — hourly.
//
// Walks kol_contacts whose review_link_expiry is in the next 7 days and
// hasn't signed off yet, firing 3 reminder tiers:
//
//   reminder1 (3-day) — expiry in <5d AND reminder1_sent_at IS NULL
//   reminder2 (5-day) — expiry in <3d AND reminder2_sent_at IS NULL
//   escalation (7-day) — expired in last 1d AND escalated_at IS NULL
//
// Each tier is bumped exactly once; the DB fields are set atomically
// with the notification create to avoid double-sends under worker crash.

import type { JobHandler } from './types.js'

const DAYS = 86_400_000

export const handleKolReminder: JobHandler = async (_job, { prisma, log }) => {
  const now = new Date()
  const in5d = new Date(now.getTime() + 5 * DAYS)
  const in3d = new Date(now.getTime() + 3 * DAYS)
  const past1d = new Date(now.getTime() - 1 * DAYS)

  let r1Count = 0
  let r2Count = 0
  let escCount = 0

  // ----- Tier 1: 3-day pre-expiry (first reminder) ----------------------
  const r1Candidates = await prisma.kolContact.findMany({
    where: {
      signedOffAt: null,
      reminder1SentAt: null,
      reviewLinkExpiry: { gt: now, lte: in5d },
    },
    select: { id: true, name: true, email: true, ideationProjectId: true },
  })
  for (const c of r1Candidates) {
    await prisma.$transaction([
      prisma.kolContact.update({
        where: { id: c.id },
        data: { reminder1SentAt: new Date() },
      }),
      prisma.notification.create({
        data: {
          // No User.id for external KOLs — notification goes to the ideation
          // project owner so they can nudge directly. The provider-side
          // email ships separately via notification.email job.
          recipientId: c.ideationProjectId,
          kind: 'kol_reminder_r1',
          severity: 'info',
          title: `KOL review reminder (3-day) — ${c.name}`,
          body: `${c.name} <${c.email}> hasn't completed KOL sign-off; review link expires in <5 days.`,
          channels: ['in_app', 'email'],
          payload: { kolContactId: c.id, tier: 'r1' },
        },
      }),
    ])
    r1Count++
  }

  // ----- Tier 2: 5-day post-first-reminder --------------------------------
  const r2Candidates = await prisma.kolContact.findMany({
    where: {
      signedOffAt: null,
      reminder1SentAt: { not: null },
      reminder2SentAt: null,
      reviewLinkExpiry: { gt: now, lte: in3d },
    },
    select: { id: true, name: true, email: true, ideationProjectId: true },
  })
  for (const c of r2Candidates) {
    await prisma.$transaction([
      prisma.kolContact.update({
        where: { id: c.id },
        data: { reminder2SentAt: new Date() },
      }),
      prisma.notification.create({
        data: {
          recipientId: c.ideationProjectId,
          kind: 'kol_reminder_r2',
          severity: 'warning',
          title: `KOL review reminder (5-day) — ${c.name}`,
          body: `${c.name} <${c.email}> still outstanding; review link expires in <3 days.`,
          channels: ['in_app', 'email'],
          payload: { kolContactId: c.id, tier: 'r2' },
        },
      }),
    ])
    r2Count++
  }

  // ----- Tier 3: Escalation after expiry ---------------------------------
  const escCandidates = await prisma.kolContact.findMany({
    where: {
      signedOffAt: null,
      escalatedAt: null,
      reviewLinkExpiry: { lte: now, gte: past1d },  // expired in last 1d
    },
    select: { id: true, name: true, email: true, ideationProjectId: true },
  })
  for (const c of escCandidates) {
    await prisma.$transaction([
      prisma.kolContact.update({
        where: { id: c.id },
        data: { escalatedAt: new Date() },
      }),
      prisma.notification.create({
        data: {
          recipientId: c.ideationProjectId,
          kind: 'kol_escalation',
          severity: 'critical',
          title: `KOL review ESCALATION — ${c.name}`,
          body: `${c.name} <${c.email}> review link expired without sign-off. Investigate + extend if valid.`,
          channels: ['in_app', 'email'],
          payload: { kolContactId: c.id, tier: 'escalation' },
        },
      }),
    ])
    escCount++
  }

  log.info({ r1Count, r2Count, escCount }, 'kol reminders processed')
  return { r1: r1Count, r2: r2Count, escalation: escCount }
}
