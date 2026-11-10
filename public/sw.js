const CACHE = 'whelkmail-v3'
const SHELL = [
  '/',
  '/favicon.svg',
  '/whelkmail-logo.svg',
  '/manifest.webmanifest',
  '/notification-badge.png',
  '/notification-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
        ),
      // Drop notifications left behind by the previous version, which tagged
      // them per message: a surviving extra notification makes Android group
      // them and show the grouping icon instead of the badge.
      self.registration.getNotifications().then((existing) => {
        for (const notification of existing) {
          notification.close()
        }
      }),
    ])
      .catch(() => undefined)
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') {
    return
  }
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put('/', copy)).catch(() => undefined)
          return response
        })
        .catch(() => caches.match('/').then((cached) => cached ?? Response.error())),
    )
    return
  }

  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.webmanifest')
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined)
            return response
          }),
      ),
    )
  }
})

// Notifications are serialised and every other one is dismissed first: Android
// shows a second notification as a group whose status bar icon is the grouping
// indicator (two empty squares) instead of the app badge.
let notificationQueue = Promise.resolve()

function showSingleNotification(title, options) {
  notificationQueue = notificationQueue
    .then(async () => {
      const existing = await self.registration.getNotifications()
      const stale = existing.filter((item) => !options.tag || item.tag !== options.tag)
      await Promise.all(stale.map((item) => item.close()))
      await self.registration.showNotification(title, options)
    })
    .catch(() => undefined)
  return notificationQueue
}

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }
  const title = payload.title || 'WhelkMail'
  const tag = payload.tag || undefined
  const options = {
    body: payload.body || '',
    // Android masks the badge into a monochrome silhouette in the status bar and
    // only renders bitmaps there, so both assets are PNG (see scripts/generate-icons.mjs).
    icon: payload.icon || '/notification-icon.png',
    badge: payload.badge || '/notification-badge.png',
    data: { url: payload.url || '/', tag },
    tag,
  }
  // `renotify` is only meaningful (and only valid) together with a tag.
  if (tag && payload.renotify) {
    options.renotify = true
  }
  event.waitUntil(showSingleNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === target && 'focus' in client) {
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
