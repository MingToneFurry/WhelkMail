import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateSqlite } from '../server/adapters/db/migrate'
import { openSqlite, type SqliteDatabase } from '../server/adapters/db/sqlite'

const roots: string[] = []
let database: SqliteDatabase | null = null

function createDatabase(): SqliteDatabase {
  const root = mkdtempSync(join(tmpdir(), 'whelkmail-sqlite-'))
  roots.push(root)
  database = openSqlite(join(root, 'test.sqlite'))
  migrateSqlite(database, process.cwd())
  return database
}

afterEach(() => {
  database?.close()
  database = null
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('SQLite D1 adapter', () => {
  it('initialises the schema and records every migration', () => {
    const db = createDatabase()
    const files = readdirSync(join(process.cwd(), 'db', 'migrations')).filter((file) =>
      file.endsWith('.sql'),
    )
    const result = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').executeSync()
    expect(result.results).toEqual([{ count: files.length }])
  })

  it('supports first/all/run and normalises bind values', async () => {
    const db = createDatabase()
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER, body BLOB)')

    await db
      .prepare('INSERT INTO t (id, n, body) VALUES (?, ?, ?)')
      .bind('a', true, new Uint8Array([1, 2, 3]))
      .run()

    const row = await db.prepare('SELECT * FROM t WHERE id = ?').bind('a').first<{
      id: string
      n: number
      body: Uint8Array
    }>()
    expect(row?.n).toBe(1)
    expect([...row!.body]).toEqual([1, 2, 3])
    expect(await db.prepare('SELECT * FROM t WHERE id = ?').bind('missing').first()).toBeNull()

    const all = await db.prepare('SELECT id FROM t').all<{ id: string }>()
    expect(all.results).toEqual([{ id: 'a' }])

    const removed = await db.prepare('DELETE FROM t WHERE id = ?').bind('a').run()
    expect(removed.meta.changes).toBe(1)
  })

  it('makes batch atomic', async () => {
    const db = createDatabase()
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)')

    await expect(
      db.batch([
        db.prepare('INSERT INTO t (id) VALUES (?)').bind('a'),
        db.prepare('INSERT INTO t (id) VALUES (?)').bind('a'),
      ]),
    ).rejects.toThrow()

    const rows = await db.prepare('SELECT id FROM t').all<{ id: string }>()
    expect(rows.results).toEqual([])
  })
})
