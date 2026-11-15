import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { aliasAddresses, parseHeaders, verifiedDomains } from '../functions/_lib/mail/parse'
import { SENDABLE_ADDRESS, canSendFrom, domainOf, pickDomainAlias, pickReplyAccount } from '../shared/from-address'

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

  it("prefers another address to the receiving mailbox's own, and uses it only when it's the only one", () => {
    const receiving = { receivingEmail: 'primary@mydomain.example' }
    expect(
      pickDomainAlias({ forwarded: ['primary@mydomain.example', 'shop@mydomain.example'], recipients: [], domain, ...verified, ...receiving }),
    ).toBe('shop@mydomain.example')
    expect(
      pickDomainAlias({ forwarded: [], recipients: ['primary@mydomain.example', 'shop@mydomain.example'], domain, ...verified, ...receiving }),
    ).toBe('shop@mydomain.example')
    // Reply as maps this mailbox to the relay: mail only to primary@ still replies as primary@.
    expect(
      pickDomainAlias({ forwarded: ['primary@mydomain.example'], recipients: ['primary@mydomain.example'], domain, ...verified, ...receiving }),
    ).toBe('primary@mydomain.example')
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

describe('pickReplyAccount', () => {
  const relayA = { id: 'relay-a', email: 'relay@a.example', anyAddress: true }
  const relayB = { id: 'relay-b', email: 'relay@b.example', anyAddress: true }
  const work = { id: 'work', email: 'me@work.example', anyAddress: false }
  const base = {
    accounts: [relayA, relayB],
    receivingEmail: 'me@gmail.example',
    sent: false,
    from: 'someone@else.example',
    forwarded: [] as string[],
    verifiedDomains: [] as string[],
    recipients: [] as string[],
  }

  it('does not choose between two relays allowed to send as the same domain', () => {
    // Picking the first would make the reply depend on account order: no alias.
    const twinA = { id: 'twin-a', email: 'one@shared.example', anyAddress: true }
    const twinB = { id: 'twin-b', email: 'two@shared.example', anyAddress: true }
    expect(
      pickReplyAccount({
        ...base,
        accounts: [twinA, twinB],
        forwarded: ['shop@shared.example'],
        verifiedDomains: ['shared.example'],
      }),
    ).toBeNull()
    // Same when the alias only appears in To/Cc.
    expect(
      pickReplyAccount({
        ...base,
        accounts: [twinA, twinB],
        recipients: ['shop@shared.example'],
      }),
    ).toBeNull()
  })

  it('still answers from a relay when it is the only one for that domain', () => {
    expect(
      pickReplyAccount({
        ...base,
        forwarded: ['shop@b.example'],
        verifiedDomains: ['b.example'],
      }),
    ).toEqual({ accountId: 'relay-b', alias: 'shop@b.example' })
  })

  it("prefers a trusted forwarding record on any relay's domain over To/Cc on another", () => {
    expect(
      pickReplyAccount({
        ...base,
        forwarded: ['me@gmail.example', 'shop@b.example'],
        verifiedDomains: ['b.example'],
        recipients: ['contact@a.example'],
      }),
    ).toEqual({ accountId: 'relay-b', alias: 'shop@b.example' })
  })

  it('uses To/Cc when no trusted forwarding header matches', () => {
    expect(
      pickReplyAccount({ ...base, forwarded: ['forged@b.example'], recipients: ['contact@a.example'] }),
    ).toEqual({ accountId: 'relay-a', alias: 'contact@a.example' })
  })

  it('picks nothing from To/Cc when they name an address on more than one relay domain', () => {
    expect(pickReplyAccount({ ...base, recipients: ['contact@a.example', 'shop@b.example'] })).toBeNull()
    expect(pickReplyAccount({ ...base, accounts: [relayB, relayA], recipients: ['contact@a.example', 'shop@b.example'] })).toBeNull()
  })

  it("leaves the receiving account's own address to that account", () => {
    expect(
      pickReplyAccount({ ...base, receivingEmail: 'me@a.example', recipients: ['me@a.example'] }),
    ).toBeNull()
    expect(
      pickReplyAccount({ ...base, receivingEmail: 'Me@a.example', forwarded: ['me@a.example'], verifiedDomains: ['a.example'] }),
    ).toBeNull()
  })

  it("looks past the receiving mailbox's own address for the alias", () => {
    expect(
      pickReplyAccount({
        ...base,
        receivingEmail: 'primary@a.example',
        forwarded: ['primary@a.example', 'shop@a.example'],
        verifiedDomains: ['a.example'],
      }),
    ).toEqual({ accountId: 'relay-a', alias: 'shop@a.example' })
    expect(
      pickReplyAccount({ ...base, receivingEmail: 'primary@a.example', recipients: ['primary@a.example', 'shop@a.example'] }),
    ).toEqual({ accountId: 'relay-a', alias: 'shop@a.example' })
  })

  it('in Sent, keeps the address the message left from instead of a recipient', () => {
    expect(
      pickReplyAccount({ ...base, sent: true, from: 'shop@a.example', recipients: ['colleague@b.example'] }),
    ).toEqual({ accountId: 'relay-a', alias: 'shop@a.example' })
    expect(pickReplyAccount({ ...base, sent: true, from: 'me@gmail.example', recipients: ['colleague@a.example'] })).toBeNull()
  })

  it("leaves a relay's own Sent copy with that relay", () => {
    expect(
      pickReplyAccount({ ...base, sent: true, receivingIsRelay: true, from: 'shop@a.example' }),
    ).toBeNull()
  })

  describe('exact account matches', () => {
    const accounts = [work, relayA]

    it('takes a forwarding header naming an account only on a verified domain', () => {
      const forged = { ...base, accounts, forwarded: ['me@gmail.example', 'me@work.example'] }
      expect(pickReplyAccount(forged)).toBeNull()
      expect(pickReplyAccount({ ...forged, verifiedDomains: ['work.example'] })).toEqual({
        accountId: 'work',
        alias: 'me@work.example',
      })
    })

    it("doesn't let a forged lower header beat the forwarder's record", () => {
      expect(
        pickReplyAccount({
          ...base,
          accounts,
          forwarded: ['shop@a.example', 'me@work.example'],
          verifiedDomains: ['a.example', 'work.example'],
        }),
      ).toEqual({ accountId: 'relay-a', alias: 'shop@a.example' })
    })

    it('prefers an account with exactly the address over a domain relay', () => {
      const shop = { id: 'shop', email: 'shop@a.example', anyAddress: false }
      expect(
        pickReplyAccount({ ...base, accounts: [relayA, shop], forwarded: ['shop@a.example'], verifiedDomains: ['a.example'] }),
      ).toEqual({ accountId: 'shop', alias: 'shop@a.example' })
    })

    it('takes an account from To/Cc only when it is the only match', () => {
      expect(pickReplyAccount({ ...base, accounts, recipients: ['me@gmail.example', 'me@work.example'] })).toEqual({
        accountId: 'work',
        alias: 'me@work.example',
      })
      expect(
        pickReplyAccount({ ...base, accounts, recipients: ['me@work.example', 'contact@a.example'] }),
      ).toBeNull()
    })

    it('in Sent, matches the From, not the recipients', () => {
      expect(
        pickReplyAccount({ ...base, accounts, sent: true, from: 'me@gmail.example', recipients: ['me@work.example'] }),
      ).toBeNull()
      expect(pickReplyAccount({ ...base, accounts, sent: true, from: 'me@work.example' })).toEqual({
        accountId: 'work',
        alias: 'me@work.example',
      })
    })
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
