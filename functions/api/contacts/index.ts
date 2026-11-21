import { contactCreateSchema } from '../../../shared/schemas'
import {
  contactValues,
  normalizeEmail,
  toContact,
  type ContactRow,
} from '../../_lib/contacts'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url)
    const query = url.searchParams.get('q')?.trim() ?? ''
    const rows = query
      ? await context.env.DB.prepare(
          'SELECT * FROM contacts WHERE lower(name) LIKE ? OR lower(email) LIKE ? ORDER BY name COLLATE NOCASE ASC LIMIT 5000',
        )
          .bind(`%${query.toLowerCase()}%`, `%${query.toLowerCase()}%`)
          .all<ContactRow>()
      : await context.env.DB.prepare(
          'SELECT * FROM contacts ORDER BY name COLLATE NOCASE ASC LIMIT 5000',
        ).all<ContactRow>()
    return json({ contacts: rows.results.map(toContact) })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    return await createContact(context)
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

async function createContact(context: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
  const body = await readJson<unknown>(context.request)
  const parsed = contactCreateSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      'Invalid contact',
      400,
      parsed.error.issues.map((issue) => issue.message).join('; '),
      'contact_invalid',
    )
  }
  const email = normalizeEmail(parsed.data.email)
  const existing = await context.env.DB.prepare(
    'SELECT * FROM contacts WHERE lower(email) = ?',
  )
    .bind(email)
    .first<ContactRow>()
  const values = contactValues(parsed.data, existing ?? undefined)
  if (existing) {
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
        existing.id,
      )
      .run()
    const updated = await context.env.DB.prepare('SELECT * FROM contacts WHERE id = ?')
      .bind(existing.id)
      .first<ContactRow>()
    if (!updated) {
      return fail('Internal error', 500, undefined, 'internal')
    }
    return json({ contact: toContact(updated) })
  }
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  await context.env.DB.prepare(
    "INSERT INTO contacts (id, name, email, note, source, first_name, last_name, company, job_title, phone, address, website, birthday, emails_json, phones_json, created_at) VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
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
      createdAt,
    )
    .run()
  const inserted = await context.env.DB.prepare('SELECT * FROM contacts WHERE id = ?')
    .bind(id)
    .first<ContactRow>()
  if (!inserted) {
    return fail('Internal error', 500, undefined, 'internal')
  }
  return json({ contact: toContact(inserted) }, 201)
}
