// Module E calendar overdue scheduler — hourly.
//
// Flips calendar_entries from 'scheduled' to 'overdue' when
// scheduled_date is in the past and no publish_record exists yet.
// Emits an in-app notification to the assigned creative so they can
// catch up or cancel.

import type { JobHandler } from './types.js'

export const handleCalendarOverdue: JobHandler = async (_job, { prisma, log }) => {
  const now = new Date()

  // Find entries that should have gone out but haven't.
  const overdue = await prisma.calendarEntry.findMany({
    where: {
      status: 'scheduled',
      scheduledDate: { lt: now },
      publishedAt: null,
    },
    select: { id: true, channel: true, scheduledDate: true, assignedCreativeId: true, ideationContentCardId: true },
  })

  if (overdue.length === 0) {
    log.debug('no overdue calendar entries')
    return { flipped: 0 }
  }

  await prisma.calendarEntry.updateMany({
    where: { id: { in: overdue.map(e => e.id) } },
    data: { status: 'overdue' },
  })

  // One notification per entry, to the assigned creative (if any).
  // Entries without an assignee fall back to the card's project team
  // via a project-scoped notification — but we don't model that here;
  // for v1 we only notify when there's an explicit assignee.
  for (const e of overdue) {
    if (!e.assignedCreativeId) continue
    await prisma.notification.create({
      data: {
        recipientId: e.assignedCreativeId,
        kind: 'calendar_entry_overdue',
        severity: 'warning',
        title: `Calendar entry overdue (${e.channel})`,
        body: `Scheduled ${e.scheduledDate.toISOString().slice(0, 10)} but not published. Publish or cancel.`,
        linkPath: `/ideation/cards/${e.ideationContentCardId}`,
        channels: ['in_app', 'email'],
        payload: { calendarEntryId: e.id, channel: e.channel },
      },
    })
  }

  log.info({ flipped: overdue.length }, 'calendar entries flipped to overdue')
  return { flipped: overdue.length }
}
