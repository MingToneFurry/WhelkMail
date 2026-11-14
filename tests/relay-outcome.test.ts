import { afterEach, describe, expect, it, vi } from 'vitest'
import { relayErrorFromSmtp } from '../functions/_lib/relay/custom'
import { isRelayRejection, RelayError } from '../functions/_lib/relay/types'
import { CloudflareRelay } from '../functions/_lib/relay/cloudflare'
import { SmtpError } from '../functions/_lib/smtp/client'
import type { RelayMessage } from '../functions/_lib/relay/types'

const message: RelayMessage = {
  fromName: 'Alerts',
  fromEmail: 'alerts@example.com',
  to: ['a@example.com'],
  cc: [],
  bcc: [],
  subject: 'Hi',
  text: 'Body',
  attachments: [],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )
}

describe('relay outcome classification', () => {
  it('treats a provider error response as a definite rejection', async () => {
    mockFetch(403, { success: false, errors: [{ code: 10203, message: 'disabled' }], result: null })

    const error = await new CloudflareRelay('token', 'acct').send(message).catch((reason) => reason)

    expect(isRelayRejection(error)).toBe(true)
    expect((error as RelayError).status).toBe(403)
  })

  it('treats a 400 as a definite rejection', async () => {
    mockFetch(400, { success: false, errors: [{ code: 1, message: 'bad request' }] })

    const error = await new CloudflareRelay('token', 'acct').send(message).catch((reason) => reason)

    expect(isRelayRejection(error)).toBe(true)
  })

  it('leaves a 500 unknown: the provider may have accepted the message', async () => {
    mockFetch(500, { success: false, errors: [{ code: 1, message: 'internal error' }] })

    const error = await new CloudflareRelay('token', 'acct').send(message).catch((reason) => reason)

    expect(isRelayRejection(error)).toBe(false)
  })

  it('leaves a 503 unknown', async () => {
    mockFetch(503, { success: false, errors: [{ code: 1, message: 'unavailable' }] })

    const error = await new CloudflareRelay('token', 'acct').send(message).catch((reason) => reason)

    expect(isRelayRejection(error)).toBe(false)
  })

  it('does not classify a network failure as a rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down')
      }),
    )

    const error = await new CloudflareRelay('token', 'acct').send(message).catch((reason) => reason)

    expect(isRelayRejection(error)).toBe(false)
  })

  it('treats a negative SMTP reply as a definite rejection', () => {
    const error = new SmtpError('RCPT TO: 550 no such user')
    error.replyCode = 550

    const mapped = relayErrorFromSmtp(error)

    expect(isRelayRejection(mapped)).toBe(true)
    expect((mapped as RelayError).status).toBe(550)
  })

  it('keeps an interrupted SMTP session unknown', () => {
    // A dropped socket may have happened after the server accepted the message.
    expect(isRelayRejection(relayErrorFromSmtp(new SmtpError('SMTP connection closed')))).toBe(
      false,
    )
    expect(isRelayRejection(relayErrorFromSmtp(new SmtpError('SMTP send timed out')))).toBe(false)
  })
})
