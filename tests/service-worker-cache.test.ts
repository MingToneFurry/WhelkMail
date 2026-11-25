import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const origin = 'https://mail.example'
const html = '<div id="root"></div><script type="module" src="/assets/main-123.js"></script><link href="/assets/main-123.css">'
const response = (body: string, type = 'text/html', status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': type } })

function fixture() {
  type Input = string | { url: string }
  type Event = {
    request?: { url: string; method: string; mode: string }
    waitUntil: (promise: Promise<unknown>) => void
    respondWith: (promise: Promise<Response>) => void
  }
  const path = (input: Input) => new URL(typeof input === 'string' ? input : input.url, origin).pathname
  const stores = new Map<string, Map<string, Response>>()
  const open = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const store = stores.get(name)!
    return {
      match: async (key: Input) => store.get(path(key))?.clone(),
      put: async (key: Input, value: Response) => { store.set(path(key), value.clone()) },
    }
  }
  const fetch = vi.fn(async (input: Input) => {
    if (path(input) === '/') return response(html)
    if (path(input).endsWith('.js')) return response('export {}', 'text/javascript')
    if (path(input).endsWith('.css')) return response('body{}', 'text/css')
    return response('icon', 'image/png')
  })
  const listeners = new Map<string, (event: Event) => void>()
  const skipWaiting = vi.fn()
  const claim = vi.fn()
  runInNewContext(worker, {
    Response, URL, fetch,
    self: { location: { origin }, skipWaiting, clients: { claim }, addEventListener: listeners.set.bind(listeners) },
    caches: {
      open: async (name: string) => open(name),
      keys: async () => [...stores.keys()], delete: async (key: string) => stores.delete(key),
      match: async (key: Input, { cacheName }: { cacheName: string }) => open(cacheName).match(key),
    },
  })

  async function fire(name: string, url?: string, mode = 'navigate') {
    const tasks: Promise<unknown>[] = []
    let result: Promise<Response> | undefined
    listeners.get(name)!({
      request: url ? { url: origin + url, method: 'GET', mode } : undefined,
      respondWith: (promise) => { result = promise },
      waitUntil: (promise) => { tasks.push(promise) },
    })
    const received = await result
    await Promise.all(tasks)
    return received
  }
  return { fire, fetch, open, stores, skipWaiting, claim }
}

describe('offline shell upgrades', () => {
  it('supports push registration on the live Vite development server', async () => {
    const app = fixture()
    app.fetch.mockResolvedValueOnce(response('<div id="root"></div><script src="/@vite/client"></script><script src="/src/main.tsx"></script>'))
    await app.fire('install')
    expect(app.skipWaiting).toHaveBeenCalledOnce()
    app.fetch.mockRejectedValueOnce(new Error('offline'))
    expect((await app.fire('fetch', '/'))?.type).toBe('error')
  })

  it('activates over the English release only after the new document and its bundles are ready', async () => {
    const app = fixture()
    await app.open('whelkmail-v3').put('/', response('English release'))
    app.open('whelkmail-preferences')
    app.open('other-app')
    app.fetch.mockResolvedValueOnce(response(html)).mockResolvedValueOnce(response('gateway error', 'text/html', 502))
    await expect(app.fire('install')).rejects.toThrow()
    expect(app.skipWaiting).not.toHaveBeenCalled()
    expect(app.stores.get('whelkmail-v3')?.has('/')).toBe(true)

    await app.fire('install')
    expect(app.skipWaiting).toHaveBeenCalledOnce()
    await app.fire('activate')
    expect(app.claim).toHaveBeenCalledOnce()
    expect(app.stores.has('whelkmail-v3')).toBe(false)
    expect(app.stores.has('whelkmail-preferences')).toBe(true)
    expect(app.stores.has('other-app')).toBe(true)

    app.fetch.mockRejectedValue(new Error('offline'))
    expect(await (await app.fire('fetch', '/inbox'))?.text()).toBe(html)
    expect(await (await app.fire('fetch', '/assets/main-123.js', 'cors'))?.text()).toBe('export {}')
    expect(await (await app.fire('fetch', '/assets/main-123.css', 'cors'))?.text()).toBe('body{}')
  })

  it('keeps errors, challenges and unrelated documents out of the offline shell', async () => {
    const app = fixture()
    await app.fire('install')
    for (const invalid of [
      response('Bad Gateway', 'text/html', 502),
      response('other HTML'),
      Response.json({}),
      new Response(html + 'challenge', { headers: { 'Content-Type': 'text/html', 'cf-mitigated': 'challenge' } }),
    ]) {
      app.fetch.mockResolvedValueOnce(invalid)
      expect(await app.fire('fetch', '/')).toBe(invalid)
      app.fetch.mockRejectedValueOnce(new Error('offline'))
      expect(await (await app.fire('fetch', '/'))?.text()).toBe(html)
    }
  })

  it('revalidates the manifest, retries bad assets and bypasses mailbox requests', async () => {
    const app = fixture()
    await app.fire('install')
    app.fetch.mockResolvedValueOnce(response('new manifest', 'application/manifest+json'))
    expect(await (await app.fire('fetch', '/manifest.webmanifest', 'cors'))?.text()).toBe('new manifest')
    app.fetch.mockRejectedValueOnce(new Error('offline'))
    expect(await (await app.fire('fetch', '/manifest.webmanifest', 'cors'))?.text()).toBe('new manifest')

    app.fetch.mockResolvedValueOnce(response('upstream error', 'text/html', 503))
    expect((await app.fire('fetch', '/assets/new.js', 'cors'))?.status).toBe(503)
    app.fetch.mockResolvedValueOnce(response('wrong MIME'))
    expect(await (await app.fire('fetch', '/assets/new.js', 'cors'))?.text()).toBe('wrong MIME')
    expect(await (await app.fire('fetch', '/assets/new.js', 'cors'))?.text()).toBe('export {}')
    const calls = app.fetch.mock.calls.length
    expect(await app.fire('fetch', '/api/accounts', 'cors')).toBeUndefined()
    expect(app.fetch).toHaveBeenCalledTimes(calls)
  })
})
