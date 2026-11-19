// Public-key source for licensing-token verification.
//
// Production: GenBioCa deploys the real public key via the
// `LICENSE_PUBLIC_KEY` env var (PEM; `\n` escape tolerated for .env
// files). Customers cannot swap this at runtime — it's injected by the
// deployment process, not stored in the DB.
//
// Development: a dev keypair is embedded here so the app runs without
// any external token-issuance tooling. A matching dev private key lives
// alongside this file so tests and local dev scripts can mint tokens.
// The dev keys MUST NOT be used in production — if `LICENSE_PUBLIC_KEY`
// is absent, the server logs a prominent warning on boot.

// Dev RSA-2048 keypair, generated specifically for this codebase and
// not used elsewhere. The private key is intentionally bundled so tests
// can sign tokens — this is NOT a key-rotation strategy, just a dev
// convenience. Replace with `LICENSE_PUBLIC_KEY` env var in any
// deployed environment.

export const DEV_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApdDzkjqs/giEVws9KlXD
7rOfHh7e+27g2Z3OZvSKunAQmfXs4A6k6PZa1BCh2kJW7+OtmlqCx+z42C6F0Qvv
N1us8K4sQ5AuPzNRV6hw4gM+WOpfdDZ0CJOwE0+16VRnHNqE+1CXAxcp/S7LHWrA
rIdcf/PINJCnemJidplPLu0M1Jj7e14baQZUvMwQMcRXdKb056eFzZ3zJR21nqAI
Gc5LHZuVFVP4+/yofo6E491DCCsubtjuTUsa+azVRbxu7S40l77LASB62dOqcZ6D
PgNi77lOyTaWBULaVxXC+MdSVPMKM3juKjV7Wr0SZrSK16GJ2X31X8Y4/e1SIpY7
owIDAQAB
-----END PUBLIC KEY-----
`

// DEV ONLY — matches DEV_PUBLIC_KEY_PEM. Used by tests + local token
// minting scripts. Treat as compromised; never ship customer tokens
// signed with this.
export const DEV_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCl0POSOqz+CIRX
Cz0qVcPus58eHt77buDZnc5m9Iq6cBCZ9ezgDqTo9lrUEKHaQlbv462aWoLH7PjY
LoXRC+83W6zwrixDkC4/M1FXqHDiAz5Y6l90NnQIk7ATT7XpVGcc2oT7UJcDFyn9
LssdasCsh1x/88g0kKd6YmJ2mU8u7QzUmPt7XhtpBlS8zBAxxFd0pvTnp4XNnfMl
HbWeoAgZzksdm5UVU/j7/Kh+joTj3UMIKy5u2O5NSxr5rNVFvG7tLjSXvssBIHrZ
06pxnoM+A2LvuU7JNpYFQtpXFcL4x1JU8wozeO4qNXtavRJmtIrXoYnZffVfxjj9
7VIiljujAgMBAAECggEABDQrcKofJ6OUo1ZMGy4odP1Fy/AxbANwHOREztRlTfu4
WAbllfqZELTqMZUoXU2wQY2uoYqo5SOrXWO0jcu1KVygIkvwIFhf68dDySqijgBS
DNQITnxw7aS84ohzTrKOmKsrkumEopXsQRh2Gs1RjC40WKQYD8kZDd+/qk0RtllO
sAGyFpEDxn0tWBfd09bkirjC2bxBLdvoaDpgLLXlB3IAkb42tPOvK2gVwTpAYBuC
77Mf8MAMr8EyVz18bO67tJ4pFJdNeXxKkF21mk3pGeOgk4llRrJMkwLPuMicSwV2
fIiOCut1Cq5+0u1WSYF2vbtVYFZyO7zzrW2ywQSZwQKBgQDdkmW4edqYnveB2V4a
+snP9DkAzKCMLxPDyIpaBYJdSwEn/mEzEGx1EG7MMYO/dWFH06diVi/qcY6ETHd8
jkMC1ODD8if3w7ALHwJVU24HaI6Lw8TbxoRu4N3XwK42JmTUBEfVEg83CtkIGVcZ
uLDHtGU+tb4ToqOrkwxkIssD4wKBgQC/lLoQqL/HlZoPA5lrg8CdSTkYAZaWrxb4
kOseuWJtDB6QoiaDvJTpNlHSi8AuiMWfpoXbD6XxeepVvhtIKngDpzrrj+HZ0ikD
iwLzRslrnAb9DK5zJoHih6NgLM9i+CvfJ0rltRitKcFyfzxWYhfBGr/vqw6awfW6
lKcfWQb1QQKBgQCeDHt6p5ECJQKwIPk7jYC/UZoHs+8hj8MteLMXm65uFb5xZMa4
whJbPqmKBhfQTk5iCdvwDUKInQ/n1xO0SVYLgwYBP4668V91z1y+uJBXwIFNuQuH
KYf1/3i/GbYq8iAiDBuhJQytWpONb2Xt9wxCp69AmCtJnk3ZaT8BfsAJuQKBgDdU
zShilIEgRA5yC61xr/+9VjAIxWVfzFKeCEonYLX9+hXrvxPtM1Tny1nz4t2NwwYJ
Ij/SlSrY+0UoUtjU6zSi5/GA7MnsWMwdKgz5NNNPjPUo5Hl9daXnZtgwGPWMl58r
ygXt9+KLXMOk29hXHGU5RJYD4YPw4PeyV1JGdCwBAoGAOIFWtZFN2MAXX9SBOI/4
B3n1U7NBSiCajCsQA0xOWKTJHX84HwoRIyjYpo+at813tWwvhSdTbxuMas0jEwld
9WtTQARDmV4DabGasXqHF66dHf3GVARjDQEULRz5+MS1z8S19H4h1Co20eK3J2bL
qcsKe/Zx9kkergQ6tL/fonA=
-----END PRIVATE KEY-----
`

/** Returns the public key the verifier should use. Prefers the env var;
 *  falls back to the embedded dev key with a clear log signal. */
export function resolveLicensePublicKey(env: NodeJS.ProcessEnv = process.env): {
  pem: string
  source: 'env' | 'dev_fallback'
} {
  const raw = env.LICENSE_PUBLIC_KEY?.trim()
  if (raw && raw.length > 0) {
    // .env values typically escape newlines as '\n' literals; expand them
    // so `-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----` works.
    const pem = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw
    return { pem, source: 'env' }
  }
  return { pem: DEV_PUBLIC_KEY_PEM, source: 'dev_fallback' }
}

/** Dev-mode flag. When set AND no License row is active, the module
 *  gate treats every module as enabled so local dev isn't blocked by
 *  the lack of a signed token. Never honoured in production deploys. */
export function isLicenseDevMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LICENSE_DEV_MODE === '1'
}

/** The expected issuer claim on GenBioCa-signed tokens. Rejects tokens
 *  signed for a different product even if the signature verifies. */
export const EXPECTED_ISSUER = 'genbioca-licensing'
