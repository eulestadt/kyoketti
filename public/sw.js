/* Kyoketti app-shell service worker.
 * Same-origin static files are cached; /api/* is never cached. */

const CACHE = 'kyoketti-shell-v1'
const PRECACHE = ['/', '/index.html', '/manifest.json', '/favicon.svg', '/logo.svg', '/icons.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            await cache.add(url)
          } catch {
            /* install still succeeds if a precache URL 404s */
          }
        }),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

function isApiRequest(url) {
  return url.pathname === '/api' || url.pathname.startsWith('/api/')
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch {
    const cached =
      (await cache.match(request)) || (await cache.match('/index.html')) || (await cache.match('/'))
    if (cached) return cached
    throw new Error('Offline and no cached app shell')
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone())
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (isApiRequest(url)) return

  const accept = request.headers.get('accept') || ''
  const isNavigate = request.mode === 'navigate' || accept.includes('text/html')
  event.respondWith(isNavigate ? networkFirst(request) : cacheFirst(request))
})
