import { describe, expect, it } from 'vitest'
import { aliasAddresses, bodyText, dateOf, parseHeaders, toMailbox, toMailboxes } from '../functions/_lib/mail/parse'

describe('mail parsing', () => {
  it('parses common headers', async () => {
    const email = await parseHeaders(
      [
        'From: Mario Rossi <mario@example.com>',
        'To: Anna <anna@example.com>, me@example.com',
        'Subject: Ciao',
        'Date: Wed, 01 Jan 2026 10:00:00 +0000',
        'Message-ID: <abc@example.com>',
      ].join('\r\n'),
    )
    expect(email.subject).toBe('Ciao')
    expect(email.messageId).toBe('<abc@example.com>')
    expect(toMailbox(email.from)).toEqual({ name: 'Mario Rossi', email: 'mario@example.com' })
    expect(toMailboxes(email.to)).toEqual([
      { name: 'Anna', email: 'anna@example.com' },
      { name: null, email: 'me@example.com' },
    ])
    expect(dateOf(email)).toBe('2026-01-01T10:00:00.000Z')
  })

  it('falls back to a plain text version of HTML', async () => {
    const email = await parseHeaders(
      [
        'From: mario@example.com',
        'Subject: HTML',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>Prima riga</p><p>Seconda riga</p>',
      ].join('\r\n'),
    )
    expect(bodyText(email)).toContain('Prima riga')
    expect(bodyText(email)).toContain('Seconda riga')
    expect(bodyText(email)).not.toContain('<p>')
  })
})

describe('alias addresses', () => {
  it('keeps header order, topmost first, and reads Cloudflare\'s X-Forwarded-For', async () => {
    // Header order of a message forwarded by Cloudflare Email Routing to Gmail,
    // with addresses replaced. The sender added a forged X-Original-To and
    // X-Forwarded-For; Cloudflare kept them, below its own headers.
    const email = await parseHeaders(
      [
        'Delivered-To: me+tag@gmail.example',
        'Received: from i-ba.cloudflare-email.net by mx.google.com with ESMTPS id abc for <me+tag@gmail.example>; Sun, 15 Nov 2026 03:27:08 -0800',
        'X-Forwarded-To: me+tag@gmail.example',
        'X-Forwarded-For: shop@mydomain.example me+tag@gmail.example',
        'Received: from bg-bag.cloudflare-smtp.net by cloudflare-email.net (cloudflare) id ZTn9WuWCLpyF for <shop@mydomain.example>; Sun, 15 Nov 2026 11:27:02 +0000',
        'To: shop@mydomain.example',
        'X-Original-To: forged-a@mydomain.example',
        'X-Forwarded-For: forged-b@mydomain.example',
      ].join('\r\n'),
    )
    expect(aliasAddresses(email)).toEqual([
      'me+tag@gmail.example',
      'shop@mydomain.example',
      'forged-a@mydomain.example',
      'forged-b@mydomain.example',
    ])
  })
})
