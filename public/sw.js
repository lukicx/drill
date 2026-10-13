// Offline support: after one online visit the app and every question set open without a connection.
// Pages and question files are fetched from the network first (so corrections show up right after a
// deploy) and fall back to the saved copy when offline or the network is too slow.
// The build fills in the id below, so every deploy installs a new worker that re-saves all files.
const CACHE = 'drill-__BUILD_ID__'
const NETWORK_TIMEOUT_MS = 4000
const scope = self.registration.scope

async function save(cache, url) {
  const res = await fetch(url, { cache: 'no-cache' })
  if (res.ok) await cache.put(url, res.clone())
  return res
}

// Saves the page, the files it references, and all question sets listed in datasets.json.
async function precache() {
  const cache = await caches.open(CACHE)
  const page = await save(cache, scope)
  const html = await page.text()
  const files = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => new URL(m[1], scope).href)
    .filter((url) => url.startsWith(scope) && url !== scope)
  const list = await save(cache, scope + 'datasets.json')
  const sets = (await list.json()).map((entry) => scope + entry.dataset)
  await Promise.allSettled([...files, ...sets].map((url) => save(cache, url)))
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

async function networkFirst(request, key) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(key)
  const fresh = fetch(request).then((res) => {
    if (res.ok) cache.put(key, res.clone())
    return res
  })
  if (!cached) return fresh
  fresh.catch(() => {}) // a late failure after the timeout must not surface as an unhandled rejection
  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS))
  return Promise.race([fresh.catch(() => cached), timeout])
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request.url)
  if (cached) return cached
  const res = await fetch(request)
  if (res.ok) cache.put(request.url, res.clone())
  return res
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || !request.url.startsWith(scope)) return
  if (request.mode === 'navigate') event.respondWith(networkFirst(request, scope))
  // Built files have a content hash in their name, so a saved copy never goes stale.
  else if (request.url.startsWith(scope + 'assets/')) event.respondWith(cacheFirst(request))
  else event.respondWith(networkFirst(request, request.url))
})
