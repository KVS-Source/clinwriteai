// Inactivity scheduler — runs the inactivity sweep (inactivity.ts) in the API
// process, where the audit chain and notification service live, and tears the
// timer down on `onClose` so dev `--watch` restarts don't leak it.
//
// The sweep is safe to repeat (one warning per inactive spell; only 'active'
// accounts are suspended). It ticks hourly, or every minute when the
// suspension time is under a day (e.g. INACTIVITY_SUSPEND_MINUTES=15 for
// testing), so a warning or suspension lands within one tick of being due.
// First run 60s after boot.
// On in production (INACTIVITY_SWEEP=off turns it off). Off everywhere else —
// dev and demo share a database, and the sweep sends real emails and suspends
// real accounts — unless INACTIVITY_SWEEP=on.

import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { inactivityConfigFromEnv, runInactivitySweep } from './inactivity.js'

const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const FIRST_RUN_MS = 60 * 1000

const inactivityPlugin: FastifyPluginAsync = async (app) => {
  const flag = process.env.INACTIVITY_SWEEP
  const enabled = app.env.NODE_ENV === 'production' ? flag !== 'off' : flag === 'on'
  if (!enabled) {
    app.log.info('inactivity sweep off (set INACTIVITY_SWEEP=on outside production to run it)')
    return
  }
  const config = inactivityConfigFromEnv()
  const tickMs = config.suspendAfterMs < 24 * HOUR_MS ? MINUTE_MS : HOUR_MS
  app.log.info({ warningAfterMinutes: config.warningAfterMs / MINUTE_MS, suspendAfterMinutes: config.suspendAfterMs / MINUTE_MS, tickMs }, 'inactivity sweep on')

  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const r = await runInactivitySweep({ prisma: app.prisma, audit: app.audit, notifications: app.notifications }, new Date(), config)
      if (r.warned.length || r.suspended.length) app.log.info({ warned: r.warned.length, suspended: r.suspended.length }, 'inactivity sweep')
    } catch (err) {
      app.log.error({ err }, 'inactivity sweep failed; will retry next tick')
    } finally {
      running = false
    }
  }

  const first = setTimeout(() => void tick(), FIRST_RUN_MS)
  const timer = setInterval(() => void tick(), tickMs)
  // Don't hold the process open for these (the timer type differs between DOM and Node typings).
  for (const t of [first, timer]) (t as unknown as { unref?: () => void }).unref?.()
  app.addHook('onClose', async () => { clearTimeout(first); clearInterval(timer) })
}

export default fp(inactivityPlugin, {
  name: 'inactivity-scheduler',
  dependencies: ['prisma', 'audit'],
})
