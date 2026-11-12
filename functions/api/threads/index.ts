import type { Folder, MailThread } from '../../../shared/types'
import {
  getAccountRow,
  listAccountRows,
  relayMessageSummary,
  type AccountRow,
  type MessageRow,
} from '../../_lib/db'
import type { Env } from '../../_lib/env'
import { fail, json } from '../../_lib/http'
import { isSchemaError } from '../../_lib/schema'
import { imapMessageSummary, type ImapMessageRow } from '../../_lib/sync'
import {
  clampPageSize,
  compareByDateDesc,
  decodePageCursor,
  encodePageCursor,
} from '../../../shared/paging'

const THREAD_FOLDERS: Folder[] = ['inbox', 'sent', 'draft', 'spam']

interface GroupRow {
  key: string
  last_at: string
  total: number
  unread: number
}

function parseFolder(value: string | null): Folder {
  if (value === 'sent' || value === 'draft' || value === 'spam') {
    return value
  }
  return 'inbox'
}

/**
 * Page of conversations for one account and folder.
 *
 * Threads are per account and the cursor is `(last message date, thread key)`,
 * mirroring the keyset used by the flat list. Messages mirrored before threading
 * existed have no key yet and use their `stable_key`, so nothing disappears while
 * the backfill catches up.
 */
interface ThreadRows {
  latest: MessageRow | ImapMessageRow
  /** Distinct senders in order of appearance (oldest first, like Gmail). */
  participants: { name: string | null; email: string }[]
  participantCount: number
}

async function accountThreads(
  env: Env,
  account: AccountRow,
  folder: Folder,
  limit: number,
  before: { date: string; id: string } | null,
): Promise<{ groups: GroupRow[]; threads: Map<string, ThreadRows> }> {
  const groups: GroupRow[] = []
  const threads = new Map<string, ThreadRows>()

  const imapSql = before
    ? `SELECT COALESCE(thread_key, stable_key) AS key, MAX(sent_at) AS last_at, COUNT(*) AS total, COALESCE(SUM(unread), 0) AS unread
       FROM imap_messages WHERE account_id = ? AND folder = ?
       GROUP BY key HAVING last_at < ? OR (last_at = ? AND key < ?)
       ORDER BY last_at DESC, key DESC LIMIT ?`
    : `SELECT COALESCE(thread_key, stable_key) AS key, MAX(sent_at) AS last_at, COUNT(*) AS total, COALESCE(SUM(unread), 0) AS unread
       FROM imap_messages WHERE account_id = ? AND folder = ?
       GROUP BY key ORDER BY last_at DESC, key DESC LIMIT ?`
  const imapRows = await env.DB.prepare(imapSql)
    .bind(
      account.id,
      folder,
      ...(before ? [before.date, before.date, before.id] : []),
      limit,
    )
    .all<GroupRow>()
  groups.push(...imapRows.results)

  const relaySql = before
    ? `SELECT COALESCE(thread_key, 'r:' || id) AS key, MAX(sent_at) AS last_at, COUNT(*) AS total, 0 AS unread
       FROM messages WHERE account_id = ? AND folder = ?
       GROUP BY key HAVING last_at < ? OR (last_at = ? AND key < ?)
       ORDER BY last_at DESC, key DESC LIMIT ?`
    : `SELECT COALESCE(thread_key, 'r:' || id) AS key, MAX(sent_at) AS last_at, COUNT(*) AS total, 0 AS unread
       FROM messages WHERE account_id = ? AND folder = ?
       GROUP BY key ORDER BY last_at DESC, key DESC LIMIT ?`
  const relayRows = await env.DB.prepare(relaySql)
    .bind(
      account.id,
      folder,
      ...(before ? [before.date, before.date, before.id] : []),
      limit,
    )
    .all<GroupRow>()
  groups.push(...relayRows.results)

  const keys = [...new Set(groups.map((group) => group.key))].slice(0, 60)
  if (keys.length === 0) {
    return { groups: [], threads }
  }
  const placeholders = keys.map(() => '?').join(', ')

  const imapMessages = await env.DB.prepare(
    `SELECT * FROM imap_messages WHERE account_id = ? AND folder = ?
       AND COALESCE(thread_key, stable_key) IN (${placeholders})
     ORDER BY sent_at ASC`,
  )
    .bind(account.id, folder, ...keys)
    .all<ImapMessageRow>()
  for (const row of imapMessages.results) {
    const key = row.thread_key ?? row.stable_key
    addThreadRow(threads, key, row, row.from_name, row.from_email)
  }

  const relayMessages = await env.DB.prepare(
    `SELECT * FROM messages WHERE account_id = ? AND folder = ?
       AND COALESCE(thread_key, 'r:' || id) IN (${placeholders})
     ORDER BY sent_at ASC`,
  )
    .bind(account.id, folder, ...keys)
    .all<MessageRow>()
  for (const row of relayMessages.results) {
    const key = row.thread_key ?? `r:${row.id}`
    addThreadRow(threads, key, row, row.from_name, row.from_email)
  }

  return { groups, threads }
}

