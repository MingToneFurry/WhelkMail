import { describe, expect, it } from 'vitest'
import { clientIp } from '../functions/_lib/rate-limit'

function request(headers: Record<string, string>): Request {
  return new Request('https://mail.example/api/auth/login', { method: 'POST', headers })
}

describe('clientIp', () => {
  it('prefers the Cloudflare header, which cannot be forged', () => {
    expect(
      clientIp(request({ 'CF-Connecting-IP': '203.0.113.7', 'X-Forwarded-For': '10.0.0.1' })),
    ).toBe('203.0.113.7')
  })

  it('takes the last forwarded entry, the one the closest proxy wrote', () => {
    // A client that sends its own X-Forwarded-For must not choose its bucket:
    // the trusted proxy appends the address it actually saw at the end.
    expect(clientIp(request({ 'X-Forwarded-For': '1.2.3.4, 198.51.100.9' }))).toBe('198.51.100.9')
  })

  it('handles a single entry and stray spaces', () => {
    expect(clientIp(request({ 'X-Forwarded-For': '  198.51.100.9  ' }))).toBe('198.51.100.9')
  })

  it('falls back to a fixed value when there is no address', () => {
    expect(clientIp(request({}))).toBe('unknown')
    expect(clientIp(request({ 'X-Forwarded-For': ' , ' }))).toBe('unknown')
  })

  it('truncates absurd values instead of storing them', () => {
    const huge = '9'.repeat(200)
    expect(clientIp(request({ 'X-Forwarded-For': huge })).length).toBe(64)
  })
})
