# Status page — Arc 12.2

Public-facing status page for clinwrite.ai customers. Decision + wiring
pending; this file documents the choice matrix + the integration
points we've already got.

## Options

| Provider | Hosted | Self-hosted | Monthly cost | Notes |
|----------|--------|-------------|--------------|-------|
| **Statuspage.io** (Atlassian) | ✓ | — | $29+ | Industry default. Pre-wired integrations with PagerDuty + Alertmanager. |
| **StatusGator** | ✓ | — | $35+ | Lighter. Nice branding. |
| **Instatus** | ✓ | — | $20+ | Cheaper, modern UI. Good for small teams. |
| **Cachet** | — | ✓ | self-host cost | Open-source. Full control, adds ops burden. |
| **Upptime** | — | ✓ (GitHub Pages) | free | Static site + GitHub Actions probing. Zero infra. Low feature count. |

Recommended default: **Instatus** or **Upptime** for cost; **Statuspage.io** if a reference customer requires the Atlassian ecosystem.

## Integration points already in place

- Prometheus `up{job="platform-api"}` gauge — scrape by the status page's probing agent OR trigger an incident webhook from Alertmanager.
- `/health` endpoint returns 200 when the API binds its port + the DB is reachable (depends on `platform-data.target`).
- Alertmanager (see `../alertmanager/alertmanager.yml`) can POST to a status-page incident webhook on Sev1/Sev2 firing/resolved — add a receiver block when the provider is picked.

## When the provider is picked

1. Add the webhook URL to `alertmanager.yml` as a new receiver + route Sev1/Sev2 → both PagerDuty AND status-page.
2. Add a `statuspage_api_key` secret via sops.
3. Configure the probing endpoints on the status page: `/health` (API), `demo.clinwrite.ai/` (web), nginx TLS cert expiry.
4. Publish the subdomain `status.clinwrite.ai` → CNAME to the provider.
5. Add a "Report a problem" link from the demo app footer that opens the status page.

## Related

- Alertmanager config: `../alertmanager/alertmanager.yml`
- Incident response runbook: `docs/compliance/runbooks/incident-response.md`
- SLOs: `docs/sre/slos.md`
