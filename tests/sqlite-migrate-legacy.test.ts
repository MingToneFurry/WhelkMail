import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateSqlite, requirementsFromSql } from '../server/adapters/db/migrate'
import { openSqlite, type SqliteDatabase } from '../server/adapters/db/sqlite'

const roots: string[] = []
let database: SqliteDatabase | null = null

function freshDatabase(): SqliteDatabase {
  const root = mkdtempSync(join(tmpdir(), 'whelkmail-legacy-'))
  roots.push(root)
  database = openSqlite(join(root, 'legacy.sqlite'))
  migrateSqlite(database, process.cwd())
  // Simulate a database that predates the registry, or a D1 export: the schema
  // is there, the bookkeeping is not.
  database.exec('DELETE FROM schema_migrations')
  return database
}

function registry(db: SqliteDatabase): string[] {
  return db
    .prepare('SELECT name FROM schema_migrations ORDER BY name')
    .executeSync()
    .results.map((row) => String((row as { name: unknown }).name))
}

function hasColumn(db: SqliteDatabase, table: string, column: string): boolean {
  return (
    db
      .prepare('SELECT name FROM pragma_table_info(?) WHERE name = ?')
      .bind(table, column)
      .executeSync().results.length > 0
  )
}

afterEach(() => {
  database?.close()
  database = null
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('migration requirements', () => {
  it('reads columns, tables and unique indexes', () => {
    const items = requirementsFromSql(
      "ALTER TABLE accounts ADD COLUMN x TEXT;\nCREATE TABLE IF NOT EXISTS t (id TEXT);\nCREATE UNIQUE INDEX IF NOT EXISTS idx ON t (id);",
    )

    expect(items).toEqual([
      { kind: 'column', table: 'accounts', name: 'x' },
      { kind: 'table', name: 't' },
      { kind: 'index', name: 'idx', unique: true, table: 't' },
    ])
  })

  it('ignores commented-out statements', () => {
    expect(requirementsFromSql('-- ALTER TABLE accounts ADD COLUMN nope TEXT;')).toEqual([])
  })
})

describe('legacy SQLite database without a registry', () => {
  it('records the migrations when the schema already contains everything', () => {
    const db = freshDatabase()

    migrateSqlite(db, process.cwd())

    // Nothing replayed, everything recorded.
    expect(registry(db).length).toBeGreaterThan(0)
    expect(hasColumn(db, 'imap_messages', 'aliases_checked')).toBe(true)
  })

  it('applies a migration whose objects are missing instead of recording it', () => {
    const db = freshDatabase()
    db.exec('ALTER TABLE imap_messages DROP COLUMN aliases_checked')
    expect(hasColumn(db, 'imap_messages', 'aliases_checked')).toBe(false)

    migrateSqlite(db, process.cwd())

    expect(hasColumn(db, 'imap_messages', 'aliases_checked')).toBe(true)
    expect(registry(db)).toContain('029_aliases_checked.sql')
  })

  it('refuses a migration that is only half applied', () => {
    const db = freshDatabase()
    // 019 adds the column and the index: keep the column, drop the index.
    db.exec('DROP INDEX idx_imap_messages_page')

    expect(() => migrateSqlite(db, process.cwd())).toThrow(/partly applied/)
  })
})
