import type { Folder } from '../../../shared/types'
import { listAccountRows } from '../../_lib/db'
import type { Env } from '../../_lib/env'
import { fail, json } from '../../_lib/http'
import { pushConfigured, sendWebPush, type PushSubscriptionRecord } from '../../_lib/push'
import { markSyncError, runSyncChunk, type ImapMessageRow } from '../../_lib/sync'

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

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const secret = context.env.CRON_SECRET
  const authorization = context.request.headers.get('Authorization') ?? ''
  if (!secret || authorization !== `Bearer ${secret}`) {
    return fail('Unauthorized', 401, undefined, 'unauthorized')
  }
  if (!pushConfigured(context.env)) {
    return json({ ok: false, reason: 'push_not_configured', sent: 0 })
  }

  const subscriptions = await context.env.DB.prepare(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions',
  ).all<PushSubscriptionRecord>()
  if (subscriptions.results.length === 0) {
    return json({ ok: true, sent: 0, reason: 'no_subscriptions' })
  }

  const prefRows = await context.env.DB.prepare('SELECT * FROM push_prefs').all<PushPrefsRow>()
  const prefs = new Map(prefRows.results.map((row) => [row.account_id, row]))
  const accounts = await listAccountRows(context.env)
  const gone = new Set<string>()
  let sent = 0

  for (const account of accounts) {
    if (account.kind !== 'imap' || !account.secret_enc) {
      continue
    }
    const pref = prefs.get(account.id)
    const enabled = pref ? Boolean(pref.enabled) : true
    if (!enabled) {
      continue
    }
    const folders = pref ? parseFolders(pref.folders_json) : (['inbox'] as Folder[])

    for (const folder of folders) {
      const previous = await context.env.DB.prepare(
        'SELECT max_uid FROM imap_sync WHERE account_id = ? AND folder = ?',
      )
        .bind(account.id, folder)
        .first<{ max_uid: number }>()
      const previousMax = previous?.max_uid ?? 0

      try {
        await runSyncChunk(context.env, account, folder)
      } catch (error) {
        await markSyncError(
          context.env,
          account.id,
          folder,
          error instanceof Error ? error.message : String(error),
        )
        continue
      }

      if (previousMax === 0) {
        continue
      }

      const fresh = await context.env.DB.prepare(
        'SELECT * FROM imap_messages WHERE account_id = ? AND folder = ? AND uid > ? ORDER BY uid ASC LIMIT 10',
      )
        .bind(account.id, folder, previousMax)
        .all<ImapMessageRow>()

      for (const message of fresh.results) {
        const title = message.from_name || message.from_email || account.display_name
        const payload = {
          title,
          body: message.subject || '(nessun oggetto)',
          url: `/?message=${encodeURIComponent(message.id)}`,
          tag: message.id,
        }
        for (const subscription of subscriptions.results) {
          if (gone.has(subscription.endpoint)) {
            continue
          }
          try {
            const result = await sendWebPush(context.env, subscription, payload)
            if (result.ok) {
              sent += 1
            }
            if (result.gone) {
              gone.add(subscription.endpoint)
            }
          } catch {
            // Keep the loop alive if a single subscription fails.
          }
        }
      }
    }
  }

  if (gone.size > 0) {
    await context.env.DB.batch(
      [...gone].map((endpoint) =>
        context.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint),
      ),
    )
  }

  return json({ ok: true, sent })
}
