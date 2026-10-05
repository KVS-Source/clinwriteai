// Notification delivery jobs — fan-out side of the Phase 4 notification
// engine. The API's NotificationService enqueues one job per
// (notification, channel) pair after writing the Notification row;
// these workers do the actual provider call and write back a
// NotificationDelivery row.
//
// Real integrations (SES/SendGrid/Twilio) land when procurement
// completes. For now the handlers log + mark delivered inline — same
// semantics as the no-op adapters the inline path had.

import type { JobHandler } from './types.js'

export interface NotificationDeliveryPayload {
  notificationId: string
  recipientId: string
  title: string
  body: string
  linkPath?: string | null
  payload?: Record<string, unknown>
}

const markDelivered = async (
  prisma: Parameters<JobHandler>[1]['prisma'],
  notificationId: string,
  channel: 'email' | 'sms',
  provider: string,
  providerRef: string | null,
) => {
  await prisma.notificationDelivery.create({
    data: {
      notificationId,
      channel,
      deliveredAt: new Date(),
      provider,
      providerRef,
    },
  })
}

const markFailed = async (
  prisma: Parameters<JobHandler>[1]['prisma'],
  notificationId: string,
  channel: 'email' | 'sms',
  provider: string,
  error: string,
) => {
  await prisma.notificationDelivery.create({
    data: {
      notificationId,
      channel,
      provider,
      error,
    },
  })
}

export const handleNotificationEmail: JobHandler<NotificationDeliveryPayload> = async (job, { prisma, log }) => {
  const { notificationId, recipientId, title } = job.data
  log.info({ notificationId, recipientId, channel: 'email', title }, 'delivering email notification')

  // TODO: swap for SES/SendGrid once procurement lands. The job retry
  // policy (3 attempts with exponential backoff) handles transient
  // provider failures.
  try {
    // await emailProvider.send({...})
    await markDelivered(prisma, notificationId, 'email', 'noop-email', null)
  } catch (err) {
    await markFailed(prisma, notificationId, 'email', 'noop-email', err instanceof Error ? err.message : String(err))
    throw err
  }
}

export const handleNotificationSms: JobHandler<NotificationDeliveryPayload> = async (job, { prisma, log }) => {
  const { notificationId, recipientId, title } = job.data
  log.info({ notificationId, recipientId, channel: 'sms', title }, 'delivering sms notification')

  try {
    // await smsProvider.send({...})
    await markDelivered(prisma, notificationId, 'sms', 'noop-sms', null)
  } catch (err) {
    await markFailed(prisma, notificationId, 'sms', 'noop-sms', err instanceof Error ? err.message : String(err))
    throw err
  }
}
