import type { Contact, ContactInput } from '../../shared/types'

export type VCardVersion = '3.0' | '4.0'

interface VProperty {
  name: string
  params: Record<string, string[]>
  /** Still escaped; callers unescape per field. */
  value: string
}

const encoder = new TextEncoder()

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function unfold(text: string): string[] {
  const lines: string[] = []
  for (const line of normalizeNewlines(text).split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1)
    } else {
      lines.push(line)
    }
  }
  return lines
}

function splitUnescaped(value: string, separator: string): string[] {
  const parts: string[] = []
  let current = ''
  let escaped = false
  for (const char of value) {
    if (escaped) {
      current += `\\${char}`
      escaped = false
    } else if (char === '\\') {
      escaped = true
    } else if (char === separator) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (escaped) {
    current += '\\'
  }
  parts.push(current)
  return parts
}

function unescapeValue(value: string): string {
  return value.replace(/\\([\\,;nN])/g, (_, char: string) =>
    char === 'n' || char === 'N' ? '\n' : char,
  )
}

function parseProperty(line: string): VProperty | null {
  let colon = -1
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      quoted = !quoted
    } else if (char === ':' && !quoted) {
      colon = index
      break
    }
  }
  if (colon < 0) {
    return null
  }
  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const tokens: string[] = []
  let current = ''
  quoted = false
  for (const char of head) {
    if (char === '"') {
      quoted = !quoted
      current += char
    } else if (char === ';' && !quoted) {
      tokens.push(current)
      current = ''
    } else {
      current += char
    }
  }
  tokens.push(current)
  let name = tokens.shift()?.trim() ?? ''
  const group = name.lastIndexOf('.')
  if (group >= 0) {
    name = name.slice(group + 1)
  }
  const params: Record<string, string[]> = {}
  for (const token of tokens) {
    const equals = token.indexOf('=')
    if (equals < 0) {
      const key = token.trim().toUpperCase()
      if (key) {
        params[key] = ['TRUE']
      }
      continue
    }
    const key = token.slice(0, equals).trim().toUpperCase()
    let paramValue = token.slice(equals + 1).trim()
    if (paramValue.startsWith('"') && paramValue.endsWith('"')) {
      paramValue = paramValue.slice(1, -1)
    }
    params[key] = paramValue.split(',').map((item) => item.trim())
  }
  return { name: name.toUpperCase(), params, value }
}

function first(card: Record<string, VProperty[]>, name: string): VProperty | undefined {
  return card[name]?.[0]
}

function all(card: Record<string, VProperty[]>, name: string): VProperty[] {
  return card[name] ?? []
}

function textOf(property: VProperty | undefined): string {
  return property ? unescapeValue(property.value).trim() : ''
}

