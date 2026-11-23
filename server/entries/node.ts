import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { handleRequest } from '../app'
import { registerNodeSockets } from '../adapters/sockets/node'
import { loadNodeEnvironment, type NodeEnvironment } from '../env.node'
import { serveStatic } from '../static'
import type { AppRuntime } from '../types'

const MAX_BODY_BYTES = 64 * 1024 * 1024

class BackgroundTasks implements AppRuntime {
  private readonly pending = new Set<Promise<unknown>>()

  waitUntil(promise: Promise<unknown>): void {
    let tracked: Promise<unknown>
    tracked = Promise.resolve(promise)
      .catch((error) => {
        console.error('[background]', error)
      })
      .finally(() => {
        this.pending.delete(tracked)
      })
    this.pending.add(tracked)
  }

  async drain(timeoutMs = 5_000): Promise<void> {
    if (this.pending.size === 0) {
      return
    }
    await Promise.race([
      Promise.allSettled([...this.pending]),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ])
  }
}

class PayloadTooLarge extends Error {}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

function requestOrigin(req: IncomingMessage, publicOrigin?: string): string {
  if (publicOrigin) {
    return publicOrigin
  }
  const proto = firstHeader(req.headers['x-forwarded-proto'])?.split(',')[0]?.trim() || 'http'
  const host =
    firstHeader(req.headers['x-forwarded-host'])?.split(',')[0]?.trim() ??
    req.headers.host ??
    'localhost'
  return `${proto}://${host}`
}

async function readBody(req: IncomingMessage): Promise<Uint8Array | undefined> {
  const declared = Number(firstHeader(req.headers['content-length']) ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new PayloadTooLarge()
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > MAX_BODY_BYTES) {
      throw new PayloadTooLarge()
    }
    chunks.push(buffer)
  }
  if (chunks.length === 0) {
    return undefined
  }
  return Buffer.concat(chunks)
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'expect',
])

async function toWebRequest(
  req: IncomingMessage,
  publicOrigin?: string,
): Promise<Request> {
  const url = new URL(req.url ?? '/', requestOrigin(req, publicOrigin))
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || HOP_BY_HOP.has(name.toLowerCase())) {
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item)
      }
    } else {
      headers.set(name, value)
    }
  }
  const method = (req.method ?? 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') {
    return new Request(url, { method, headers })
  }
  const body = await readBody(req)
  return new Request(url, { method, headers, body: body as BodyInit | undefined })
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  const setCookies =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() === 'set-cookie') {
      return
    }
    res.setHeader(name, value)
  })
  if (setCookies.length > 0) {
    res.setHeader('set-cookie', setCookies)
  }
  if (!response.body || response.status === 204 || response.status === 304) {
    res.end()
    return
  }
  try {
    await pipeline(Readable.fromWeb(response.body as never), res)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ERR_STREAM_PREMATURE_CLOSE' && code !== 'EPIPE') {
      throw error
    }
  }
}

function jsonError(message: string, status: number, code: string): Response {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function startCron(
  environment: NodeEnvironment,
  runtime: BackgroundTasks,
  origin: string,
  onStop: (stop: () => void) => void,
): void {
  if (!environment.cronEnabled || !environment.env.CRON_SECRET) {
    return
  }
  let running = false
  const tick = async () => {
    if (running) {
      return
    }
    running = true
    try {
      const request = new Request(`${origin}/api/cron/notifications`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${environment.env.CRON_SECRET}` },
      })
      const response = await handleRequest(request, environment.env, runtime)
      if (!response.ok) {
        console.warn(`[cron] notifications returned ${response.status}`)
      }
    } catch (error) {
      console.error('[cron]', error)
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => {
    void tick()
  }, 60_000)
  timer.unref()
  onStop(() => clearInterval(timer))
}

async function main(): Promise<void> {
  const root = process.env.WHELKMAIL_ROOT ?? process.cwd()
  const environment = loadNodeEnvironment(root)
  registerNodeSockets()

  const runtime = new BackgroundTasks()
  const cleanup: Array<() => void> = []

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const request = await toWebRequest(req, environment.publicOrigin)
        const url = new URL(request.url)
        const response =
          url.pathname === '/api' || url.pathname.startsWith('/api/')
            ? await handleRequest(request, environment.env, runtime)
            : await serveStatic(request, environment.staticDir)
        await send(res, response)
      } catch (error) {
        if (error instanceof PayloadTooLarge) {
          await send(res, jsonError('Payload too large', 413, 'payload_too_large'))
          return
        }
        console.error('[http]', error)
        if (!res.headersSent) {
          await send(res, jsonError('Internal error', 500, 'internal')).catch(() => undefined)
        } else {
          res.destroy()
        }
      }
    })()
  })

  const origin = environment.publicOrigin ?? `http://127.0.0.1:${environment.port}`
  startCron(environment, runtime, origin, (stop) => cleanup.push(stop))

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(environment.port, environment.host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  console.log(`[whelkmail] listening on http://${environment.host}:${environment.port}`)
  console.log(`[whelkmail] database: ${environment.databasePath}`)
  console.log(
    `[whelkmail] object storage: ${environment.env.BUCKET ? 'S3-compatible' : 'disabled'}`,
  )
  console.log(`[whelkmail] cron: ${environment.cronEnabled ? 'enabled' : 'disabled'}`)

  let stopping = false
  const shutdown = async (signal: string) => {
    if (stopping) {
      return
    }
    stopping = true
    console.log(`[whelkmail] ${signal}: shutting down`)
    for (const stop of cleanup) {
      stop()
    }
    server.close()
    server.closeAllConnections?.()
    await runtime.drain()
    environment.database.close()
    process.exitCode = 0
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error) => {
  console.error('[whelkmail] failed to start')
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
