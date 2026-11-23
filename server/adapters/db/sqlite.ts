import { DatabaseSync } from 'node:sqlite'

/**
 * Minimal D1-compatible database backed by Node's built-in `node:sqlite`.
 *
 * The application was written against D1: `prepare().bind().first()/all()/run()`
 * plus `batch()`. Mirroring that surface keeps every call site unchanged while
 * the Docker image needs no native module and no extra dependency.
 */

type Statement = ReturnType<DatabaseSync['prepare']>

type BindValue = string | number | bigint | null | Uint8Array

interface D1Meta {
  changes: number
  last_row_id: number
}

interface D1Result<T = unknown> {
  results: T[]
  success: true
  meta: D1Meta
}

function normalize(value: unknown): BindValue {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return value
  }
  if (value instanceof Uint8Array) {
    return value
  }
  return String(value)
}

function metaOf(info: { changes: number | bigint; lastInsertRowid: number | bigint }): D1Meta {
  return {
    changes: Number(info.changes),
    last_row_id: Number(info.lastInsertRowid),
  }
}

export class SqliteStatement {
  private readonly statement: Statement
  private readonly sql: string
  private readonly values: BindValue[]

  constructor(statement: Statement, sql: string, values: BindValue[] = []) {
    this.statement = statement
    this.sql = sql
    this.values = values
  }

  bind(...values: unknown[]): SqliteStatement {
    return new SqliteStatement(
      this.statement,
      this.sql,
      values.map(normalize),
    )
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.statement.get(...this.values) as Record<string, unknown> | undefined
    if (row === undefined) {
      return null
    }
    if (column) {
      return (row[column] ?? null) as T | null
    }
    return row as T
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const results = this.statement.all(...this.values) as T[]
    return { results, success: true, meta: { changes: 0, last_row_id: 0 } }
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeSync<T>()
  }

  executeSync<T = Record<string, unknown>>(): D1Result<T> {
    if (/^\s*(select|pragma|with)\b/i.test(this.sql)) {
      const results = this.statement.all(...this.values) as T[]
      return { results, success: true, meta: { changes: 0, last_row_id: 0 } }
    }
    const info = this.statement.run(...this.values)
    return { results: [], success: true, meta: metaOf(info) }
  }
}

export class SqliteDatabase {
  private readonly db: DatabaseSync
  private readonly statements = new Map<string, Statement>()

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')
  }

  prepare(sql: string): SqliteStatement {
    let statement = this.statements.get(sql)
    if (!statement) {
      statement = this.db.prepare(sql)
      this.statements.set(sql, statement)
    }
    return new SqliteStatement(statement, sql)
  }

  async batch<T = Record<string, unknown>>(statements: SqliteStatement[]): Promise<D1Result<T>[]> {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const results = statements.map((statement) => statement.executeSync<T>())
      this.db.exec('COMMIT')
      return results
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // The transaction may already be gone; the original error matters.
      }
      throw error
    }
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  close(): void {
    this.statements.clear()
    this.db.close()
  }
}

export function openSqlite(path: string): SqliteDatabase {
  return new SqliteDatabase(path)
}
