import type { Folder, Mailbox, MessageSummary } from '../../../shared/types'
import {
  getAccountRow,
  listAccountRows,
  relayMessageSummary,
  type AccountRow,
  type MessageRow,
} from '../../_lib/db'
import type { Env } from '../../_lib/env'
import { fail, json } from '../../_lib/http'
import type { ImapHeader } from '../../_lib/imap/client'
import { applyFilters } from '../../_lib/filters'
import { listFolder, listFolderByUids } from '../../_lib/mail/imap'
import { imapMessageId, parseImapMessageId, parseRelayMessageId } from '../../_lib/mail/ids'
import { dateOf, parseHeaders, toMailbox, toMailboxes } from '../../_lib/mail/parse'
import { isSchemaError } from '../../_lib/schema'

interface AccountError {
  accountId: string
  email: string
  message: string
}

interface LabelAssignment {
  message_id: string
  account_id: string
  folder: string
}

async function summariesFromHeaders(
  account: AccountRow,
  folder: Folder,
  headers: ImapHeader[],
): Promise<MessageSummary[]> {
  const summaries: MessageSummary[] = []
  for (const header of headers) {
    const email = await parseHeaders(header.header)
    const from: Mailbox = email.from ? toMailbox(email.from) : { name: null, email: '' }
    summaries.push({
      id: imapMessageId(account.id, folder, header.uid),
      accountId: account.id,
      accountEmail: account.email,
      accountName: account.display_name,
      folder,
      from,
      to: toMailboxes(email.to),
      cc: toMailboxes(email.cc),
      bcc: toMailboxes(email.bcc),
      subject: email.subject ?? '',
      snippet: '',
      date: dateOf(email),
      unread:
        folder === 'draft' ? false : !header.flags.some((flag) => flag.toLowerCase() === '\\seen'),
      hasAttachments: header.hasAttachments,
      status: folder === 'draft' ? 'draft' : 'sent',
      labelIds: [],
    })
  }
  return summaries
}

async function summariesFromImap(
  env: Env,
  account: AccountRow,
  folder: Folder,
): Promise<MessageSummary[]> {
  const headers = await listFolder(env, account, folder, 30)
  return summariesFromHeaders(account, folder, headers)
}

async function applyLabels(
  env: Env,
  accountId: string,
  folder: Folder,
  messages: MessageSummary[],
): Promise<void> {
  if (messages.length === 0) {
    return
  }
  try {
    const result = await env.DB.prepare(
      'SELECT message_id, label_id FROM message_labels WHERE account_id = ? AND folder = ?',
    )
      .bind(accountId, folder)
      .all<{ message_id: string; label_id: string }>()
    const assignments = new Map<string, string[]>()
    for (const row of result.results) {
      const current = assignments.get(row.message_id) ?? []
      current.push(row.label_id)
      assignments.set(row.message_id, current)
    }
    for (const message of messages) {
      message.labelIds = assignments.get(message.id) ?? []
    }
  } catch (error) {
    if (isSchemaError(error)) {
      for (const message of messages) {
        message.labelIds = []
      }
      return
    }
    throw error
  }
}

async function summariesFromRelay(
  env: Env,
  account: AccountRow,
  folder: Folder,
): Promise<MessageSummary[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM messages WHERE account_id = ? AND folder = ? ORDER BY sent_at DESC LIMIT 30',
  )
    .bind(account.id, folder)
    .all<MessageRow>()
  return result.results.map((row) => relayMessageSummary(row, account))
}

async function summariesFromImapLabel(
  env: Env,
  account: AccountRow,
  assignments: LabelAssignment[],
): Promise<MessageSummary[]> {
  const byFolder = new Map<Folder, number[]>()
  for (const assignment of assignments) {
    const parsed = parseImapMessageId(assignment.message_id)
    if (!parsed || parsed.accountId !== account.id) {
      continue
    }
    const uids = byFolder.get(parsed.folder) ?? []
    uids.push(parsed.uid)
    byFolder.set(parsed.folder, uids)
  }
  const summaries: MessageSummary[] = []
  for (const [folder, uids] of byFolder) {
    const headers = await listFolderByUids(env, account, folder, [...new Set(uids)])
    summaries.push(...(await summariesFromHeaders(account, folder, headers)))
  }
  return summaries
}

