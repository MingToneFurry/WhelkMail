import type { ConfigEnvelope, ConfigImportResult } from '../../shared/types'
import { decryptString, encryptString, fromBase64, toBase64 } from './crypto'
import type { Env } from './env'

/**
 * Portable configuration bundle for moving an installation to another one.
 *
 * Only user-authored configuration is exported (accounts, labels, filters,
 * contacts, notification prefs and the app settings written by Settings). The
 * IMAP mirror, cached bodies, relay sent copies, sessions, logs and push
 * subscriptions are deliberately left out: they are either rebuildable from the
 * providers or tied to this deployment.
 *
 * Secrets inside `accounts` are decrypted with the source `TOKEN_ENC_KEY` and
 * held in plaintext inside the bundle. The whole bundle is then encrypted with
 * a passphrase-derived key, so the exported file is safe at rest and can be
 * imported by an installation that uses a different `TOKEN_ENC_KEY`.
 */

export const CONFIG_FORMAT = 'whelkmail-config'
export const CONFIG_VERSION = 1

const KDF_NAME = 'PBKDF2-SHA256'
/**
 * Cloudflare Workers implements PBKDF2 with a hard cap of 100,000 iterations
 * ("Pbkdf2 failed: iteration counts above 100000 are not supported"). Node
 * itself accepts more, but the bundle must be produced and opened on every
 * target, so both generation and validation stay at that ceiling.
 */
const PBKDF2_ITERATIONS = 100_000
const MIN_PBKDF2_ITERATIONS = 10_000
const MAX_PBKDF2_ITERATIONS = 100_000
const SALT_BYTES = 16
const IV_BYTES = 12

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Encrypted account columns and the plaintext name they use inside the bundle. */
const ACCOUNT_SECRET_FIELDS: Record<string, string> = {
  secret_enc: 'secret',
  access_token_enc: 'access_token',
  relay_api_key_enc: 'relay_api_key',
  relay_api_secret_enc: 'relay_api_secret',
  drive_refresh_token_enc: 'drive_refresh_token',
  drive_access_token_enc: 'drive_access_token',
}

/**
 * `app_settings` keys that belong to the user's configuration. Everything else
 * in the table (the TOTP secret, recovery hashes, the enabled flag) is security
 * state tied to this deployment and is never exported.
 */
export const CONFIG_SETTING_KEYS = [
  'default_signature',
  'default_signature_html',
  'signature_mode',
  'allow_remote_images',
  'metadata_retention_days',
  'contact_auto_add',
  'auto_reply_mode',
  'auto_reply_enabled',
  'auto_reply_subject',
  'auto_reply_body',
  'auto_reply_body_html',
]

const CONFIG_TABLES = ['accounts', 'labels', 'filters', 'contacts', 'push_prefs'] as const
type ConfigTable = (typeof CONFIG_TABLES)[number]

/**
 * Tables wiped before a restore. Order matters: rows that reference an account
 * or a label go first. The mail mirror and relay sent-copy rows are rebuildable
 * from the providers, so a restore drops them instead of leaving rows that point
 * at accounts the bundle does not contain.
 */
const CLEAR_STATEMENTS = [
  'DELETE FROM message_labels',
  'DELETE FROM filters',
  'DELETE FROM labels',
  'DELETE FROM contacts',
  'DELETE FROM push_prefs',
  'DELETE FROM accounts',
  'DELETE FROM imap_body_cache',
  'DELETE FROM imap_messages',
  'DELETE FROM imap_sync',
  'DELETE FROM imap_sync_locks',
  'DELETE FROM forward_log',
  'DELETE FROM deletion_log',
  'DELETE FROM auto_reply_log',
  'DELETE FROM storage_cleanup_log',
  'DELETE FROM messages',
]

export type ConfigRow = Record<string, unknown>

export interface ConfigData {
  accounts: ConfigRow[]
  labels: ConfigRow[]
  filters: ConfigRow[]
  contacts: ConfigRow[]
  pushPrefs: ConfigRow[]
  settings: { key: string; value: string }[]
}

export interface ConfigBundle {
  format: typeof CONFIG_FORMAT
  version: number
  createdAt: string
  data: ConfigData
}

export class ConfigTransferError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptConfigBundle(
  passphrase: string,
  bundle: ConfigBundle,
): Promise<ConfigEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(bundle)),
  )
  return {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    createdAt: bundle.createdAt,
    kdf: { name: KDF_NAME, iterations: PBKDF2_ITERATIONS, salt: toBase64(salt) },
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  }
}

