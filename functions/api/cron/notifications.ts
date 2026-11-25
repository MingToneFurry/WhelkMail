import type { Folder } from '../../../shared/types'
import { syncIntervalDue } from '../../../shared/sync-interval'
import { listAccountRows } from '../../_lib/db'
import { deleteArchivedMessage } from '../../_lib/deletion'
import type { Env } from '../../_lib/env'
import { cleanupBodyCache } from '../../_lib/body-cache'
import { pruneMirroredMetadata } from '../../_lib/retention'
import { applyFilters } from '../../_lib/filters'
import { processAutoReply } from '../../_lib/auto-reply'
import { forwardFilteredMessage } from '../../_lib/forward'
import { fail, json } from '../../_lib/http'
import { pushConfigured, sendWebPush, type PushSubscriptionRecord } from '../../_lib/push'
import {
  cleanupExpiredSyncLocks,
  imapMessageSummary,
  markSyncError,
  runSyncChunk,
  type ImapMessageRow,
} from '../../_lib/sync'

interface PushPrefsRow {
  account_id: string
  enabled: number
  folders_json: string
}

function parseFolders(value: string): Folder[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) {
      return ['inbox']
    }
    return parsed.filter(
      (item): item is Folder => item === 'inbox' || item === 'sent' || item === 'draft',
    )
  } catch {
    return ['inbox']
  }
}

/**
 * The scheduled work itself, callable without an HTTP round trip.
 *
 * The Workers entry runs it directly from `scheduled()`, so a deployment that
 * never configured CRON_SECRET still gets sync, notifications, filters,
 * forwarding and cleanup. The HTTP endpoint below keeps the secret check for
 * external triggers (the separate `worker/` cron used by Pages deployments).
 */
