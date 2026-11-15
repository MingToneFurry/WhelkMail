import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudflareRelay } from '../functions/_lib/relay/cloudflare'
import { recipientLimitExceeded, relayDomainMissing, resolveRelayDomain } from '../functions/_lib/relay/validation'
import { findRelayProvider } from '../shared/presets'
import type { RelayMessage } from '../functions/_lib/relay/types'

const message: RelayMessage = {
  fromName: 'Alerts',
  fromEmail: 'alerts@notifications.example.com',
  to: ['a@example.com', 'b@example.com'],
  cc: [],
  bcc: ['c@example.com'],
  subject: 'Hello',
  text: 'Body',
  attachments: [
    { filename: 'hi.txt', contentType: 'text/plain', content: new TextEncoder().encode('hi\n') },
  ],
}

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cloudflare REST relay', () => {
  it('maps the message onto the send API and returns the message id', async () => {
    const fetchMock = mockFetch(200, {
      success: true,
      errors: [],
      result: { message_id: '<id@example.com>', delivered: [], queued: ['a@example.com', 'b@example.com', 'c@example.com'] },
    })
    const result = await new CloudflareRelay('token', 'acct123').send(message)
    expect(result.providerMessageId).toBe('<id@example.com>')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acct123/email/sending/send')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token')
    const body = JSON.parse(init.body as string)
    expect(body.from).toBe('"Alerts" <alerts@notifications.example.com>')
    expect(body.to).toEqual(['a@example.com', 'b@example.com'])
    expect(body.cc).toBeUndefined()
    expect(body.bcc).toEqual(['c@example.com'])
    expect(body.attachments).toEqual([
      { filename: 'hi.txt', type: 'text/plain', disposition: 'attachment', content: 'aGkK' },
    ])
  })

  it('surfaces Cloudflare error codes', async () => {
    mockFetch(403, {
      success: false,
      errors: [{ code: 10203, message: 'email.sending.error.email.sending_disabled' }],
      result: null,
    })
    await expect(new CloudflareRelay('token', 'acct').send(message)).rejects.toThrow(
      "notifications.example.com isn't set up for Email Sending in this Cloudflare account",
    )
    await expect(new CloudflareRelay('token', 'acct').send(message)).rejects.toThrow(
      '10203 email.sending.error.email.sending_disabled',
    )

    mockFetch(429, { success: false, errors: [{ code: 10004, message: 'email.sending.error.throttled' }], result: null })
    await expect(new CloudflareRelay('token', 'acct').send(message)).rejects.toThrow(
      'Cloudflare send failed: 10004 email.sending.error.throttled',
    )
  })

  it('reports bounced and suppressed recipients as undelivered instead of failing', async () => {
    mockFetch(200, {
      success: true,
      result: {
        message_id: '<x>',
        delivered: [],
        queued: [],
        permanent_bounces: ['a@example.com'],
        suppressed_recipients: ['b@example.com'],
      },
    })
    await expect(new CloudflareRelay('token', 'acct').send(message)).resolves.toEqual({
      providerMessageId: '<x>',
      undelivered: ['a@example.com', 'b@example.com'],
    })

    mockFetch(200, { success: true, result: { message_id: '<y>', delivered: ['a@example.com'], queued: [] } })
    await expect(new CloudflareRelay('token', 'acct').send(message)).resolves.toEqual({ providerMessageId: '<y>' })
  })
})

describe('relay domain validation', () => {
  it('names the account ID for Cloudflare and the domain for Mailgun', async () => {
    const cloudflare = relayDomainMissing(findRelayProvider('cloudflare')!)
    expect(cloudflare.status).toBe(400)
    expect(await cloudflare.json()).toMatchObject({
      error: 'Cloudflare Email Service account ID is required',
      code: 'relay_account_id_required',
    })

    const mailgun = relayDomainMissing(findRelayProvider('mailgun')!)
    expect(await mailgun.json()).toMatchObject({
      error: 'Mailgun domain is required',
      code: 'relay_domain_required',
    })
  })
})

