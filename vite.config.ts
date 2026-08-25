import { defineConfig } from 'vitest/config';

// Pages serves this as a project site at /chomp/, but dev and E2E serve from
// root. Keyed off an explicit variable rather than CI, so a CI *test* run
// doesn't silently inherit the deploy path.
const base = process.env.CHOMP_BASE ?? '/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    // No vendor chunk: there are no runtime dependencies to split out.
    rollupOptions: {
      output: { manualChunks: undefined },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'monitoring/**/*.test.ts'],
    coverage: {
      include: ['src/engine/**'],
      reporter: ['text', 'lcov'],
    },
  },
});
