import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { aliasAddresses, parseHeaders, verifiedDomains } from '../functions/_lib/mail/parse'
import { SENDABLE_ADDRESS, canSendFrom, domainOf, pickDomainAlias, pickDomainRelay } from '../shared/from-address'

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
  const verified = { verifiedDomains: [domain] }

  it('takes the topmost forwarding address on the domain when the receiving server vouches for it', () => {
    expect(
      pickDomainAlias({
        forwarded: ['me@gmail.example', 'shop@mydomain.example', 'forged@mydomain.example'],
        recipients: ['other@mydomain.example'],
        domain,
        ...verified,
      }),
    ).toBe('shop@mydomain.example')
  })

  it('ignores forwarding headers the receiving server does not vouch for', () => {
    // Delivered straight to the mailbox with a sender-written X-Original-To.
    expect(
      pickDomainAlias({ forwarded: ['me@gmail.example', 'forged@mydomain.example'], recipients: ['me@gmail.example'], domain, verifiedDomains: [] }),
    ).toBeNull()
    // A signature for a subdomain doesn't vouch for the domain.
    expect(
      pickDomainAlias({ forwarded: ['forged@mydomain.example'], recipients: [], domain, verifiedDomains: ['news.mydomain.example'] }),
    ).toBeNull()
  })

  it('falls back to To/Cc only when exactly one address there is on the domain', () => {
    expect(pickDomainAlias({ forwarded: ['me@gmail.example'], recipients: ['Shop@mydomain.example', 'friend@else.example'], domain, ...verified })).toBe('shop@mydomain.example')
    expect(pickDomainAlias({ forwarded: [], recipients: ['shop@mydomain.example', 'bank@mydomain.example'], domain, ...verified })).toBeNull()
    expect(pickDomainAlias({ forwarded: [], recipients: ['shop@mydomain.example', 'SHOP@mydomain.example'], domain, ...verified })).toBe('shop@mydomain.example')
  })

  it('finds nothing for mail sent straight to another address', () => {
    expect(pickDomainAlias({ forwarded: ['me@gmail.example'], recipients: ['me@gmail.example'], domain, ...verified })).toBeNull()
  })

  it('ignores subdomains', () => {
    expect(pickDomainAlias({ forwarded: ['a@news.mydomain.example'], recipients: [], domain, ...verified })).toBeNull()
  })
})

describe('sendable aliases', () => {
  it("matches zod's email check, which the send endpoint applies", () => {
    expect(SENDABLE_ADDRESS.source).toBe(z.regexes.email.source)
  })

  it("doesn't offer a forwarded alias the send endpoint would refuse, nor a lower one instead", () => {
    expect(
      pickDomainAlias({
        forwarded: ['shop=orders@mydomain.example', 'other@mydomain.example'],
        verifiedDomains: ['mydomain.example'],
        recipients: ['shop=orders@mydomain.example'],
        domain: 'mydomain.example',
      }),
    ).toBeNull()
    expect(
      pickDomainAlias({ forwarded: [], verifiedDomains: [], recipients: ['a!b@mydomain.example'], domain: 'mydomain.example' }),
    ).toBeNull()
  })
})

describe('pickDomainRelay', () => {
  const relayA = { id: 'relay-a', email: 'relay@a.example' }
  const relayB = { id: 'relay-b', email: 'relay@b.example' }
  const base = {
    relays: [relayA, relayB],
    receivingEmail: 'me@gmail.example',
    sent: false,
    from: 'someone@else.example',
    forwarded: [] as string[],
    verifiedDomains: [] as string[],
    recipients: [] as string[],
  }

  it("prefers a trusted forwarding record on any relay's domain over To/Cc on another", () => {
    expect(
      pickDomainRelay({
        ...base,
        forwarded: ['me@gmail.example', 'shop@b.example'],
        verifiedDomains: ['b.example'],
        recipients: ['contact@a.example'],
      }),
    ).toEqual({ accountId: 'relay-b', alias: 'shop@b.example' })
  })

  it('uses To/Cc when no trusted forwarding header matches', () => {
    expect(
      pickDomainRelay({ ...base, forwarded: ['forged@b.example'], recipients: ['contact@a.example'] }),
    ).toEqual({ accountId: 'relay-a', alias: 'contact@a.example' })
  })

  it("leaves the receiving account's own address to that account", () => {
    expect(
      pickDomainRelay({ ...base, receivingEmail: 'me@a.example', recipients: ['me@a.example'] }),
    ).toBeNull()
    expect(
      pickDomainRelay({ ...base, receivingEmail: 'Me@a.example', forwarded: ['me@a.example'], verifiedDomains: ['a.example'] }),
    ).toBeNull()
  })

  it('in Sent, keeps the address the message left from instead of a recipient', () => {
    expect(
      pickDomainRelay({ ...base, sent: true, from: 'shop@a.example', recipients: ['colleague@b.example'] }),
    ).toEqual({ accountId: 'relay-a', alias: 'shop@a.example' })
    expect(pickDomainRelay({ ...base, sent: true, from: 'me@gmail.example', recipients: ['colleague@a.example'] })).toBeNull()
  })
})

