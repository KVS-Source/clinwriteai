# Manual VPS deploy — one-shot for a fresh/shared box

Use this when the GitHub Actions auto-deploy isn't working (SSH key not
set up yet, etc). SSH to the VPS as a sudo-capable user (root or
anything with `sudo`) and run:

```bash
curl -fsSL https://raw.githubusercontent.com/KVS-Source/clinwriteai/main/infra/standalone/scripts/first-run-bootstrap.sh \
  | sudo bash
```

That installs apt prereqs, docker, node 20, nginx, certbot; creates the
`/opt/platform/*` layout; git-clones the repo; generates `api.env` with
random secrets; installs our nginx config + systemd units; brings up
Postgres + Redis via docker compose; opens firewall for 80/443. Takes
about 3–5 min on a fresh VPS, ~1 sec on a re-run.

Then build + migrate + seed + start the API:

```bash
sudo /opt/platform/repo/infra/standalone/scripts/deploy.sh
```

That also runs the Let's Encrypt cert issuance on first invocation
(adds both `demo.clinwrite.ai` and `api.clinwrite.ai` to one SAN cert).
If the cert step completes but you want to re-run it independently:

```bash
sudo /opt/platform/repo/infra/standalone/scripts/setup-letsencrypt.sh
```

## Verify

```bash
# Both should return 200
curl -sI https://demo.clinwrite.ai/ | head -1
curl -sI https://api.clinwrite.ai/health | head -1

# Our cert now covers api.clinwrite.ai
echo | openssl s_client -servername api.clinwrite.ai -connect api.clinwrite.ai:443 2>/dev/null \
  | openssl x509 -noout -subject -ext subjectAltName \
  | grep -E "subject|DNS:"
```

## Shared VPS caveats

This VPS also hosts moringa-ai's B2B backend. Our setup is deliberately
sandbox-safe:
- All our files live under `/opt/platform/*`, `/var/www/platform/`,
  `/var/www/acme/`.
- Our nginx snippets are prefixed `platform-*.conf` under
  `/etc/nginx/snippets/` so they can't collide with moringa's.
- Our site config at `/etc/nginx/sites-available/platform` only matches
  `server_name demo.clinwrite.ai api.clinwrite.ai` — moringa's config
  continues to serve its own hostnames.
- Our Postgres + Redis run in Docker on their own ports/volumes under
  `/opt/platform/data/*`.
- Our Let's Encrypt cert is a separate `demo.clinwrite.ai` lineage —
  moringa's existing certs for their domains are untouched.

The first `nginx -t && systemctl reload nginx` after bootstrap will
either succeed (both projects coexisting) or fail with a conflict error
that points to the clashing directive. If it fails, read the error +
tell me — the fix is usually renaming our server block or removing a
duplicate directive.

## When the auto-deploy pipeline is also fixed

Running the manual commands above once makes subsequent GitHub Actions
auto-deploys idempotent. The deploy workflow will go through the same
first-run-bootstrap.sh (short-circuits in ~1 sec since already set up)
and then deploy.sh (git pull → build → migrate → restart) on every
push to main.
