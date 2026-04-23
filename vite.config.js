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

  // Base path: '/' for production (hexatone.plainsound.org), '/hexatone/' for
  // GitHub Pages preview (plainsound.github.io/hexatone). Set VITE_BASE_PATH in CI.
  base: process.env.VITE_BASE_PATH || '/',

  build: {
    outDir: 'build',
    sourcemap: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        retune: path.resolve(__dirname, 'retune.html'),
        usermanual: path.resolve(__dirname, 'usermanual.html'),
      },
    },
  },

  server: {
    host: '0.0.0.0',
  },

  // ── Vitest ──────────────────────────────────────────────────────────────────
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.js'],
    include: ['src/**/*.test.{js,jsx}'],

    // Stub static assets — same role as the old Jest moduleNameMapper
    moduleNameMapper: {
      '\\.(mp3|wav|ogg|scl|ascl|svg|png|jpg|jpeg|gif|woff|woff2|ttf|eot)(\\?.*)?$':
        '<rootDir>/__mocks__/fileMock.js',
      '\\.(css|less)$': '<rootDir>/__mocks__/styleMock.js',
    },
  },
});
