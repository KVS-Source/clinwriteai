// Smoke scenario — 1 VU, 30 s. Keeps the k6 harness honest in CI.

import { sleep } from 'k6'
import { login, listRoutes } from './helpers.js'

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    checks: ['rate==1.0'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
  },
}

export default function () {
  const jar = login()
  listRoutes(jar)
  sleep(1)
}
