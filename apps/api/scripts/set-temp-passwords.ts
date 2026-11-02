// One-shot — give users a temporary password so they can sign in with
// password login (Phase A) and be made to choose their own on first login.
//
// Sets password_hash to a fresh random temp password and
// must_change_password=true. The SPA sends anyone who signs in with
// must_change_password=true to /set-password before anything else, and
// POST /auth/change-password clears the flag.
//
// Usage (from the repo root, with the API's env loaded):
//   npm --workspace=apps/api run auth:set-temp-passwords -- --dry-run --all
//   npm --workspace=apps/api run auth:set-temp-passwords -- a@x.com b@y.com
//   npm --workspace=apps/api run auth:set-temp-passwords -- --all
//
//   <emails>    only these users
//   --all       every active user who has no password yet
//   --force     also reset users who already have a password
//   --dry-run   list who would be changed; write nothing
//
// Prints email → temp password once; hand each one to its owner privately.
// Only active users are touched (invited / suspended rows are skipped).
// Like the other scripts here it does not append to the hash-chained audit
// log (only the API process holds the chain secret) — the printed list is
// the record of what changed.

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { generateTempPassword, hashPassword } from '../src/auth/password.js'

const prisma = new PrismaClient()

async function main() {
  const args   = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const all    = args.includes('--all')
  const force  = args.includes('--force')
  const emails = args.filter(a => !a.startsWith('--')).map(e => e.trim().toLowerCase())

  if (!all && emails.length === 0) {
    console.log('Nothing to do. Pass one or more emails, or --all. Add --dry-run to preview.')
    process.exitCode = 1
    return
  }

  const users = await prisma.user.findMany({
    where: all ? {} : { email: { in: emails, mode: 'insensitive' } },
    select: { id: true, email: true, name: true, status: true, passwordHash: true },
    orderBy: { email: 'asc' },
  })

  const missing = emails.filter(e => !users.some(u => u.email.toLowerCase() === e))
  for (const e of missing) console.log(`skip  ${e} — no such user`)

  const targets = users.filter(u => {
    if (u.status !== 'active') { console.log(`skip  ${u.email} — status is ${u.status}`); return false }
    if (u.passwordHash && !force) { console.log(`skip  ${u.email} — already has a password (use --force to reset)`); return false }
    return true
  })

  if (targets.length === 0) { console.log('\nNo users to update.'); return }

  if (dryRun) {
    console.log(`\nDry run — would set a temporary password for ${targets.length} user(s):`)
    for (const u of targets) console.log(`  ${u.email}  (${u.name})`)
    return
  }

  const issued: Array<{ email: string; name: string; password: string }> = []
  for (const u of targets) {
    const password = generateTempPassword()
    await prisma.user.update({
      where:  { id: u.id },
      data:   {
        passwordHash:           await hashPassword(password),
        mustChangePassword:     true,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
      select: { id: true },
    })
    issued.push({ email: u.email, name: u.name, password })
  }

  console.log(`\nTemporary passwords set for ${issued.length} user(s). Each must choose a new one at first sign-in:\n`)
  const width = Math.max(...issued.map(i => i.email.length))
  for (const i of issued) console.log(`  ${i.email.padEnd(width)}  ${i.password}   (${i.name})`)
  console.log('\nThese are shown once — share each privately with its owner.')
}

main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
