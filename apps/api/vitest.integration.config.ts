import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 60_000,       // Testcontainers Postgres boot can be slow
    hookTimeout: 60_000,
    pool: 'forks',             // one Postgres per test file
    poolOptions: {
      forks: { singleFork: false },
    },
  },
})
