import { defineConfig } from 'vitest/config';

/**
 * Kept separate from vite.config.ts: that file sets `root: 'ui'` for the app,
 * which would otherwise make vitest look for tests inside ui/ and find none.
 */
export default defineConfig({
  test: {
    root: '.',
    include: ['scoring-core/**/*.test.ts', 'collector/**/*.test.ts'],
    environment: 'node',
  },
});
