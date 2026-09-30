/**
 * Service-worker precache and runtime sample-cache policy consumed by generate-sw.js.
 * Static build assets are precached; MP3 samples are cached on demand with bounded
 * age/count. Changes affect offline/update behaviour, not the audio scheduler.
 */

export default {
  globDirectory: 'build/',
  globPatterns: ['**/*.{js,css,html,png,webmanifest,wasm,scsyndef}'],
  // Keep engine/definitions versioned together; source archives remain downloadable.
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
  swDest: 'build/sw.js',
  // Let an update wait until the user naturally reloads or closes the app.
  // Immediate takeover can interrupt preset selection and active playback.
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
