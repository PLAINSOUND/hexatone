import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import svgr from 'vite-plugin-svgr';
import path from 'path';
import fs from 'fs';
import process from 'process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'),
);
const appVersion = packageJson.version || '0.0.0';

const devHttpsEnabled = process.env.VITE_DEV_HTTPS === 'true';
const devHttpsKeyPath = process.env.VITE_DEV_SSL_KEY || path.resolve(__dirname, '.cert/localhost-key.pem');
const devHttpsCertPath = process.env.VITE_DEV_SSL_CERT || path.resolve(__dirname, '.cert/localhost.pem');

function resolveDevHttpsConfig() {
  if (!devHttpsEnabled) return false;

  if (!fs.existsSync(devHttpsKeyPath) || !fs.existsSync(devHttpsCertPath)) {
    throw new Error(
      [
        'HTTPS dev server requested, but certificate files were not found.',
        `Expected key: ${devHttpsKeyPath}`,
        `Expected cert: ${devHttpsCertPath}`,
        'Create local certs first, for example with mkcert, or set VITE_DEV_SSL_KEY and VITE_DEV_SSL_CERT.',
      ].join('\n'),
    );
  }

  return {
    key: fs.readFileSync(devHttpsKeyPath),
    cert: fs.readFileSync(devHttpsCertPath),
  };
}

export default defineConfig({
  plugins: [
    preact({
      devToolsEnabled: process.env.VITE_PREACT_DEVTOOLS === 'true',
      // Prefresh retains detached virtualized sequencer rows as they are replaced
      // during scrolling. Keep long-running development sessions leak-free by
      // default; `yarn start:hmr` remains available for short HMR sessions.
      prefreshEnabled: process.env.VITE_PREACT_PREFRESH === 'true',
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
    rolldownOptions: {
      moduleTypes: { '.js': 'jsx' },
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

  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
  },

  build: {
    outDir: 'build',
    sourcemap: true,
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        retune: path.resolve(__dirname, 'retune.html'),
        usermanual: path.resolve(__dirname, 'usermanual.html'),
      },
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-preact',
              test: /node_modules[\\/]preact[\\/]/,
              priority: 2,
            },
            {
              name: 'vendor-webmidi',
              test: /node_modules[\\/]webmidi[\\/]/,
              priority: 2,
            },
            {
              name: 'settings',
              test: /src[\\/]settings[\\/]/,
              priority: 1,
            },
          ],
        },
      },
    },
  },

  server: {
    host: '0.0.0.0',
    https: resolveDevHttpsConfig(),
  },

  // ── Vitest ──────────────────────────────────────────────────────────────────
  test: {
    environment: 'jsdom',
    css: false,
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    globals: true,
    setupFiles: ['./vitest.setup.js'],
    include: ['src/**/*.test.{js,jsx}'],

    // Stub static assets imported in tests.
    alias: [
      {
        find: /\.(mp3|wav|ogg|scl|ascl|svg|png|jpg|jpeg|gif|woff|woff2|ttf|eot)(\?.*)?$/,
        replacement: path.resolve(__dirname, '__mocks__/fileMock.js'),
      },
      {
        find: /\.(css|less)$/,
        replacement: path.resolve(__dirname, '__mocks__/styleMock.js'),
      },
    ],
  },
});
