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

export interface FilterMatchContext {
  /**
   * Address of the account that owns a scoped filter, when that account is a
   * send-only relay. Such an account has no mailbox of its own: its mail arrives
   * in the IMAP mailbox it forwards to, so the scope means "mail for this
   * address", not "rows under this account id".
   */
  accountEmail?: string
  accountIsRelay?: boolean
}

export function matchesFilter(
  filter: MailFilter,
  message: MessageSummary,
  context: FilterMatchContext = {},
): boolean {
  const sender = `${message.from.name ?? ''} ${message.from.email}`
  const recipients = recipientText(message)
  // An empty accountId is a filter for every account; otherwise it only sees
  // the mail of the account that owns it. A relay account owns no mailbox, so
  // its automatic label follows the address into the mailbox that receives it.
  if (filter.accountId && filter.accountId !== message.accountId) {
    if (!context.accountIsRelay || !context.accountEmail) {
      return false
    }
    if (!includesText(recipients, context.accountEmail)) {
      return false
    }
  }
  const haystack = `${sender} ${recipients} ${message.subject} ${message.snippet}`
  // A header-only message has no snippet yet, and the body is indexed later.
  // Treating that empty snippet as real text made "has words" filters never match
  // and, worse, "doesn't have" filters match every new message. Leave the
  // decision to the pass that runs once the body is indexed.
  const bodyKnown = message.snippet.trim().length > 0
  if ((filter.hasWords || filter.doesntHave) && !bodyKnown) {
    return false
  }
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
    const [result, accountRows] = await Promise.all([
      env.DB.prepare('SELECT * FROM filters WHERE enabled = 1').all<FilterRow>(),
      env.DB.prepare('SELECT id, email, kind, incoming_label_id FROM accounts').all<{
        id: string
        email: string
        kind: string
        incoming_label_id: string | null
      }>(),
    ])
    const filters = result.results.map((row) => toFilter(row))
    const accounts = new Map(accountRows.results.map((row) => [row.id, row]))
    // An automatic-label filter is the editable form of `incoming_label_id`.
    // Keep the direct label as a fallback for databases whose filters table has
    // no automatic rows yet (or no auto_label column at all): otherwise the
    // account label stops working for new mail while old mail stays labelled.
    let autoFilterOwners = new Set<string>()
    try {
      const autoRows = await env.DB.prepare(
        'SELECT account_id FROM filters WHERE auto_label = 1',
      ).all<{ account_id: string }>()
      autoFilterOwners = new Set(autoRows.results.map((row) => row.account_id))
    } catch (error) {
      if (!isSchemaError(error)) {
        throw error
      }
    }
    const createdAt = new Date().toISOString()
    const statements: D1PreparedStatement[] = []
    const forwards: FilterForwardMatch[] = []
    const mailbox = accounts.get(accountId)
    // Relay accounts have no mailbox of their own: their incoming label follows
    // the alias into the IMAP mailbox that actually receives the forwarded mail.
    const relayLabels = accountRows.results.filter(
      (row) => row.kind === 'relay' && row.id !== accountId && row.incoming_label_id,
    )
    for (const message of messages) {
      const addLabel = (labelId: string) => {
        if (message.labelIds.includes(labelId)) {
          return
        }
        message.labelIds.push(labelId)
        statements.push(
          env.DB.prepare(
            'INSERT OR IGNORE INTO message_labels (message_id, account_id, folder, label_id, created_at) VALUES (?, ?, ?, ?, ?)',
          ).bind(message.id, accountId, message.folder, labelId, createdAt),
        )
      }
      if (mailbox?.incoming_label_id && !autoFilterOwners.has(mailbox.id)) {
        addLabel(mailbox.incoming_label_id)
      }
      if (relayLabels.length > 0) {
        const recipients = recipientText(message)
        for (const relay of relayLabels) {
          if (
            relay.incoming_label_id &&
            !autoFilterOwners.has(relay.id) &&
            includesText(recipients, relay.email)
          ) {
            addLabel(relay.incoming_label_id)
          }
        }
      }
      for (const filter of filters) {
        // A relay account stores no incoming mail: its mail lives in the IMAP
        // mailbox the address forwards to. Match its automatic label against the
        // recipient/alias instead of the row's account id.
        const owner = filter.accountId ? accounts.get(filter.accountId) : undefined
        const context: FilterMatchContext | undefined =
          owner && owner.kind === 'relay' && filter.accountId !== accountId
            ? { accountEmail: owner.email, accountIsRelay: true }
            : undefined
        if (filter.accountId && filter.accountId !== accountId && !context) {
          continue
        }
        if (!matchesFilter(filter, message, context)) {
          continue
        }
        if (filter.forwardTo.length > 0) {
          forwards.push({ filterId: filter.id, forwardTo: filter.forwardTo })
        }
        for (const labelId of filter.labelIds) {
          addLabel(labelId)
        }
      }
    }
    if (statements.length > 0) {
      for (let index = 0; index < statements.length; index += 100) {
        await env.DB.batch(statements.slice(index, index + 100))
      }
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
