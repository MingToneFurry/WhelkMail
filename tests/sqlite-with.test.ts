import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openSqlite, type SqliteDatabase } from '../server/adapters/db/sqlite'

const roots: string[] = []
let database: SqliteDatabase | null = null

function create(): SqliteDatabase {
  const root = mkdtempSync(join(tmpdir(), 'whelkmail-with-'))
  roots.push(root)
  database = openSqlite(join(root, 'with.sqlite'))
  database.exec('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL)')
  return database
}

afterEach(() => {
  database?.close()
  database = null
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('CTE statements', () => {
  it('returns rows for a read CTE', () => {
    const db = create()
    db.prepare('INSERT INTO t (id, n) VALUES (?, ?)').bind('a', 1).run()

    const result = db
      .prepare('WITH x AS (SELECT * FROM t) SELECT * FROM x')
      .executeSync<{ id: string; n: number }>()

    expect(result.results).toEqual([{ id: 'a', n: 1 }])
  })

  it('executes a data-modifying CTE and reports the change count', () => {
    const db = create()

    const result = db
      .prepare("WITH x(n) AS (SELECT 7) INSERT INTO t (id, n) SELECT 'b', n FROM x")
      .executeSync()

    // all() would run it too, but report changes: 0, which hides the insert from
    // any caller that checks the count.
    expect(result.meta.changes).toBe(1)
    expect(db.prepare('SELECT COUNT(*) AS count FROM t').executeSync<{ count: number }>().results).toEqual([
      { count: 1 },
    ])
  })

  it('still surfaces a real SQL error', () => {
    const db = create()

    expect(() => db.prepare('WITH x AS (SELECT nope) SELECT * FROM x').executeSync()).toThrow()
  })
})

describe('prepared statement cache', () => {
  it('stays bounded on a long-running process', () => {
    const db = create()

    for (let index = 0; index < 500; index += 1) {
      db.prepare(`SELECT ${index} AS value`).executeSync()
    }

    expect(db.statementCacheSize).toBeLessThanOrEqual(200)
  })
})
