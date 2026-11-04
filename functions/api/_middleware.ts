import { readCookie, verifySession } from '../_lib/crypto'
import type { Env } from '../_lib/env'
import { fail, HttpError } from '../_lib/http'

const PUBLIC_PATHS = new Set(['/api/auth/login', '/api/health'])

export const onRequest: PagesFunction<Env> = async (context) => {
  try {
    const request = context.request
    const url = new URL(request.url)

    if (!PUBLIC_PATHS.has(url.pathname)) {
      const session = readCookie(request, 'mc_session')
      if (!(await verifySession(context.env, session))) {
        return fail('Authentication required', 401, undefined, 'unauthorized')
      }
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.get('Origin')
      if (origin && origin !== url.origin) {
        return fail('Origin not allowed', 403, undefined, 'invalid_origin')
      }
    }

    return await context.next()
  } catch (error) {
    if (error instanceof HttpError) {
      return fail(error.message, error.status)
    }
    const detail = error instanceof Error ? error.message : 'Errore sconosciuto'
    return fail('Internal error', 500, detail, 'internal')
  }
}
