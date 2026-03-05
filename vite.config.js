import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import svgr from 'vite-plugin-svgr';
import path from 'path';

export default defineConfig({
  
  plugins: [
    preact({
      // Tell the Preact plugin to treat .js files as JSX,
      // since the codebase uses .js extensions throughout
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
      scales:              path.resolve(__dirname, 'scales'),
      'react':               'preact/compat',
      'react-dom/test-utils':'preact/test-utils',
      'react-dom':           'preact/compat',
    },
  },

  build: {
    outDir: 'build',
    sourcemap: true,
  },

  server: {
    host: '0.0.0.0',
  },
});