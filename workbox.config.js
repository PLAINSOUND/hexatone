export default {
  globDirectory: 'build/',
  globPatterns: ['**/*.{js,css,html,png,mp3,webmanifest}'],
  swDest: 'build/sw.js',
  clientsClaim: true,
  skipWaiting: true,
};