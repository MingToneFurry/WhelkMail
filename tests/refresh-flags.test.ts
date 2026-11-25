import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { refreshMirrorFlags } from '../functions/_lib/mail/refresh-flags'
import { openSqlite, type SqliteDatabase } from '../server/adapters/db/sqlite'

describe('historical IMAP flags', () => {
  let db: SqliteDatabase
  beforeEach(() => {
    db = openSqlite(':memory:')
    db.exec(`CREATE TABLE imap_messages (
      account_id TEXT DEFAULT 'a', folder TEXT DEFAULT 'inbox', uid INTEGER,
      uid_validity INTEGER DEFAULT 99, unread INTEGER DEFAULT 1, updated_at TEXT DEFAULT '')`)
  })
  afterEach(() => db.close())

  it('visits each sparse, mirrored UID, revisits recent messages and wraps even as the mailbox grows', async () => {
    // One large gap plus over two pages of UID history.
    db.exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 600)
      INSERT INTO imap_messages(uid) SELECT 10*n FROM seq`)
    const allSeen = { fetchFlags: async (uids: number[]) => uids.map(uid => ({ uid, flags: ['\\Seen'] })) }
    const refresh = (max: number, cursor: number) => refreshMirrorFlags(db as unknown as D1Database, allSeen, 'a', 'inbox', 99, max, cursor)
    let cursor = await refresh(6000, 0)
    expect(cursor).toBeGreaterThan(10)
    expect(await db.prepare('SELECT unread FROM imap_messages WHERE uid=10').first('unread')).toBe(1)
    db.exec('INSERT INTO imap_messages(uid) VALUES (9000000)')
    cursor = await refresh(9000000, cursor)
    cursor = await refresh(9000000, cursor)
    expect(cursor).toBe(0)
    expect(await db.prepare('SELECT sum(unread) FROM imap_messages').first('sum(unread)')).toBe(0)
    const allUnread = { fetchFlags: async (uids: number[]) => uids.map(uid => ({ uid, flags: [] })) }
    cursor = await refreshMirrorFlags(db as unknown as D1Database, allUnread, 'a', 'inbox', 99, 9000000, cursor)
    expect(cursor).toBeGreaterThan(0)
    expect(await db.prepare('SELECT unread FROM imap_messages WHERE uid=6000').first('unread')).toBe(1)
  })

  it('preserves missing remote messages, another generation, and concurrent local updates', async () => {
    db.exec('INSERT INTO imap_messages(uid,uid_validity) VALUES (1,99),(2,99),(3,88),(4,99)')
    const connection = {
      async fetchFlags() {
        db.exec("UPDATE imap_messages SET updated_at='9999' WHERE uid=4")
        return [1, 3, 4].map(uid => ({ uid, flags: ['\\Seen'] }))
      },
    }
    await refreshMirrorFlags(db as unknown as D1Database, connection, 'a', 'inbox', 99, 4, 0)
    expect((await db.prepare('SELECT uid FROM imap_messages WHERE unread=1 ORDER BY uid').all()).results)
      .toEqual([{ uid: 2 }, { uid: 3 }, { uid: 4 }])
  })
})
