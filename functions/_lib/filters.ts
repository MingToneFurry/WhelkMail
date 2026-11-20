import type { MailFilter, MessageSummary } from '../../shared/types'
import type { Env } from './env'
import { isSchemaError } from './schema'

export interface FilterRow {
  id: string
  account_id: string
  name: string
  from_pattern: string | null
  to_pattern: string | null
  subject_pattern: string | null
  has_words: string | null
  doesnt_have: string | null
  has_attachment: number
  label_ids_json: string
  forward_to_json: string
  enabled: number
  auto_label: number
  created_at: string
}

export interface ForwardLogSummary {
  filter_id: string
  status: string
  error: string | null
  updated_at: string
}

export interface FilterForwardMatch {
  filterId: string
  forwardTo: string[]
}

export function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function parseLabelIds(value: string): string[] {
  return parseStringArray(value)
}

export function toFilter(row: FilterRow, last?: ForwardLogSummary): MailFilter {
  return {
    id: row.id,
    accountId: row.account_id ?? '',
    autoLabel: Boolean(row.auto_label),
    name: row.name,
    from: row.from_pattern,
    to: row.to_pattern,
    subject: row.subject_pattern,
    hasWords: row.has_words,
    doesntHave: row.doesnt_have,
    hasAttachment: Boolean(row.has_attachment),
    labelIds: parseLabelIds(row.label_ids_json),
    forwardTo: parseStringArray(row.forward_to_json),
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    lastForwardStatus: last?.status ?? null,
    lastForwardError: last?.error ?? null,
    lastForwardAt: last?.updated_at ?? null,
  }
}

function includesText(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.trim().toLowerCase())
}

function recipientText(message: MessageSummary): string {
  const recipients = [...message.to, ...message.cc, ...message.bcc]
    .map((item) => `${item.name ?? ''} ${item.email}`)
    .join(' ')
  // A domain that only forwards leaves its address in the forwarding headers,
  // where the message was received by the mailbox that forwards it: without
  // these, a filter on "to: info@domain" never matches forwarded mail.
  const aliases = (message.aliases ?? []).join(' ')
  return aliases ? `${recipients} ${aliases}` : recipients
}

export function matchesFilter(filter: MailFilter, message: MessageSummary): boolean {
  // An empty accountId is a filter for every account; otherwise it only sees
  // the mail of the account that owns it.
  if (filter.accountId && filter.accountId !== message.accountId) {
    return false
  }
  const sender = `${message.from.name ?? ''} ${message.from.email}`
  const recipients = recipientText(message)
  const haystack = `${sender} ${recipients} ${message.subject} ${message.snippet}`
  if (filter.from && !includesText(sender, filter.from)) {
    return false
  }
  if (filter.to && !includesText(recipients, filter.to)) {
    return false
  }
  if (filter.subject && !includesText(message.subject, filter.subject)) {
    return false
  }
  if (filter.hasWords && !includesText(haystack, filter.hasWords)) {
    return false
  }
  if (filter.doesntHave && includesText(haystack, filter.doesntHave)) {
    return false
  }
  if (filter.hasAttachment && !message.hasAttachments) {
    return false
  }
  return true
}

export async function labelsExist(env: Env, labelIds: string[]): Promise<boolean> {
  if (labelIds.length === 0) {
    return true
  }
  const placeholders = labelIds.map(() => '?').join(', ')
  const found = await env.DB.prepare(
    `SELECT id FROM labels WHERE id IN (${placeholders})`,
  )
    .bind(...labelIds)
    .all<{ id: string }>()
  return found.results.length === labelIds.length
}

export async function applyFilters(
  env: Env,
  accountId: string,
  messages: MessageSummary[],
): Promise<FilterForwardMatch[]> {
  if (messages.length === 0) {
    return []
  }
  try {
    const result = await env.DB.prepare(
      "SELECT * FROM filters WHERE enabled = 1 AND (account_id = '' OR account_id = ?)",
    )
      .bind(accountId)
      .all<FilterRow>()
    const filters = result.results.map((row) => toFilter(row))
    if (filters.length === 0) {
      return []
    }
    const createdAt = new Date().toISOString()
    const statements: D1PreparedStatement[] = []
    const forwards: FilterForwardMatch[] = []
    for (const message of messages) {
      for (const filter of filters) {
        if (!matchesFilter(filter, message)) {
          continue
        }
        if (filter.forwardTo.length > 0) {
          forwards.push({ filterId: filter.id, forwardTo: filter.forwardTo })
        }
        for (const labelId of filter.labelIds) {
          if (message.labelIds.includes(labelId)) {
            continue
          }
          message.labelIds.push(labelId)
          statements.push(
            env.DB.prepare(
              'INSERT OR IGNORE INTO message_labels (message_id, account_id, folder, label_id, created_at) VALUES (?, ?, ?, ?, ?)',
            ).bind(message.id, accountId, message.folder, labelId, createdAt),
          )
        }
      }
    }
    if (statements.length > 0) {
      await env.DB.batch(statements)
    }
    return forwards
  } catch (error) {
    if (!isSchemaError(error)) {
      throw error
    }
    return []
  }
}

/**
 * Keep the filter that implements an account's automatic label in sync.
 *
 * The account dropdown and the account creation wizard both set
 * `incoming_label_id`; the actual labelling is a real filter, so the user can
 * inspect and edit it from Settings > Filters like any other rule. It has no
 * criteria and is scoped to the account, so it matches all of its mail in every
 * folder.
 */
export async function syncAccountLabelFilter(
  env: Env,
  accountId: string,
  labelId: string | null,
  labelName: string,
): Promise<void> {
  try {
    const existing = await env.DB.prepare(
      'SELECT id FROM filters WHERE account_id = ? AND auto_label = 1',
    )
      .bind(accountId)
      .first<{ id: string }>()
    if (!labelId) {
      if (existing) {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM forward_log WHERE filter_id = ?').bind(existing.id),
          env.DB.prepare('DELETE FROM filters WHERE id = ?').bind(existing.id),
        ])
      }
      return
    }
    if (existing) {
      await env.DB.prepare(
        'UPDATE filters SET name = ?, label_ids_json = ?, enabled = 1 WHERE id = ?',
      )
        .bind(labelName, JSON.stringify([labelId]), existing.id)
        .run()
      return
    }
    await env.DB.prepare(
      `INSERT INTO filters (id, account_id, name, from_pattern, to_pattern, subject_pattern, has_words, doesnt_have, has_attachment, label_ids_json, forward_to_json, enabled, created_at, auto_label)
       VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, 0, ?, '[]', 1, ?, 1)`,
    )
      .bind(
        crypto.randomUUID(),
        accountId,
        labelName,
        JSON.stringify([labelId]),
        new Date().toISOString(),
      )
      .run()
  } catch (error) {
    if (!isSchemaError(error)) {
      throw error
    }
  }
}

export async function backfillAccountLabel(
  env: Env,
  accountId: string,
  labelId: string | null,
): Promise<void> {
  if (!labelId) {
    return
  }
  const createdAt = new Date().toISOString()
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO message_labels (message_id, account_id, folder, label_id, created_at)
         SELECT id, account_id, folder, ?, ? FROM imap_messages WHERE account_id = ?`,
      ).bind(labelId, createdAt, accountId),
      env.DB.prepare(
        `INSERT OR IGNORE INTO message_labels (message_id, account_id, folder, label_id, created_at)
         SELECT id, account_id, folder, ?, ? FROM messages WHERE account_id = ?`,
      ).bind(labelId, createdAt, accountId),
    ])
  } catch (error) {
    if (!isSchemaError(error)) {
      throw error
    }
  }
}
