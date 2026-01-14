import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'packages/*/src/**/*.ts',
        'apps/*/src/**/*.ts',
      ],
      exclude: [
        'node_modules/**',
        '**/dist/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/coverage/**',
        '**/__tests__/**',
        '**/test/**',
        'apps/frontend/**', // Frontend needs different testing setup
        'packages/shared/src/types.ts', // Pure TypeScript interfaces, no executable code
      ],
    },
    // Set test timeout for async operations
    testTimeout: 10000,
  },
})
