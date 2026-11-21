import type { Contact, ContactSource, Mailbox } from '../../shared/types'
import type { Env } from './env'
import { isSchemaError } from './schema'

export interface ContactRow {
  id: string
  name: string
  email: string
  note: string | null
  source: string | null
  created_at: string
}

function sourceOf(value: string | null | undefined): ContactSource {
  return value === 'auto' ? 'auto' : 'manual'
}

export function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    note: row.note ?? '',
    source: sourceOf(row.source),
    createdAt: row.created_at,
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Readable fallback for a recipient with no display name. */
export function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  return local
    .replace(/[._+-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export const AUTO_CONTACTS_SETTING = 'contact_auto_add'

/**
 * Gmail-style "Other contacts": every address a message was sent to is kept for
 * autocomplete unless the user turned the option off. Existing contacts are left
 * untouched (`INSERT OR IGNORE` on the unique lower(email) index), so a real
 * contact is never downgraded or renamed.
 */
export async function addAutoContacts(env: Env, recipients: Mailbox[]): Promise<void> {
  if (recipients.length === 0) {
    return
  }
  try {
    const setting = await env.DB.prepare(
      'SELECT value FROM app_settings WHERE key = ?',
    )
      .bind(AUTO_CONTACTS_SETTING)
      .first<{ value: string }>()
    if (setting?.value === '0') {
      return
    }
    const ownRows = await env.DB.prepare('SELECT lower(email) AS email FROM accounts').all<{
      email: string
    }>()
    const own = new Set(ownRows.results.map((row) => row.email))
    const byEmail = new Map<string, Mailbox>()
    for (const recipient of recipients) {
      const email = normalizeEmail(recipient.email)
      if (!email || !email.includes('@') || own.has(email) || byEmail.has(email)) {
        continue
      }
      byEmail.set(email, recipient)
    }
    if (byEmail.size === 0) {
      return
    }
    const createdAt = new Date().toISOString()
    const insert = async (withSource: boolean) => {
      const statements: D1PreparedStatement[] = []
      for (const [email, recipient] of byEmail) {
        const name = recipient.name?.trim() || displayNameFromEmail(email)
        statements.push(
          withSource
            ? env.DB.prepare(
                "INSERT OR IGNORE INTO contacts (id, name, email, note, created_at, source) VALUES (?, ?, ?, NULL, ?, 'auto')",
              ).bind(crypto.randomUUID(), name, email, createdAt)
            : env.DB.prepare(
                'INSERT OR IGNORE INTO contacts (id, name, email, note, created_at) VALUES (?, ?, ?, NULL, ?)',
              ).bind(crypto.randomUUID(), name, email, createdAt),
        )
      }
      for (let index = 0; index < statements.length; index += 100) {
        await env.DB.batch(statements.slice(index, index + 100))
      }
    }
    try {
      await insert(true)
    } catch (error) {
      if (!isSchemaError(error)) {
        throw error
      }
      // The `source` column comes from migration 032. Saving the address is more
      // important than the Other-contacts badge: keep working on an older schema.
      await insert(false)
    }
  } catch (error) {
    // Recording recipients must never turn a successful send into an error.
    if (!isSchemaError(error)) {
      console.error('[contacts] auto-add failed', error)
    }
  }
}