function normalizeBirthday(value: string): string {
  const trimmed = value.trim()
  if (/^\d{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`
  }
  return trimmed
}

function splitFullName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return { firstName: '', lastName: '' }
  }
  if (parts.length === 1) {
    return { firstName: parts[0] ?? '', lastName: '' }
  }
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') }
}

function cardToInput(card: Record<string, VProperty[]>): ContactInput | null {
  const email = all(card, 'EMAIL')
    .map((property) => unescapeValue(property.value).trim().replace(/^mailto:/i, ''))
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
  if (email.length === 0) {
    return null
  }
  const [primaryEmail, ...additionalEmails] = [...new Set(email)]
  if (!primaryEmail) {
    return null
  }
  const phones = [
    ...new Set(
      all(card, 'TEL')
        .map((property) => unescapeValue(property.value).trim().replace(/^tel:/i, ''))
        .filter(Boolean),
    ),
  ]
  const [phone, ...additionalPhones] = phones
  const n = first(card, 'N')
  const nParts = n ? splitUnescaped(n.value, ';') : []
  const nLast = unescapeValue(nParts[0] ?? '').trim()
  const nFirst = unescapeValue(nParts[1] ?? '').trim()
  const fn = textOf(first(card, 'FN'))
  const derived = [nFirst, nLast].filter(Boolean).join(' ').trim()
  const name = fn || derived || primaryEmail.split('@')[0] || primaryEmail
  const names =
    nFirst || nLast ? { firstName: nFirst, lastName: nLast } : splitFullName(name)
  const address = all(card, 'ADR')
    .map((property) =>
      splitUnescaped(property.value, ';')
        .map((part) => unescapeValue(part).trim())
        .filter(Boolean)
        .join(', '),
    )
    .filter(Boolean)
    .join('\n')
  const company = all(card, 'ORG')
    .map((property) =>
      splitUnescaped(property.value, ';')
        .map((part) => unescapeValue(part).trim())
        .filter(Boolean)
        .join(', '),
    )
    .filter(Boolean)
    .join(', ')
  return {
    name,
    email: primaryEmail,
    firstName: names.firstName || undefined,
    lastName: names.lastName || undefined,
    phone: phone || undefined,
    additionalPhones: additionalPhones.length > 0 ? additionalPhones : undefined,
    additionalEmails: additionalEmails.length > 0 ? additionalEmails : undefined,
    company: company || undefined,
    jobTitle: textOf(first(card, 'TITLE')) || undefined,
    address: address || undefined,
    website: textOf(first(card, 'URL')) || undefined,
    birthday: normalizeBirthday(textOf(first(card, 'BDAY'))) || undefined,
    note: textOf(first(card, 'NOTE')) || undefined,
  }
}

/** Parse one or more vCards (2.1/3.0/4.0), detecting VERSION per card. */
export function parseVCards(text: string): ContactInput[] {
  const cards: ContactInput[] = []
  let current: Record<string, VProperty[]> | null = null
  for (const line of unfold(text)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    if (/^BEGIN:VCARD$/i.test(trimmed)) {
      current = {}
      continue
    }
    if (/^END:VCARD$/i.test(trimmed)) {
      if (current) {
        const input = cardToInput(current)
        if (input) {
          cards.push(input)
        }
      }
      current = null
      continue
    }
    if (!current) {
      continue
    }
    const property = parseProperty(line)
    if (!property) {
      continue
    }
    current[property.name] = [...(current[property.name] ?? []), property]
  }
  return cards
}

export function isVCard(text: string): boolean {
  return /BEGIN:VCARD/i.test(text)
}

function escapeValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}

function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) {
    return line
  }
  const chunks: string[] = []
  let current = ''
  let bytes = 0
  for (const char of Array.from(line)) {
    const size = encoder.encode(char).length
    const limit = chunks.length === 0 ? 75 : 74
    if (bytes + size > limit) {
      chunks.push(current)
      current = char
      bytes = size
    } else {
      current += char
      bytes += size
    }
  }
  chunks.push(current)
  return chunks[0] + chunks.slice(1).map((chunk) => `\r\n ${chunk}`).join('')
}

function textProperty(
  name: string,
  value: string,
  version: VCardVersion,
  params: string[] = [],
): string | null {
  if (!value.trim()) {
    return null
  }
  const parameters = [...params]
  if (version === '3.0') {
    parameters.push('CHARSET=UTF-8')
  }
  const head = parameters.length > 0 ? `${name};${parameters.join(';')}` : name
  return foldLine(`${head}:${escapeValue(value)}`)
}

function structuredProperty(
  name: string,
  components: string[],
  version: VCardVersion,
  params: string[] = [],
): string {
  const parameters = [...params]
  if (version === '3.0') {
    parameters.push('CHARSET=UTF-8')
  }
  const head = parameters.length > 0 ? `${name};${parameters.join(';')}` : name
  return foldLine(`${head}:${components.join(';')}`)
}

function names(contact: Contact): { firstName: string; lastName: string } {
  if (contact.firstName || contact.lastName) {
    return { firstName: contact.firstName, lastName: contact.lastName }
  }
  return splitFullName(contact.name)
}

/** Serialize contacts as vCard 3.0 (default/interoperable) or 4.0. */
export function contactsToVCard(contacts: Contact[], version: VCardVersion): string {
  const lines: string[] = []
  for (const contact of contacts) {
    const person = names(contact)
    lines.push('BEGIN:VCARD', `VERSION:${version}`)
    const fn = textProperty('FN', contact.name, version)
    if (fn) {
      lines.push(fn)
    }
    lines.push(
      structuredProperty(
        'N',
        [
          escapeValue(person.lastName),
          escapeValue(person.firstName),
          '',
          '',
          '',
        ],
        version,
      ),
    )
    lines.push(
      foldLine(
        `EMAIL;TYPE=${version === '3.0' ? 'INTERNET,HOME' : 'home'}:${escapeValue(contact.email)}`,
      ),
    )
    for (const email of contact.additionalEmails) {
      lines.push(
        foldLine(
          `EMAIL;TYPE=${version === '3.0' ? 'INTERNET' : 'work'}:${escapeValue(email)}`,
        ),
      )
    }
    if (contact.phone) {
      lines.push(
        foldLine(
          `TEL;TYPE=${version === '3.0' ? 'CELL' : 'cell'}:${escapeValue(contact.phone)}`,
        ),
      )
    }
    for (const phone of contact.additionalPhones) {
      lines.push(
        foldLine(
          `TEL;TYPE=${version === '3.0' ? 'VOICE' : 'voice'}:${escapeValue(phone)}`,
        ),
      )
    }
    if (contact.address.trim()) {
      lines.push(
        structuredProperty(
          'ADR',
          ['', '', escapeValue(contact.address), '', '', '', ''],
          version,
          [`TYPE=${version === '3.0' ? 'WORK' : 'work'}`],
        ),
      )
    }
    const company = textProperty('ORG', contact.company, version)
    if (company) {
      lines.push(company)
    }
    const title = textProperty('TITLE', contact.jobTitle, version)
    if (title) {
      lines.push(title)
    }
    const website = textProperty('URL', contact.website, version)
    if (website) {
      lines.push(website)
    }
    if (contact.birthday.trim()) {
      lines.push(foldLine(`BDAY:${contact.birthday.trim()}`))
    }
    const note = textProperty('NOTE', contact.note, version)
    if (note) {
      lines.push(note)
    }
    lines.push('END:VCARD')
  }
  return lines.join('\r\n') + (lines.length > 0 ? '\r\n' : '')
}
