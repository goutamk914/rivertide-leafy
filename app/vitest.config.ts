import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
    restoreMocks: true,
    // jsdom page renders are slow when ~40 suites run in parallel; 5 s produced false timeouts.
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/shared/**', 'src/main/**', 'src/renderer/engine/dsp/**'],
      reporter: ['text-summary', 'html'],
    },
  },
});
