import { listAccountRows } from '../../../functions/_lib/db'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'
import { withImap } from '../../_lib/mail/imap'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'
import { backfillThreadKeys, SYNC_FOLDERS } from '../../_lib/sync'

/** Messages whose key is read per call, across all folders of one account. */
const BUDGET = 200
const BATCH = 50

async function pendingByAccount(env: Env): Promise<{ accountId: string; email: string; pending: number }[]> {
  const accounts = (await listAccountRows(env)).filter((row) => row.kind === 'imap')
  const counts = new Map<string, number>()
  try {
    const rows = await env.DB.prepare(
      'SELECT account_id, COUNT(*) AS pending FROM imap_messages WHERE thread_key IS NULL GROUP BY account_id',
    ).all<{ account_id: string; pending: number }>()
    for (const row of rows.results) {
      counts.set(row.account_id, row.pending)
    }
  } catch (error) {
    if (isSchemaError(error)) {
      return []
    }
    throw error
  }
  return accounts
    .map((account) => ({
      accountId: account.id,
      email: account.email,
      pending: counts.get(account.id) ?? 0,
    }))
    .filter((entry) => entry.pending > 0)
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    return json({ accounts: await pendingByAccount(context.env) })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

/**
 * Place the mail mirrored before threading existed into its conversation.
 *
 * Only headers are fetched (`UID FETCH ... HEADER.FIELDS`), never bodies, and the
 * work is bounded per call so the Worker stays inside its budget: the button can
 * be pressed again until nothing is pending.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await readJson<{ accountId?: string }>(context.request ?? new Request('http://x'))
    const accountId = body?.accountId
    if (!accountId) {
      return fail('accountId is required', 400, undefined, 'thread_rebuild_invalid')
    }
    const account = (await listAccountRows(context.env)).find((row) => row.id === accountId)
    if (!account || account.kind !== 'imap') {
      return fail('Account not found', 404, undefined, 'account_not_found')
    }

    let updated = 0
    for (const folder of SYNC_FOLDERS) {
      if (updated >= BUDGET) {
        break
      }
      try {
        await withImap(context.env, account, async (connection) => {
          while (updated < BUDGET) {
            const count = await backfillThreadKeys(
              context.env,
              connection,
              account,
              folder,
              Math.min(BATCH, BUDGET - updated),
            )
            if (count === 0) {
              break
            }
            updated += count
          }
        })
      } catch {
        // A folder that fails (missing on the server, offline) is skipped.
      }
    }

    const pending = await pendingByAccount(context.env)
    return json({
      updated,
      pending: pending.find((entry) => entry.accountId === accountId)?.pending ?? 0,
    })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}
