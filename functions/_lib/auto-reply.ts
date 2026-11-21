import type { AccountRow } from './db'
import type { Env } from './env'
import { appendToSent } from './mail/imap'
import { sendWithAccount } from './mail/smtp'
import { buildMime } from './mime'

/** Wait at most this long before replying to the same sender again. */
const SENDER_COOLDOWN_MS = 24 * 60 * 60 * 1000
/** Never auto-reply to mail older than this, even if it is the first sync. */
const MAX_MESSAGE_AGE_MS = 7 * 24 * 60 * 60 * 1000

const DEFAULT_BODY =
  'I am currently out of the office and will get back to you as soon as possible.'

const NO_REPLY_SENDER = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce|notifications?)(\+.*)?@/i
const AUTO_REPLY_SUBJECT = /^(auto(matic)?[ -]?reply|out of office|fuori sede|risposta automatica)\b/i

interface AutoReplyConfig {
  enabled: boolean
  subject: string
  body: string
  bodyHtml: string
}

interface MessageRowLike {
  account_id: string
  folder: string
  message_id: string | null
  from_name: string | null
  from_email: string
  subject: string
  sent_at: string
  id: string
}

export async function autoReplyConfig(env: Env, account: AccountRow): Promise<AutoReplyConfig> {
  const result = await env.DB.prepare(
    'SELECT key, value FROM app_settings WHERE key IN (?, ?, ?, ?, ?)',
  )
    .bind(
      'auto_reply_mode',
      'auto_reply_enabled',
      'auto_reply_subject',
      'auto_reply_body',
      'auto_reply_body_html',
    )
    .all<{ key: string; value: string }>()
  const values = new Map(result.results.map((row) => [row.key, row.value]))
  const perAccount = values.get('auto_reply_mode') === 'per_account'
  if (perAccount) {
    return {
      enabled: Boolean(account.auto_reply_enabled),
      subject: account.auto_reply_subject ?? '',
      body: account.auto_reply_body ?? '',
      bodyHtml: account.auto_reply_body_html ?? '',
    }
  }
  return {
    enabled: values.get('auto_reply_enabled') === '1',
    subject: values.get('auto_reply_subject') ?? '',
    body: values.get('auto_reply_body') ?? '',
    bodyHtml: values.get('auto_reply_body_html') ?? '',
  }
}

/**
 * Send the vacation responder for one incoming message.
 *
 * The unique `(account_id, message_id)` row is inserted before sending: a
 * retried sync chunk or a second cron run cannot reply twice. A sender cooldown
 * prevents a loop with another auto-responder.
 */
export async function processAutoReply(
  env: Env,
  account: AccountRow,
  row: MessageRowLike,
): Promise<'sent' | 'skipped' | 'error'> {
  if (account.kind !== 'imap' || row.folder !== 'inbox') {
    return 'skipped'
  }
  const messageId = row.message_id?.trim() || row.id
  const sender = row.from_email?.trim().toLowerCase() ?? ''
  if (!sender || !sender.includes('@') || NO_REPLY_SENDER.test(sender)) {
    return 'skipped'
  }
  if (AUTO_REPLY_SUBJECT.test(row.subject ?? '')) {
    return 'skipped'
  }
  const sentAt = Date.parse(row.sent_at)
  if (Number.isFinite(sentAt) && Date.now() - sentAt > MAX_MESSAGE_AGE_MS) {
    return 'skipped'
  }
  const config = await autoReplyConfig(env, account)
  if (!config.enabled) {
    return 'skipped'
  }
  const own = await env.DB.prepare('SELECT lower(email) AS email FROM accounts').all<{
    email: string
  }>()
  if (own.results.some((item) => item.email === sender)) {
    return 'skipped'
  }
  const now = Date.now()
  const cooldown = await env.DB.prepare(
    "SELECT id FROM auto_reply_log WHERE account_id = ? AND lower(sender_email) = ? AND status = 'sent' AND created_at >= ? LIMIT 1",
  )
    .bind(account.id, sender, new Date(now - SENDER_COOLDOWN_MS).toISOString())
    .first<{ id: string }>()
  if (cooldown) {
    return 'skipped'
  }

  const logId = crypto.randomUUID()
  const createdAt = new Date(now).toISOString()
  const claimed = await env.DB.prepare(
    'INSERT OR IGNORE INTO auto_reply_log (id, account_id, message_id, sender_email, status, error, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
  )
    .bind(logId, account.id, messageId, sender, 'pending', createdAt)
    .run()
  if (!claimed.meta.changes) {
    return 'skipped'
  }

  const body = config.body.trim() || DEFAULT_BODY
  const bodyHtml = config.bodyHtml.trim()
  const subject = (config.subject.trim() || `Re: ${row.subject || 'your message'}`).slice(0, 200)
  const domain = account.email.split('@')[1] ?? 'localhost'
  const outboundId = `<auto-${crypto.randomUUID()}@${domain}>`
  const mime = buildMime({
    from: { name: account.display_name, email: account.email },
    to: [{ name: row.from_name ?? null, email: row.from_email }],
    cc: [],
    bcc: [],
    subject,
    text: body,
    html: bodyHtml || undefined,
    attachments: [],
    messageId: outboundId,
    inReplyTo: row.message_id,
    references: null,
    date: new Date(now),
    // RFC 3834: another auto-responder must not answer this reply.
    headers: ['Auto-Submitted: auto-replied', 'X-Auto-Response-Suppress: All'],
  })
  try {
    await sendWithAccount(env, account, mime, [row.from_email])
    if (!account.auto_saves_sent) {
      await appendToSent(env, account, mime).catch(() => undefined)
    }
    await env.DB.prepare('UPDATE auto_reply_log SET status = ? WHERE id = ?')
      .bind('sent', logId)
      .run()
    return 'sent'
  } catch (error) {
    await env.DB.prepare('UPDATE auto_reply_log SET status = ?, error = ? WHERE id = ?')
      .bind('error', error instanceof Error ? error.message : String(error), logId)
      .run()
      .catch(() => undefined)
    return 'error'
  }
}
