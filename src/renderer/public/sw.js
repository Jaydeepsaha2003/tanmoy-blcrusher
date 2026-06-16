// Minimal service worker: makes the app installable (PWA) and serves the shell
// offline. Network-first for everything; never touches /api (always live).
const CACHE = 'blcrusher-v1'

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
  if (req.method !== 'GET') return // POST /api etc. — let it hit the network
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api')) return

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
