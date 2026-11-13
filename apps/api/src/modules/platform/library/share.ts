// Master Library "Share" (2026-11-13).
//
// Who may share: a Project Manager or a Contributor (the writers and reviewers). Auditor, QC and IT Admin can't.
//
// Who it can go to — any email address:
//   - a colleague with an active account in the sharer's organisation who can open the Master Library gets an
//     in-app notification and an email linking to the document in the app (they sign in as usual);
//   - anyone else — no account at all (e.g. a CEO who must read it), or an account that can't open the Master
//     Library — gets an invitation. Its link alone opens nothing: the reader asks for a one-time code, which is
//     emailed to the invited address only, and the document shows after the code is entered. Someone the link
//     is forwarded to can't get the code, so a forwarded or copied link is useless. Only hashes of the link
//     token, the code and the viewing session are stored (library_shares, migration 71).
//   - an account in the organisation that is suspended or deprovisioned is refused: it was switched off on
//     purpose, and an invitation would get round that.
// The invited reader can only read the document in the browser — no download button, no other documents.
//
// Audit: the share, every opened invitation and every lock-out after too many wrong codes are written to the
// source document's own audit trail when the entry was pushed from a document, otherwise to the library entry.
//
// SSO (not built yet): when the organisation signs in through an identity provider, recipients should be looked
// up through it — a person in the IdP directory without a ClinWrite account would be provisioned (or invited)
// through SSO/SCIM instead of getting an email code, and a person the IdP has deactivated refused even if the
// local account is still active. Today only local accounts are checked.
//
// Routes:
//   POST /library/:id/share                 (signed in: PM or Contributor)
//   GET  /shared-library/:token             (public) what was shared, by whom, to which (masked) address
//   POST /shared-library/:token/code        (public) email a one-time code to the invited address
//   POST /shared-library/:token/verify      (public) check the code; returns a viewing session
//   GET  /shared-library/:token/pdf         (public + X-Share-Session) the document, for reading in the browser

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { requireAuth, type AuthenticatedUser } from '../../../auth/rbac.js'
import { libraryItemPdf } from './pdf-file.js'
import { versionLabel } from './shape.js'

export const SHARE_MAX_RECIPIENTS = 20
export const SHARE_LINK_DAYS = 14              // an invitation link works for this long
export const CODE_TTL_MINUTES = 10             // a one-time code works for this long
export const CODE_MAX_ATTEMPTS = 5             // wrong entries before the code stops working
export const CODE_RESEND_SECONDS = 60          // wait before another code can be sent
export const CODES_MAX_PER_SHARE = 10          // codes one invitation can ever send
export const SESSION_HOURS = 8                 // how long a verified reader can read before entering a new code

