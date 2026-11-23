import { routes, type RouteEntry } from './routes'
import type { RouteModule } from './types'

interface CompiledRoute {
  entry: RouteEntry
  regex: RegExp
  keys: string[]
  dynamic: number
  segments: number
}

function escapeLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compile(entry: RouteEntry): CompiledRoute {
  const parts = entry.path.split('/').filter(Boolean)
  const keys: string[] = []
  let dynamic = 0
  const pattern = parts
    .map((part) => {
      if (part.startsWith(':')) {
        keys.push(part.slice(1))
        dynamic += 1
        return '([^/]+)'
      }
      return escapeLiteral(part)
    })
    .join('/')
  return {
    entry,
    regex: new RegExp(`^/${pattern}/?$`),
    keys,
    dynamic,
    segments: parts.length,
  }
}

// Static routes first, then the ones with the fewest dynamic segments: a
// request for /api/messages/search must never be captured by /api/messages/:id.
const compiled = routes
  .map(compile)
  .sort((a, b) => a.dynamic - b.dynamic || b.segments - a.segments)

export interface MatchedRoute {
  route: RouteEntry
  params: Record<string, string>
}

export function matchRoute(pathname: string): MatchedRoute | null {
  for (const route of compiled) {
    const match = route.regex.exec(pathname)
    if (!match) {
      continue
    }
    const params: Record<string, string> = {}
    for (let index = 0; index < route.keys.length; index += 1) {
      try {
        params[route.keys[index]] = decodeURIComponent(match[index + 1] ?? '')
      } catch {
        params[route.keys[index]] = match[index + 1] ?? ''
      }
    }
    return { route: route.entry, params }
  }
  return null
}

const METHOD_EXPORTS = {
  GET: 'onRequestGet',
  HEAD: 'onRequestHead',
  POST: 'onRequestPost',
  PUT: 'onRequestPut',
  PATCH: 'onRequestPatch',
  DELETE: 'onRequestDelete',
  OPTIONS: 'onRequestOptions',
} as const

export type HttpMethod = keyof typeof METHOD_EXPORTS

export function handlerFor(module: RouteModule, method: string): RouteModule[keyof RouteModule] {
  const name = METHOD_EXPORTS[method as HttpMethod]
  const direct = name ? module[name] : undefined
  if (direct) {
    return direct
  }
  if (method === 'HEAD' && module.onRequestGet) {
    return module.onRequestGet
  }
  return module.onRequest
}

export function allowedMethods(module: RouteModule): string[] {
  if (module.onRequest) {
    return ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  }
  const methods = new Set<string>()
  for (const [method, name] of Object.entries(METHOD_EXPORTS)) {
    if (module[name]) {
      methods.add(method)
    }
  }
  if (module.onRequestGet) {
    methods.add('GET')
    methods.add('HEAD')
  }
  return [...methods]
}
