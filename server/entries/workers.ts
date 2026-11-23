import type { Env } from '../../functions/_lib/env'
import { handleRequest } from '../app'
import { registerWorkersSockets } from '../adapters/sockets/workers'

registerWorkersSockets()

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    return handleRequest(request, env, { waitUntil: (promise) => ctx.waitUntil(promise) })
  },

  async scheduled(_controller: unknown, env: Env, ctx: ExecutionContextLike): Promise<void> {
    const origin = env.APP_URL?.trim() || 'https://whelkmail.internal'
    const request = new Request(`${origin}/api/cron/notifications`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CRON_SECRET ?? ''}` },
    })
    ctx.waitUntil(handleRequest(request, env, { waitUntil: (promise) => ctx.waitUntil(promise) }))
  },
}