// Account roles that can open the Master Library in the app (IT Admin can't; guests are outsiders).
const LIBRARY_ROLES = new Set(['pm', 'contributor', 'auditor', 'qc'])
const SHARER_ROLES = ['pm', 'contributor'] as const
const INACTIVE = new Set(['suspended', 'deprovisioned'])

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const newToken = () => randomBytes(32).toString('base64url')
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** j***@company.com — enough for the reader to recognise their address, not enough to harvest it. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(6, local.length - 1)))}@${domain}`
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

const libraryVisibleTo = (user: { tenantId: string | null }): Prisma.LibrarySectionWhereInput =>
  user.tenantId == null ? {} : { OR: [{ tenantId: null }, { tenantId: user.tenantId }] }

/** Where a share's audit entries go: the source document's trail when there is one, else the library entry's. */
function auditTarget(row: { id: string; tags: string[] }): { entityType: string; entityId: string; documentId: string | null } {
  const documentId = row.tags.find(t => t.startsWith('fromdoc:'))?.slice('fromdoc:'.length) ?? null
  return documentId ? { entityType: 'document', entityId: documentId, documentId } : { entityType: 'library_section', entityId: row.id, documentId: null }
}

const appBaseUrl = (app: FastifyInstance) => (app.env.APP_BASE_URL ?? app.env.CORS_ORIGIN).replace(/\/$/, '')

// --------------------------------------------------------------------------------------------------------------
// POST /library/:id/share
// --------------------------------------------------------------------------------------------------------------

const shareBody = z.object({
  emails: z.array(z.string().trim().toLowerCase().email().max(254)).min(1).max(SHARE_MAX_RECIPIENTS),
})

type Recipient =
  | { kind: 'user'; email: string; id: string; name: string }
  | { kind: 'invite'; email: string }

export const libraryShareRoutes: FastifyPluginAsync = async (app) => {
  app.post('/:id/share', {
    preHandler: requireAuth({ roles: [...SHARER_ROLES] }),
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = request.user! as AuthenticatedUser
    const { id } = request.params as { id: string }
    const parsed = shareBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation', message: `Enter between 1 and ${SHARE_MAX_RECIPIENTS} valid email addresses.`, issues: parsed.error.issues })
    }
    const row = await app.prisma.librarySection.findFirst({ where: { id, AND: [libraryVisibleTo(user)] } })
    if (!row || row.category === 'best_practice') return reply.code(404).send({ error: 'not_found' })
    if (row.retiredAt) return reply.code(409).send({ error: 'withdrawn', message: 'This document has been withdrawn from the library and can no longer be shared.' })

    const emails = [...new Set(parsed.data.emails)].filter(e => e !== user.email.toLowerCase())
    if (!emails.length) return reply.code(400).send({ error: 'share_with_self', message: 'Add at least one person other than yourself.' })

    // Accounts with these addresses, in any organisation (an account elsewhere is an outsider here).
    const accounts = await app.prisma.user.findMany({
      where: { email: { in: emails, mode: 'insensitive' } },
      select: { id: true, email: true, name: true, role: true, additionalRoles: true, tenantId: true, status: true },
    })
    const byEmail = new Map(accounts.map(a => [a.email.toLowerCase(), a]))
    const refused: string[] = []
    const recipients: Recipient[] = []
    for (const email of emails) {
      const a = byEmail.get(email)
      const ours = a && a.tenantId === user.tenantId
      if (ours && INACTIVE.has(a.status)) { refused.push(email); continue }
      if (ours && a.status === 'active' && [a.role, ...a.additionalRoles].some(r => LIBRARY_ROLES.has(r))) {
        recipients.push({ kind: 'user', email, id: a.id, name: a.name })
      } else {
        recipients.push({ kind: 'invite', email })
      }
    }
    if (refused.length) {
      return reply.code(400).send({
        error: 'recipients_not_allowed',
        message: 'These people have accounts in your organisation that are switched off, so the document can’t be shared with them. Nothing has been sent.',
        emails: refused,
      })
    }

    const target = auditTarget(row)
    const sharer = await app.prisma.user.findUnique({ where: { id: user.id }, select: { name: true } })
    const sharerName = sharer?.name ?? 'A colleague'
    const version = versionLabel(row.version)
    const failed: string[] = []

    // Colleagues: a notification in the app and by email, linking to the document in the Master Library.
    for (const r of recipients) {
      if (r.kind !== 'user') continue
      try {
        await app.notifications.send({
          recipientId: r.id,
          kind: 'library_document_shared',
          title: `${sharerName} shared "${row.title}" with you`,
          body: `${sharerName} shared the Master Library document "${row.title}" (${version}) with you. Open it to read it.`,
          linkPath: `/master-library/documents?item=${encodeURIComponent(row.id)}`,
          channels: ['in_app', 'email'],
          payload: { libraryItemId: row.id, sharedBy: user.id, ...(target.documentId && { documentId: target.documentId }) },
        })
      } catch (err) {
        app.log.warn({ err, libraryItemId: row.id, recipientId: r.id }, 'library share: notification failed')
        failed.push(r.email)
      }
    }

    // Everyone else: an invitation (one working link per person and document — an older one stops working).
    const expiresAt = new Date(Date.now() + SHARE_LINK_DAYS * 24 * 60 * 60 * 1000)
    for (const r of recipients) {
      if (r.kind !== 'invite') continue
      const token = newToken()
      const now = new Date()
      await app.prisma.libraryShare.updateMany({
        where: { libraryItemId: row.id, email: r.email, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      })
      const share = await app.prisma.libraryShare.create({
        data: { libraryItemId: row.id, tenantId: row.tenantId ?? user.tenantId, email: r.email, sharedBy: user.id, expiresAt, tokenHash: sha256(token) },
      })
      const link = `${appBaseUrl(app)}/shared/library/${token}`
      try {
        await app.mailer.sendMail(invitationEmail({ to: r.email, sharerName, title: row.title, version, link, expiresAt }))
      } catch (err) {
        app.log.warn({ err, libraryItemId: row.id, shareId: share.id }, 'library share: invitation email failed')
        await app.prisma.libraryShare.update({ where: { id: share.id }, data: { revokedAt: new Date() } })
        failed.push(r.email)
      }
    }

    const sent = recipients.filter(r => !failed.includes(r.email))
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: user.id,
      action: 'library_document_shared',
      entityType: target.entityType,
      entityId: target.entityId,
      details: {
        libraryItemId: row.id,
        title: row.title,
        libraryVersion: row.version,
        recipients: sent.map(r => (r.kind === 'user' ? { kind: 'user', id: r.id, email: r.email, name: r.name } : { kind: 'invite', email: r.email })),
        ...(failed.length && { failed }),
        ...(sent.some(r => r.kind === 'invite') && { invitationExpiresAt: expiresAt.toISOString() }),
      },
      ipAddress: request.ip ?? null,
    })

    return reply.send({
      shared: sent.map(r => ({ email: r.email, kind: r.kind, ...(r.kind === 'user' && { name: r.name }) })),
      failed,
    })
  })
}

// --------------------------------------------------------------------------------------------------------------
// Public: /shared-library/:token…
// --------------------------------------------------------------------------------------------------------------

type ShareRow = NonNullable<Awaited<ReturnType<FastifyInstance['prisma']['libraryShare']['findUnique']>>>
type ItemRow = { id: string; title: string; body: string; tags: string[]; framework: string; version: number }

const GONE_LINK = { error: 'link_invalid', message: 'This link is not valid. Ask the person who shared the document to share it again.' }

/** The share behind a link token and its library entry, or the answer to send when the link no longer works. */
async function loadShare(app: FastifyInstance, token: string, reply: FastifyReply): Promise<{ share: ShareRow; item: ItemRow } | null> {
  if (!token || token.length < 30 || token.length > 100) { await reply.code(404).send(GONE_LINK); return null }
  const share = await app.prisma.libraryShare.findUnique({ where: { tokenHash: sha256(token) } })
  if (!share) { await reply.code(404).send(GONE_LINK); return null }
  if (share.revokedAt) { await reply.code(410).send({ error: 'revoked', message: 'This link no longer works. Ask the person who shared the document to share it again.' }); return null }
  if (share.expiresAt.getTime() <= Date.now()) { await reply.code(410).send({ error: 'expired', message: 'This link has expired. Ask the person who shared the document to share it again.' }); return null }
  const item = await app.prisma.librarySection.findUnique({
    where: { id: share.libraryItemId },
    select: { id: true, title: true, body: true, tags: true, framework: true, version: true, retiredAt: true },
  })
  if (!item || item.retiredAt) { await reply.code(410).send({ error: 'withdrawn', message: 'This document has been withdrawn and can no longer be read.' }); return null }
  return { share, item }
}

const codeBody = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.') })

export const sharedLibraryPublicRoutes: FastifyPluginAsync = async (app) => {
  // What was shared — no content, no full address.
  app.get('/:token', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const loaded = await loadShare(app, (request.params as { token: string }).token, reply)
    if (!loaded) return
    const { share, item } = loaded
    const sharer = await app.prisma.user.findUnique({ where: { id: share.sharedBy }, select: { name: true } })
    return reply.send({
      title: item.title,
      docType: item.framework,
      version: versionLabel(item.version),
      sharedByName: sharer?.name ?? null,
      sharedAt: share.sharedAt.toISOString(),
      expiresAt: share.expiresAt.toISOString(),
      emailHint: maskEmail(share.email),
    })
  })

  // Email a one-time code to the invited address (never to an address from the request).
  app.post('/:token/code', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const loaded = await loadShare(app, (request.params as { token: string }).token, reply)
    if (!loaded) return
    const { share, item } = loaded
    if (share.codesSent >= CODES_MAX_PER_SHARE) {
      return reply.code(429).send({ error: 'too_many_codes', message: 'Too many codes have been requested for this link. Ask the person who shared the document to share it again.' })
    }
    const waited = share.codeSentAt ? (Date.now() - share.codeSentAt.getTime()) / 1000 : Infinity
    if (waited < CODE_RESEND_SECONDS) {
      const retryAfterSec = Math.ceil(CODE_RESEND_SECONDS - waited)
      return reply.code(429).send({ error: 'code_recently_sent', message: `A code was just sent. You can ask for another in ${retryAfterSec} seconds.`, retryAfterSec })
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const now = new Date()
    await app.prisma.libraryShare.update({
      where: { id: share.id },
      data: { codeHash: sha256(`${share.id}:${code}`), codeSentAt: now, codeExpiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000), codeAttempts: 0, codesSent: { increment: 1 } },
    })
    try {
      await app.mailer.sendMail(codeEmail({ to: share.email, title: item.title, code }))
    } catch (err) {
      app.log.warn({ err, shareId: share.id }, 'library share: code email failed')
      return reply.code(502).send({ error: 'email_failed', message: 'The code could not be emailed. Please try again in a minute.' })
    }
    return reply.send({ sentTo: maskEmail(share.email), expiresInMinutes: CODE_TTL_MINUTES, resendAfterSec: CODE_RESEND_SECONDS })
  })

  // Check the code. Right: a viewing session (one at a time — a new one ends the old). Wrong: counted.
  app.post('/:token/verify', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const loaded = await loadShare(app, (request.params as { token: string }).token, reply)
    if (!loaded) return
    const { share, item } = loaded
    const parsed = codeBody.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', message: parsed.error.issues[0]?.message ?? 'Enter the 6-digit code.' })
    if (!share.codeHash || !share.codeExpiresAt || share.codeExpiresAt.getTime() <= Date.now()) {
      return reply.code(410).send({ error: 'code_expired', message: 'This code has expired. Ask for a new one.' })
    }
    if (share.codeAttempts >= CODE_MAX_ATTEMPTS) {
      return reply.code(429).send({ error: 'too_many_attempts', message: 'Too many wrong codes. Ask for a new one.' })
    }
    const target = auditTarget(item)
    if (!sameHash(sha256(`${share.id}:${parsed.data.code}`), share.codeHash)) {
      const attempts = share.codeAttempts + 1
      const locked = attempts >= CODE_MAX_ATTEMPTS
      await app.prisma.libraryShare.update({ where: { id: share.id }, data: { codeAttempts: { increment: 1 }, ...(locked && { codeHash: null }) } })
      if (locked) {
        await app.audit.append({
          timestamp: new Date().toISOString(), actorId: 'system:library-share', action: 'library_share_code_locked',
          entityType: target.entityType, entityId: target.entityId,
          details: { libraryItemId: item.id, shareId: share.id, email: share.email, attempts },
          ipAddress: request.ip ?? null,
        })
        return reply.code(429).send({ error: 'too_many_attempts', message: 'Too many wrong codes. Ask for a new one.' })
      }
      return reply.code(400).send({ error: 'wrong_code', message: 'That code is not right.', attemptsLeft: CODE_MAX_ATTEMPTS - attempts })
    }
    const session = newToken()
    const sessionExpiresAt = new Date(Math.min(Date.now() + SESSION_HOURS * 3_600_000, share.expiresAt.getTime()))
    await app.prisma.libraryShare.update({
      where: { id: share.id },
      data: { codeHash: null, codeExpiresAt: null, codeAttempts: 0, sessionHash: sha256(session), sessionExpiresAt, lastOpenedAt: new Date() },
    })
    await app.audit.append({
      timestamp: new Date().toISOString(), actorId: 'system:library-share', action: 'library_share_opened',
      entityType: target.entityType, entityId: target.entityId,
      details: { libraryItemId: item.id, shareId: share.id, email: share.email, sharedBy: share.sharedBy },
      ipAddress: request.ip ?? null,
    })
    return reply.send({ session, expiresAt: sessionExpiresAt.toISOString() })
  })

  // The document, for reading in the browser. Needs the session from /verify for this very link.
  app.get('/:token/pdf', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const loaded = await loadShare(app, (request.params as { token: string }).token, reply)
    if (!loaded) return
    const { share, item } = loaded
    const session = request.headers['x-share-session']
    const ok = typeof session === 'string' && session.length >= 30 && share.sessionHash && share.sessionExpiresAt
      && share.sessionExpiresAt.getTime() > Date.now() && sameHash(sha256(session), share.sessionHash)
    if (!ok) return reply.code(401).send({ error: 'code_required', message: 'Enter the code from your email to read this document.' })
    const pdf = await libraryItemPdf(app, item)
    if (!pdf.ok) return reply.code(pdf.code).send({ error: pdf.error, message: pdf.message })
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${pdf.fileName}"`)
      .header('Content-Length', String(pdf.body.length))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'no-store, private')
      .send(pdf.body)
  })
}

