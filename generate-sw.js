/**
 * Post-build service-worker generator invoked by yarn build.
 * Delegates precache/runtime-cache policy to workbox.config.js and writes build/sw.js.
 */

import { generateSW } from 'workbox-build';
import config from './workbox.config.js';

generateSW(config).then(({ count, size }) => {
  console.log(`Generated service worker covering ${count} files, ${size} bytes.`);
});
