const CACHE = 'whelkmail-v5'
const PREFERENCES = 'whelkmail-preferences'
const PUSH_LANGUAGE = '/api/device/push-language'
const SHELL_FILES = [
  '/favicon.svg',
  '/whelkmail-logo.svg',
  '/manifest.webmanifest',
  '/notification-badge.png',
  '/notification-icon.png',
]

function usable(response) {
  return response.status === 200 && !response.redirected && response.headers.get('cf-mitigated') !== 'challenge'
}

function assetResponse(pathname, response) {
  if (!usable(response)) return false
  const mime = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()
  if (/\.m?js$/.test(pathname)) return /^(text|application)\/(java|ecma)script$/.test(mime ?? '')
  if (pathname.endsWith('.css')) return mime === 'text/css'
  return Boolean(mime && mime !== 'text/html')
}

async function cacheShell(response) {
  if (!usable(response) || !/^text\/html\b/i.test(response.headers.get('Content-Type') ?? '')) return false
  const html = await response.clone().text()
  if (!html.includes('<div id="root">')) return false
  // The Vite dev server still needs an active worker for push testing. Its
  // source modules require the live server and cannot form an offline shell.
  if (html.includes('src="/@vite/client"') && html.includes('src="/src/main.tsx"')) return true
  // Vite emits absolute, content-hashed entry URLs. Keep the old offline
  // document until every script and stylesheet referenced by the new one exists.
  const entries = html.matchAll(/\b(?:src|href)=["'](\/assets\/[\w.-]+\.(?:m?js|css))["']/g)
  const assets = [...new Set(Array.from(entries, (match) => match[1]))]
  if (!assets.some((path) => /\.m?js$/.test(path))) return false
  const cache = await caches.open(CACHE)
  await Promise.all(assets.map(async (path) => {
    if (await cache.match(path)) return
    const asset = await fetch(path, { cache: 'no-store' })
    if (!assetResponse(path, asset)) throw new Error('Unavailable shell asset')
    await cache.put(path, asset)
  }))
  await cache.put('/', response)
  return true
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const response = await fetch('/', { cache: 'no-store' })
    if (!(await cacheShell(response))) throw new Error('Unavailable application shell')
    const cache = await caches.open(CACHE)
    await Promise.allSettled(SHELL_FILES.map(async (path) => {
      const asset = await fetch(path, { cache: 'no-store' })
      if (assetResponse(path, asset)) await cache.put(path, asset)
    }))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => /^whelkmail-v\d+$/.test(key) && key !== CACHE).map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  const cached = () => caches.match(request, { cacheName: CACHE }).catch(() => undefined)
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-store' })
        event.waitUntil(cacheShell(response.clone()).catch(() => undefined))
        return response
      } catch {
        return (await caches.match('/', { cacheName: CACHE })) ?? Response.error()
      }
    })())
    return
  }

  const immutable = url.pathname.startsWith('/assets/')
  if (immutable || SHELL_FILES.includes(url.pathname)) {
    event.respondWith((async () => {
      if (immutable) {
        const hit = await cached()
        if (hit) return hit
      }
      try {
        const response = immutable ? await fetch(request) : await fetch(request, { cache: 'no-store' })
        if (assetResponse(url.pathname, response)) {
          const copy = response.clone()
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined))
        }
        return response
      } catch (error) {
        const hit = await cached()
        if (hit) return hit
        throw error
      }
    })())
  }
})

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function fetchApplicationServerKey() {
  try {
    const response = await fetch('/api/push/key', { credentials: 'same-origin' })
    if (!response.ok) {
      return null
    }
    const data = await response.json()
    return data && data.publicKey ? base64UrlToBytes(data.publicKey) : null
  } catch {
    return null
  }
}

async function postSubscription(subscription) {
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys || !json.keys.p256dh || !json.keys.auth) {
    return
  }
  await fetch('/api/push/subscribe', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      userAgent: self.navigator ? self.navigator.userAgent : undefined,
    }),
  })
}

async function forgetSubscription(endpoint) {
  if (!endpoint) {
    return
  }
  try {
    await fetch('/api/push/subscribe', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    })
  } catch {
    // The cron worker also drops endpoints that answer 404/410.
  }
}

// Chrome can rotate or invalidate the subscription while the app is closed.
// Resubscribe and re-register so the server stops sending to a dead endpoint.
// The app also re-registers on every start (src/lib/push.ts), which covers
// browsers that never fire this event and sessions that expire here.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      let subscription = event.newSubscription
      if (!subscription) {
        const options = event.oldSubscription ? event.oldSubscription.options : null
        const applicationServerKey =
          (options && options.applicationServerKey) || (await fetchApplicationServerKey())
        if (!applicationServerKey) {
          return
        }
        subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        })
      }
      if (event.oldSubscription && event.oldSubscription.endpoint !== subscription.endpoint) {
        await forgetSubscription(event.oldSubscription.endpoint)
      }
      await postSubscription(subscription)
    })().catch(() => undefined),
  )
})

self.addEventListener('message', (event) => {
  if (event.origin !== self.location.origin || event.data?.type !== 'push-language') return
  const { locale, noSubject } = event.data
  if (typeof locale !== 'string' || typeof noSubject !== 'string') return
  event.waitUntil(
    caches.open(PREFERENCES)
      .then((cache) => cache.put(PUSH_LANGUAGE, Response.json({ locale, noSubject })))
      .catch(() => undefined),
  )
})

async function showMailNotification(payload) {
  let body = payload.body
  let lang
  if (body === '') {
    const language = await caches.match(PUSH_LANGUAGE, { cacheName: PREFERENCES })
      .then((response) => response?.json())
      .catch(() => undefined)
    lang = language?.locale || 'zh-CN'
    body = language?.noSubject || '（无主题）'
  }
  const title = payload.title || 'WhelkMail'
  await self.registration.showNotification(title, {
    body: body || '',
    lang,
    // Android masks the badge into a monochrome silhouette in the status bar and
    // only renders bitmaps there, so both assets are PNG (see scripts/generate-icons.mjs).
    icon: payload.icon || '/notification-icon.png',
    badge: payload.badge || '/notification-badge.png',
    data: { url: payload.url || '/', tag: payload.tag || undefined },
    tag: payload.tag || undefined,
  })
}

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }
  event.waitUntil(showMailNotification(payload))
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
