import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['db/**/*.db.test.ts'],
    setupFiles: ['db/test/env.ts'],
    // Los tests comparten una base. Aislan por temporada, no por proceso.
    fileParallelism: false,
    testTimeout: 30_000,
  },
})
