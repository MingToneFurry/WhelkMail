import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { SqliteDatabase } from './sqlite'

function migrationFiles(root: string): string[] {
  return readdirSync(join(root, 'db', 'migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort()
}

function tableExists(db: SqliteDatabase, name: string): boolean {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .bind(name)
    .executeSync()
  return rows.results.length > 0
}

function recordedMigrations(db: SqliteDatabase): Set<string> {
  const rows = db.prepare('SELECT name FROM schema_migrations').executeSync()
  return new Set(rows.results.map((row) => String((row as { name: unknown }).name)))
}

function record(db: SqliteDatabase, file: string, appliedAt: string): void {
  db.prepare('INSERT OR REPLACE INTO schema_migrations (name, applied_at) VALUES (?, ?)')
    .bind(file, appliedAt)
    .executeSync()
}

/**
 * Bring a Node/SQLite database to the current schema.
 *
 * A new database gets `db/schema.sql` and the migration list is recorded as the
 * baseline. An existing database only receives the files missing from
 * `schema_migrations`. This mirrors `scripts/migrate.mjs`, which does the same
 * for D1.
 */
export function migrateSqlite(db: SqliteDatabase, root: string): void {
  const files = migrationFiles(root)
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  )

  const now = new Date().toISOString()
  const fresh = !tableExists(db, 'accounts')
  const applied = recordedMigrations(db)

  if (fresh) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(readFileSync(join(root, 'db', 'schema.sql'), 'utf8'))
      for (const file of files) {
        record(db, file, now)
      }
      db.exec('COMMIT')
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // ignore
      }
      throw error
    }
    console.log(`[db] fresh SQLite database initialised (${files.length} migrations recorded)`)
    return
  }

  if (applied.size === 0 && files.length > 0) {
    // A database created before the registry existed (for example a D1 export)
    // already contains the full schema.sql. Record the baseline instead of
    // replaying additive ALTER statements that would fail.
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const file of files) {
        record(db, file, now)
      }
      db.exec('COMMIT')
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // ignore
      }
      throw error
    }
    console.warn(
      '[db] schema_migrations was empty on an existing database: migrations recorded without replaying them',
    )
    return
  }

  const pending = files.filter((file) => !applied.has(file))
  if (pending.length === 0) {
    console.log(`[db] SQLite schema is up to date (${applied.size} migrations)`)
    return
  }

  for (const file of pending) {
    console.log(`[db] applying ${file}`)
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(readFileSync(join(root, 'db', 'migrations', file), 'utf8'))
      record(db, file, new Date().toISOString())
      db.exec('COMMIT')
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // ignore
      }
      throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : error}`)
    }
  }
}