export async function runScheduledTasks(
  env: Env,
): Promise<{ sent: number; forwarded: number; deleted: number }> {
  const canNotify = pushConfigured(env)
  const subscriptions = canNotify
    ? await env.DB.prepare(
        'SELECT id, endpoint, p256dh, auth FROM push_subscriptions',
      ).all<PushSubscriptionRecord>()
    : { results: [] as PushSubscriptionRecord[] }
  const notify = canNotify && subscriptions.results.length > 0

  const prefRows = await env.DB.prepare('SELECT * FROM push_prefs').all<PushPrefsRow>()
  const prefs = new Map(prefRows.results.map((row) => [row.account_id, row]))
  const accounts = await listAccountRows(env)
  const forwardingFilters = await env.DB.prepare(
    "SELECT id FROM filters WHERE enabled = 1 AND forward_to_json <> '[]'",
  ).all<{ id: string }>()
  const hasForwarding = forwardingFilters.results.length > 0
  const gone = new Set<string>()
  let sent = 0
  let forwarded = 0
  let deleted = 0

  for (const account of accounts) {
    if (account.kind !== 'imap' || !account.secret_enc) {
      continue
    }
    const pref = prefs.get(account.id)
    const notifyEnabled = pref ? Boolean(pref.enabled) : true
    const pushFolders = new Set<Folder>(pref ? parseFolders(pref.folders_json) : ['inbox'])
    // Work that produces a notification, a forward or a provider cleanup must
    // run every minute; the plain automatic sync follows the account interval.
    const requiredFolders = new Set<Folder>()
    if (notifyEnabled) {
      for (const folder of pushFolders) {
        requiredFolders.add(folder)
      }
    }
    if (hasForwarding || account.delete_after_archive) {
      requiredFolders.add('inbox')
    }
    const autoFolders = new Set<Folder>()
    if (account.auto_sync) {
      autoFolders.add('inbox')
      autoFolders.add('sent')
      autoFolders.add('draft')
      autoFolders.add('spam')
    }
    const folders = new Set<Folder>([...requiredFolders, ...autoFolders])
    if (folders.size === 0) {
      continue
    }
    let autoDue = false
    if (autoFolders.size > 0) {
      const lastAuto = await env.DB.prepare(
        'SELECT MAX(last_synced_at) AS last FROM imap_sync WHERE account_id = ?',
      )
        .bind(account.id)
        .first<{ last: string | null }>()
      autoDue = syncIntervalDue(lastAuto?.last, account.sync_interval_minutes)
    }

    for (const folder of folders) {
      if (!requiredFolders.has(folder) && !autoDue) {
        continue
      }
      const previous = await env.DB.prepare(
        'SELECT max_uid FROM imap_sync WHERE account_id = ? AND folder = ?',
      )
        .bind(account.id, folder)
        .first<{ max_uid: number }>()
      const previousMax = previous?.max_uid ?? 0

      try {
        await runSyncChunk(env, account, folder)
      } catch (error) {
        await markSyncError(
          env,
          account.id,
          folder,
          error instanceof Error ? error.message : String(error),
        )
        continue
      }

      if (previousMax === 0) {
        continue
      }

      const fresh = await env.DB.prepare(
        'SELECT * FROM imap_messages WHERE account_id = ? AND folder = ? AND uid > ? ORDER BY uid ASC LIMIT 20',
      )
        .bind(account.id, folder, previousMax)
        .all<ImapMessageRow>()

      for (const row of fresh.results) {
        const summary = imapMessageSummary(row, account)
        const existingLabels = await env.DB.prepare(
          'SELECT label_id FROM message_labels WHERE message_id = ?',
        )
          .bind(row.id)
          .all<{ label_id: string }>()
        summary.labelIds = existingLabels.results.map((item) => item.label_id)
        // Filters run on every folder: the automatic account label is a filter
        // too, so sent, drafts and trash are labelled like the inbox.
        const forwards = await applyFilters(env, account.id, [summary])

        // Labelling runs everywhere, forwarding only on incoming mail.
        if (folder === 'inbox') {
          for (const match of forwards) {
            const result = await forwardFilteredMessage(
              env,
              account,
              match.filterId,
              match.forwardTo,
              row,
            )
            if (result === 'sent') {
              forwarded += 1
            }
          }
          try {
            await processAutoReply(env, account, row)
          } catch (error) {
            console.error('[auto-reply] failed', error)
          }
        }

        if (folder === 'inbox' && account.delete_after_archive) {
          const result = await deleteArchivedMessage(env, account, row)
          if (result === 'done') {
            deleted += 1
          }
        }

        if (notify && notifyEnabled && pushFolders.has(folder)) {
          const title = row.from_name || row.from_email || account.display_name
          const payload = {
            title,
            body: row.subject || '',
            url: `/?message=${encodeURIComponent(row.id)}`,
            tag: row.id,
          }
          for (const subscription of subscriptions.results) {
            if (gone.has(subscription.endpoint)) {
              continue
            }
            try {
              const result = await sendWebPush(env, subscription, payload, {
                urgency: 'high',
              })
              if (result.ok) {
                sent += 1
              }
              if (result.gone) {
                gone.add(subscription.endpoint)
              }
            } catch {
              // Keep processing the remaining subscriptions.
            }
          }
        }
      }
    }

    if (account.delete_after_archive) {
      const pending = await env.DB.prepare(
        `SELECT m.* FROM imap_messages m
         LEFT JOIN deletion_log d ON d.message_id = m.id AND d.status = 'done'
         WHERE m.account_id = ? AND m.folder = 'inbox' AND m.archived = 1 AND m.archive_key IS NOT NULL AND d.id IS NULL
         ORDER BY m.uid ASC LIMIT 10`,
      )
        .bind(account.id)
        .all<ImapMessageRow>()
      for (const row of pending.results) {
        const result = await deleteArchivedMessage(env, account, row)
        if (result === 'done') {
          deleted += 1
        }
      }
    }
  }

  await cleanupBodyCache(env).catch(() => undefined)
  await cleanupExpiredSyncLocks(env).catch(() => undefined)
  await pruneMirroredMetadata(env).catch(() => undefined)

  if (gone.size > 0) {
    await env.DB.batch(
      [...gone].map((endpoint) =>
        env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint),
      ),
    )
  }

  return { sent, forwarded, deleted }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const secret = context.env.CRON_SECRET
  const authorization = context.request.headers.get('Authorization') ?? ''
  if (!secret || authorization !== `Bearer ${secret}`) {
    return fail('Unauthorized', 401, undefined, 'unauthorized')
  }
  const result = await runScheduledTasks(context.env)
  return json({ ok: true, ...result })
}
