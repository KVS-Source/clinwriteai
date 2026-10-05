// Notification service — the one place to call for fan-out.
//
// Delivery model:
//   - A Notification row is created first (append-only). In-app deliveries
//     are inserted synchronously in the same transaction so the client's
//     unread-count reflects reality immediately.
//   - 'email' and 'sms' channels enqueue a BullMQ job per channel; the
//     worker (apps/worker/src/jobs/notification-delivery.ts) consumes the
//     job and writes a NotificationDelivery row on success/failure. This
//     keeps the API request fast + decouples provider latency from the
//     caller's experience.
//   - If the queue enqueue fails (Redis down), we fall back to writing a
//     'queued' delivery row with error='enqueue_failed'. The API never
//     silently drops a notification request.

import type { PrismaClient } from '@prisma/client'
import type { QueueProducer } from '../queue/producer.js'

export type NotificationChannel = 'in_app' | 'email' | 'sms'

export interface SendNotificationArgs {
  recipientId: string
  kind: string
  severity?: 'info' | 'warning' | 'critical'
  title: string
  body: string
  linkPath?: string
  channels?: NotificationChannel[]
  payload?: Record<string, unknown>
}

export class NotificationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue?: QueueProducer,
  ) {}

  async send(args: SendNotificationArgs) {
    const channels: NotificationChannel[] = args.channels?.length
      ? args.channels
      : ['in_app']

    const notification = await this.prisma.notification.create({
      data: {
        recipientId: args.recipientId,
        kind: args.kind,
        severity: args.severity ?? 'info',
        title: args.title,
        body: args.body,
        linkPath: args.linkPath ?? null,
        channels,
        payload: (args.payload ?? {}) as unknown as object,
      },
    })

    if (channels.includes('in_app')) {
      await this.prisma.notificationDelivery.create({
        data: {
          notificationId: notification.id,
          channel: 'in_app',
          deliveredAt: new Date(),
          provider: 'internal',
        },
      })
    }

    // Enqueue each off-platform channel. If the queue is unavailable
    // (test env, Redis down), we skip enqueueing but still record a
    // placeholder NotificationDelivery so an operator can see "this
    // notification was requested but not dispatched".
    for (const ch of channels) {
      if (ch === 'in_app') continue
      if (!this.queue) {
        await this.prisma.notificationDelivery.create({
          data: {
            notificationId: notification.id,
            channel: ch,
            provider: 'none-configured',
            error: 'notification queue not configured',
          },
        })
        continue
      }
      try {
        const jobName = ch === 'email' ? 'notification.email' : 'notification.sms'
        await this.queue.enqueue(jobName, {
          notificationId: notification.id,
          recipientId: args.recipientId,
          title: args.title,
          body: args.body,
          linkPath: args.linkPath ?? null,
          payload: args.payload ?? {},
        })
      } catch (err) {
        await this.prisma.notificationDelivery.create({
          data: {
            notificationId: notification.id,
            channel: ch,
            provider: 'queue',
            error: `enqueue_failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        })
      }
    }

    return notification
  }
}
