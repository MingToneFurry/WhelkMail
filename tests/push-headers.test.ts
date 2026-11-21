import { describe, expect, it } from 'vitest'
import { pushHeaders } from '../functions/_lib/push'

const authorization = 'vapid t=header.payload.signature, k=public-key'

describe('push headers', () => {
  it('keeps the RFC 8030 defaults', () => {
    expect(pushHeaders(authorization)).toEqual({
      Authorization: authorization,
      TTL: '86400',
      Urgency: 'normal',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
    })
  })

  it('marks new mail as high urgency so delivery is not deferred', () => {
    expect(pushHeaders(authorization, { urgency: 'high' }).Urgency).toBe('high')
  })

  it('accepts a custom TTL', () => {
    expect(pushHeaders(authorization, { ttlSeconds: 60 }).TTL).toBe('60')
  })
})
