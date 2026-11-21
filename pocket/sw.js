// Service worker «Подхода»: в метро без сети страница и данные открываются из кэша мгновенно.
// Сначала кэш, обновление в фоне: новая сборка данных (pocket:publish) видна со следующего открытия.
const CACHE = 'pocket-v6' // v6 21.11: аудио под контролем, настройки в синхронизации - страница и ядро вместе
// './' не предзагружаем: локальный Next отдаёт на папку 404, и установка падала целиком. Открытие по адресу папки
// (github.io) кэшируется при первом заходе.
const FILES = ['index.html', 'trainer-core.js', 'pocket-core.js', 'data.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'pdf.min.mjs', 'pdf.worker.min.mjs']

// Каждый файл - отдельно: с addAll один сбой (рваная сеть, dev-сервер ещё компилирует) валил всю установку.
// Не закэшированное здесь докэшируется при первом обращении (fetch ниже).
self.addEventListener('install', e => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then(c => Promise.allSettled(FILES.map(f => c.add(f))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('pocket-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request, { ignoreSearch: true }).then(hit => {
        const fresh = fetch(e.request)
          .then(res => {
            if (res.ok) cache.put(e.request, res.clone())
            return res
          })
          .catch(() => hit)
        if (hit) {
          e.waitUntil(fresh.catch(() => {}))
          return hit
        }
        return fresh
      }),
    ),
  )
})
