#!/usr/bin/env tsx
// Signs a policy package folder (docs/policy-packages.md) into one .cwplan file for the tenant admin to import under
// Admin → Licensing → Import policy package.
//
// By default it signs with the DEVELOPMENT key in licensing/keys.ts: such a file only imports on installs without
// LICENSE_PUBLIC_KEY set (local, demo). Real packages are signed by GenBioCa's license generator with the
// production key; pass --key <private-key.pem> to sign with another key.
//
// Usage:
//   npx tsx apps/api/scripts/sign-policy-package.ts --manifest policy-packages/protocol-build-plan/package.json \
//     [--out protocol-build-plan-v1.cwplan] [--key path/to/private.pem]

import { readFileSync, writeFileSync } from 'node:fs'
import { DEV_PRIVATE_KEY_PEM } from '../src/modules/platform/licensing/keys.js'
import { packagePayload, signPayload } from '../src/modules/platform/policy-packages/sign.js'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!, process.argv[i + 1] ?? '')

const manifest = args.get('--manifest')
if (!manifest) {
  console.error('Usage: sign-policy-package --manifest <folder>/package.json [--out file.cwplan] [--key private.pem]')
  process.exit(1)
}
const keyPath = args.get('--key')
const payload = packagePayload(manifest)
const token = signPayload(payload, keyPath ? readFileSync(keyPath, 'utf8') : DEV_PRIVATE_KEY_PEM)
const out = args.get('--out') ?? `${String(payload.packageId)}-v${String(payload.packageVersion)}.cwplan`
writeFileSync(out, `${token}\n`)
console.error(`Signed ${String(payload.packageId)} v${String(payload.packageVersion)}${keyPath ? '' : ' with the DEVELOPMENT key'} → ${out}`)
