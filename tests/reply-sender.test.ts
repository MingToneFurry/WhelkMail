import { describe, expect, it } from 'vitest'
import { pickReplyAccount } from '../shared/from-address'
import { pickReplySender, privateReplyAlias, privateSenderAccount, replyParticipants } from '../src/lib/sender'

const ids = ['provider', 'domain-relay', 'other']

describe('reply participants', () => {
  const message = {
    folder: 'inbox' as const,
    from: { name: 'owner@gmail.com', email: 'sender@example.org' },
    to: [{ name: null, email: 'o.wn.er+list@GoogleMail.com' }, { name: null, email: 'member+team@gmail.com' }],
    cc: [{ name: null, email: 'OWNER+copy@gmail.com' }, { name: null, email: 'Member+other@gmail.com' }],
  }

  it('omits equivalent private addresses from To and Cc, and omits the original display name from the quote', () => {
    expect(replyParticipants(message, true, [], ['owner@gmail.com'])).toEqual({
      to: ['sender@example.org', 'member+team@gmail.com'], cc: ['Member+other@gmail.com'], quotedSender: 'sender@example.org',
    })
    expect(replyParticipants({ ...message, from: message.to[0] }, false, [], ['owner@gmail.com'])).toEqual({
      to: [], cc: [], quotedSender: '',
    })
  })

  it('preserves standard reply-all recipients and display names outside privacy mode', () => {
    expect(replyParticipants(message, true, [])).toEqual({
      to: ['sender@example.org', 'o.wn.er+list@GoogleMail.com', 'member+team@gmail.com'],
      cc: ['OWNER+copy@gmail.com', 'Member+other@gmail.com'],
      quotedSender: 'owner@gmail.com <sender@example.org>',
    })
  })
})

describe('private reply identity', () => {
  const domain = 'example.org'
  const incoming = {
    folder: 'inbox' as const,
    verifiedDomains: [domain],
    aliasAddresses: ['personal@gmail.com', 'shop@example.org'],
  }
  const catchAll = { kind: 'relay', email: 'hub@example.org', relayAnyAddress: true }

  it('suggests only one alias from the verified forwarding path', () => {
    expect(privateReplyAlias(incoming, domain)).toBe('shop@example.org')
    expect(privateReplyAlias({ ...incoming, verifiedDomains: [] }, domain)).toBeNull()
    expect(privateReplyAlias({ ...incoming, aliasAddresses: ['personal@gmail.com'] }, domain)).toBeNull()
    expect(privateReplyAlias({ ...incoming, aliasAddresses: ['one@example.org', 'two@example.org'] }, domain)).toBeNull()
    expect(privateReplyAlias({ ...incoming, folder: 'sent' }, domain)).toBeNull()
  })

  it('accepts a manually entered alias only with an unambiguous route on the private domain', () => {
    expect(privateSenderAccount([catchAll], 'Shop@example.org', domain)).toBe(catchAll)
    expect(privateSenderAccount([catchAll], '', domain)).toBeNull()
    expect(privateSenderAccount([catchAll], 'my@gmail.com', domain)).toBeNull()
    expect(privateSenderAccount([{ ...catchAll, kind: 'imap' }], catchAll.email, domain)).toBeNull()
    const exact = { ...catchAll, email: 'shop@example.org' }
    expect(privateSenderAccount([catchAll, exact], exact.email, domain)).toBe(exact)
    expect(privateSenderAccount([catchAll, exact], 'another@example.org', domain)).toBeNull()
  })
})

describe('pickReplySender', () => {
  it('uses the account configured on the mailbox that received the message', () => {
    expect(
      pickReplySender({
        messageAccountId: 'provider',
        replyAccountId: 'domain-relay',
        defaultSender: 'auto',
        accountIds: ids,
      }),
    ).toBe('domain-relay')
  })

  it('answers from the alias the message was sent to, when nothing is configured', () => {
    expect(
      pickReplySender({
        messageAccountId: 'provider',
        replyAccountId: null,
        aliasAccountId: 'domain-relay',
        defaultSender: 'auto',
        accountIds: ids,
      }),
    ).toBe('domain-relay')
  })

  it('keeps the explicit mapping above the alias and the alias above the preference', () => {
    expect(
      pickReplySender({
        messageAccountId: 'provider',
        replyAccountId: 'other',
        aliasAccountId: 'domain-relay',
        defaultSender: 'other',
        accountIds: ids,
      }),
    ).toBe('other')

    expect(
      pickReplySender({
        messageAccountId: 'provider',
        replyAccountId: null,
        aliasAccountId: 'domain-relay',
        defaultSender: 'other',
        accountIds: ids,
      }),
    ).toBe('domain-relay')
  })

  it('beats the global reply preference', () => {
    expect(
      pickReplySender({
        messageAccountId: 'provider',
        replyAccountId: 'domain-relay',
        defaultSender: 'other',
        accountIds: ids,
      }),
    ).toBe('domain-relay')
  })

  it('falls back to the global preference, then to the receiving account', () => {
    expect(
      pickReplySender({
        messageAccountId: 'provider',
        replyAccountId: null,
        defaultSender: 'other',
        accountIds: ids,
      }),
    ).toBe('other')

    expect(
      pickReplySender({
        messageAccountId: 'provider',
        replyAccountId: null,
        defaultSender: 'auto',
        accountIds: ids,
      }),
    ).toBe('provider')
  })

  it('ignores mappings that point at a deleted account', () => {
    expect(
      pickReplySender({
        messageAccountId: 'provider',
        replyAccountId: 'gone',
        defaultSender: 'auto',
        accountIds: ids,
      }),
    ).toBe('provider')
    expect(
      pickReplySender({
        messageAccountId: 'provider',
        replyAccountId: 'gone',
        defaultSender: 'gone-too',
        accountIds: ids,
      }),
    ).toBe('provider')
  })
})

describe('alias detection inputs', () => {
  // The domain account from a forwarded message, as aliasAccountFor() in App asks.
  const input = {
    accounts: [{ id: 'domain-relay', email: 'email@dominio.it', anyAddress: false }],
    receivingEmail: 'email@provider.it',
    sent: false,
    from: 'someone@else.it',
    forwarded: ['email@dominio.it'],
    verifiedDomains: [] as string[],
    recipients: ['email@provider.it'],
  }

  it('matches the domain account from a forwarding header the receiving server vouches for', () => {
    expect(pickReplyAccount({ ...input, verifiedDomains: ['dominio.it'] })?.accountId).toBe('domain-relay')
  })

  it('ignores the same header without that check, but still reads To', () => {
    expect(pickReplyAccount(input)).toBeNull()
    expect(pickReplyAccount({ ...input, recipients: ['email@dominio.it'] })?.accountId).toBe('domain-relay')
  })
})
