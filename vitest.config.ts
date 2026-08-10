import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['core/**/*.test.ts', 'db/**/*.unit.test.ts'],
  },
})