/**
 * Rows arrive oldest first: the last one seen is the newest message, while the
 * participant list keeps the order in which senders first appear in the thread.
 */
function addThreadRow(
  threads: Map<string, ThreadRows>,
  key: string,
  row: MessageRow | ImapMessageRow,
  name: string | null,
  email: string,
): void {
  const entry = threads.get(key) ?? { latest: row, participants: [], participantCount: 0 }
  entry.latest = row
  const known = entry.participants.some(
    (item) => item.email.toLowerCase() === (email ?? '').toLowerCase(),
  )
  if (!known && email) {
    entry.participantCount += 1
    if (entry.participants.length < 6) {
      entry.participants.push({ name: name ?? null, email })
    }
  }
  threads.set(key, entry)
}

async function labelIdsFor(env: Env, ids: string[]): Promise<Map<string, string[]>> {
  const assignments = new Map<string, string[]>()
  if (ids.length === 0) {
    return assignments
  }
  try {
    for (let index = 0; index < ids.length; index += 50) {
      const chunk = ids.slice(index, index + 50)
      const placeholders = chunk.map(() => '?').join(', ')
      const result = await env.DB.prepare(
        `SELECT message_id, label_id FROM message_labels WHERE message_id IN (${placeholders})`,
      )
        .bind(...chunk)
        .all<{ message_id: string; label_id: string }>()
      for (const row of result.results) {
        const current = assignments.get(row.message_id) ?? []
        current.push(row.label_id)
        assignments.set(row.message_id, current)
      }
    }
  } catch (error) {
    if (!isSchemaError(error)) {
      throw error
    }
  }
  return assignments
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const accountId = url.searchParams.get('accountId') ?? 'all'
  const folder = parseFolder(url.searchParams.get('folder'))
  if (!THREAD_FOLDERS.includes(folder)) {
    return fail('Invalid folder', 400, undefined, 'folder_invalid')
  }
  const limit = clampPageSize(Number(url.searchParams.get('limit') ?? ''))
  const before = decodePageCursor(url.searchParams.get('before'))

  let accounts: AccountRow[]
  if (accountId === 'all') {
    accounts = (await listAccountRows(context.env)).filter(
      (row) => !(row.kind === 'relay' && folder === 'inbox'),
    )
  } else {
    const row = await getAccountRow(context.env, accountId)
    if (!row) {
      return fail('Account not found', 404, undefined, 'account_not_found')
    }
    accounts = [row]
  }

  const errors: { accountId: string; email: string; message: string }[] = []
  const threads: MailThread[] = []

  for (const account of accounts) {
    try {
      const { groups, threads: rows } = await accountThreads(
        context.env,
        account,
        folder,
        limit,
        before,
      )
      for (const group of groups) {
        const entry = rows.get(group.key)
        if (!entry) {
          continue
        }
        const row = entry.latest
        const summary =
          'stable_key' in row
            ? imapMessageSummary(row as ImapMessageRow, account)
            : relayMessageSummary(row as MessageRow, account)
        threads.push({
          threadKey: group.key,
          accountId: account.id,
          accountEmail: account.email,
          accountName: account.display_name,
          folder,
          latest: summary,
          total: group.total,
          unread: group.unread,
          participants: entry.participants,
        })
      }
    } catch (error) {
      if (isSchemaError(error)) {
        // Databases created before migration 024 have no thread_key column.
        return fail(
          'Run the database migration for conversation grouping',
          503,
          undefined,
          'schema_outdated',
        )
      }
      errors.push({
        accountId: account.id,
        email: account.email,
        message: error instanceof Error ? error.message : 'Errore',
      })
    }
  }

  const labels = await labelIdsFor(
    context.env,
    threads.map((thread) => thread.latest.id),
  )
  for (const thread of threads) {
    thread.latest.labelIds = labels.get(thread.latest.id) ?? []
  }

  threads.sort((left, right) => compareByDateDesc(left.latest, right.latest))
  const page = threads.slice(0, limit)
  const last = page[page.length - 1]
  const nextCursor =
    threads.length > limit && last
      ? encodePageCursor({ date: last.latest.date, id: last.threadKey })
      : null

  return json({ threads: page, errors, nextCursor })
}
