import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrevoRelay } from '../functions/_lib/relay/brevo'
import { CloudflareRelay } from '../functions/_lib/relay/cloudflare'
import { CustomSmtpRelay } from '../functions/_lib/relay/custom'
import { MailgunRelay } from '../functions/_lib/relay/mailgun'
import { MailjetRelay } from '../functions/_lib/relay/mailjet'
import { PostmarkRelay } from '../functions/_lib/relay/postmark'
import { ResendRelay } from '../functions/_lib/relay/resend'
import { SendGridRelay } from '../functions/_lib/relay/sendgrid'
import { Smtp2GoRelay } from '../functions/_lib/relay/smtp2go'
import type { RelayAdapter, RelayMessage } from '../functions/_lib/relay/types'
import { SmtpConnection } from '../functions/_lib/smtp/client'

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
    name: 'smtp2go',
    adapter: () => new Smtp2GoRelay('key'),
    success: { data: { succeeded: 1, failed: 0, failures: [], email_id: 'id' } },
    status: 200,
    body: (text) => JSON.parse(text),
  },
  {
    name: 'mailgun',
    adapter: () => new MailgunRelay('key', 'example.com'),
    success: { id: 'id' },
    status: 200,
    body: (text) => JSON.parse(text),
  },
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
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function capture(status: number, body: unknown) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init.body instanceof FormData
        ? JSON.stringify(Object.fromEntries(init.body))
        : String(init.body))
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

  it('keeps To, Cc and Bcc in their own fields', async () => {
    const calls = capture(status, success)

    await adapter().send({ ...base, cc: ['cc@example.com'], bcc: ['bcc@example.com'] })

    const payload = body(calls[0]) as Record<string, unknown>
    const recipients = { to: 'dest@example.com', cc: 'cc@example.com', bcc: 'bcc@example.com' }
    for (const [role, address] of Object.entries(recipients)) {
      const field = findKey(payload, role)
      expect(field).toBeDefined()
      // Some adapters send strings, others send address objects.
      const addresses = JSON.stringify(payload[field!]).match(/[\w.]+@example\.com/g)
      expect(addresses).toEqual([address])
    }
  })
})

it('delivers custom SMTP blind copies only through the envelope', async () => {
  const sendRaw = vi.fn<SmtpConnection['sendRaw']>().mockResolvedValue(undefined)
  const connection = Object.create(SmtpConnection.prototype) as SmtpConnection
  Object.assign(connection, { sendRaw, authenticate: vi.fn(), quit: vi.fn() })
  vi.spyOn(SmtpConnection, 'open').mockResolvedValue(connection)

  const relay = new CustomSmtpRelay({
    host: 'relay.example.com', port: 465, security: 'tls', username: 'user', password: 'password',
  })
  await relay.send({ ...base, cc: ['copy@example.com'], bcc: ['blind@example.com'] })

  const [mime, from, envelope] = sendRaw.mock.calls[0]
  expect(from).toBe(base.fromEmail)
  expect(envelope).toEqual(['dest@example.com', 'copy@example.com', 'blind@example.com'])
  const headers = new TextDecoder().decode(mime).split('\r\n\r\n')[0]
  expect(headers).toContain('To: dest@example.com')
  expect(headers).toContain('Cc: copy@example.com')
  expect(headers).not.toMatch(/^Bcc:|blind@example\.com/im)
})
