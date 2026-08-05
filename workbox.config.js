export default {
  globDirectory: 'build/',
  globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
  swDest: 'build/sw.js',
  clientsClaim: true,
  skipWaiting: true,
  runtimeCaching: [
    {
      urlPattern: /\/sounds\/.*\.mp3$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'hexatone-samples-v1',
        expiration: {
          maxEntries: 96,
          maxAgeSeconds: 60 * 60 * 24 * 30,
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
  ],
};
