import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    // better-sqlite3 is a native addon: it resolves its .node binding relative
    // to its own location at runtime. Let Vitest load it as a real external
    // module instead of trying to transform/bundle it (which breaks the lookup).
    server: {
      deps: {
        external: [/better-sqlite3/, /bindings/],
      },
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
    },
  },
});
