import { defineConfig } from 'vitest/config';

// `make live NN` sets LIVE=1. Without it, live tests are skipped (see src/testing.ts).
export default defineConfig({
  test: {
    include: ['missions/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 30_000,
  },
});
