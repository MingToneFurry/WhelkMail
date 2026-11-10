import { describe, expect, it } from 'vitest'
import { digestNotification, mailNotification, NOTIFICATION_TAG } from '../functions/_lib/push'

function payload(messageId = 'imap:acc-1:inbox:42') {
  return mailNotification({
    messageId,
    title: 'Alice',
    body: 'Ciao',
  })
}

describe('notification tag', () => {
  it('is a single slot for the whole app', () => {
    // A per-message tag made every new mail a separate notification; Android
    // then groups them and swaps the badge for the grouping indicator.
    expect(payload('imap:acc-1:inbox:10').tag).toBe(NOTIFICATION_TAG)
    expect(payload('imap:acc-2:spam:99').tag).toBe(NOTIFICATION_TAG)
    expect(payload().tag).toBe(payload('relay:acc-1:draft:1').tag)
  })

  it('does not depend on the message, account or folder', () => {
    expect(payload().tag).toBe('whelkmail')
  })
})

describe('mail notification payload', () => {
  it('keeps the badge assets out of the payload so the service worker defaults apply', () => {
    const result = payload()
    expect(result.icon).toBeUndefined()
    expect(result.badge).toBeUndefined()
  })

  it('asks for a new alert when the notification is replaced', () => {
    expect(payload().renotify).toBe(true)
  })

  it('opens the newest message and encodes the id', () => {
    expect(payload().url).toBe('/?message=imap%3Aacc-1%3Ainbox%3A42')
  })
})

function message(index: number) {
  return {
    messageId: `imap:acc-1:inbox:${index}`,
    title: `Sender ${index}`,
    body: `Subject ${index}`,
  }
}

describe('notification digest', () => {
  it('keeps the plain notification for a single message', () => {
    const result = digestNotification([message(1)])
    expect(result.title).toBe('Sender 1')
    expect(result.body).toBe('Subject 1')
    expect(result.tag).toBe(NOTIFICATION_TAG)
  })

  it('lists every message in one notification', () => {
    const result = digestNotification([message(1), message(2), message(3)])
    expect(result.title).toBe('3 nuovi messaggi')
    expect(result.body.split('\n')).toEqual([
      'Sender 1: Subject 1',
      'Sender 2: Subject 2',
      'Sender 3: Subject 3',
    ])
    // One tag means Android never groups them and keeps the badge.
    expect(result.tag).toBe(NOTIFICATION_TAG)
    expect(result.renotify).toBe(true)
  })

  it('opens the newest message of the batch', () => {
    const result = digestNotification([message(7), message(8)])
    expect(result.url).toBe('/?message=imap%3Aacc-1%3Ainbox%3A8')
  })

  it('caps the body but keeps the real count in the title', () => {
    const result = digestNotification([1, 2, 3, 4, 5, 6].map(message))
    expect(result.title).toBe('6 nuovi messaggi')
    expect(result.body.split('\n')).toHaveLength(4)
    expect(result.body.startsWith('Sender 3')).toBe(true)
  })

  it('refuses an empty batch', () => {
    expect(() => digestNotification([])).toThrow()
  })
})
