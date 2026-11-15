import { describe, expect, it } from 'vitest'
import { pickReplyAccount } from '../shared/from-address'
import { pickReplySender } from '../src/lib/sender'

const ids = ['provider', 'domain-relay', 'other']

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
