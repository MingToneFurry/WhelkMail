import type { MessageDetail } from '../../../../shared/types'
import type { Env } from '../../../_lib/env'
import { fail, json } from '../../../_lib/http'
import { loadRaw } from '../../../_lib/mail/load'
import {
  attachmentMeta,
  bodyText,
  dateOf,
  parseFull,
  toMailbox,
  toMailboxes,
} from '../../../_lib/mail/parse'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  const loaded = await loadRaw(context.env, id, true)
  if (!loaded) {
    return fail('Message not found', 404, undefined, 'message_not_found')
  }
  const email = await parseFull(loaded.bytes)
  const text = bodyText(email)
  const attachments = attachmentMeta(email)
  const detail: MessageDetail = {
    id,
    accountId: loaded.account.id,
    accountEmail: loaded.account.email,
    accountName: loaded.account.display_name,
    folder: loaded.folder,
    from: email.from ? toMailbox(email.from) : { name: null, email: '' },
    to: toMailboxes(email.to),
    cc: toMailboxes(email.cc),
    bcc: toMailboxes(email.bcc),
    subject: email.subject ?? '',
    snippet: text.replace(/\s+/g, ' ').trim().slice(0, 160),
    date: dateOf(email),
    unread: false,
    hasAttachments: attachments.length > 0,
    status: loaded.folder === 'draft' ? 'draft' : 'sent',
    text,
    html: email.html ?? null,
    attachments,
    size: loaded.bytes.byteLength,
  }
  return json({ message: detail })
}