function asBase64(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigTransferError('config_invalid', `Missing ${label}`)
  }
  return value
}

function parseEnvelope(value: unknown): ConfigEnvelope {
  if (!value || typeof value !== 'object') {
    throw new ConfigTransferError('config_invalid', 'Not a WhelkMail configuration file')
  }
  const envelope = value as Record<string, unknown>
  if (envelope.format !== CONFIG_FORMAT || envelope.version !== CONFIG_VERSION) {
    throw new ConfigTransferError('config_invalid', 'Unsupported configuration file')
  }
  const kdf = envelope.kdf
  if (!kdf || typeof kdf !== 'object') {
    throw new ConfigTransferError('config_invalid', 'Missing key derivation parameters')
  }
  const kdfFields = kdf as Record<string, unknown>
  const iterations = Number(kdfFields.iterations)
  if (
    kdfFields.name !== KDF_NAME ||
    !Number.isInteger(iterations) ||
    iterations < MIN_PBKDF2_ITERATIONS ||
    iterations > MAX_PBKDF2_ITERATIONS
  ) {
    throw new ConfigTransferError('config_invalid', 'Unsupported key derivation parameters')
  }
  return {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    createdAt: typeof envelope.createdAt === 'string' ? envelope.createdAt : '',
    kdf: { name: KDF_NAME, iterations, salt: asBase64(kdfFields.salt, 'salt') },
    iv: asBase64(envelope.iv, 'iv'),
    ciphertext: asBase64(envelope.ciphertext, 'ciphertext'),
  }
}

function assertRows(value: unknown, label: string): ConfigRow[] {
  if (!Array.isArray(value)) {
    throw new ConfigTransferError('config_invalid', `Invalid ${label}`)
  }
  return value.filter((row): row is ConfigRow => Boolean(row) && typeof row === 'object')
}

function validateBundle(value: unknown): ConfigBundle {
  if (!value || typeof value !== 'object') {
    throw new ConfigTransferError('config_invalid', 'Invalid configuration payload')
  }
  const bundle = value as Record<string, unknown>
  if (bundle.format !== CONFIG_FORMAT || bundle.version !== CONFIG_VERSION) {
    throw new ConfigTransferError('config_invalid', 'Unsupported configuration payload')
  }
  const data = bundle.data
  if (!data || typeof data !== 'object') {
    throw new ConfigTransferError('config_invalid', 'Missing configuration data')
  }
  const fields = data as Record<string, unknown>
  const settings = Array.isArray(fields.settings)
    ? fields.settings.filter((row): row is { key: string; value: string } => {
        return (
          Boolean(row) &&
          typeof row === 'object' &&
          typeof (row as { key?: unknown }).key === 'string' &&
          typeof (row as { value?: unknown }).value === 'string'
        )
      })
    : []
  return {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    createdAt: typeof bundle.createdAt === 'string' ? bundle.createdAt : '',
    data: {
      accounts: assertRows(fields.accounts, 'accounts'),
      labels: assertRows(fields.labels, 'labels'),
      filters: assertRows(fields.filters, 'filters'),
      contacts: assertRows(fields.contacts, 'contacts'),
      pushPrefs: assertRows(fields.pushPrefs, 'push preferences'),
      settings,
    },
  }
}

export async function decryptConfigBundle(
  passphrase: string,
  envelope: unknown,
): Promise<ConfigBundle> {
  const parsedEnvelope = parseEnvelope(envelope)
  const key = await deriveKey(
    passphrase,
    fromBase64(parsedEnvelope.kdf.salt),
    parsedEnvelope.kdf.iterations,
  )
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(parsedEnvelope.iv) },
      key,
      fromBase64(parsedEnvelope.ciphertext),
    )
  } catch {
    throw new ConfigTransferError(
      'config_passphrase',
      'Wrong passphrase or corrupted configuration file',
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(decoder.decode(plaintext))
  } catch {
    throw new ConfigTransferError('config_invalid', 'Corrupted configuration payload')
  }
  return validateBundle(parsed)
}

