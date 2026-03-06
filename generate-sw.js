import { generateSW } from 'workbox-build';
import config from './workbox.config.js';

generateSW(config).then(({ count, size }) => {
  console.log(`Generated service worker covering ${count} files, ${size} bytes.`);
});