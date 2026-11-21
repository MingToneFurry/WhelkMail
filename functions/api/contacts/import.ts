import { contactImportSchema } from '../../../shared/schemas'
import { contactValues, normalizeEmail, type ContactRow } from '../../_lib/contacts'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'

const UPDATE_CONTACT =
  "UPDATE contacts SET name = ?, email = ?, note = ?, source = 'manual', first_name = ?, last_name = ?, company = ?, job_title = ?, phone = ?, address = ?, website = ?, birthday = ?, emails_json = ?, phones_json = ? WHERE id = ?"

const INSERT_CONTACT =
  "INSERT INTO contacts (id, name, email, note, source, first_name, last_name, company, job_title, phone, address, website, birthday, emails_json, phones_json, created_at) VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await readJson<unknown>(context.request)
    const parsed = contactImportSchema.safeParse(body)
    if (!parsed.success) {
      return fail(
        'Invalid contacts',
        400,
        parsed.error.issues.map((issue) => issue.message).join('; '),
        'contacts_invalid',
      )
    }
    const inputs = new Map<string, (typeof parsed.data.contacts)[number]>()
    for (const contact of parsed.data.contacts) {
      inputs.set(normalizeEmail(contact.email), contact)
    }
    const emails = [...inputs.keys()]
    const existing = new Map<string, ContactRow>()
    for (let index = 0; index < emails.length; index += 50) {
      const chunk = emails.slice(index, index + 50)
      const placeholders = chunk.map(() => '?').join(', ')
      const rows = await context.env.DB.prepare(
        `SELECT * FROM contacts WHERE lower(email) IN (${placeholders})`,
      )
        .bind(...chunk)
        .all<ContactRow>()
      for (const row of rows.results) {
        existing.set(normalizeEmail(row.email), row)
      }
    }

    const statements: D1PreparedStatement[] = []
    let imported = 0
    let updated = 0
    const createdAt = new Date().toISOString()
    for (const [email, input] of inputs) {
      const row = existing.get(email)
      const values = contactValues(input, row)
      const common = [
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
      ] as const
      if (row) {
        statements.push(
          context.env.DB.prepare(UPDATE_CONTACT).bind(...common, row.id),
        )
        updated += 1
      } else {
        statements.push(
          context.env.DB.prepare(INSERT_CONTACT).bind(
            crypto.randomUUID(),
            ...common,
            createdAt,
          ),
        )
        imported += 1
      }
    }
    for (let index = 0; index < statements.length; index += 100) {
      await context.env.DB.batch(statements.slice(index, index + 100))
    }
    return json({ imported, updated })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}
