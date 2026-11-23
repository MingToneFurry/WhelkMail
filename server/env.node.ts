import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Env } from '../functions/_lib/env'
import { migrateSqlite } from './adapters/db/migrate'
import { openSqlite, type SqliteDatabase } from './adapters/db/sqlite'
import { createS3Bucket } from './adapters/storage/s3'
import { appPasswordProblem, MIN_APP_PASSWORD_LENGTH } from '../shared/app-password'

export interface NodeEnvironment {
  env: Env
  database: SqliteDatabase
  databasePath: string
  staticDir: string
  port: number
  host: string
  publicOrigin?: string
  cronEnabled: boolean
}

function value(name: string): string | undefined {
  const raw = process.env[name]
  if (raw === undefined || raw === '') {
    return undefined
  }
  return raw
}

function required(name: string): string {
  const raw = value(name)
  if (!raw) {
    throw new Error(`Missing required environment variable ${name}`)
  }
  return raw
}

const PASSTHROUGH = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_MAIL_CLIENT_ID',
  'GOOGLE_MAIL_CLIENT_SECRET',
  'MICROSOFT_CLIENT_ID',
  'MICROSOFT_CLIENT_SECRET',
  'MICROSOFT_TENANT',
  'RELAY_PROVIDER',
  'RELAY_API_KEY',
  'RELAY_API_SECRET',
  'MAILGUN_DOMAIN',
  'MAILGUN_REGION',
  'SMTP2GO_API_KEY',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  'UPDATE_CHECK',
  'GITHUB_TOKEN',
] as const

export function loadNodeEnvironment(root = process.cwd()): NodeEnvironment {
  const databasePath = value('DB_PATH') ?? join(root, 'data', 'whelkmail.sqlite')
  mkdirSync(dirname(databasePath), { recursive: true })

  const database = openSqlite(databasePath)
  migrateSqlite(database, root)

  const bucketName = value('S3_BUCKET')
  let bucket: unknown = undefined
  if (bucketName) {
    const endpoint = value('S3_ENDPOINT') ?? value('AWS_ENDPOINT_URL_S3')
    const accessKeyId = value('S3_ACCESS_KEY_ID') ?? value('AWS_ACCESS_KEY_ID')
    const secretAccessKey = value('S3_SECRET_ACCESS_KEY') ?? value('AWS_SECRET_ACCESS_KEY')
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'S3_BUCKET is set but S3_ENDPOINT, S3_ACCESS_KEY_ID or S3_SECRET_ACCESS_KEY is missing',
      )
    }
    bucket = createS3Bucket({
      endpoint,
      bucket: bucketName,
      region: value('S3_REGION') ?? value('AWS_REGION') ?? 'us-east-1',
      accessKeyId,
      secretAccessKey,
      sessionToken: value('S3_SESSION_TOKEN') ?? value('AWS_SESSION_TOKEN'),
      forcePathStyle: value('S3_FORCE_PATH_STYLE') !== 'false',
    })
  }

  const publicOrigin = value('PUBLIC_ORIGIN') ?? value('APP_URL')
  if (!publicOrigin) {
    // Without it the origin comes from X-Forwarded-Proto/Host, which a client
    // can write unless a proxy overwrites them: cookies and OAuth redirects
    // would then follow an attacker-chosen host.
    const message =
      'PUBLIC_ORIGIN is required: set it to the public URL of this deployment (for example https://mail.example.com).'
    if (process.env.NODE_ENV === 'production') {
      throw new Error(message)
    }
    console.warn(`[env] ${message}`)
  }
  const cronSecret = value('CRON_SECRET') ?? `local-${crypto.randomUUID()}`

  const appPassword = required('APP_PASSWORD')
  const passwordProblem = appPasswordProblem(appPassword)
  if (passwordProblem) {
    // A container that starts with the example password is a public installation
    // with a password printed in the repository.
    const message = `${passwordProblem} Choose a password of at least ${MIN_APP_PASSWORD_LENGTH} characters and set it in deploy/docker/.env.`
    if (process.env.NODE_ENV === 'production') {
      throw new Error(message)
    }
    console.warn(`[env] ${message}`)
  }

  const env: Env = {
    DB: database as unknown as Env['DB'],
    BUCKET: bucket as Env['BUCKET'],
    APP_PASSWORD: appPassword,
    TOKEN_ENC_KEY: required('TOKEN_ENC_KEY'),
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    CRON_SECRET: cronSecret,
    APP_URL: publicOrigin,
  }

  for (const name of PASSTHROUGH) {
    const raw = value(name)
    if (raw !== undefined) {
      ;(env as unknown as Record<string, unknown>)[name] = raw
    }
  }

  const port = Number(value('PORT') ?? '8787')
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error('PORT must be a positive number')
  }

  return {
    env,
    database,
    databasePath,
    staticDir: value('STATIC_DIR') ?? join(root, 'dist'),
    port,
    host: value('HOST') ?? '0.0.0.0',
    publicOrigin,
    cronEnabled: value('CRON_ENABLED') !== 'false',
  }
}
