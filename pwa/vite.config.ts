import { defineConfig } from 'vitest/config';

// No framework plugins: the app is plain TypeScript + DOM (docs/SPEC.md picks no UI framework).
// `pnpm preview` is the only way to test the service worker — `vite dev` serves no SW by design.
export default defineConfig({
  server: { port: 5173 },
  build: { target: 'es2022', sourcemap: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // fake-indexeddb needs no DOM, but it must be installed before Dexie is imported.
    setupFiles: ['tests/setup.ts'],
  },
});
