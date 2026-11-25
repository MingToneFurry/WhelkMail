import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { processAutoReply } from '../functions/_lib/auto-reply'
import type { AccountRow } from '../functions/_lib/db'
import type { Env } from '../functions/_lib/env'
import { forwardFilteredMessage } from '../functions/_lib/forward'
import { loadRaw } from '../functions/_lib/mail/load'
import { parseFull } from '../functions/_lib/mail/parse'
import { sendWithAccount } from '../functions/_lib/mail/smtp'
import type { ImapMessageRow } from '../functions/_lib/sync'
import { openSqlite, type SqliteDatabase } from '../server/adapters/db/sqlite'

vi.mock('../functions/_lib/mail/load', () => ({ loadRaw: vi.fn() }))
vi.mock('../functions/_lib/mail/smtp', () => ({ sendWithAccount: vi.fn() }))

describe('generated mail language', () => {
  let db: SqliteDatabase
  let env: Env
  const account = {
    id: 'account', kind: 'imap', display_name: 'Owner', email: 'owner@example.com', auto_saves_sent: 1,
  } as AccountRow
  const original = {
    id: 'message', uid: 5, account_id: account.id, folder: 'inbox', message_id: '<a@example.com>',
    from_name: null, from_email: 'sender@example.com', subject: '', sent_at: new Date().toISOString(),
  }

  beforeEach(() => {
    db = openSqlite(':memory:')
    db.exec(readFileSync('db/schema.sql', 'utf8'))
    env = { DB: db } as unknown as Env
    vi.clearAllMocks()
  })
  afterEach(() => db.close())

  it('forwards with Chinese labels and keeps the original body intact', async () => {
    const bytes = new TextEncoder().encode('From: sender@example.com\r\n\r\nOriginal content.')
    vi.mocked(loadRaw).mockResolvedValue({ bytes, account, folder: 'inbox', source: 'imap', needsSeen: false })
    const result = await forwardFilteredMessage(env, account, 'filter', ['reader@example.com'], original as ImapMessageRow)
    expect(result).toBe('sent')
    const mail = await parseFull(vi.mocked(sendWithAccount).mock.calls[0][2])
    expect(mail.subject).toBe('Fwd: （无主题）')
    expect(mail.text).toContain('发件人')
    expect(mail.text).toContain('Original content.')
  })

  it.each([
    { locale: undefined, subject: 'Re: 您的邮件', words: '不在办公室' },
    { locale: 'unknown', subject: 'Re: 您的邮件', words: '不在办公室' },
    { locale: 'en', subject: 'Re: your message', words: 'out of the office' },
    { locale: 'it', subject: 'Re: il tuo messaggio', words: 'fuori ufficio' },
  ])('uses the configured vacation template for $locale', async ({ locale, subject, words }) => {
    env.MAIL_LOCALE = locale
    db.exec("INSERT INTO app_settings (key, value) VALUES ('auto_reply_enabled', '1')")
    expect(await processAutoReply(env, account, original)).toBe('sent')
    const mail = await parseFull(vi.mocked(sendWithAccount).mock.calls[0][2])
    expect(mail.text).toContain(words)
    expect(mail.subject).toBe(subject)
  })

  it('preserves the configured vacation subject and body regardless of language', async () => {
    db.exec(`INSERT INTO app_settings (key, value) VALUES
      ('auto_reply_enabled', '1'), ('auto_reply_subject', 'Back on Monday'), ('auto_reply_body', 'Your note was received.')`)
    expect(await processAutoReply(env, account, original)).toBe('sent')
    const mail = await parseFull(vi.mocked(sendWithAccount).mock.calls[0][2])
    expect(mail.subject).toBe('Back on Monday')
    expect(mail.text?.trim()).toBe('Your note was received.')
  })
})
