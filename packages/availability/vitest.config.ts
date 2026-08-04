import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./test/pgserver.ts'],
    // All test files share one ephemeral Postgres; run them sequentially so
    // capacity/concurrency assertions never see another file's writes.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
})
