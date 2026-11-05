import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    // Node by default; a client spec opts into a DOM with its `@vitest-environment` docblock.
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/client/locales.ts'],
      reporter: ['text', 'lcov'],
    },
  },
})