/** Turn an `accounts` row into its portable form (secrets decrypted, no `*_enc`). */
export async function accountRowForExport(env: Env, row: ConfigRow): Promise<ConfigRow> {
  const copy: ConfigRow = { ...row }
  const secrets: Record<string, string> = {}
  for (const [column, name] of Object.entries(ACCOUNT_SECRET_FIELDS)) {
    const value = copy[column]
    delete copy[column]
    if (typeof value === 'string' && value.length > 0) {
      try {
        secrets[name] = await decryptString(env, value)
      } catch {
        const label = String(row.email ?? row.id ?? 'unknown')
        throw new ConfigTransferError(
          'config_secret_undecryptable',
          `The stored ${name.replace(/_/g, ' ')} for ${label} cannot be decrypted with this deployment's TOKEN_ENC_KEY. Re-enter the account credentials, then export again.`,
        )
      }
    }
  }
  copy.secrets = secrets
  return copy
}

/** Reverse of `accountRowForExport`: secrets re-encrypted with the local key. */
export async function accountRowForImport(env: Env, row: ConfigRow): Promise<ConfigRow> {
  const copy: ConfigRow = { ...row }
  const source = copy.secrets
  delete copy.secrets
  const secrets: Record<string, unknown> =
    source && typeof source === 'object' ? (source as Record<string, unknown>) : {}
  for (const [column, name] of Object.entries(ACCOUNT_SECRET_FIELDS)) {
    const value = secrets[name]
    copy[column] = typeof value === 'string' && value.length > 0 ? await encryptString(env, value) : null
  }
  return copy
}

async function rows(env: Env, sql: string, ...bind: unknown[]): Promise<ConfigRow[]> {
  const statement = env.DB.prepare(sql)
  const result = await (bind.length ? statement.bind(...bind) : statement).all<ConfigRow>()
  return result.results ?? []
}

export async function buildConfigBundle(env: Env): Promise<ConfigBundle> {
  const placeholders = CONFIG_SETTING_KEYS.map(() => '?').join(', ')
  const [accountRows, labels, filters, contacts, pushPrefs, settings] = await Promise.all([
    rows(env, 'SELECT * FROM accounts ORDER BY created_at ASC'),
    rows(env, 'SELECT * FROM labels ORDER BY created_at ASC'),
    rows(env, 'SELECT * FROM filters ORDER BY created_at ASC'),
    rows(env, 'SELECT * FROM contacts ORDER BY created_at ASC'),
    rows(env, 'SELECT * FROM push_prefs'),
    rows(
      env,
      `SELECT key, value FROM app_settings WHERE key IN (${placeholders})`,
      ...CONFIG_SETTING_KEYS,
    ),
  ])
  const accounts: ConfigRow[] = []
  for (const row of accountRows) {
    accounts.push(await accountRowForExport(env, row))
  }
  return {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    createdAt: new Date().toISOString(),
    data: {
      accounts,
      labels,
      filters,
      contacts,
      pushPrefs,
      settings: settings.map((row) => ({
        key: String(row.key),
        value: String(row.value),
      })),
    },
  }
}

const COLUMN_NAME = /^[a-z][a-z0-9_]*$/

function sanitizeRow(row: ConfigRow, table: ConfigTable): ConfigRow {
  const clean: ConfigRow = {}
  for (const [key, value] of Object.entries(row)) {
    if (!COLUMN_NAME.test(key)) {
      throw new ConfigTransferError('config_invalid', `Invalid column in ${table}: ${key}`)
    }
    if (value === undefined || value === null) {
      clean[key] = null
    } else if (typeof value === 'string' || typeof value === 'number') {
      clean[key] = value
    } else if (typeof value === 'boolean') {
      clean[key] = value ? 1 : 0
    } else {
      throw new ConfigTransferError('config_invalid', `Invalid value in ${table}.${key}`)
    }
  }
  if (Object.keys(clean).length === 0) {
    throw new ConfigTransferError('config_invalid', `Empty row in ${table}`)
  }
  return clean
}

