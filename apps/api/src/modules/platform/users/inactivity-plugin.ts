// Inactivity scheduler — runs the inactivity sweep (inactivity.ts) hourly in
// the API process, where the audit chain and notification service live, and
// tears the timer down on `onClose` so dev `--watch` restarts don't leak it.
//
// The sweep is safe to repeat (one warning per inactive spell; only 'active'
// accounts are suspended), so an hourly tick just means a warning or
// suspension lands within the hour it becomes due. First run 60s after boot.
// On in production (INACTIVITY_SWEEP=off turns it off). Off everywhere else —
// dev and demo share a database, and the sweep sends real emails and suspends
// real accounts — unless INACTIVITY_SWEEP=on.

import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { runInactivitySweep } from './inactivity.js'

const TICK_MS = 60 * 60 * 1000
const FIRST_RUN_MS = 60 * 1000

const inactivityPlugin: FastifyPluginAsync = async (app) => {
  const flag = process.env.INACTIVITY_SWEEP
  const enabled = app.env.NODE_ENV === 'production' ? flag !== 'off' : flag === 'on'
  if (!enabled) {
    app.log.info('inactivity sweep off (set INACTIVITY_SWEEP=on outside production to run it)')
    return
  }

  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const r = await runInactivitySweep({ prisma: app.prisma, audit: app.audit, notifications: app.notifications })
      if (r.warned.length || r.suspended.length) app.log.info({ warned: r.warned.length, suspended: r.suspended.length }, 'inactivity sweep')
    } catch (err) {
      app.log.error({ err }, 'inactivity sweep failed; will retry next tick')
    } finally {
      running = false
    }
  }

  const first = setTimeout(() => void tick(), FIRST_RUN_MS)
  const timer = setInterval(() => void tick(), TICK_MS)
  // Don't hold the process open for these (the timer type differs between DOM and Node typings).
  for (const t of [first, timer]) (t as unknown as { unref?: () => void }).unref?.()
  app.addHook('onClose', async () => { clearTimeout(first); clearInterval(timer) })
}

export default fp(inactivityPlugin, {
  name: 'inactivity-scheduler',
  dependencies: ['prisma', 'audit'],
})
