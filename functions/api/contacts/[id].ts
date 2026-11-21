import { contactUpdateSchema } from '../../../shared/schemas'
import { contactValues, toContact, type ContactRow } from '../../_lib/contacts'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  try {
    return await updateContact(context)
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

async function updateContact(context: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
  const id = context.params.id as string
  const row = await context.env.DB.prepare('SELECT * FROM contacts WHERE id = ?')
    .bind(id)
    .first<ContactRow>()
  if (!row) {
    return fail('Contact not found', 404, undefined, 'contact_not_found')
  }
  const body = await readJson<unknown>(context.request)
  const parsed = contactUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      'Invalid contact',
      400,
      parsed.error.issues.map((issue) => issue.message).join('; '),
      'contact_invalid',
    )
  }
  const values = contactValues(parsed.data, row)
  if (values.email !== row.email) {
    const duplicate = await context.env.DB.prepare(
      'SELECT id FROM contacts WHERE lower(email) = ? AND id <> ?',
    )
      .bind(values.email, id)
      .first<{ id: string }>()
    if (duplicate) {
      return fail('A contact with this email already exists', 409, undefined, 'contact_exists')
    }
  }
  await context.env.DB.prepare(
    "UPDATE contacts SET name = ?, email = ?, note = ?, source = 'manual', first_name = ?, last_name = ?, company = ?, job_title = ?, phone = ?, address = ?, website = ?, birthday = ?, emails_json = ?, phones_json = ? WHERE id = ?",
  )
    .bind(
      values.name,
      values.email,
      values.note,
      values.firstName,
      values.lastName,
      values.company,
      values.jobTitle,
      values.phone,
      values.address,
      values.website,
      values.birthday,
      JSON.stringify(values.additionalEmails),
      JSON.stringify(values.additionalPhones),
      id,
    )
    .run()
  const updated = await context.env.DB.prepare('SELECT * FROM contacts WHERE id = ?')
    .bind(id)
    .first<ContactRow>()
  if (!updated) {
    return fail('Contact not found', 404, undefined, 'contact_not_found')
  }
  return json({ contact: toContact(updated) })
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  try {
    const id = context.params.id as string
    const row = await context.env.DB.prepare('SELECT id FROM contacts WHERE id = ?')
      .bind(id)
      .first<{ id: string }>()
    if (!row) {
      return fail('Contact not found', 404, undefined, 'contact_not_found')
    }
    await context.env.DB.prepare('DELETE FROM contacts WHERE id = ?').bind(id).run()
    return json({ ok: true })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}
