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
import { listFolder } from '../../_lib/mail/imap'
import { imapMessageId } from '../../_lib/mail/ids'
import { dateOf, parseHeaders, toMailbox, toMailboxes } from '../../_lib/mail/parse'

interface AccountError {
  accountId: string
  email: string
  message: string
}

async function summariesFromImap(
  env: Env,
  account: AccountRow,
  folder: Folder,
): Promise<MessageSummary[]> {
  const headers = await listFolder(env, account, folder, 30)
  const summaries: MessageSummary[] = []
  for (const header of headers) {
    const email = await parseHeaders(header.header)
    const from: Mailbox = email.from
      ? toMailbox(email.from)
      : { name: null, email: '' }
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
      unread: folder === 'draft' ? false : !header.flags.some((flag) => flag.toLowerCase() === '\\seen'),
      hasAttachments: header.hasAttachments,
      status: folder === 'draft' ? 'draft' : 'sent',
      labelIds: [],
    })
  }
  return summaries
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

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const accountId = url.searchParams.get('accountId') ?? 'all'
  const folderParam = url.searchParams.get('folder')
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
