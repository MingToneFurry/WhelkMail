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

interface Requirement {
  kind: 'column' | 'table' | 'index'
  table?: string
  name: string
  unique?: boolean
}

/**
 * The objects a migration creates, read from its own statements.
 *
 * A Node database imported from D1 can predate the current `schema.sql`, so the
 * registry cannot simply be filled in: what the schema does not contain has to
 * be applied, and what is half there has to be looked at by a human. The same
 * rules live in `scripts/migrate.mjs` for D1.
 */
export function requirementsFromSql(text: string): Requirement[] {
  const sql = text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
  const pattern =
    /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)|CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)|CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)/gi
  const items: Requirement[] = []
  for (const match of sql.matchAll(pattern)) {
    if (match[1]) {
      items.push({ kind: 'column', table: match[1], name: match[2] })
    } else if (match[3]) {
      items.push({ kind: 'table', name: match[3] })
    } else {
      // The table matters: dropping it takes the index with it.
      items.push({ kind: 'index', name: match[5], unique: Boolean(match[4]), table: match[6] })
    }
  }
  return items
}

/**
 * Whether a later migration removes the object again.
 *
 * Migration 009 creates `forward_rules`, migration 011 drops it when forwarding
 * moved into filters. Such an object is legitimately absent from a current
 * schema, and counting it as "missing" would make every modern database look
 * half-migrated.
 */
export function removedByLaterMigration(
  root: string,
  files: string[],
  index: number,
  item: Requirement,
): boolean {
  const columnPattern =
    item.kind === 'column' && item.table
      ? new RegExp(
          `ALTER\\s+TABLE\\s+${item.table}\\s+DROP\\s+COLUMN\\s+${item.name}\\b`,
          'i',
        )
      : null
  for (const later of files.slice(index + 1)) {
    const text = readFileSync(join(root, 'db', 'migrations', later), 'utf8')
    if (
      new RegExp(
        `DROP\\s+(?:TABLE|INDEX|VIEW)\\s+(?:IF\\s+EXISTS\\s+)?${item.name}\\b`,
        'i',
      ).test(text)
    ) {
      return true
    }
    if (item.kind === 'index' && item.table) {
      // Indexes disappear with their table: 011 drops and recreates forward_log.
      if (
        new RegExp(
          `DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${item.table}\\b`,
          'i',
        ).test(text)
      ) {
        return true
      }
    }
    if (columnPattern?.test(text)) {
      return true
    }
  }
  return false
}

export function hasRequirement(db: SqliteDatabase, item: Requirement): boolean {
  if (item.kind === 'table') {
    return (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .bind(item.name)
        .executeSync().results.length > 0
    )
  }
  if (item.kind === 'index') {
    const rows = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
      .bind(item.name)
      .executeSync()
    if (rows.results.length === 0) {
      return false
    }
    if (!item.unique) {
      return true
    }
    return /\bUNIQUE\b/i.test(String((rows.results[0] as { sql?: unknown }).sql ?? ''))
  }
  const rows = db
    .prepare('SELECT name FROM pragma_table_info(?) WHERE name = ?')
    .bind(item.table ?? '', item.name)
    .executeSync()
  return rows.results.length > 0
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
    // may or may not contain the current schema.sql. Recording every file as
    // applied would leave a older schema declared up to date, so each one is
    // checked: complete → recorded, absent → applied, half → refused.
    console.warn('[db] schema_migrations is empty: checking each migration against the schema')
    let recordedFiles = 0
    let appliedFiles = 0
    for (const [index, file] of files.entries()) {
      const requirements = requirementsFromSql(readFileSync(join(root, 'db', 'migrations', file), 'utf8'))
      const present = requirements.filter((item) => hasRequirement(db, item))
      const gone = requirements.filter(
        (item) => !present.includes(item) && removedByLaterMigration(root, files, index, item),
      )
      const missing = requirements.filter(
        (item) => !present.includes(item) && !gone.includes(item),
      )
      if (missing.length === 0) {
        record(db, file, now)
        recordedFiles += 1
        continue
      }
      if (present.length === 0) {
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
          throw new Error(
            `Migration ${file} failed: ${error instanceof Error ? error.message : error}`,
          )
        }
        appliedFiles += 1
        continue
      }
      throw new Error(
        `[db] ${file} is partly applied: ${missing.length} of ${requirements.length} object(s) are missing ` +
          `(${missing
            .map(
              (item) =>
                `${item.kind} ${item.kind === 'column' && item.table ? `${item.table}.` : ''}${item.name}`,
            )
            .join(', ')}). ` +
          'Repair the schema by hand, or start from an empty database and import a configuration bundle.',
      )
    }
    console.log(
      `[db] baseline recorded for ${recordedFiles} migration(s), ${appliedFiles} applied to bring the schema up to date`,
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