async function summariesFromRelayLabel(
  env: Env,
  account: AccountRow,
  assignments: LabelAssignment[],
): Promise<MessageSummary[]> {
  const ids = [
    ...new Set(
      assignments
        .map((assignment) => parseRelayMessageId(assignment.message_id))
        .filter((value): value is string => Boolean(value)),
    ),
  ]
  const rows: MessageRow[] = []
  for (let index = 0; index < ids.length; index += 50) {
    const chunk = ids.slice(index, index + 50)
    const placeholders = chunk.map(() => '?').join(', ')
    const result = await env.DB.prepare(
      `SELECT * FROM messages WHERE id IN (${placeholders})`,
    )
      .bind(...chunk)
      .all<MessageRow>()
    rows.push(...result.results)
  }
  return rows.map((row) => relayMessageSummary(row, account))
}

async function loadByLabel(
  env: Env,
  accounts: AccountRow[],
  labelId: string,
): Promise<{ messages: MessageSummary[]; errors: AccountError[] }> {
  const result = await env.DB.prepare(
    'SELECT message_id, account_id, folder FROM message_labels WHERE label_id = ?',
  )
    .bind(labelId)
    .all<LabelAssignment>()
  const byAccount = new Map<string, LabelAssignment[]>()
  for (const assignment of result.results) {
    const current = byAccount.get(assignment.account_id) ?? []
    current.push(assignment)
    byAccount.set(assignment.account_id, current)
  }

  const messages: MessageSummary[] = []
  const errors: AccountError[] = []
  for (const account of accounts) {
    const assignments = byAccount.get(account.id)
    if (!assignments || assignments.length === 0) {
      continue
    }
    if (account.kind === 'imap' && !account.secret_enc) {
      continue
    }
    try {
      const loaded =
        account.kind === 'imap'
          ? await summariesFromImapLabel(env, account, assignments)
          : await summariesFromRelayLabel(env, account, assignments)
      const folders = new Set(loaded.map((message) => message.folder))
      for (const folder of folders) {
        await applyLabels(
          env,
          account.id,
          folder,
          loaded.filter((message) => message.folder === folder),
        )
      }
      messages.push(...loaded)
    } catch (error) {
      errors.push({
        accountId: account.id,
        email: account.email,
        message: error instanceof Error ? error.message : 'Errore IMAP',
      })
    }
  }
  return { messages, errors }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const accountId = url.searchParams.get('accountId') ?? 'all'
  const folderParam = url.searchParams.get('folder')
  const labelId = url.searchParams.get('labelId')
  const folder: Folder =
    folderParam === 'sent' ? 'sent' : folderParam === 'draft' ? 'draft' : 'inbox'

  let accounts: AccountRow[]
  if (accountId === 'all') {
    accounts = await listAccountRows(context.env)
  } else {
    const row = await getAccountRow(context.env, accountId)
    if (!row) {
      return fail('Account not found', 404, undefined, 'account_not_found')
    }
    accounts = [row]
  }

  if (labelId) {
    const { messages, errors } = await loadByLabel(context.env, accounts, labelId)
    messages.sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
    return json({ messages: messages.slice(0, 100), errors })
  }

  const messages: MessageSummary[] = []
  const errors: AccountError[] = []

  for (const account of accounts) {
    if (account.kind === 'imap' && !account.secret_enc) {
      continue
    }
    if (account.kind === 'relay' && folder === 'inbox') {
      continue
    }
    try {
      const loaded =
        account.kind === 'imap'
          ? await summariesFromImap(context.env, account, folder)
          : await summariesFromRelay(context.env, account, folder)
      await applyLabels(context.env, account.id, folder, loaded)
      await applyFilters(context.env, account.id, loaded)
      messages.push(...loaded)
    } catch (error) {
      errors.push({
        accountId: account.id,
        email: account.email,
        message: error instanceof Error ? error.message : 'Errore IMAP',
      })
    }
  }

  messages.sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
  return json({ messages: messages.slice(0, 100), errors })
}