function insertStatements(env: Env, table: ConfigTable, tableRows: ConfigRow[]): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = []
  for (const raw of tableRows) {
    const row = sanitizeRow(raw, table)
    const columns = Object.keys(row)
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns
      .map(() => '?')
      .join(', ')})`
    statements.push(env.DB.prepare(sql).bind(...columns.map((column) => row[column])))
  }
  return statements
}

async function runInChunks(env: Env, statements: D1PreparedStatement[], size = 50): Promise<void> {
  for (let index = 0; index < statements.length; index += size) {
    await env.DB.batch(statements.slice(index, index + size))
  }
}

interface ConfigSnapshot {
  tables: { table: ConfigTable; rows: ConfigRow[] }[]
  settings: { key: string; value: string }[]
}

function settingsStatements(env: Env, settings: { key: string; value: string }[]): D1PreparedStatement[] {
  return settings.map((setting) =>
    env.DB.prepare(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).bind(setting.key, setting.value),
  )
}

async function replaceSettings(env: Env, settings: { key: string; value: string }[]): Promise<void> {
  const placeholders = CONFIG_SETTING_KEYS.map(() => '?').join(', ')
  await env.DB.prepare(`DELETE FROM app_settings WHERE key IN (${placeholders})`)
    .bind(...CONFIG_SETTING_KEYS)
    .run()
  await runInChunks(env, settingsStatements(env, settings))
}

/** Read what is there now, so a failed import can put it back. */
async function snapshotConfig(env: Env): Promise<ConfigSnapshot> {
  const tables: ConfigSnapshot['tables'] = []
  for (const table of CONFIG_TABLES) {
    try {
      const result = await env.DB.prepare(`SELECT * FROM ${table}`).all<ConfigRow>()
      tables.push({ table, rows: result.results })
    } catch {
      // An older schema may lack the table: nothing to keep for it.
      tables.push({ table, rows: [] })
    }
  }
  let settings: { key: string; value: string }[] = []
  try {
    const placeholders = CONFIG_SETTING_KEYS.map(() => '?').join(', ')
    const result = await env.DB.prepare(
      `SELECT key, value FROM app_settings WHERE key IN (${placeholders})`,
    )
      .bind(...CONFIG_SETTING_KEYS)
      .all<{ key: string; value: string }>()
    settings = result.results
  } catch {
    settings = []
  }
  return { tables, settings }
}

/**
 * Put a snapshot back after a failed import. Best effort: the caller reports the
 * original error, and this must not mask it with a second failure.
 */
async function restoreConfig(env: Env, snapshot: ConfigSnapshot): Promise<void> {
  await env.DB.batch(CLEAR_STATEMENTS.map((sql) => env.DB.prepare(sql)))
  for (const { table, rows } of snapshot.tables) {
    try {
      await runInChunks(env, insertStatements(env, table, rows))
    } catch {
      // Skip a table that cannot be rebuilt rather than aborting the restore.
    }
  }
  await replaceSettings(env, snapshot.settings)
}

/**
 * Replace the whole configuration with the bundle.
 *
 * Order matters for safety, because D1 makes a transaction atomic per batch and
 * not across batches:
 *
 * 1. every row is validated and every statement is built **before** anything is
 *    deleted, so a malformed bundle cannot empty the installation;
 * 2. the current configuration is snapshotted;
 * 3. the replacement runs, and if any step fails the snapshot is restored.
 */
export async function applyConfigBundle(env: Env, bundle: ConfigBundle): Promise<ConfigImportResult> {
  const accounts: ConfigRow[] = []
  for (const row of bundle.data.accounts) {
    accounts.push(await accountRowForImport(env, row))
  }
  // Built now: sanitizeRow() throws on an invalid column or value, and that must
  // happen while the current configuration is still in place.
  const prepared: Record<ConfigTable, D1PreparedStatement[]> = {
    accounts: insertStatements(env, 'accounts', accounts),
    labels: insertStatements(env, 'labels', bundle.data.labels),
    filters: insertStatements(env, 'filters', bundle.data.filters),
    contacts: insertStatements(env, 'contacts', bundle.data.contacts),
    push_prefs: insertStatements(env, 'push_prefs', bundle.data.pushPrefs),
  }
  const known = new Set(CONFIG_SETTING_KEYS)
  const settings = bundle.data.settings.filter((setting) => known.has(setting.key))

  const snapshot = await snapshotConfig(env)

  try {
    await env.DB.batch(CLEAR_STATEMENTS.map((sql) => env.DB.prepare(sql)))
    for (const table of CONFIG_TABLES) {
      await runInChunks(env, prepared[table])
    }
    await replaceSettings(env, settings)
  } catch (error) {
    await restoreConfig(env, snapshot).catch(() => undefined)
    throw error
  }

  return {
    ok: true,
    counts: {
      accounts: accounts.length,
      labels: bundle.data.labels.length,
      filters: bundle.data.filters.length,
      contacts: bundle.data.contacts.length,
      pushPrefs: bundle.data.pushPrefs.length,
      settings: settings.length,
    },
  }
}
