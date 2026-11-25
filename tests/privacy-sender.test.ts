import { describe, expect, it, vi } from 'vitest'
import { privacyAccountAllowed } from '../shared/privacy-sender'
import { onRequestPost } from '../functions/api/messages/send'
import { sendWithAccount } from '../functions/_lib/mail/smtp'
import { processAutoReply } from '../functions/_lib/auto-reply'
import type { AccountRow } from '../functions/_lib/db'
import type { Env } from '../functions/_lib/env'
import { openSqlite } from '../server/adapters/db/sqlite'
import { migrateSqlite } from '../server/adapters/db/migrate'

const domain = 'aliases.example'
const relay = { kind: 'relay', email: 'hub@aliases.example', relayProvider: 'resend' }
const smtpRelay = { ...relay, relayProvider: 'custom', smtpSecurity: 'tls', smtpHost: 'mail.smtp2go.com' }

describe('protected sender domain', () => {
  it('allows a relay for the exact domain', () => {
    expect(privacyAccountAllowed(domain, relay)).toBe(true)
    expect(privacyAccountAllowed(domain, { ...relay, email: 'hub@sub.aliases.example' })).toBe(false)
    expect(privacyAccountAllowed(domain, { ...relay, kind: 'imap' })).toBe(false)
  })

  it('only allows encrypted submission to a trusted dedicated relay', () => {
    expect(privacyAccountAllowed(domain, smtpRelay)).toBe(true)
    expect(privacyAccountAllowed(domain, { ...smtpRelay, smtpSecurity: 'plain' })).toBe(false)
    expect(privacyAccountAllowed(domain, { ...smtpRelay, smtpHost: 'smtp.gmail.com' })).toBe(false)
    expect(privacyAccountAllowed(domain, { ...smtpRelay, username: 'owner@gmail.com' })).toBe(false)
    expect(privacyAccountAllowed(domain, { ...smtpRelay, smtpHost: 'mail.smtp2go.com.other.example' })).toBe(false)
    expect(privacyAccountAllowed(domain, { ...smtpRelay, smtpHost: 'submit.example' }, 'submit.example')).toBe(true)
  })

  it.each([
    ['imap', 'owner@gmail.com', undefined],
    ['imap', 'hub@aliases.example', 'hub@aliases.example'],
    ['relay', 'hub@aliases.example', undefined],
    ['relay', 'hub@aliases.example', 'someone@other.example'],
    ['relay', 'hub@other.example', 'alias@aliases.example'],
  ])('rejects %s / %s / %s before any transport or draft cleanup', async (kind, email, fromEmail) => {
    const first = vi.fn().mockResolvedValue({ id: 'a', kind, email, relay_any_address: 1 })
    const prepare = vi.fn(() => ({ bind: () => ({ first }) }))
    const request = new Request('https://web.example/api/messages/send', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'a', draftId: 'saved', fromEmail, to: ['alice@example.com'] }),
    })
    const context = { env: { DB: { prepare }, PRIVACY_SENDER_DOMAIN: domain }, request }
    const response = await onRequestPost(context as unknown as Parameters<typeof onRequestPost>[0])
    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe('privacy_sender_required')
    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it('disables vacation replies and protects the common SMTP transport used for background jobs', async () => {
    const env = { PRIVACY_SENDER_DOMAIN: domain } as Env
    const mailbox = { kind: 'imap', email: 'owner@gmail.com' } as AccountRow
    expect(await processAutoReply(env, mailbox, { folder: 'inbox' } as Parameters<typeof processAutoReply>[2])).toBe('skipped')
    await expect(sendWithAccount(env, mailbox, new Uint8Array(), ['alice@example.com'])).rejects.toThrow('domain sending relay')
  })

  it('delivers via the selected domain alias and keeps the original display name out of the submission and sent copy', async () => {
    const db = openSqlite(':memory:')
    const transport = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ id: 'accepted' }))
    vi.stubGlobal('fetch', transport)
    try {
      migrateSqlite(db, process.cwd())
      db.exec(`INSERT INTO accounts (id,email,display_name,kind,storage_driver,relay_provider,relay_any_address,created_at)
               VALUES ('relay','hub@aliases.example','owner@gmail.com','relay','r2','resend',1,'2026-01-01')`)
      const request = new Request('https://web.example/api/messages/send', {
        method: 'POST',
        body: JSON.stringify({ accountId: 'relay', fromEmail: 'bank@aliases.example', to: ['a@example.com'], bcc: ['b@example.com'] }),
      })
      const env = { DB: db, PRIVACY_SENDER_DOMAIN: domain, RELAY_API_KEY: 'mock', BUCKET: { put: vi.fn() } }
      const response = await onRequestPost({ request, env } as unknown as Parameters<typeof onRequestPost>[0])
      expect(response.status).toBe(201)
      expect(transport).toHaveBeenCalledTimes(1)
      const payload = JSON.parse(String(transport.mock.calls[0][1].body))
      expect(payload).toMatchObject({ from: 'bank@aliases.example', to: ['a@example.com'], bcc: ['b@example.com'] })
      expect(JSON.stringify(payload)).not.toContain('owner@gmail.com')
      expect(await db.prepare('SELECT from_name, from_email FROM messages').first()).toEqual({
        from_name: '', from_email: 'bank@aliases.example',
      })
    } finally {
      vi.unstubAllGlobals()
      db.close()
    }
  })
})
