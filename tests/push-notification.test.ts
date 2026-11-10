import { describe, expect, it } from 'vitest'
import { mailNotification, NOTIFICATION_TAG } from '../functions/_lib/push'

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
