// Notification delivery jobs — fan-out side of the Phase 4 notification
// engine. The API's NotificationService enqueues one job per
// (notification, channel) pair after writing the Notification row;
// these workers do the actual provider call and write back a
// NotificationDelivery row.
//
// Provider selection via EMAIL_PROVIDER / SMS_PROVIDER env vars. Default
// 'noop' (dev / CI). Set to 'ses' | 'sendgrid' / 'twilio' once
// procurement completes — no code change needed here.
// See notification-providers.ts for the adapter contracts.

import type { JobHandler } from './types.js'
import { createEmailAdapter, createSmsAdapter } from './notification-providers.js'

export interface NotificationDeliveryPayload {
  notificationId: string
  recipientId: string
  title: string
  body: string
  linkPath?: string | null
  payload?: Record<string, unknown>
  // Resolved by the API-side NotificationService before enqueueing.
  // Phone number isn't on the User model (SMS targets are typically
  // external contacts — KolContact / MaContact — stored in moduleE)
  // so the service passes the resolved value through on the job.
  recipientPhone?: string
}

// Lazy singletons so each worker process shares one adapter instance.
let emailAdapter: ReturnType<typeof createEmailAdapter> | null = null
let smsAdapter:   ReturnType<typeof createSmsAdapter> | null = null
const email = () => (emailAdapter ??= createEmailAdapter())
const sms   = () => (smsAdapter   ??= createSmsAdapter())

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
  const { notificationId, recipientId, title, body, linkPath } = job.data
  const adapter = email()
  log.info({ notificationId, recipientId, channel: 'email', provider: adapter.provider, title }, 'delivering email notification')

  const recipient = await prisma.user.findUnique({ where: { id: recipientId }, select: { email: true, name: true } })
  if (!recipient?.email) {
    await markFailed(prisma, notificationId, 'email', adapter.provider, 'recipient email missing')
    return
  }

  try {
    const result = await adapter.send({
      recipientEmail: recipient.email,
      recipientName:  recipient.name ?? undefined,
      subject: title,
      body,
      linkPath: linkPath ?? null,
    })
    await markDelivered(prisma, notificationId, 'email', adapter.provider, result.providerRef)
  } catch (err) {
    await markFailed(prisma, notificationId, 'email', adapter.provider, err instanceof Error ? err.message : String(err))
    throw err
  }
}

export const handleNotificationSms: JobHandler<NotificationDeliveryPayload> = async (job, { prisma, log }) => {
  const { notificationId, recipientId, title, body, recipientPhone } = job.data
  const adapter = sms()
  log.info({ notificationId, recipientId, channel: 'sms', provider: adapter.provider, title }, 'delivering sms notification')

  if (!recipientPhone) {
    await markFailed(prisma, notificationId, 'sms', adapter.provider, 'recipient phone missing from payload')
    return
  }

  try {
    // recipientPhone is pre-resolved by the API-side NotificationService
    // (decrypted via KMS wrapper when Arc 9.1 lands).
    const result = await adapter.send({ recipientPhone, body })
    await markDelivered(prisma, notificationId, 'sms', adapter.provider, result.providerRef)
  } catch (err) {
    await markFailed(prisma, notificationId, 'sms', adapter.provider, err instanceof Error ? err.message : String(err))
    throw err
  }
}
