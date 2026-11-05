import { fail } from './http'

export function isSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /no such (table|column)/i.test(message)
}

export function schemaOutdated(): Response {
  return fail(
    'Database schema is outdated',
    503,
    'Run npm run db:migrate:remote (or npm run db:migrate:local) to create the labels, message_labels and app_settings tables.',
    'schema_outdated',
  )
}
