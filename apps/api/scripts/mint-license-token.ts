#!/usr/bin/env tsx
// Dev / staging licence-token minter.
//
// Signs a GenBioCa-shaped JWT with the DEV private key bundled in
// apps/api/src/modules/platform/licensing/keys.ts. Tokens signed with
// this key only verify against the matching dev public key — i.e. on
// installs that have NOT set LICENSE_PUBLIC_KEY. In a real production
// deployment GenBioCa HQ signs tokens with their private key (not in
// this repo), and the deployment's LICENSE_PUBLIC_KEY env var carries
// the matching public key.
//
// Usage:
//   npx tsx apps/api/scripts/mint-license-token.ts \
//     --install   genbioca-demo-clinwrite \
//     --customer  "GenBioCa Demo" \
//     --modules   A,B,C,D,E \
//     --days      365
//
// Prints the token to stdout; paste on Settings → Licensing.

import { createSign } from 'node:crypto'
import { DEV_PRIVATE_KEY_PEM, EXPECTED_ISSUER } from '../src/modules/platform/licensing/keys.js'

interface Args {
  install:   string
  customer:  string
  modules:   string[]
  features:  string[]
  days:      number
  maxUsers?: number
  contact?:  string
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { modules: [], features: [] }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) continue
    switch (flag) {
      case '--install':   out.install  = next; i++; break
      case '--customer':  out.customer = next; i++; break
      case '--modules':   out.modules  = next.split(',').map(s => s.trim().toUpperCase()); i++; break
      case '--features':  out.features = next.split(',').map(s => s.trim()); i++; break
      case '--days':      out.days     = Number.parseInt(next, 10); i++; break
      case '--max-users': out.maxUsers = Number.parseInt(next, 10); i++; break
      case '--contact':   out.contact  = next; i++; break
    }
  }
  if (!out.install || !out.customer || !out.modules || out.modules.length === 0) {
    console.error('Usage: mint-license-token --install <id> --customer <name> --modules A,B,C [--features ...] [--days 365] [--max-users 100] [--contact email]')
    process.exit(1)
  }
  return {
    install:  out.install,
    customer: out.customer,
    modules:  out.modules,
    features: out.features ?? [],
    days:     out.days ?? 365,
    maxUsers: out.maxUsers,
    contact:  out.contact,
  }
}

function base64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf) : buf
  return b.toString('base64url')
}

function mint(args: Args): string {
  const now = Math.floor(Date.now() / 1000)
  const payload: Record<string, unknown> = {
    iss:          EXPECTED_ISSUER,
    iat:          now,
    exp:          now + args.days * 24 * 60 * 60,
    installId:    args.install,
    customerName: args.customer,
    modules:      args.modules,
    features:     args.features,
  }
  if (args.maxUsers !== undefined) payload.maxUsers = args.maxUsers
  if (args.contact  !== undefined) payload.contact  = args.contact

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body   = base64url(JSON.stringify(payload))
  const signer = createSign('sha256')
  signer.update(`${header}.${body}`)
  signer.end()
  const sig    = base64url(signer.sign(DEV_PRIVATE_KEY_PEM))
  return `${header}.${body}.${sig}`
}

const args  = parseArgs(process.argv.slice(2))
const token = mint(args)
console.error('--- payload ---')
console.error(JSON.stringify({ ...args, days: undefined, iat: 'now', exp: `now + ${args.days}d` }, null, 2))
console.error('--- token ---')
console.log(token)
