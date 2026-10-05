// Baseline scenario — 50 VU, validates the p95 ≤ 500 ms SLO under moderate
// load. Target: nightly cron against QA.

import { sleep } from 'k6'
import { login, listRoutes } from './helpers.js'

export const options = {
  stages: [
    { duration: '2m', target: 50 },     // ramp up
    { duration: '3m', target: 50 },     // steady state
    { duration: '1m', target: 0 },      // ramp down
  ],
  thresholds: {
    checks: ['rate>0.995'],
    http_req_failed: ['rate<0.001'],
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    http_reqs: ['rate>20'],
  },
}

export default function () {
  const jar = login()
  // Hit the auth + list surface 3 times per VU iteration to amplify
  // throughput without over-authenticating.
  for (let i = 0; i < 3; i++) {
    listRoutes(jar)
    sleep(Math.random() * 0.5)
  }
}
