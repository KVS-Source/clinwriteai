// Mailer — nodemailer SMTP wrapper (Phase A, 2026-11-02).
//
// Decorated on the Fastify instance as `app.mailer`. Two implementations
// live behind a single interface:
//
//   • SMTP mode   — SMTP_HOST + SMTP_USER + SMTP_PASS all set → real
//                   transport; messages leave the box.
//   • Log mode    — SMTP_HOST empty → noop transport that writes the
//                   message to pino.info. Lets local dev + CI exercise
//                   the password-reset flow end-to-end without a real
//                   relay, with the reset link visible in the API log.
//
// A later arc can slot in SES / SendGrid behind the same `sendMail` call
// without touching the password routes.

import nodemailer, { type Transporter } from 'nodemailer'
import type { FastifyBaseLogger } from 'fastify'
import fp from 'fastify-plugin'
import type { Env } from '../config/env.js'

export interface MailMessage {
  to:      string
  subject: string
  text:    string
  html:    string
}

export interface Mailer {
  /** Transmits (or logs) the message. Resolves to the provider's message
   *  id on success. Rejects on transport failure — callers decide
   *  whether to surface or swallow. */
  sendMail(msg: MailMessage): Promise<{ messageId: string; transport: 'smtp' | 'log' }>
}

export function createMailer(env: Env, logger: FastifyBaseLogger): Mailer {
  const configured = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS)

  if (!configured) {
    logger.warn(
      '[mailer] SMTP_HOST / SMTP_USER / SMTP_PASS not fully set — running in LOG mode. ' +
      'Password reset links will be written to the API log instead of being emailed.',
    )
    return logMailer(logger, env.EMAIL_FROM)
  }

  const transporter: Transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER!,
      pass: env.SMTP_PASS!,
    },
  })

  logger.info(
    { host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, from: env.EMAIL_FROM },
    '[mailer] SMTP transport ready',
  )

  return {
    async sendMail(msg) {
      const info = await transporter.sendMail({
        from: env.EMAIL_FROM,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      })
      logger.info({ to: msg.to, subject: msg.subject, messageId: info.messageId }, '[mailer] sent')
      return { messageId: info.messageId, transport: 'smtp' }
    },
  }
}

function logMailer(logger: FastifyBaseLogger, from: string): Mailer {
  return {
    async sendMail(msg) {
      const messageId = `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      // Multi-line log so the operator can see the full body in dev
      // console. The one line callers want to copy is the magic link
      // inside the text body, so we log .text verbatim.
      logger.info(
        {
          messageId,
          from,
          to: msg.to,
          subject: msg.subject,
        },
        `[mailer:log] EMAIL (not sent)\n--- subject ---\n${msg.subject}\n--- body ---\n${msg.text}\n---`,
      )
      return { messageId, transport: 'log' }
    },
  }
}

/** Fastify plugin — decorates app with `app.mailer`. */
export const mailerPlugin = fp(async (app) => {
  const mailer = createMailer(app.env, app.log)
  app.decorate('mailer', mailer)
})

declare module 'fastify' {
  interface FastifyInstance {
    mailer: Mailer
  }
}
