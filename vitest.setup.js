// vitest.setup.js
// Vitest equivalent of the old Jest moduleNameMapper for static assets.
// Place this file in the project root and reference it from vite.config.js:
//   test: { setupFiles: ['./vitest.setup.js'] }
//
// Vite's own asset handling covers most cases during dev/build, but
// during test runs (jsdom environment) we need to stub them out.

import { vi } from 'vitest';

// Stub .scl and other binary/media imports
vi.mock(/\.(scl|ascl|mp3|wav|svg|png|jpg|jpeg|gif|css)(\?raw)?$/, () => ({
  default: '',
}));
