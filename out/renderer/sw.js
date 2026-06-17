// Service worker: PWA install + faster loads.
//  - /assets/* (content-hashed, immutable) -> cache-first (instant on repeat visits)
//  - navigations / other GETs            -> network-first, fall back to cache offline
//  - /api/*                              -> never touched (always live)
const CACHE = 'blcrusher-v2'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api')) return

  // Hashed build assets are immutable — serve from cache first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
            }
            return res
          })
      )
    )
    return
  }

  // Everything else: network-first with offline cache fallback.
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req)
        if (res && res.status === 200) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
        }
        return res
      } catch {
        const cached = await caches.match(req)
        return cached || (await caches.match('/index.html')) || Response.error()
      }
    })()
  )
})
