// Service worker офлайн-тренажёра: страница и колода работают без сети.
// deck.js — сначала сеть (свежая колода), при отсутствии сети — кэш. Остальное — сначала кэш.
const CACHE = 'phrase-trainer-v1'
const FILES = ['./', 'index.html', 'core.js', 'deck.js', 'manifest.webmanifest']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  const networkFirst = url.pathname.endsWith('deck.js') || url.pathname.endsWith('core.js') || url.pathname.endsWith('index.html') || url.pathname.endsWith('/')
  if (networkFirst) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, copy))
          return res
        })
        .catch(() => caches.match(e.request)),
    )
  } else {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)))
  }
})
