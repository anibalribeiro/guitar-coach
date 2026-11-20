// ---------- Offline cache ----------
// The app is a static shell: one HTML page, the ES modules and six generated lesson clips plus a real reference clip.
// Cache them on install so a page that has loaded once keeps working with no network. The
// fetch handler is same-origin only; external lesson links leave the app and are never cached.
// Bump the release on shell changes. A waiting worker activates after old tabs close,
// so an open page never receives a different release halfway through its imports.
const CACHE_PREFIX = 't2coach:' + encodeURIComponent(new URL('./', self.location.href).pathname) + ':';
const CACHE = CACHE_PREFIX + 'v34';

const SHELL = [
  './',
  './index.html',
  './bootstrap.js',
  './src/audio.js',
  './src/backing.js',
  './src/content.js',
  './src/drills.js',
  './src/fade.js',
  './src/fretboard.js',
  './src/guitar.js',
  './src/leds.js',
  './src/main.js',
  './src/mic.js',
  './src/panels.js',
  './src/pitch.js',
  './src/progress.js',
  './src/quiz.js',
  './src/score.js',
  './src/session.js',
  './src/settings.js',
  './src/theory.js',
  './src/transport.js',
  './src/wakelock.js'
];
const MEDIA = [
  './assets/videos/scale-run.mp4',
  './assets/videos/scale-run.png',
  './assets/videos/blues-scale.mp4',
  './assets/videos/blues-scale.png',
  './assets/videos/power-chords.mp4',
  './assets/videos/power-chords.png',
  './assets/videos/chord-change.mp4',
  './assets/videos/chord-change.png',
  './assets/videos/fretboard-notes.mp4',
  './assets/videos/fretboard-notes.png',
  './assets/videos/strumming.mp4',
  './assets/videos/strumming.png',
  './assets/videos/real-hand.mp4',
  './assets/videos/real-hand.png',
  './assets/videos/real-fretboard.jpg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(async cache => {
        // Shell failure must fail the install; one unavailable video must not pin the app to
        // an old HTML shell (the boot-error failure mode this cache can otherwise cause).
        await cache.addAll(SHELL);
        await Promise.allSettled(MEDIA.map(url => cache.add(url)));
      }),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)))),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL('./', self.location.href).pathname)) return;

  const shellUrls = SHELL.map(path => new URL(path, self.location.href).href);
  if (request.mode === 'navigate' || shellUrls.includes(url.href)) {
    // A shell cache is immutable after a successful install. Never replace individual
    // files with network bytes from a different deployment or another scope's cache.
    event.respondWith(caches.open(CACHE).then(async cache => {
      const cached = await cache.match(request.mode === 'navigate' ? './index.html' : request);
      return cached || fetch(request);
    }));
    return;
  }

  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(request);
    return cached || fetch(request);
  }));
});
