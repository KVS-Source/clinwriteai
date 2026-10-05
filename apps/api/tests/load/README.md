# Load tests — k6

Phase 6 load testing targets the SLOs defined in
`docs/launch/slo.md`. Three scenarios:

- `smoke.js` — 1 VU, 30s. Sanity check that the harness talks to the API
  and the k6-metrics format is consumable. Runs in CI on every PR.
- `baseline.js` — 50 VU ramp over 2m, hold 3m, ramp down 1m. Validates
  p95 ≤500ms under moderate load. Runs nightly against demo.
- `peak.js` — 500 VU ramp over 10m, hold 20m, ramp down 5m. Validates
  the plan's "500 concurrent authors" scale target. Runs quarterly or
  before major release.

Each scenario emits `k6-report.json` + `summary.txt`. CI uploads both as
artifacts; peak runs also push histograms into Prometheus via
remote-write for the Grafana dashboard.

## Running locally

```bash
# Smoke
cd apps/api
E2E_BASE_URL=http://localhost:3101 k6 run tests/load/smoke.js

# Baseline against staging
E2E_BASE_URL=https://api.clinwrite.ai k6 run tests/load/baseline.js
```

## Thresholds

k6 fails the run (exits non-zero) when thresholds break. SLO docs are the
contract; thresholds in the scripts implement them.

| Metric | SLO | k6 threshold |
|---|---|---|
| HTTP p95 | ≤500 ms | `http_req_duration{expected_response:true}` p(95) < 500 |
| HTTP p99 | ≤1500 ms | p(99) < 1500 |
| Error rate | ≤0.1% | `http_req_failed` rate < 0.001 |
| Throughput floor | ≥20 req/s (baseline) | `http_reqs` rate > 20 |