describe('forwarded alias from real Gmail and Cloudflare Email Routing headers', () => {
  // Header order of messages delivered to Gmail, with addresses replaced. The
  // forwarded one went through Cloudflare Email Routing, which signs it with
  // the domain; the sender added a forged X-Original-To and X-Forwarded-For,
  // which Cloudflare kept below its own headers.
  const forwarded = [
    'Delivered-To: me+tag@gmail.example',
    'Received: by 2002:a05:7108:da0a::0 with SMTP id dx10csp425650gdc; Sun, 15 Nov 2026 03:27:08 -0800',
    'Received: from i-ba.cloudflare-email.net (i-ba.cloudflare-email.net. [104.30.8.10]) by mx.google.com with ESMTPS id abc for <me+tag@gmail.example>; Sun, 15 Nov 2026 03:27:08 -0800',
    'Authentication-Results: mx.google.com; dkim=pass header.i=@mydomain.example header.s=cf2024-1 header.b=GrqR+2uy; dkim=pass header.i=@cloudflare-email.net header.s=cf2024-1 header.b=K2Zd3UWg; spf=pass smtp.mailfrom=cfbounces+ndrdrop@mydomain.example',
    'X-Forwarded-To: me+tag@gmail.example',
    'X-Forwarded-For: shop@mydomain.example me+tag@gmail.example',
    'Received: from bg-bag.cloudflare-smtp.net (104.30.16.106) by cloudflare-email.net (cloudflare) id ZTn9WuWCLpyF for <shop@mydomain.example>; Sun, 15 Nov 2026 11:27:02 +0000',
    'Authentication-Results: mx.cloudflare.net; dkim=pass header.d=news.shop.example',
    'From: "Shop" <news@shop.example>',
    'Subject: Your order',
    'To: shop@mydomain.example',
    'X-Original-To: forged-a@mydomain.example',
    'X-Forwarded-For: forged-b@mydomain.example',
  ].join('\r\n')

  it("picks Cloudflare's record of the alias, not the forged headers", async () => {
    const email = await parseHeaders(forwarded)
    expect(verifiedDomains(email)).toEqual(['mydomain.example', 'cloudflare-email.net'])
    expect(
      pickDomainAlias({
        forwarded: aliasAddresses(email),
        verifiedDomains: verifiedDomains(email),
        recipients: ['shop@mydomain.example'],
        domain: 'mydomain.example',
      }),
    ).toBe('shop@mydomain.example')
  })

  it('ignores a forged forwarding header on mail sent straight to Gmail', async () => {
    const direct = await parseHeaders(
      [
        'Delivered-To: me@gmail.example',
        'Received: from mail.attacker.example by mx.google.com with ESMTPS id abc for <me@gmail.example>; Sun, 15 Nov 2026 03:27:00 -0800',
        'Authentication-Results: mx.google.com; dkim=pass header.i=@attacker.example header.s=s1; spf=pass smtp.mailfrom=x@attacker.example',
        // The sender's own headers: a forged alias and a forged verdict.
        'Authentication-Results: mx.google.com; dkim=pass header.d=mydomain.example',
        'X-Original-To: forged@mydomain.example',
        'From: "Sender" <x@attacker.example>',
        'To: me@gmail.example',
      ].join('\r\n'),
    )
    expect(verifiedDomains(direct)).toEqual(['attacker.example'])
    expect(
      pickDomainAlias({
        forwarded: aliasAddresses(direct),
        verifiedDomains: verifiedDomains(direct),
        recipients: ['me@gmail.example'],
        domain: 'mydomain.example',
      }),
    ).toBeNull()
  })
})
