import { describe, expect, it } from 'vitest'
import type { MailFilter, MessageSummary } from '../shared/types'
import { matchesFilter } from '../functions/_lib/filters'

function makeFilter(overrides: Partial<MailFilter> = {}): MailFilter {
  return {
    id: 'filter-1',
    name: 'Test filter',
    from: null,
    to: null,
    subject: null,
    hasWords: null,
    doesntHave: null,
    hasAttachment: false,
    labelIds: [],
    forwardTo: [],
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastForwardStatus: null,
    lastForwardError: null,
    lastForwardAt: null,
    ...overrides,
  }
}

function makeMessage(overrides: Partial<MessageSummary> = {}): MessageSummary {
  return {
    id: 'message-1',
    accountId: 'account-1',
    accountEmail: 'me@example.com',
    accountName: 'Me',
    folder: 'inbox',
    from: { name: 'Mario Rossi', email: 'mario@example.com' },
    to: [{ name: null, email: 'me@example.com' }],
    cc: [],
    bcc: [],
    subject: 'Fattura di novembre',
    snippet: 'Buongiorno, in allegato la fattura.',
    date: '2026-01-01T10:00:00.000Z',
    unread: false,
    hasAttachments: true,
    status: 'sent',
    labelIds: [],
    ...overrides,
  }
}

describe('matchesFilter', () => {
  it('matches sender, recipients, subject and words', () => {
    const filter = makeFilter({
      from: 'mario',
      to: 'me@example',
      subject: 'fattura',
      hasWords: 'allegato',
      doesntHave: 'spam',
    })
    expect(matchesFilter(filter, makeMessage())).toBe(true)
  })

  it('matches a filter on "to" against a forwarded address', () => {
    // info@domain.example is forwarded to the mailbox: its address only appears
    // in the forwarding headers, never in To.
    const forwarded = makeMessage({
      to: [{ name: null, email: 'me@provider.example' }],
      aliases: ['info@domain.example'],
    })
    expect(matchesFilter(makeFilter({ to: 'info@domain.example' }), forwarded)).toBe(true)
    expect(matchesFilter(makeFilter({ to: 'INFO@Domain.Example' }), forwarded)).toBe(true)
  })

  it('still rejects an address the message never went to', () => {
    const forwarded = makeMessage({
      to: [{ name: null, email: 'me@provider.example' }],
      aliases: ['info@domain.example'],
    })
    expect(matchesFilter(makeFilter({ to: 'sales@domain.example' }), forwarded)).toBe(false)
  })

  it('matches other criteria on forwarded mail too', () => {
    const forwarded = makeMessage({ aliases: ['info@domain.example'] })
    expect(matchesFilter(makeFilter({ from: 'mario', subject: 'fattura' }), forwarded)).toBe(true)
  })

  it('never matches messages outside the inbox', () => {
    expect(matchesFilter(makeFilter({ subject: 'fattura' }), makeMessage({ folder: 'sent' }))).toBe(
      false,
    )
  })

  it('requires all configured criteria', () => {
    expect(matchesFilter(makeFilter({ from: 'mario', subject: 'natale' }), makeMessage())).toBe(
      false,
    )
  })

  it('rejects messages containing the excluded words', () => {
    expect(matchesFilter(makeFilter({ doesntHave: 'allegato' }), makeMessage())).toBe(false)
  })

  it('checks attachments when requested', () => {
    expect(matchesFilter(makeFilter({ hasAttachment: true }), makeMessage())).toBe(true)
    expect(
      matchesFilter(makeFilter({ hasAttachment: true }), makeMessage({ hasAttachments: false })),
    ).toBe(false)
  })
})
