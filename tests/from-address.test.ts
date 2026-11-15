import { describe, expect, it } from 'vitest'
import { canSendFrom, domainOf } from '../shared/from-address'

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
