import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*": ["./*"] — tsc resolves it for typecheck,
    // but Vitest needs its own alias to resolve it at test-run time.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    include: ['db/**/*.db.test.ts'],
    setupFiles: ['db/test/env.ts'],
    // Los tests comparten una base. Aislan por temporada, no por proceso.
    fileParallelism: false,
    testTimeout: 30_000,
  },
})
