import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import svgr from 'vite-plugin-svgr';
import path from 'path';

export default defineConfig({

  plugins: [
    preact({
      babel: {
        parserOpts: {
          plugins: ['jsx'],
        },
      },
    }),
    svgr({
      svgrOptions: {
        svgoConfig: {
          plugins: [
            { name: 'mergePaths',  active: false },
            { name: 'prefixIds',   active: false },
            { name: 'cleanupIDs',  active: false },
          ],
        },
      },
    })
  ],

  optimizeDeps: {
    esbuildOptions: {
      loader: { '.js': 'jsx' },
    },
  },

  resolve: {
    alias: {
      scales:               path.resolve(__dirname, 'scales'),
      'react':              'preact/compat',
      'react-dom/test-utils':'preact/test-utils',
      'react-dom':          'preact/compat',
    },
  },

  build: {
    outDir: 'build',
    sourcemap: true,
  },

  server: {
    host: '0.0.0.0',
  },

  // ── Vitest configuration ────────────────────────────────────────────────────
  test: {
    environment: 'jsdom',
    globals: true,           // provides describe / it / expect without imports
    setupFiles: ['./vitest.setup.js'],
    include: ['src/**/*.test.{js,jsx,ts,tsx}'],
    // Alias rules are inherited from resolve.alias above.
    // Mock static assets (fonts, images, audio, scala files) the same way
    // the old Jest config did — just return an empty string.
    server: {
      deps: {
        inline: ['@testing-library/preact'],
      },
    },
  },
});
