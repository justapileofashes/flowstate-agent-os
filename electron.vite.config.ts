import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    // Bundle every dep into the main bundle. The electron-builder files
    // whitelist ships NO node_modules except better-sqlite3, so anything left
    // external (zod, shell-quote, electron-updater, ...) is missing in the
    // packaged app and crashes with ERR_MODULE_NOT_FOUND. Only the native
    // module stays external.
    build: {
      outDir: 'out/main',
      rollupOptions: {
        external: ['electron', 'better-sqlite3'],
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@main': resolve(__dirname, 'src/main'),
      },
    },
  },
  preload: {
    // No externalizeDepsPlugin: with sandbox:true, the preload can only
    // require() 'electron' + Node built-ins. Any other dep (zod, etc.) must
    // be bundled in.
    build: {
      outDir: 'out/preload',
      // Electron's sandbox:true preload also requires CommonJS — force CJS.
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs',
          inlineDynamicImports: true,
        },
        external: ['electron'],
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  renderer: {
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
    root: 'src/renderer',
  },
});
