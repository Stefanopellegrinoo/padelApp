import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*": ["./*"] — tsc resolves it for typecheck,
    // but Vitest needs its own alias to resolve it at test-run time.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    include: ['core/**/*.test.ts', 'db/**/*.unit.test.ts', 'app/**/*.unit.test.ts'],
  },
})
