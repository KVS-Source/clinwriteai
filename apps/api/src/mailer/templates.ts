// Email body templates for the password-auth flow (Phase A, 2026-11-02).
//
// Plain templating — no handlebars / mjml. Each template returns a text
// body + an HTML body. HTML is minimal (inline styles, table-less) so
// Gmail / Outlook render it without rewriting. If / when we move to a
// richer template system (mjml), these become the input, not the surface.

import type { MailMessage } from './mailer.js'

interface PasswordResetParams {
  recipientEmail: string
  recipientName:  string
  resetUrl:       string
  ttlMinutes:     number
}

export function passwordResetEmail(p: PasswordResetParams): MailMessage {
  const subject = 'Reset your ClinWrite.AI password'
  const text = [
    `Hello ${p.recipientName},`,
    '',
    'A password reset was requested for your ClinWrite.AI account.',
    `If this was you, open the link below within ${p.ttlMinutes} minutes:`,
    '',
    p.resetUrl,
    '',
    "If you didn't request this, you can safely ignore this email — no change has been made to your account.",
    '',
    'ClinWrite.AI · Protected by 21 CFR Part 11 compliant authentication',
  ].join('\n')
  const html = baseHtml(
    'Reset your password',
    `
      <p>Hello ${esc(p.recipientName)},</p>
      <p>A password reset was requested for your ClinWrite.AI account.
         If this was you, open the link below within ${p.ttlMinutes} minutes:</p>
      ${ctaButton(p.resetUrl, 'Reset password')}
      <p style="color:#64748B;font-size:13px;line-height:1.6">
        If you didn't request this, you can safely ignore this email —
        no change has been made to your account.
      </p>
    `,
  )
  return { to: p.recipientEmail, subject, text, html }
}

interface TempPasswordParams {
  recipientEmail: string
  recipientName:  string
  tempPassword:   string
  signInUrl:      string
}

export function tempPasswordEmail(p: TempPasswordParams): MailMessage {
  const subject = 'Your ClinWrite.AI temporary password'
  const text = [
    `Hello ${p.recipientName},`,
    '',
    'ClinWrite.AI now uses passwords for sign-in. A temporary password has been set for your account:',
    '',
    `    ${p.tempPassword}`,
    '',
    `Sign in at ${p.signInUrl} and you will be asked to set a password of your own on first sign-in.`,
    '',
    'For your security, this temporary password:',
    '  • is single-use (once you set your own, it stops working),',
    '  • is not stored in cleartext anywhere, and',
    '  • cannot be recovered if lost — contact your administrator for a replacement.',
    '',
    'ClinWrite.AI · Protected by 21 CFR Part 11 compliant authentication',
  ].join('\n')
  const html = baseHtml(
    'Your temporary password',
    `
      <p>Hello ${esc(p.recipientName)},</p>
      <p>ClinWrite.AI now uses passwords for sign-in. A temporary password
         has been set for your account:</p>
      <div style="margin:16px 0;padding:16px;background:#F1F5F9;border:1px solid #E2E8F0;border-radius:8px;font-family:'IBM Plex Mono',Menlo,monospace;font-size:16px;letter-spacing:1px;text-align:center;color:#0F172A;user-select:all;">
        ${esc(p.tempPassword)}
      </div>
      <p>Sign in and you will be asked to set a password of your own on first sign-in.</p>
      ${ctaButton(p.signInUrl, 'Sign in to ClinWrite.AI')}
      <p style="color:#64748B;font-size:13px;line-height:1.6">
        This temporary password is single-use. Once you set your own, it
        stops working. It cannot be recovered if lost — contact your
        administrator for a replacement.
      </p>
    `,
  )
  return { to: p.recipientEmail, subject, text, html }
}

interface InvitationEmailParams {
  recipientEmail: string
  recipientName:  string
  inviterName:    string
  inviterEmail:   string
  tenantName:     string
  roleLabel:      string
  acceptUrl:      string
  expiresAtHuman: string
}

export function invitationEmail(p: InvitationEmailParams): MailMessage {
  const subject = `You've been invited to ClinWrite.AI (${p.tenantName})`
  const text = [
    `Hello ${p.recipientName},`,
    '',
    `${p.inviterName} (${p.inviterEmail}) has invited you to join ${p.tenantName} on ClinWrite.AI as ${p.roleLabel}.`,
    '',
    `Open the link below to accept — it expires ${p.expiresAtHuman}:`,
    '',
    p.acceptUrl,
    '',
    'ClinWrite.AI · Protected by 21 CFR Part 11 compliant authentication',
  ].join('\n')
  const html = baseHtml(
    `You've been invited to ${esc(p.tenantName)}`,
    `
      <p>Hello ${esc(p.recipientName)},</p>
      <p><strong>${esc(p.inviterName)}</strong> (${esc(p.inviterEmail)}) has invited you to join
         <strong>${esc(p.tenantName)}</strong> on ClinWrite.AI as <strong>${esc(p.roleLabel)}</strong>.</p>
      ${ctaButton(p.acceptUrl, 'Accept invitation')}
      <p style="color:#64748B;font-size:13px;line-height:1.6">
        This link expires ${esc(p.expiresAtHuman)}.
      </p>
    `,
  )
  return { to: p.recipientEmail, subject, text, html }
}

// ────────────────────────────────────────────────────────────────────────
// Shared HTML scaffolding — brand bar, body, compliance footer.

function baseHtml(headline: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(headline)}</title>
</head>
<body style="margin:0;padding:0;background:#E8ECF1;font-family:'Plus Jakarta Sans','Segoe UI',Helvetica,Arial,sans-serif;color:#0F172A">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px">
    <div style="background:#1A3C5E;border-radius:12px 12px 0 0;padding:16px 24px;display:flex;align-items:center;gap:12px;color:#fff">
      <div style="width:32px;height:32px;border-radius:8px;background:#fff;color:#1A3C5E;display:inline-flex;align-items:center;justify-content:center;font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:14px">C</div>
      <div>
        <div style="font-size:16px;font-weight:700;line-height:1.2">ClinWrite.AI</div>
        <div style="font-size:11px;opacity:.75">AI-Native Authoring for Life Sciences</div>
      </div>
    </div>
    <div style="background:#fff;border:1px solid #E2E8F0;border-top:0;border-radius:0 0 12px 12px;padding:28px 24px;font-size:14px;line-height:1.6;color:#0F172A">
      <h1 style="margin:0 0 16px 0;font-size:18px;font-weight:700;color:#0F172A">${esc(headline)}</h1>
      ${bodyHtml}
    </div>
    <p style="margin:16px 0 0 0;font-family:'IBM Plex Mono',Menlo,monospace;font-size:11px;color:#94A3B8;text-align:center">
      Protected by 21 CFR Part 11 compliant authentication
    </p>
  </div>
</body>
</html>`
}

function ctaButton(href: string, label: string): string {
  return `<p style="margin:20px 0">
    <a href="${esc(href)}"
       style="display:inline-block;background:#1A3C5E;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">
      ${esc(label)}
    </a>
  </p>
  <p style="color:#64748B;font-size:12px;line-height:1.6;word-break:break-all">
    Or paste this link into your browser:<br>
    <a href="${esc(href)}" style="color:#1A3C5E">${esc(href)}</a>
  </p>`
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    c === '&' ? '&amp;' :
    c === '<' ? '&lt;' :
    c === '>' ? '&gt;' :
    c === '"' ? '&quot;' :
                '&#39;'
  ))
}