// --------------------------------------------------------------------------------------------------------------
// Emails
// --------------------------------------------------------------------------------------------------------------

function invitationEmail(p: { to: string; sharerName: string; title: string; version: string; link: string; expiresAt: Date }) {
  const until = p.expiresAt.toUTCString().replace(/ GMT$/, ' UTC')
  const text = [
    `${p.sharerName} shared the document "${p.title}" (${p.version}) with you on ClinWrite.`,
    '',
    `Open it here: ${p.link}`,
    '',
    'For your security, when you open the link we will email a one-time code to this address. The document opens after you enter it.',
    'The link works only for you: please do not forward it — anyone you forward it to cannot get the code.',
    `The link works until ${until}.`,
  ].join('\n')
  const html = `<p>${escapeHtml(p.sharerName)} shared the document <strong>${escapeHtml(p.title)}</strong> (${escapeHtml(p.version)}) with you on ClinWrite.</p>
<p><a href="${escapeHtml(p.link)}">Open the document</a></p>
<p>For your security, when you open the link we will email a one-time code to this address. The document opens after you enter it.
The link works only for you: please do not forward it — anyone you forward it to cannot get the code.</p>
<p>The link works until ${escapeHtml(until)}.</p>`
  return { to: p.to, subject: `${p.sharerName} shared "${p.title}" with you`, text, html }
}

function codeEmail(p: { to: string; title: string; code: string }) {
  const text = [
    `Your code to open "${p.title}" on ClinWrite is: ${p.code}`,
    '',
    `It works for ${CODE_TTL_MINUTES} minutes. If you did not try to open this document, you can ignore this email.`,
  ].join('\n')
  const html = `<p>Your code to open <strong>${escapeHtml(p.title)}</strong> on ClinWrite is:</p>
<p style="font-size:24px;font-weight:bold;letter-spacing:4px">${p.code}</p>
<p>It works for ${CODE_TTL_MINUTES} minutes. If you did not try to open this document, you can ignore this email.</p>`
  return { to: p.to, subject: `Your code: ${p.code}`, text, html }
}
