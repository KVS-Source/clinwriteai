// Peak scenario — 500 VU, the plan's scale target ("500 concurrent authors").
// Run quarterly or before major releases. Needs horizontal scale on the API
// tier; expect to pre-stage a scaled-up VPS or AWS variant before kicking off.

import { sleep } from 'k6'
import { login, listRoutes } from './helpers.js'

export const options = {
  stages: [
    { duration: '10m', target: 500 },   // ramp — slow enough to avoid
                                        // triggering rate limits early
    { duration: '20m', target: 500 },   // steady state
    { duration: '5m',  target: 0 },     // ramp down
  ],
  thresholds: {
    // Peak thresholds are looser than baseline — we're validating "the
    // system doesn't fall over", not "cold-start latency is the same".
    checks: ['rate>0.99'],
    http_req_failed: ['rate<0.005'],
    http_req_duration: ['p(95)<1500', 'p(99)<3500'],
  },
}

export default function () {
  const jar = login()
  // Mimic a writer's session: hit routes, think, come back.
  for (let i = 0; i < 5; i++) {
    listRoutes(jar)
    sleep(1 + Math.random() * 3)      // 1-4s of "think time" per iteration
  }
}