describe('cloudflare account ID lookup on save', () => {
  const cloudflare = findRelayProvider('cloudflare')!

  /** One GET /accounts page listing these account IDs. */
  function accountsPage(ids: string[], page = 1, totalPages = 1) {
    return new Response(
      JSON.stringify({
        success: true,
        errors: [],
        result: ids.map((id) => ({ id, name: `Account ${id}` })),
        result_info: { page, per_page: 50, total_pages: totalPages, count: ids.length, total_count: ids.length },
      }),
    )
  }

  async function errorOf(result: string | Response) {
    expect(result).toBeInstanceOf(Response)
    const response = result as Response
    return { status: response.status, ...(await response.json()) }
  }

  it('fills in the account ID when the token reaches exactly one account', async () => {
    const fetchMock = vi.fn(async () => accountsPage(['acct1']))
    vi.stubGlobal('fetch', fetchMock)
    await expect(resolveRelayDomain(cloudflare, 'token', undefined)).resolves.toBe('acct1')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts?per_page=50&page=1')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token')
  })

  it('asks for the ID when the token reaches no account or several', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => accountsPage(['acct1', 'acct2'])))
    expect(await errorOf(await resolveRelayDomain(cloudflare, 'token', undefined))).toMatchObject({
      status: 400,
      code: 'relay_account_id_required',
      detail: 'This API token can reach 2 Cloudflare accounts, so enter the ID of the one to send from.',
    })

    vi.stubGlobal('fetch', vi.fn(async () => accountsPage([])))
    expect(await errorOf(await resolveRelayDomain(cloudflare, 'token', ''))).toMatchObject({
      code: 'relay_account_id_required',
      detail: "This API token doesn't list any Cloudflare accounts, so enter the account ID.",
    })
  })

  it('accepts an entered ID the token reaches, looking past the first page', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('page=1') ? accountsPage(['acct1'], 1, 2) : accountsPage(['acct2'], 2, 2),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(resolveRelayDomain(cloudflare, 'token', 'acct2')).resolves.toBe('acct2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('accepts an entered ID in capitals and saves it in lowercase', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => accountsPage(['0123abcd'])))
    await expect(resolveRelayDomain(cloudflare, 'token', '0123ABCD')).resolves.toBe('0123abcd')
  })

  it('rejects an entered ID the token does not reach', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => accountsPage(['acct1'])))
    expect(await errorOf(await resolveRelayDomain(cloudflare, 'token', 'someone-else'))).toMatchObject({
      status: 400,
      code: 'relay_account_denied',
      detail: "someone-else isn't one of the accounts this API token can reach.",
    })
  })

  it("reports a refused token with Cloudflare's own error", async () => {
    mockFetch(400, {
      success: false,
      errors: [{ code: 6003, message: 'Invalid request headers' }],
      result: null,
    })
    expect(await errorOf(await resolveRelayDomain(cloudflare, 'bad', 'acct1'))).toMatchObject({
      status: 400,
      code: 'relay_key_rejected',
      detail: '6003 Invalid request headers',
    })
  })

  it('says when Cloudflare could not be reached, without blaming the token', async () => {
    mockFetch(503, { success: false, errors: [], result: null })
    expect(await errorOf(await resolveRelayDomain(cloudflare, 'token', undefined))).toMatchObject({
      status: 502,
      code: 'relay_check_failed',
    })

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    expect(await errorOf(await resolveRelayDomain(cloudflare, 'token', undefined))).toMatchObject({
      status: 502,
      code: 'relay_check_failed',
      detail: 'fetch failed',
    })
  })
})

describe('relay recipient limit', () => {
  it('allows up to the limit and rejects one more, counting to, cc and bcc together', async () => {
    const relay = new CloudflareRelay('token', 'acct')
    expect(relay.maxRecipients).toBe(50)
    expect(recipientLimitExceeded(relay, 50)).toBeNull()

    const response = recipientLimitExceeded(relay, 51)
    expect(response?.status).toBe(400)
    expect(await response?.json()).toMatchObject({
      code: 'too_many_recipients',
      detail: 'Cloudflare Email Service allows at most 50 recipients per message (to, cc and bcc combined); this message has 51.',
    })
  })

  it('ignores relays without a limit', () => {
    expect(recipientLimitExceeded({ label: 'Postmark' }, 500)).toBeNull()
  })
})
