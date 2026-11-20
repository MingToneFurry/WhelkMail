import { listAccountRows, type AccountRow } from '../../_lib/db'
import type { Env } from '../../_lib/env'
import { matchesFilter, toFilter, type FilterRow } from '../../_lib/filters'
import { forwardFilteredMessage } from '../../_lib/forward'
import { json, readJson } from '../../_lib/http'
import { imapMessageSummary, type ImapMessageRow } from '../../_lib/sync'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'

/**
 * Apply the enabled filters to mail that is already in the mirror.
 *
 * Filters normally run on new mail only: when one is created, the mail that
 * arrived before it is untouched. This endpoint walks the mirror of every folder
 * in batches so the user can apply a new filter (or all of them) to what is
 * already there. Labels are always applied to every folder; forwarding is opt-in
 * per run and only touches incoming mail, because it sends mail to an external
 * address.
 *
 * The work is driven in pages by the client: each request returns a cursor, so
 * no single invocation has to walk a whole mailbox.
 */
const LABEL_BATCH = 200
/** Forwarding costs an SMTP/HTTP round trip per match: smaller pages, same reason. */
const FORWARD_BATCH = 25

interface ApplyBody {
  cursor?: string
  filterId?: string
  forward?: boolean
}

interface LabelStatement {
  messageId: string
  accountId: string
  folder: string
  labelId: string
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = await readJson<ApplyBody>(context.request)
  const cursor = typeof body?.cursor === 'string' && body.cursor ? body.cursor : ''
  const forward = body?.forward === true
  const filterId = typeof body?.filterId === 'string' && body.filterId ? body.filterId : null

  try {
    const filterRows = await context.env.DB.prepare(
      filterId ? 'SELECT * FROM filters WHERE id = ? AND enabled = 1' : 'SELECT * FROM filters WHERE enabled = 1',
    )
      .bind(...(filterId ? [filterId] : []))
      .all<FilterRow>()
    if (filterRows.results.length === 0) {
      return json({ processed: 0, matched: 0, labelled: 0, forwarded: 0, nextCursor: null })
    }
    const filters = filterRows.results.map((row) => toFilter(row))

    const accounts = new Map((await listAccountRows(context.env)).map((row) => [row.id, row]))
    const limit = forward ? FORWARD_BATCH : LABEL_BATCH
    const rows = await context.env.DB.prepare(
      'SELECT * FROM imap_messages WHERE id > ? ORDER BY id ASC LIMIT ?',
    )
      .bind(cursor, limit)
      .all<ImapMessageRow>()

    const labelStatements: LabelStatement[] = []
    const forwardJobs: { account: AccountRow; row: ImapMessageRow; filterId: string; to: string[] }[] = []
    let matched = 0

    for (const row of rows.results) {
      const account = accounts.get(row.account_id)
      if (!account) {
        continue
      }
      const summary = imapMessageSummary(row, account)
      let hit = false
      for (const filter of filters) {
        if (!matchesFilter(filter, summary)) {
          continue
        }
        hit = true
        for (const labelId of filter.labelIds) {
          labelStatements.push({
            messageId: row.id,
            accountId: account.id,
            folder: row.folder,
            labelId,
          })
        }
        // Forwarding stays an incoming-mail action: labelling now covers every
        // folder, but sent/draft/trash mail must not be sent out by a filter.
        if (forward && filter.forwardTo.length > 0 && row.folder === 'inbox') {
          forwardJobs.push({ account, row, filterId: filter.id, to: filter.forwardTo })
        }
      }
      if (hit) {
        matched += 1
      }
    }

    const createdAt = new Date().toISOString()
    if (labelStatements.length > 0) {
      // Chunked to stay well inside D1's statement limit per batch.
      for (let index = 0; index < labelStatements.length; index += 100) {
        const chunk = labelStatements.slice(index, index + 100)
        await context.env.DB.batch(
          chunk.map((item) =>
            context.env.DB.prepare(
              'INSERT OR IGNORE INTO message_labels (message_id, account_id, folder, label_id, created_at) VALUES (?, ?, ?, ?, ?)',
            ).bind(item.messageId, item.accountId, item.folder, item.labelId, createdAt),
          ),
        )
      }
    }

    let forwarded = 0
    for (const job of forwardJobs) {
      // forward_log has a unique (filter_id, message_id) key: a message is never
      // forwarded twice by the same filter, so a rerun is safe.
      const result = await forwardFilteredMessage(
        context.env,
        job.account,
        job.filterId,
        job.to,
        job.row,
      ).catch(() => 'failed' as const)
      if (result === 'sent') {
        forwarded += 1
      }
    }

    const last = rows.results[rows.results.length - 1]
    return json({
      processed: rows.results.length,
      matched,
      labelled: labelStatements.length,
      forwarded,
      nextCursor: rows.results.length < limit ? null : (last?.id ?? null),
    })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}
