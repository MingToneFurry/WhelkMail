import type { ForwardRule } from '../../shared/types'
import type { AccountRow } from './db'
import type { Env } from './env'
import { loadRaw } from './mail/load'
import { bodyText, parseFull, toMailbox } from './mail/parse'
import { sendWithAccount } from './mail/smtp'
import { buildMime } from './mime'
import type { ImapMessageRow } from './sync'

export interface ForwardRuleRow {
  id: string
  account_id: string
  label_id: string
  recipients_json: string
  enabled: number
  created_at: string
  updated_at: string
}

interface ForwardLogRow {
  rule_id: string
  status: string
  error: string | null
  updated_at: string
}

const decoder = new TextDecoder()

export function parseRecipients(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function toForwardRule(
  row: ForwardRuleRow,
  last?: ForwardLogRow,
): ForwardRule {
  return {
    id: row.id,
    accountId: row.account_id,
    labelId: row.label_id,
    recipients: parseRecipients(row.recipients_json),
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    lastStatus: last?.status ?? null,
    lastError: last?.error ?? null,
    lastAt: last?.updated_at ?? null,
  }
}

export async function listForwardRules(
  env: Env,
  accountId?: string,
): Promise<ForwardRule[]> {
  const rows = accountId
    ? await env.DB.prepare('SELECT * FROM forward_rules WHERE account_id = ? ORDER BY created_at ASC')
        .bind(accountId)
        .all<ForwardRuleRow>()
    : await env.DB.prepare('SELECT * FROM forward_rules ORDER BY created_at ASC').all<ForwardRuleRow>()
  const logs = await env.DB.prepare(
    'SELECT rule_id, status, error, updated_at FROM forward_log ORDER BY updated_at DESC LIMIT 500',
  ).all<ForwardLogRow>()
  const byRule = new Map<string, ForwardLogRow>()
  for (const log of logs.results) {
    if (!byRule.has(log.rule_id)) {
      byRule.set(log.rule_id, log)
    }
  }
  return rows.results.map((row) => toForwardRule(row, byRule.get(row.id)))
}

async function logForward(
  env: Env,
  rule: ForwardRuleRow,
  messageId: string,
  status: string,
  error: string | null = null,
): Promise<void> {
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO forward_log (id, rule_id, account_id, message_id, status, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(rule_id, message_id) DO UPDATE SET status = excluded.status, error = excluded.error, updated_at = excluded.updated_at`,
  )
    .bind(
      crypto.randomUUID(),
      rule.id,
      rule.account_id,
      messageId,
      status,
      error,
      now,
      now,
    )
    .run()
}

export async function forwardMessage(
  env: Env,
  account: AccountRow,
  rule: ForwardRuleRow,
  message: ImapMessageRow,
): Promise<string> {
  const existing = await env.DB.prepare(
    'SELECT status FROM forward_log WHERE rule_id = ? AND message_id = ?',
  )
    .bind(rule.id, message.id)
    .first<{ status: string }>()
  if (existing?.status === 'sent') {
    return 'sent'
  }

  try {
    const loaded = await loadRaw(env, message.id)
    if (!loaded) {
      await logForward(env, rule, message.id, 'failed', 'Messaggio originale non disponibile')
      return 'failed'
    }
    const head = decoder.decode(loaded.bytes.slice(0, 8192)).toLowerCase()
    if (head.includes('x-whelkmail-forwarded:')) {
      await logForward(env, rule, message.id, 'skipped', 'Messaggio già inoltrato')
      return 'skipped'
    }

    const email = await parseFull(loaded.bytes)
    const from = toMailbox(email.from)
    const subject = email.subject?.trim() || message.subject || '(nessun oggetto)'
    const recipients = parseRecipients(rule.recipients_json)
    if (recipients.length === 0) {
      await logForward(env, rule, message.id, 'failed', 'Nessun destinatario')
      return 'failed'
    }
    const originalText = bodyText(email).slice(0, 5000)
    const forwardedText = [
      '---------- Messaggio inoltrato ----------',
      `Da: ${from.name ? `${from.name} <${from.email}>` : from.email}`,
      `A: ${message.to_json ? parseRecipientsSafe(message.to_json).join(', ') : ''}`,
      `Data: ${email.date ?? message.sent_at}`,
      `Oggetto: ${subject}`,
      '',
      originalText,
    ].join('\n')
    const domain = account.email.split('@')[1] ?? 'whelkmail.local'
    const mime = buildMime({
      from: { name: account.display_name, email: account.email },
      to: recipients.map((recipient) => ({ email: recipient })),
      cc: [],
      bcc: [],
      subject: /^fwd:/i.test(subject) ? subject : `Fwd: ${subject}`,
      text: forwardedText,
      attachments: [
        {
          filename: `forwarded-${message.uid}.eml`,
          contentType: 'message/rfc822',
          content: loaded.bytes,
        },
      ],
      messageId: `<${crypto.randomUUID()}@${domain}>`,
      date: new Date(),
      headers: [`X-WhelkMail-Forwarded: ${rule.id}`],
    })
    await sendWithAccount(env, account, mime, recipients)
    await logForward(env, rule, message.id, 'sent')
    return 'sent'
  } catch (error) {
    await logForward(
      env,
      rule,
      message.id,
      'failed',
      error instanceof Error ? error.message : String(error),
    )
    return 'failed'
  }
}

function parseRecipientsSafe(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .map((item) => (typeof item === 'string' ? item : (item as { email?: string }).email))
      .filter((item): item is string => Boolean(item))
  } catch {
    return []
  }
}
