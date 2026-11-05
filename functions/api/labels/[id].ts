import { labelUpdateSchema } from '../../../shared/schemas'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'
import { toLabel, type LabelRow } from '../../_lib/labels'

export const onRequestPatch: PagesFunction<Env> = async (context) => {
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
      'SELECT id FROM labels WHERE lower(name) = lower(?) AND id <> ?',
    )
      .bind(name, id)
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
  const id = context.params.id as string
  const row = await context.env.DB.prepare('SELECT id FROM labels WHERE id = ?')
    .bind(id)
    .first<{ id: string }>()
  if (!row) {
    return fail('Label not found', 404, undefined, 'label_not_found')
  }
  await context.env.DB.batch([
    context.env.DB.prepare('DELETE FROM message_labels WHERE label_id = ?').bind(id),
    context.env.DB.prepare('DELETE FROM labels WHERE id = ?').bind(id),
  ])
  return json({ ok: true })
}
