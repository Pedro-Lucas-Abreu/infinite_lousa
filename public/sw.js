const build = /* Build manifest */ null
if (!build) throw new Error('Missing offline build manifest')

const scope = self.registration.scope
const cachePrefix = `whiteboard:${scope}:`
const currentCache = `${cachePrefix}${build.version}`
const shell = new URL('./index.html', scope).href
const assetRoot = new URL('./assets/', scope).href
const precache = new Set(build.assets.map((asset) => new URL(asset, scope).href))

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(currentCache)
    const resources = [...precache].map((url) => new Request(url, { cache: 'reload' }))
    await cache.addAll(resources)
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const versions = (await caches.keys()).filter((key) => key.startsWith(cachePrefix))
    const previousIndex = versions.indexOf(currentCache) - 1
    // Keep the previous release's immutable assets for tabs still running it.
    await Promise.all(versions.slice(0, Math.max(0, previousIndex)).map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('message', (event) => {
  // An update normally waits until the old tabs close. The UI can request it after saving.
  if (event.data === 'activate-update') event.waitUntil(self.skipWaiting())
})

async function findPreviousAsset(url) {
  const versions = await caches.keys()
  const older = versions.slice(0, versions.indexOf(currentCache)).reverse()
  for (const key of older) {
    if (key.startsWith(cachePrefix)) {
      const response = await caches.match(url, { cacheName: key })
      if (response) return response
    }
  }
  return undefined
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || !request.url.startsWith(scope)) return

  const url = new URL(request.url)
  const scopePath = new URL(scope).pathname
  const isShell = request.mode === 'navigate' &&
    (url.pathname === scopePath || url.pathname === new URL(shell).pathname)
  const key = isShell ? shell : url.href
  if (precache.has(key)) {
    event.respondWith((async () => {
      const response = await caches.match(key, { cacheName: currentCache })
      return response ?? fetch(request)
    })())
  } else if (key.startsWith(assetRoot)) {
    event.respondWith((async () => (await findPreviousAsset(key)) ?? fetch(request))())
  }
})
