import { appPasswordProblem, MIN_APP_PASSWORD_LENGTH } from '../../shared/app-password'
import type { Env } from './env'

/**
 * Refuse to serve the application with an unusable login password.
 *
 * The Node entrypoint stops at startup, but a Worker and a Pages project have no
 * such moment: the same policy has to be enforced on the request path, or the two
 * runtimes disagree about what is safe.
 *
 * `/api/health` is deliberately allowed through so monitoring can still report the
 * deployment; everything else — including the login endpoint — answers 503.
 */
const ALLOWED_WHILE_MISCONFIGURED = new Set(['/api/health'])

// One entry per isolate: the secret cannot change without a new deployment.
let cached: { password: string; problem: string | null } | null = null

function html(problem: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhelkMail is not configured</title><style>body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;margin:0;padding:2.5rem 1.25rem;background:#fff7f2;color:#202124}main{max-width:38rem;margin:0 auto;background:#fff;border:1px solid #f0ded6;border-radius:16px;padding:1.75rem}h1{font-size:1.1rem;margin:0 0 .75rem}p{font-size:.9rem;line-height:1.5;margin:.5rem 0}code{background:#f6f6f6;border-radius:4px;padding:.1rem .3rem;font-size:.85em}ul{font-size:.9rem;line-height:1.6;margin:.5rem 0 0;padding-left:1.2rem}</style></head><body><main><h1>WhelkMail is not configured correctly</h1><p>${problem}</p><p>Set a real login password of at least ${MIN_APP_PASSWORD_LENGTH} characters:</p><ul><li><strong>Workers:</strong> <code>npx wrangler secret put APP_PASSWORD</code></li><li><strong>Pages:</strong> the project's <em>Settings → Variables and Secrets</em></li><li><strong>Docker:</strong> <code>APP_PASSWORD</code> in <code>deploy/docker/.env</code></li></ul><p>The application stays unavailable until this is fixed.</p></main></body></html>`
}

function misconfigured(problem: string, pathname: string): Response {
  if (pathname.startsWith('/api/')) {
    return new Response(
      JSON.stringify({
        error: 'WhelkMail is not configured: APP_PASSWORD is missing or too weak',
        detail: problem,
        code: 'app_password_insecure',
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      },
    )
  }
  return new Response(html(problem), {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/**
 * A 503 when the deployment must not be used, or null when it may.
 *
 * The problem is memoised per secret value; the response is built per request so
 * an API call gets JSON and a page gets the HTML explanation.
 */
export function passwordGuard(env: Env, pathname: string): Response | null {
  const password = env.APP_PASSWORD ?? ''
  if (!cached || cached.password !== password) {
    cached = { password, problem: appPasswordProblem(password) }
  }
  if (!cached.problem || ALLOWED_WHILE_MISCONFIGURED.has(pathname)) {
    return null
  }
  return misconfigured(cached.problem, pathname)
}
