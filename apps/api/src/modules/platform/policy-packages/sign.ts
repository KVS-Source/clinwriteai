// Signing a policy package (docs/policy-packages.md). The app itself only verifies packages; this is what GenBioCa's
// license generator does to make one, kept here so the format has one definition, tests can sign packages, and
// scripts/sign-policy-package.ts can sign with the development key for local and demo testing.

import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { EXPECTED_ISSUER } from '../licensing/keys.js'
import { parseBuildPlan } from './build-plan.js'
import { PACKAGE_FORMAT_VERSION, PACKAGE_TYPE } from './package.js'

/** package.json of a policy package folder: what it is, who may import it, and the files it carries. */
export interface PackageManifest {
  packageId:      string
  packageVersion: number
  description?:   string
  audience:       { installIds: string[] }
  /** Per document type, the content files, relative to the manifest. */
  contents:       Array<{ docType: string; buildPlan?: string }>
}

/** The signed payload for a manifest, with its files read in and each build plan checked. */
export function packagePayload(manifestPath: string, now = Math.floor(Date.now() / 1000)): Record<string, unknown> {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
  const dir = dirname(manifestPath)
  const contents = manifest.contents.map(c => {
    const out: Record<string, unknown> = { docType: c.docType }
    if (c.buildPlan) {
      const plan = JSON.parse(readFileSync(resolve(dir, c.buildPlan), 'utf8')) as unknown
      const checked = parseBuildPlan(plan)
      if (!checked.ok) throw new Error(`${c.buildPlan}: ${checked.errors.join(' ')}`)
      out.buildPlan = plan
    }
    return out
  })
  return {
    iss:            EXPECTED_ISSUER,
    typ:            PACKAGE_TYPE,
    formatVersion:  PACKAGE_FORMAT_VERSION,
    packageId:      manifest.packageId,
    packageVersion: manifest.packageVersion,
    ...(manifest.description ? { description: manifest.description } : {}),
    iat:            now,
    audience:       manifest.audience,
    contents,
  }
}

/** An RS256 JWT of the payload (the same form as a license key). */
export function signPayload(payload: Record<string, unknown>, privateKeyPem: string): string {
  const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64url')
  const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = b64(JSON.stringify(payload))
  const signer = createSign('sha256')
  signer.update(`${head}.${body}`)
  signer.end()
  return `${head}.${body}.${b64(signer.sign(privateKeyPem))}`
}
