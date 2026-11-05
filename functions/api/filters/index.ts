import { filterCreateSchema } from '../../../shared/schemas'
import type { Env } from '../../_lib/env'
import { labelsBelongToAccount, toFilter, type FilterRow } from '../../_lib/filters'
import { fail, json, readJson } from '../../_lib/http'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'

async function listFilters(env: Env, accountId: string | null) {
  const result = accountId
    ? await env.DB.prepare(
        'SELECT * FROM filters WHERE account_id = ? ORDER BY created_at ASC',
      )
        .bind(accountId)
        .all<FilterRow>()
    : await env.DB.prepare('SELECT * FROM filters ORDER BY created_at ASC').all<FilterRow>()
  return result.results.map(toFilter)
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url)
    return json({ filters: await listFilters(context.env, url.searchParams.get('accountId')) })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    return await createFilter(context)
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

async function createFilter(context: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
  const body = await readJson<unknown>(context.request)
  const parsed = filterCreateSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      'Invalid filter',
      400,
      parsed.error.issues.map((issue) => issue.message).join('; '),
      'filter_invalid',
    )
  }
  const input = parsed.data
  const account = await context.env.DB.prepare('SELECT id FROM accounts WHERE id = ?')
    .bind(input.accountId)
    .first<{ id: string }>()
  if (!account) {
    return fail('Account not found', 404, undefined, 'account_not_found')
  }
  if (!(await labelsBelongToAccount(context.env, input.accountId, input.labelIds))) {
    return fail('Label not found', 404, undefined, 'label_not_found')
  }
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  await context.env.DB.prepare(
    `INSERT INTO filters (id, account_id, name, from_pattern, to_pattern, subject_pattern, has_words, doesnt_have, has_attachment, label_ids_json, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.accountId,
      input.name?.trim() || 'Filter',
      input.from?.trim() || null,
      input.to?.trim() || null,
      input.subject?.trim() || null,
      input.hasWords?.trim() || null,
      input.doesntHave?.trim() || null,
      input.hasAttachment ? 1 : 0,
      JSON.stringify(input.labelIds),
      input.enabled === false ? 0 : 1,
      createdAt,
    )
    .run()
  const row = await context.env.DB.prepare('SELECT * FROM filters WHERE id = ?')
    .bind(id)
    .first<FilterRow>()
  if (!row) {
    return fail('Internal error', 500, undefined, 'internal')
  }
  return json({ filter: toFilter(row) }, 201)
}
