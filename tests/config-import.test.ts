import { describe, expect, it } from 'vitest'
import {
  applyConfigBundle,
  CONFIG_FORMAT,
  CONFIG_VERSION,
  type ConfigBundle,
  type ConfigData,
} from '../functions/_lib/config-transfer'
import type { Env } from '../functions/_lib/env'

/**
 * Minimal D1 stand-in for the import path: it records what ran, so a test can
 * prove that nothing was deleted before the bundle was validated and that a
 * failure puts the previous configuration back.
 */
type Row = Record<string, unknown>

class FakeDb {
  tables = new Map<string, Row[]>([
    ['accounts', []],
    ['labels', [{ id: 'old-label', name: 'Old', color: 'blue' }]],
    ['filters', []],
    ['contacts', []],
    ['push_prefs', []],
    ['app_settings', [{ key: 'signature_mode', value: 'shared' }]],
  ])
  cleared = false
  /** Table whose INSERT throws once, to fail in the middle of the import. */
  failOnInsert: string | null = null
  statements = 0

  rows(table: string): Row[] {
    return this.tables.get(table) ?? []
  }

  prepare(sql: string) {
    let params: unknown[] = []
    const self = {
      bind(...args: unknown[]) {
        params = args
        return self
      },
      async run() {
        return { meta: { changes: this.apply(sql) } }
      },
      async all() {
        const rows = this.select(sql)
        return { results: rows }
      },
      async first() {
        return this.select(sql)[0] ?? null
      },
      apply: (statement: string) => 0,
    }
    // Keep the SQL for batch(); `apply` is replaced per statement below.
    const record = { sql, params, run: self.run.bind({ ...self, apply: () => this.execute(sql, params) }) }
    self.run = async () => ({ meta: { changes: this.execute(sql, params) } })
    self.all = async () => ({ results: this.select(sql) })
    self.first = async () => this.select(sql)[0] ?? null
    void record
    return self
  }

  async batch(statements: { run: () => Promise<unknown> }[]) {
    const results = []
    for (const statement of statements) {
      results.push(await statement.run())
    }
    return results
  }

  private tableOf(sql: string): string {
    const match = /(?:FROM|INTO|UPDATE)\s+(\w+)/i.exec(sql)
    return match?.[1] ?? ''
  }

  private select(sql: string): Row[] {
    if (!/^\s*SELECT/i.test(sql)) {
      return []
    }
    return this.rows(this.tableOf(sql))
  }

  private execute(sql: string, params: unknown[]): number {
    this.statements += 1
    const table = this.tableOf(sql)
    if (/^\s*DELETE\s+FROM\s+(\w+)\s*$/i.test(sql)) {
      const rows = this.rows(table)
      if (table === 'labels') {
        this.cleared = true
      }
      this.tables.set(table, [])
      return rows.length
    }
    if (/^\s*DELETE\s+FROM\s+app_settings/i.test(sql)) {
      const keys = params.map(String)
      const kept = this.rows('app_settings').filter((row) => !keys.includes(String(row.key)))
      this.tables.set('app_settings', kept)
      return keys.length
    }
    if (/^\s*INSERT\s+INTO/i.test(sql)) {
      if (this.failOnInsert === table) {
        this.failOnInsert = null
        throw new Error(`INSERT into ${table} failed`)
      }
      const columns = /\(([^)]*)\)\s*VALUES/i.exec(sql)?.[1]?.split(',').map((item) => item.trim()) ?? []
      const row: Row = {}
      columns.forEach((column, index) => {
        row[column] = params[index]
      })
      this.tables.set(table, [...this.rows(table), row])
      return 1
    }
    return 0
  }
}

function envWith(db: FakeDb): Env {
  return { DB: db } as unknown as Env
}

function bundle(data: Partial<ConfigData>): ConfigBundle {
  return {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    createdAt: new Date().toISOString(),
    data: {
      accounts: [],
      labels: [],
      filters: [],
      contacts: [],
      pushPrefs: [],
      settings: [],
      ...data,
    },
  }
}

describe('configuration import', () => {
  it('validates every row before deleting anything', async () => {
    const db = new FakeDb()

    await expect(
      applyConfigBundle(
        envWith(db),
        bundle({ labels: [{ id: 'new', 'bad column': 'x' }] }),
      ),
    ).rejects.toThrow(/Invalid column/)

    expect(db.cleared).toBe(false)
    expect(db.rows('labels')).toHaveLength(1)
  })

  it('restores the previous configuration when an insert fails', async () => {
    const db = new FakeDb()
    db.failOnInsert = 'contacts'

    await expect(
      applyConfigBundle(
        envWith(db),
        bundle({
          labels: [{ id: 'new-label', name: 'New', color: 'emerald' }],
          // The insert that fails must actually be attempted: it runs after the
          // clear and after the labels, which is the window being tested.
          contacts: [{ id: 'c1', name: 'Someone', email: 'someone@example.com' }],
        }),
      ),
    ).rejects.toThrow(/INSERT into contacts failed/)

    // The old label is back, the new one is gone: the import left no half state.
    expect(db.rows('labels')).toEqual([{ id: 'old-label', name: 'Old', color: 'blue' }])
  })

  it('replaces the configuration on success', async () => {
    const db = new FakeDb()

    const result = await applyConfigBundle(
      envWith(db),
      bundle({
        labels: [{ id: 'new-label', name: 'New', color: 'emerald' }],
        settings: [{ key: 'signature_mode', value: 'per_account' }],
      }),
    )

    expect(result.counts.labels).toBe(1)
    expect(db.rows('labels').map((row) => row.id)).toEqual(['new-label'])
    expect(db.rows('app_settings')).toContainEqual({ key: 'signature_mode', value: 'per_account' })
  })
})
