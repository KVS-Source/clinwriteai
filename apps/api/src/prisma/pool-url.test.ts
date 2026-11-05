// Pool settings added to DATABASE_URL: a bounded pool outside production, a name per process,
// and nothing the URL itself already says is overridden.

import { describe, expect, it } from 'vitest'
import { withPoolSettings } from './pool-url.js'

const BASE = 'postgresql://user:p%40ss@db.example:15432/platform?schema=public&sslmode=disable'
const params = (url: string) => new URL(url).searchParams
const opts = (env: NodeJS.ProcessEnv) => ({ app: 'clinwrite-api', devLimit: 5, env, host: 'dev-laptop' })

describe('withPoolSettings', () => {
  it('outside production: limits the pool to the dev default and names the connection', () => {
    const p = params(withPoolSettings(BASE, opts({ NODE_ENV: 'development' })))
    expect(p.get('connection_limit')).toBe('5')
    expect(p.get('application_name')).toBe('clinwrite-api@dev-laptop')
  })

  it('keeps everything else in the URL as it was (credentials, schema, sslmode)', () => {
    const out = new URL(withPoolSettings(BASE, opts({ NODE_ENV: 'development' })))
    expect(`${out.username}:${out.password}@${out.host}${out.pathname}`).toBe('user:p%40ss@db.example:15432/platform')
    expect(out.searchParams.get('schema')).toBe('public')
    expect(out.searchParams.get('sslmode')).toBe('disable')
  })

  it('a connection_limit / application_name already in the URL wins', () => {
    const p = params(withPoolSettings(`${BASE}&connection_limit=2&application_name=mine`, opts({ NODE_ENV: 'development', DB_CONNECTION_LIMIT: '9' })))
    expect(p.get('connection_limit')).toBe('2')
    expect(p.get('application_name')).toBe('mine')
  })

  it('DB_CONNECTION_LIMIT sets the size, in any environment', () => {
    expect(params(withPoolSettings(BASE, opts({ NODE_ENV: 'development', DB_CONNECTION_LIMIT: '8' }))).get('connection_limit')).toBe('8')
    expect(params(withPoolSettings(BASE, opts({ NODE_ENV: 'production', DB_CONNECTION_LIMIT: '20' }))).get('connection_limit')).toBe('20')
  })

  it('production keeps Prisma’s default unless DB_CONNECTION_LIMIT is set', () => {
    expect(params(withPoolSettings(BASE, opts({ NODE_ENV: 'production' }))).has('connection_limit')).toBe(false)
  })

  it.each(['0', '-3', 'abc', '2.5'])('an invalid DB_CONNECTION_LIMIT (%s) falls back to the default', (v) => {
    expect(params(withPoolSettings(BASE, opts({ NODE_ENV: 'development', DB_CONNECTION_LIMIT: v }))).get('connection_limit')).toBe('5')
  })

  it('keeps the name within Postgres’s 63 characters and to safe characters', () => {
    const name = params(withPoolSettings(BASE, { app: 'clinwrite-api', devLimit: 5, env: {}, host: 'Ädars laptop (home)'.repeat(5) })).get('application_name')!
    expect(name.length).toBeLessThanOrEqual(63)
    expect(name).toMatch(/^clinwrite-api@[A-Za-z0-9._-]+$/)
  })

  it('an unparseable URL is passed through for Prisma to report', () => {
    expect(withPoolSettings('not a url', opts({}))).toBe('not a url')
  })
})
