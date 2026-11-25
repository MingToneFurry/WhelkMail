import type { Folder } from '../../../shared/types'
import type { ImapConnection } from '../imap/client'

// Keep active mail current on every sync. Walk the history in descending
// order so new arrivals cannot postpone an old message indefinitely.
const RECENT_UID_WINDOW = 120
const HISTORY_BATCH = 240

interface MirrorFlag {
  uid: number
  unread: number
}

export async function refreshMirrorFlags(
  db: D1Database,
  connection: Pick<ImapConnection, 'fetchFlags'>,
  accountId: string,
  folder: Folder,
  uidValidity: number | null,
  maxUid: number,
  beforeUid: number,
): Promise<number> {
  const recentStart = Math.max(1, maxUid - RECENT_UID_WINDOW)
  const recent = await db.prepare(
    'SELECT uid, unread FROM imap_messages WHERE account_id = ? AND folder = ? AND uid BETWEEN ? AND ? ORDER BY uid DESC',
  ).bind(accountId, folder, recentStart, maxUid).all<MirrorFlag>()
  const older = await db.prepare(
    'SELECT uid, unread FROM imap_messages WHERE account_id = ? AND folder = ? AND uid < ? ORDER BY uid DESC LIMIT ?',
  ).bind(accountId, folder, Math.min(beforeUid || recentStart, recentStart), HISTORY_BATCH).all<MirrorFlag>()
  const local = new Map([...recent.results, ...older.results].map(row => [row.uid, row.unread]))
  const observedAt = new Date().toISOString()
  const flags = await connection.fetchFlags([...local.keys()])
  const changed: [number[], number[]] = [[], []]
  for (const item of flags) {
    const unread = folder === 'draft' || item.flags.some(flag => flag.toLowerCase() === '\\seen') ? 0 : 1
    if (local.has(item.uid) && local.get(item.uid) !== unread) changed[unread].push(item.uid)
  }

  const updates: D1PreparedStatement[] = []
  for (const [unread, uids] of changed.entries()) {
    // Keep each statement under D1's binding limit. A concurrent web read or
    // a reset into another UIDVALIDITY must not be overwritten by this fetch.
    for (let i = 0; i < uids.length; i += 90) {
      const chunk = uids.slice(i, i + 90)
      updates.push(db.prepare(
        `UPDATE imap_messages SET unread = ?, updated_at = ?
         WHERE account_id = ? AND folder = ? AND uid_validity IS ? AND updated_at <= ?
           AND unread <> ? AND uid IN (${chunk.map(() => '?').join(',')})`,
      ).bind(unread, observedAt, accountId, folder, uidValidity, observedAt, unread, ...chunk))
    }
  }
  if (updates.length) await db.batch(updates)
  return older.results.length === HISTORY_BATCH ? older.results[HISTORY_BATCH - 1].uid : 0
}
