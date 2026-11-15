import { describe, expect, it } from 'vitest'
import { aliasAddresses, parseHeaders } from '../functions/_lib/mail/parse'
import { canSendFrom, domainOf, pickDomainAlias } from '../shared/from-address'

const relay = { kind: 'relay', email: 'me@mydomain.example', relayAnyAddress: true }

describe('canSendFrom', () => {
  it("always allows the account's own address, in any case", () => {
    expect(canSendFrom({ ...relay, relayAnyAddress: false }, 'ME@mydomain.example')).toBe(true)
    expect(canSendFrom({ kind: 'imap', email: 'me@provider.example', relayAnyAddress: false }, 'me@provider.example')).toBe(true)
  })

  it('allows another address on the exact domain only when the setting is on', () => {
    expect(canSendFrom(relay, 'shop@mydomain.example')).toBe(true)
    expect(canSendFrom(relay, 'Shop@MyDomain.example')).toBe(true)
    expect(canSendFrom({ ...relay, relayAnyAddress: false }, 'shop@mydomain.example')).toBe(false)
  })

  it('refuses subdomains, lookalike domains and other domains', () => {
    expect(canSendFrom(relay, 'shop@news.mydomain.example')).toBe(false)
    expect(canSendFrom(relay, 'shop@evilmydomain.example')).toBe(false)
    expect(canSendFrom(relay, 'shop@mydomain.example.evil')).toBe(false)
    expect(canSendFrom(relay, 'ceo@bank.example')).toBe(false)
  })

  it('never lets an IMAP account send as another address', () => {
    const imap = { kind: 'imap', email: 'me@mydomain.example', relayAnyAddress: true }
    expect(canSendFrom(imap, 'shop@mydomain.example')).toBe(false)
  })

  it('reads the domain after the last @', () => {
    expect(domainOf('"a@b"@MyDomain.example')).toBe('mydomain.example')
    expect(domainOf('no-at-sign')).toBe('')
  })
})

describe('pickDomainAlias', () => {
  const domain = 'mydomain.example'

  it('takes the topmost forwarding address on the domain', () => {
    expect(
      pickDomainAlias({
        forwarded: ['me@gmail.example', 'shop@mydomain.example', 'forged@mydomain.example'],
        recipients: ['other@mydomain.example'],
        domain,
      }),
    ).toBe('shop@mydomain.example')
  })

  it('falls back to To/Cc only when exactly one address there is on the domain', () => {
    expect(pickDomainAlias({ forwarded: ['me@gmail.example'], recipients: ['Shop@mydomain.example', 'friend@else.example'], domain })).toBe('shop@mydomain.example')
    expect(pickDomainAlias({ forwarded: [], recipients: ['shop@mydomain.example', 'bank@mydomain.example'], domain })).toBeNull()
    expect(pickDomainAlias({ forwarded: [], recipients: ['shop@mydomain.example', 'SHOP@mydomain.example'], domain })).toBe('shop@mydomain.example')
  })

  it('finds nothing for mail sent straight to another address', () => {
    expect(pickDomainAlias({ forwarded: ['me@gmail.example'], recipients: ['me@gmail.example'], domain })).toBeNull()
  })

  it('ignores subdomains', () => {
    expect(pickDomainAlias({ forwarded: ['a@news.mydomain.example'], recipients: [], domain })).toBeNull()
  })
})

describe('forwarded alias from real Cloudflare Email Routing headers', () => {
  // Header order of a message forwarded by Cloudflare Email Routing to Gmail,
  // with addresses replaced. The sender added a forged X-Original-To and
  // X-Forwarded-For; Cloudflare kept them, below its own headers.
  const headers = [
    'Delivered-To: me+tag@gmail.example',
    'Received: by 2002:a05:7108:da0a::0 with SMTP id dx10csp425650gdc; Sun, 15 Nov 2026 03:27:08 -0800',
    'Received: from i-ba.cloudflare-email.net (i-ba.cloudflare-email.net. [104.30.8.10]) by mx.google.com with ESMTPS id abc for <me+tag@gmail.example>; Sun, 15 Nov 2026 03:27:08 -0800',
    'X-Forwarded-To: me+tag@gmail.example',
    'X-Forwarded-For: shop@mydomain.example me+tag@gmail.example',
    'Received: from bg-bag.cloudflare-smtp.net (104.30.16.106) by cloudflare-email.net (cloudflare) id ZTn9WuWCLpyF for <shop@mydomain.example>; Sun, 15 Nov 2026 11:27:02 +0000',
    'From: "Shop" <news@shop.example>',
    'Subject: Your order',
    'To: shop@mydomain.example',
    'X-Original-To: forged-a@mydomain.example',
    'X-Forwarded-For: forged-b@mydomain.example',
  ].join('\r\n')

  it("picks Cloudflare's record of the alias, not the forged headers", async () => {
    const email = await parseHeaders(headers)
    expect(
      pickDomainAlias({
        forwarded: aliasAddresses(email),
        recipients: ['shop@mydomain.example'],
        domain: 'mydomain.example',
      }),
    ).toBe('shop@mydomain.example')
  })

  it('finds no alias in a message sent straight to Gmail', async () => {
    const direct = await parseHeaders(
      [
        'Delivered-To: me@gmail.example',
        'Received: from bg-bag.cloudflare-smtp.net by mx.google.com with ESMTPS id abc for <me@gmail.example>; Sun, 15 Nov 2026 03:27:00 -0800',
        'From: "Sender" <header-test.noreply@notifications.mydomain.example>',
        'To: me@gmail.example',
      ].join('\r\n'),
    )
    expect(
      pickDomainAlias({ forwarded: aliasAddresses(direct), recipients: ['me@gmail.example'], domain: 'mydomain.example' }),
    ).toBeNull()
  })
})
