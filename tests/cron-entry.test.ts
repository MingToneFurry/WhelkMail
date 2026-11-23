import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../functions/api/cron/notifications'
import workers from '../server/entries/workers'
import type { Env } from '../functions/_lib/env'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function context(env: Partial<Env>, headers: Record<string, string> = {}) {
  const request = new Request('https://mail.example/api/cron/notifications', {
    method: 'POST',
    headers,
  })
  return { env: env as Env, request, waitUntil: () => undefined } as never
}

describe('cron endpoint', () => {
  it('rejects an external call when no secret is configured', async () => {
    // Opening this endpoint without a secret would let anyone trigger a sync.
    const response = await onRequestPost(context({}))

    expect(response.status).toBe(401)
  })

  it('rejects a wrong bearer token', async () => {
    const response = await onRequestPost(
      context({ CRON_SECRET: 'right' }, { Authorization: 'Bearer wrong' }),
    )

    expect(response.status).toBe(401)
  })
})

describe('workers scheduled handler', () => {
  it('runs the scheduled work in-process and reports a failure instead of throwing', async () => {
    // No CRON_SECRET here on purpose: the Workers entry must not depend on it.
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const waitUntil = vi.fn()

    await expect(
      workers.scheduled(
        {},
        {} as Env,
        { waitUntil } as never,
      ),
    ).resolves.toBeUndefined()

    // The env has no database, so the work fails and must be logged, not crash.
    expect(error).toHaveBeenCalled()
  })
})
