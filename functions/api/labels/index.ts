import { labelCreateSchema } from '../../../shared/schemas'
import type { Label } from '../../../shared/types'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'
import { toLabel, type LabelRow } from '../../_lib/labels'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'

async function listLabels(env: Env, accountId: string | null): Promise<Label[]> {
  const result = accountId
    ? await env.DB.prepare(
        'SELECT * FROM labels WHERE account_id = ? ORDER BY name COLLATE NOCASE ASC',
      )
        .bind(accountId)
        .all<LabelRow>()
    : await env.DB.prepare('SELECT * FROM labels ORDER BY name COLLATE NOCASE ASC').all<LabelRow>()
  return result.results.map(toLabel)
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url)
    return json({ labels: await listLabels(context.env, url.searchParams.get('accountId')) })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated()
    }
    throw error
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    return await createLabel(context)
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated()
    }
    throw error
  }
}

async function createLabel(context: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
  const body = await readJson<unknown>(context.request)
  const parsed = labelCreateSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      'Invalid label',
      400,
      parsed.error.issues.map((issue) => issue.message).join('; '),
      'label_invalid',
    )
  }
  const input = parsed.data
  const account = await context.env.DB.prepare('SELECT id FROM accounts WHERE id = ?')
    .bind(input.accountId)
    .first<{ id: string }>()
  if (!account) {
    return fail('Account not found', 404, undefined, 'account_not_found')
  }
  const existing = await context.env.DB.prepare(
    'SELECT id FROM labels WHERE account_id = ? AND lower(name) = lower(?)',
  )
    .bind(input.accountId, input.name)
    .first<{ id: string }>()
  if (existing) {
    return fail('A label with this name already exists', 409, undefined, 'label_exists')
  }
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  await context.env.DB.prepare(
    'INSERT INTO labels (id, account_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, input.accountId, input.name, input.color, createdAt)
    .run()
  return json(
    {
      label: {
        id,
        accountId: input.accountId,
        name: input.name,
        color: input.color,
        createdAt,
      } satisfies Label,
    },
    201,
  )
}
