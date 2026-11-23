import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { SECURITY_HEADERS } from './app'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

function headersFor(pathname: string, contentType: string, length: number): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value)
  }
  headers.set('Content-Type', contentType)
  headers.set('Content-Length', String(length))
  if (pathname.startsWith('/assets/')) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  } else if (pathname === '/sw.js') {
    headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
  } else {
    headers.set('Cache-Control', 'no-cache')
  }
  return headers
}

async function readAsset(
  root: string,
  pathname: string,
): Promise<{ file: string; body: Buffer } | null> {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) {
    return null
  }
  const relative = decoded === '/' ? '/index.html' : decoded
  const file = resolve(root, `.${relative}`)
  if (file !== root && !file.startsWith(root + sep)) {
    return null
  }
  try {
    const info = await stat(file)
    if (!info.isFile()) {
      return null
    }
    return { file, body: await readFile(file) }
  } catch {
    return null
  }
}

/**
 * Serve the Vite build the same way Pages and Workers Assets do: existing files
 * first, `index.html` for the SPA routes, 404 for a missing asset.
 */
export async function serveStatic(request: Request, root: string): Promise<Response> {
  const url = new URL(request.url)
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 })
  }

  const asset = await readAsset(root, url.pathname)
  let body: Buffer | null = asset?.body ?? null
  const pathname = asset ? url.pathname : '/index.html'
  let contentType = MIME[extname(asset?.file ?? 'index.html').toLowerCase()] ?? 'application/octet-stream'

  if (!asset) {
    if (extname(url.pathname) !== '') {
      return new Response('Not found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    try {
      body = await readFile(join(root, 'index.html'))
    } catch {
      return new Response('The frontend build is missing (run npm run build)', {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    contentType = MIME['.html']
  }

  const headers = headersFor(pathname, contentType, body?.byteLength ?? 0)
  return new Response(request.method === 'HEAD' ? null : (body as unknown as BodyInit), {
    status: 200,
    headers,
  })
}
