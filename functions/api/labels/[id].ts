import { labelUpdateSchema } from '../../../shared/schemas'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'
import { toLabel, type LabelRow } from '../../_lib/labels'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  try {
    return await updateLabel(context)
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated()
    }
    throw error
  }
}

async function updateLabel(context: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
  const id = context.params.id as string
  const row = await context.env.DB.prepare('SELECT * FROM labels WHERE id = ?')
    .bind(id)
    .first<LabelRow>()
  if (!row) {
    return fail('Label not found', 404, undefined, 'label_not_found')
  }
  const body = await readJson<unknown>(context.request)
  const parsed = labelUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      'Invalid label',
      400,
      parsed.error.issues.map((issue) => issue.message).join('; '),
      'label_invalid',
    )
  }
  const name = parsed.data.name ?? row.name
  const color = parsed.data.color ?? row.color
  if (name.toLowerCase() !== row.name.toLowerCase()) {
    const duplicate = await context.env.DB.prepare(
      'SELECT id FROM labels WHERE account_id IS ? AND lower(name) = lower(?) AND id <> ?',
    )
      .bind(row.account_id, name, id)
      .first<{ id: string }>()
    if (duplicate) {
      return fail('A label with this name already exists', 409, undefined, 'label_exists')
    }
  }
  await context.env.DB.prepare('UPDATE labels SET name = ?, color = ? WHERE id = ?')
    .bind(name, color, id)
    .run()
  const updated = await context.env.DB.prepare('SELECT * FROM labels WHERE id = ?')
    .bind(id)
    .first<LabelRow>()
  if (!updated) {
    return fail('Label not found', 404, undefined, 'label_not_found')
  }
  return json({ label: toLabel(updated) })
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  try {
    return await deleteLabel(context)
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated()
    }
    throw error
  }
}

async function deleteLabel(context: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
  const id = context.params.id as string
  const row = await context.env.DB.prepare('SELECT id, account_id FROM labels WHERE id = ?')
    .bind(id)
    .first<{ id: string; account_id: string | null }>()
  if (!row) {
    return fail('Label not found', 404, undefined, 'label_not_found')
  }
  const statements = [
    context.env.DB.prepare('DELETE FROM message_labels WHERE label_id = ?').bind(id),
    context.env.DB.prepare('DELETE FROM labels WHERE id = ?').bind(id),
  ]
  if (row.account_id) {
    const filters = await context.env.DB.prepare(
      'SELECT id, label_ids_json FROM filters WHERE account_id = ?',
    )
      .bind(row.account_id)
      .all<{ id: string; label_ids_json: string }>()
    for (const filter of filters.results) {
      let labelIds: string[] = []
      try {
        labelIds = JSON.parse(filter.label_ids_json) as string[]
      } catch {
        continue
      }
      if (!labelIds.includes(id)) {
        continue
      }
      const remaining = labelIds.filter((labelId) => labelId !== id)
      statements.push(
        remaining.length > 0
          ? context.env.DB.prepare('UPDATE filters SET label_ids_json = ? WHERE id = ?').bind(
              JSON.stringify(remaining),
              filter.id,
            )
          : context.env.DB.prepare('DELETE FROM filters WHERE id = ?').bind(filter.id),
      )
    }
  }
  await context.env.DB.batch(statements)
  return json({ ok: true })
}
