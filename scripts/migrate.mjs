#!/usr/bin/env node
/**
 * Apply the SQL migrations in db/migrations in filename order.
 *
 *   node scripts/migrate.mjs local              # local D1 (miniflare)
 *   node scripts/migrate.mjs remote             # remote D1 of the account
 *   node scripts/migrate.mjs remote --from=013  # ignore the registry below 013
 *   node scripts/migrate.mjs remote --mark-applied  # record, run nothing
 *   node scripts/migrate.mjs remote --dry-run   # show the plan only
 *   node scripts/migrate.mjs remote --only=019  # re-run a single file
 *
 * Every applied file is recorded in `schema_migrations`, so a rerun skips what
 * is already done and an interrupted upgrade resumes where it stopped.
 *
 * The migrations are additive ALTER/CREATE statements, not idempotent: a fresh
 * database only needs db/schema.sql, which already contains every column. On an
 * installation created before the registry existed the table is empty while the
 * schema is complete, so the script stops and asks for `--mark-applied` instead
 * of replaying migrations that would fail on duplicate columns.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const target = args.find((arg) => !arg.startsWith('--')) ?? 'local'
if (target !== 'local' && target !== 'remote') {
  console.error(`Unknown target "${target}". Use "local" or "remote".`)
  process.exit(1)
}
const fromArg = args.find((arg) => arg.startsWith('--from='))
const from = fromArg ? fromArg.slice('--from='.length).padStart(3, '0') : '000'
const onlyArg = args.find((arg) => arg.startsWith('--only='))
const only = onlyArg ? onlyArg.slice('--only='.length).padStart(3, '0') : null
const markApplied = args.includes('--mark-applied')
const dryRun = args.includes('--dry-run')

const database = process.env.WHELKMAIL_D1_NAME ?? 'mail-client'
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

function command(sql) {
  return [
    'wrangler',
    'd1',
    'execute',
    database,
    `--${target}`,
    `--command=${sql}`,
  ]
}

function runWrangler(argv, capture = false) {
  return spawnSync(npx, argv, {
    cwd: root,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  })
}

/** Run a single SQL statement and, when asked, return the rows it produced. */
function sql(statement) {
  const result = runWrangler([...command(statement), '--json'], true)
  if (result.status !== 0) {
    return { ok: false, rows: [], error: (result.stderr || result.stdout || '').trim() }
  }
  const text = result.stdout ?? ''
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end < start) {
    return { ok: false, rows: [], error: `unexpected wrangler output: ${text.slice(0, 200)}` }
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1))
    const first = Array.isArray(parsed) ? parsed[0] : parsed
    return { ok: true, rows: first?.results ?? [], error: '' }
  } catch (error) {
    return { ok: false, rows: [], error: String(error) }
  }
}

function ensureRegistry() {
  const created = sql(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  )
  if (!created.ok) {
    console.error(`\n[db] cannot create schema_migrations: ${created.error}`)
    process.exit(1)
  }
}

function appliedMigrations() {
  const result = sql('SELECT name FROM schema_migrations')
  if (!result.ok) {
    return null
  }
  return new Set(result.rows.map((row) => String(row.name)))
}

function databaseInitialised() {
  const result = sql("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'accounts'")
  return result.ok && result.rows.length > 0
}

const migrations = readdirSync(join(root, 'db', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .filter((file) => (only ? file.slice(0, 3) === only : file.slice(0, 3) >= from))

if (only && migrations.length === 0) {
  console.error(`[db] no migration file starting with ${only}.`)
  process.exit(1)
}

ensureRegistry()
const applied = appliedMigrations()
if (!applied) {
  console.error('\n[db] cannot read schema_migrations; is the database reachable?')
  process.exit(1)
}

if (applied.size === 0 && databaseInitialised() && !fromArg && !markApplied) {
  console.error(
    [
      '',
      '[db] This database has a schema but no migration registry.',
      '     It was created before schema_migrations existed.',
      '',
      '     If it is already up to date, record the current migrations without',
      '     running them:',
      '',
      `        node scripts/migrate.mjs ${target} --mark-applied`,
      '',
      '     If it is missing some of them, name the first one to apply:',
      '',
      `        node scripts/migrate.mjs ${target} --from=013`,
      '',
    ].join('\n'),
  )
  process.exit(1)
}

const pending = migrations.filter((file) => !applied.has(file))

if (pending.length === 0) {
  console.log(`[db] ${target}: nothing to apply (${applied.size} migration(s) recorded).`)
  process.exit(0)
}

if (dryRun) {
  console.log(`[db] ${target}: ${pending.length} migration(s) pending:`)
  for (const file of pending) {
    console.log(`  ${file}`)
  }
  process.exit(0)
}

if (markApplied) {
  for (const file of pending) {
    const result = sql(
      `INSERT OR REPLACE INTO schema_migrations (name, applied_at) VALUES ('${file}', datetime('now'))`,
    )
    if (!result.ok) {
      console.error(`\n[db] cannot record ${file}: ${result.error}`)
      process.exit(1)
    }
    console.log(`[db] recorded ${file}`)
  }
  console.log(`\n[db] recorded ${pending.length} migration(s) without applying them.`)
  process.exit(0)
}

for (const file of pending) {
  const relative = `./db/migrations/${file}`
  console.log(`\n[db] ${relative} -> ${target}`)
  const result = runWrangler([
    'wrangler',
    'd1',
    'execute',
    database,
    `--${target}`,
    `--file=${relative}`,
  ])
  if (result.status !== 0) {
    console.error(
      [
        '',
        `[db] ${file} failed.`,
        '     D1 runs each statement of the file on its own, so the ones before the',
        '     error are already applied and are not recorded. Inspect the database,',
        '     fix the statement, then finish this file alone:',
        '',
        `        node scripts/migrate.mjs ${target} --only=${file.slice(0, 3)}`,
        '',
        '     If the remaining statements are already applied, record it instead:',
        '',
        `        node scripts/migrate.mjs ${target} --only=${file.slice(0, 3)} --mark-applied`,
        '',
      ].join('\n'),
    )
    process.exit(result.status ?? 1)
  }
  const recorded = sql(
    `INSERT OR REPLACE INTO schema_migrations (name, applied_at) VALUES ('${file}', datetime('now'))`,
  )
  if (!recorded.ok) {
    console.error(
      `\n[db] ${file} was applied but could not be recorded (${recorded.error}). Record it manually before the next run.`,
    )
    process.exit(1)
  }
}

console.log(`\n[db] applied ${pending.length} migration(s) to ${target}.`)
