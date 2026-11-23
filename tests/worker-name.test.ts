import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM script without type declarations
import { resolveWorkerName } from '../scripts/worker-name.mjs'

describe('deploy Worker name', () => {
  it('prefers the Cloudflare override', () => {
    expect(
      resolveWorkerName({
        WRANGLER_CI_OVERRIDE_NAME: 'my-whelkmail',
        WORKER_NAME: 'local',
        CF_NAME: 'other',
      }),
    ).toBe('my-whelkmail')
  })

  it('falls back to WORKER_NAME and CF_NAME', () => {
    expect(resolveWorkerName({ WORKER_NAME: 'local-name' })).toBe('local-name')
    expect(resolveWorkerName({ CF_NAME: 'cf-name' })).toBe('cf-name')
  })

  it('returns null when no override is set', () => {
    expect(resolveWorkerName({})).toBeNull()
    expect(resolveWorkerName({ WRANGLER_CI_OVERRIDE_NAME: '  ' })).toBeNull()
  })

  it('rejects names Cloudflare cannot use', () => {
    expect(() => resolveWorkerName({ WORKER_NAME: 'Bad_Name' })).toThrow()
    expect(() => resolveWorkerName({ WORKER_NAME: '-leading' })).toThrow()
  })
})
