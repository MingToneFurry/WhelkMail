import { fail } from './http'

export function isSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /no such (table|column)/i.test(message)
}

export function schemaOutdated(error?: unknown): Response {
  const reason = error instanceof Error ? error.message : error ? String(error) : ''
  return fail(
    'Database schema is outdated',
    503,
    `${reason ? `${reason}. ` : ''}Run npm run db:migrate:remote (or npm run db:migrate:local) to update the labels and filters schema.`,
    'schema_outdated',
  )
}
