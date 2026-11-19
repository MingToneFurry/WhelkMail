import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrevoRelay } from '../functions/_lib/relay/brevo'
import { CloudflareRelay } from '../functions/_lib/relay/cloudflare'
import { MailjetRelay } from '../functions/_lib/relay/mailjet'
import { PostmarkRelay } from '../functions/_lib/relay/postmark'
import { ResendRelay } from '../functions/_lib/relay/resend'
import { SendGridRelay } from '../functions/_lib/relay/sendgrid'
import type { RelayAdapter, RelayMessage } from '../functions/_lib/relay/types'

/**
 * A message with no Cc and no Bcc must not carry empty recipient fields.
 *
 * Brevo answers `cc is missing` for `"cc": []`, which surfaced as
 * "Send failed: Brevo send failed: cc is missing" on every plain send from a
 * relay account. The same payload shape exists in other adapters, so every HTTP
 * provider is checked here.
 */

const base: RelayMessage = {
  fromName: 'Whelk',
  fromEmail: 'me@example.com',
  to: ['dest@example.com'],
  cc: [],
  bcc: [],
  subject: 'Hi',
  text: 'Body',
  attachments: [],
}

interface Case {
  name: string
  adapter: () => RelayAdapter
  /** Successful body for that provider. */
  success: unknown
  status: number
  body: (text: string) => Record<string, unknown> | undefined
}

const cases: Case[] = [
  {
    name: 'brevo',
    adapter: () => new BrevoRelay('key'),
    success: { messageId: '<id>' },
    status: 201,
    body: (text) => JSON.parse(text),
  },
  {
    name: 'mailjet',
    adapter: () => new MailjetRelay('key', 'secret'),
    success: { Messages: [{ Status: 'success', MessageID: 'id' }] },
    status: 200,
    body: (text) => JSON.parse(text).Messages?.[0],
  },
  {
    name: 'postmark',
    adapter: () => new PostmarkRelay('token'),
    success: { ErrorCode: 0, MessageID: 'id' },
    status: 200,
    body: (text) => JSON.parse(text),
  },
  {
    name: 'resend',
    adapter: () => new ResendRelay('key'),
    success: { id: 'id' },
    status: 200,
    body: (text) => JSON.parse(text),
  },
  {
    name: 'sendgrid',
    adapter: () => new SendGridRelay('key'),
    success: {},
    status: 202,
    body: (text) => JSON.parse(text).personalizations?.[0],
  },
  {
    name: 'cloudflare',
    adapter: () => new CloudflareRelay('token', 'acct'),
    success: { success: true, result: { message_id: '<id>' } },
    status: 200,
    body: (text) => JSON.parse(text),
  },
]

afterEach(() => {
  vi.unstubAllGlobals()
})

function capture(status: number, body: unknown) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(String(init.body))
      return new Response(JSON.stringify(body), { status })
    }),
  )
  return calls
}

/** Cc/Bcc spelled in either case, as the provider expects. */
function findKey(record: Record<string, unknown>, name: string): string | undefined {
  return Object.keys(record).find((key) => key.toLowerCase() === name)
}

describe.each(cases)('$name recipient fields', ({ adapter, success, status, body }) => {
  it('omits Cc and Bcc when there are none', async () => {
    const calls = capture(status, success)

    await adapter().send({ ...base })

    const payload = body(calls[0])
    expect(payload).toBeTruthy()
    expect(findKey(payload as Record<string, unknown>, 'cc')).toBeUndefined()
    expect(findKey(payload as Record<string, unknown>, 'bcc')).toBeUndefined()
  })

  it('sends Cc and Bcc when they are used', async () => {
    const calls = capture(status, success)

    await adapter().send({ ...base, cc: ['cc@example.com'], bcc: ['bcc@example.com'] })

    const payload = body(calls[0]) as Record<string, unknown>
    const ccKey = findKey(payload, 'cc')
    const bccKey = findKey(payload, 'bcc')
    expect(ccKey).toBeDefined()
    expect(bccKey).toBeDefined()
    expect(JSON.stringify(payload[ccKey as string])).toContain('cc@example.com')
    expect(JSON.stringify(payload[bccKey as string])).toContain('bcc@example.com')
  })
})
