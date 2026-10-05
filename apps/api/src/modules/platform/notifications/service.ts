// Notification service — the one place to call for fan-out.
//
// Delivery model:
//   - A Notification row is created first (append-only). Each requested
//     channel gets a NotificationDelivery child row.
//   - 'in_app' deliveries are considered "delivered" the moment the row
//     is created (the client polls or subscribes to the notifications feed).
//   - 'email' and 'sms' deliveries are stubs that record the attempt and
//     mark delivered immediately in dev. The real adapters (SES/SendGrid,
//     Twilio) are plugged in via NotificationChannelAdapter interface
//     below — swap the no-op implementations when procurement lands.
//
// Fan-out is NOT yet queue-backed. BullMQ wiring lands in a future session
// (same queue infra as the Module C expiry scheduler); until then, email +
// sms attempts happen inline. Keeping this in-process in dev is fine; prod
// should move to the queue before scale testing.

import type { PrismaClient } from '@prisma/client'

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

export interface NotificationChannelAdapter {
  send(args: {
    recipientId: string
    title: string
    body: string
    linkPath?: string
    payload: Record<string, unknown>
  }): Promise<{ providerRef: string | null }>
  readonly providerName: string
}

// --- no-op adapters (stubs) ----------------------------------------------

class NoopEmailAdapter implements NotificationChannelAdapter {
  readonly providerName = 'noop-email'
  async send(): Promise<{ providerRef: string | null }> {
    return { providerRef: null }
  }
}

class NoopSmsAdapter implements NotificationChannelAdapter {
  readonly providerName = 'noop-sms'
  async send(): Promise<{ providerRef: string | null }> {
    return { providerRef: null }
  }
}

export class NotificationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly adapters: {
      email: NotificationChannelAdapter
      sms: NotificationChannelAdapter
    } = { email: new NoopEmailAdapter(), sms: new NoopSmsAdapter() },
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

    // In-app: insert a delivered row immediately.
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

    for (const ch of channels) {
      if (ch === 'in_app') continue
      const adapter = ch === 'email' ? this.adapters.email : this.adapters.sms
      try {
        const { providerRef } = await adapter.send({
          recipientId: args.recipientId,
          title: args.title,
          body: args.body,
          linkPath: args.linkPath,
          payload: args.payload ?? {},
        })
        await this.prisma.notificationDelivery.create({
          data: {
            notificationId: notification.id,
            channel: ch,
            deliveredAt: new Date(),
            provider: adapter.providerName,
            providerRef,
          },
        })
      } catch (err) {
        await this.prisma.notificationDelivery.create({
          data: {
            notificationId: notification.id,
            channel: ch,
            provider: adapter.providerName,
            error: err instanceof Error ? err.message : String(err),
          },
        })
      }
    }

    return notification
  }
}
