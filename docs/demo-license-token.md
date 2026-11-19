# Demo licence token — GenBioCa Demo install

Pre-minted signed JWT for the demo deployment, so IT admin can paste it
on **Settings → Licensing** and exercise the real token-import flow
instead of relying on the auto-demo-mode fallback.

## When you need this

- You want the Licensing tab to show **Active** (green), not **Demo mode** (blue).
- You want to test the real import / verify flow end-to-end on demo.
- You want the demo install's state to look the same as a production customer's.

## When you don't need this

- The demo auto-enables all modules even without a token, because
  `LICENSE_PUBLIC_KEY` is not set on the demo env (the server falls back
  to the embedded dev public key and treats the install as demo /
  staging). See the WARN line `No licence imported and dev public key in
  use — auto-enabling all modules.` in the API boot log.

## The token

Valid for 1 year from the mint time below. Signed with the dev private
key bundled in [apps/api/src/modules/platform/licensing/keys.ts](../apps/api/src/modules/platform/licensing/keys.ts).

```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJnZW5iaW9jYS1saWNlbnNpbmciLCJpYXQiOjE3OTUwNjkyNTIsImV4cCI6MTgyNjYwNTI1MiwiaW5zdGFsbElkIjoiZ2VuYmlvY2EtZGVtby1jbGlud3JpdGUiLCJjdXN0b21lck5hbWUiOiJHZW5CaW9DYSBEZW1vIiwibW9kdWxlcyI6WyJBIiwiQiIsIkMiLCJEIiwiRSJdLCJmZWF0dXJlcyI6WyJhaV9kcmFmdGVyIiwicGFydDExX2VzaWciLCJzZWN0aW9uX3RlbXBsYXRlX2V4dHJhY3QiXSwibWF4VXNlcnMiOjEwMCwiY29udGFjdCI6ImRlbW9AZ2VuYmlvY2EuY29tIn0.Uea8zk0UB6jq-eK-tAQRAwx7N_G6q8i2zVY2wBRY29UOqfF4mdkuhazmaWWXVe4KMKaxIXSGoHZx-gPezbUdcuORBs8KHFsts0HfXnzFVyKJL04z1RokNoz2WX1G6vW1jGlmFDMTbkmu9fKOZL2Q9TD6ddxMSVKIz20EvIcgqYj05FXEoOAiF6kqlYC0dT6I3q9H9mqsQ4LlJ4_n17Z6HL_DD0-A6zQbkPiN4NAVguQylC9QJMaddzmqsOdh8ud_w9zLabzNIm6hPlpfbQdmuHR8jiHs3yMUWXdzPJmAnKgdIwwwKQFoXvFapjb4AsEem_IYZR0F0QCuyWjSJa1Rag
```

### Decoded payload

```json
{
  "iss":          "genbioca-licensing",
  "iat":          1795069252,
  "exp":          1826605252,
  "installId":    "genbioca-demo-clinwrite",
  "customerName": "GenBioCa Demo",
  "modules":      ["A", "B", "C", "D", "E"],
  "features":     ["ai_drafter", "part11_esig", "section_template_extract"],
  "maxUsers":     100,
  "contact":      "demo@genbioca.com"
}
```

## How to apply

1. Sign in to the demo as any user with role `admin`.
2. **Sidebar → Settings → Licensing** tab.
3. Paste the token from the fenced block above into the textarea.
4. Click **Import licence**. Status chip should flip to **Active** with
   the GenBioCa Demo customer name + 365-day expiry countdown.

## How to mint a new one (fresh expiry, different modules, etc.)

Reusable CLI at [apps/api/scripts/mint-license-token.ts](../apps/api/scripts/mint-license-token.ts):

```bash
npx tsx apps/api/scripts/mint-license-token.ts \
  --install   genbioca-demo-clinwrite \
  --customer  "GenBioCa Demo" \
  --modules   A,B,C,D,E \
  --features  ai_drafter,part11_esig,section_template_extract \
  --days      365 \
  --max-users 100 \
  --contact   demo@genbioca.com
```

The token is written to stdout; everything else (payload summary) goes
to stderr so you can `>> token.txt` cleanly.

## Security notes

- This token is signed by the **dev** private key, which lives in the
  repo and is therefore public. Anyone who clones ClinWrite can mint
  tokens that verify against the embedded dev public key.
- That's safe on dev / staging installs because they also use the dev
  public key.
- **Production installs MUST set `LICENSE_PUBLIC_KEY` to GenBioCa's real
  public key**, at which point tokens signed by the dev private key
  stop verifying. GenBioCa HQ signs real customer tokens with a
  private key that never leaves their infrastructure.
- Never paste this token into any environment that has
  `LICENSE_PUBLIC_KEY` set to a non-dev key — it will fail verification
  with `invalid_signature`.
