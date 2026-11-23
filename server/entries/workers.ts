import type { Env } from '../../functions/_lib/env'
import { handleRequest } from '../app'
import { registerWorkersSockets } from '../adapters/sockets/workers'
import { runScheduledTasks } from '../../functions/api/cron/notifications'

registerWorkersSockets()

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    return handleRequest(request, env, { waitUntil: (promise) => ctx.waitUntil(promise) })
  },

  async scheduled(_controller: unknown, env: Env, _ctx: ExecutionContextLike): Promise<void> {
    // The scheduled work runs in-process instead of calling the HTTP endpoint:
    // no CRON_SECRET is needed here, and a deployment that never set it keeps
    // syncing, notifying and forwarding instead of answering 401 forever.
    const started = Date.now()
    try {
      const result = await runScheduledTasks(env)
      console.log(
        `[cron] ${Date.now() - started}ms sent=${result.sent} forwarded=${result.forwarded} deleted=${result.deleted}`,
      )
    } catch (error) {
      // A failing cron must leave a trace: it can otherwise run broken silently.
      console.error(`[cron] failed after ${Date.now() - started}ms:`, error)
    }
  },
}
