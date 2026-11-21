import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  Download,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
} from 'lucide-react'
import type { Contact, ContactInput } from '../../shared/types'
import { useI18n } from '../i18n'
import { contactsToVCard, isVCard, parseVCards } from '../lib/vcard'
import { cn, initials, isValidEmail } from '../lib/utils'

interface ContactsProps {
  contacts: Contact[]
  onCreate: (input: ContactInput) => Promise<Contact | null>
  onUpdate: (id: string, input: ContactInput) => Promise<boolean>
  onDelete: (id: string) => void
  onImport: (contacts: ContactInput[]) => Promise<{ imported: number; updated: number } | null>
}

type ExportFormat = 'vcard3' | 'vcard4' | 'csv'

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') {
      cell += char
    }
  }
  if (cell || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((item) => item.some((value) => value.trim()))
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

function parseList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,;\n]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
}

export function Contacts({ contacts, onCreate, onUpdate, onDelete, onImport }: ContactsProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [company, setCompany] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [address, setAddress] = useState('')
  const [website, setWebsite] = useState('')
  const [birthday, setBirthday] = useState('')
  const [additionalEmails, setAdditionalEmails] = useState('')
  const [additionalPhones, setAdditionalPhones] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('vcard3')
  const fileInput = useRef<HTMLInputElement>(null)

  const needle = query.trim().toLowerCase()
  const visible = needle
    ? contacts.filter((contact) =>
        [
          contact.name,
          contact.email,
          contact.company,
          contact.jobTitle,
          contact.phone,
          contact.address,
          contact.note,
          ...contact.additionalEmails,
          ...contact.additionalPhones,
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    : contacts

  function resetForm() {
    setEditingId(null)
    setFirstName('')
    setLastName('')
    setEmail('')
    setPhone('')
    setCompany('')
    setJobTitle('')
    setAddress('')
    setWebsite('')
    setBirthday('')
    setAdditionalEmails('')
    setAdditionalPhones('')
    setNote('')
    setError(null)
  }

  function startEdit(contact: Contact) {
    const person =
      contact.firstName || contact.lastName
        ? { firstName: contact.firstName, lastName: contact.lastName }
        : splitFullName(contact.name)
    setEditingId(contact.id)
    setFirstName(person.firstName)
    setLastName(person.lastName)
    setEmail(contact.email)
    setPhone(contact.phone)
    setCompany(contact.company)
    setJobTitle(contact.jobTitle)
    setAddress(contact.address)
    setWebsite(contact.website)
    setBirthday(contact.birthday)
    setAdditionalEmails(contact.additionalEmails.join(', '))
    setAdditionalPhones(contact.additionalPhones.join(', '))
    setNote(contact.note)
    setError(null)
    setMessage(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmedFirst = firstName.trim()
    const trimmedLast = lastName.trim()
    const trimmedEmail = email.trim()
    if ((!trimmedFirst && !trimmedLast) || !trimmedEmail) {
      setError(t('contacts.required'))
      return
    }
    if (!isValidEmail(trimmedEmail)) {
      setError(t('contacts.invalidEmail'))
      return
    }
    const extraEmails = parseList(additionalEmails)
    if (extraEmails.some((item) => !isValidEmail(item))) {
      setError(t('contacts.invalidEmail'))
      return
    }
    const name =
      [trimmedFirst, trimmedLast].filter(Boolean).join(' ') ||
      trimmedEmail.split('@')[0] ||
      trimmedEmail
    const input: ContactInput = {
      name,
      email: trimmedEmail,
      firstName: trimmedFirst,
      lastName: trimmedLast,
      phone: phone.trim(),
      company: company.trim(),
      jobTitle: jobTitle.trim(),
      address: address.trim(),
      website: website.trim(),
      birthday: birthday.trim(),
      additionalEmails: extraEmails,
      additionalPhones: parseList(additionalPhones),
      note: note.trim(),
    }
    setBusy(true)
    if (editingId) {
      const updated = await onUpdate(editingId, input)
      setBusy(false)
      if (updated) {
        setMessage(t('contacts.updated'))
        resetForm()
      }
    } else {
      const created = await onCreate(input)
      setBusy(false)
      if (created) {
        setMessage(t('contacts.created'))
        resetForm()
      }
    }
  }

  function exportCsv() {
    const lines = [
      'name,email,note',
      ...contacts.map((contact) =>
        [contact.name, contact.email, contact.note].map(csvCell).join(','),
      ),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'contacts.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  function exportVCards(version: '3.0' | '4.0') {
    const text = contactsToVCard(contacts, version)
    const blob = new Blob([text], { type: 'text/vcard;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `contacts-v${version.replace('.', '')}.vcf`
    link.click()
    URL.revokeObjectURL(url)
  }

  function exportContacts() {
    if (exportFormat === 'csv') {
      exportCsv()
    } else {
      exportVCards(exportFormat === 'vcard4' ? '4.0' : '3.0')
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    const text = await file.text()
    event.target.value = ''
    let inputs: ContactInput[]
    if (isVCard(text)) {
      inputs = parseVCards(text)
    } else {
      const rows = parseCsv(text)
      const start = rows[0]?.[0]?.trim().toLowerCase() === 'name' ? 1 : 0
      inputs = rows
        .slice(start)
        .map((row) => ({
          name: row[0]?.trim() ?? '',
          email: row[1]?.trim() ?? '',
          note: row[2]?.trim() ?? '',
        }))
        .filter((item) => item.name && isValidEmail(item.email))
    }
    if (inputs.length === 0) {
      setError(t('contacts.importEmpty'))
      return
    }
    setError(null)
    setMessage(null)
    const result = await onImport(inputs)
    if (!result) {
      setError(t('contacts.importFailed'))
      return
    }
    const total = result.imported + result.updated
    const failed = Math.max(0, inputs.length - total)
    setMessage(
      failed > 0
        ? t('contacts.importedPartial', { imported: total, failed })
        : t('contacts.imported', { count: total }),
    )
  }

  const inputClass =
    'w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand'

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users size={20} className="text-muted" />
            <h2 className="text-lg font-medium">{t('contacts.title')}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-slate-50"
            >
              <Upload size={14} /> {t('contacts.import')}
            </button>
            <select
              value={exportFormat}
              onChange={(event) => setExportFormat(event.target.value as ExportFormat)}
              className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs outline-none focus:border-brand"
              aria-label={t('contacts.exportFormat')}
            >
              <option value="vcard3">{t('contacts.vcard3')}</option>
              <option value="vcard4">{t('contacts.vcard4')}</option>
              <option value="csv">CSV</option>
            </select>
            <button
              type="button"
              onClick={exportContacts}
              disabled={contacts.length === 0}
              className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
            >
              <Download size={14} /> {t('contacts.export')}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.vcf,.vcard,text/csv,text/vcard,text/x-vcard"
              onChange={(event) => void importFile(event)}
              className="hidden"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-white p-5">
          <label className="relative block">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('contacts.search')}
              className="w-full rounded-full bg-slate-100 py-2 pl-9 pr-4 text-sm outline-none focus:bg-white focus:ring-1 focus:ring-line"
            />
          </label>

          <form onSubmit={submit} className="mt-4 rounded-xl border border-line p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <Plus size={13} /> {editingId ? t('contacts.edit') : t('contacts.new')}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                placeholder={t('contacts.firstName')}
                className={inputClass}
              />
              <input
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                placeholder={t('contacts.lastName')}
                className={inputClass}
              />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t('contacts.email')}
                className={inputClass}
                required
              />
              <input
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder={t('contacts.phone')}
                className={inputClass}
              />
              <input
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                placeholder={t('contacts.company')}
                className={inputClass}
              />
              <input
                value={jobTitle}
                onChange={(event) => setJobTitle(event.target.value)}
                placeholder={t('contacts.jobTitle')}
                className={inputClass}
              />
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder={t('contacts.address')}
                className={`${inputClass} sm:col-span-2`}
              />
              <input
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                placeholder={t('contacts.website')}
                className={inputClass}
              />
              <input
                value={birthday}
                onChange={(event) => setBirthday(event.target.value)}
                placeholder={t('contacts.birthday')}
                className={inputClass}
              />
              <input
                value={additionalEmails}
                onChange={(event) => setAdditionalEmails(event.target.value)}
                placeholder={t('contacts.additionalEmails')}
                className={inputClass}
              />
              <input
                value={additionalPhones}
                onChange={(event) => setAdditionalPhones(event.target.value)}
                placeholder={t('contacts.additionalPhones')}
                className={inputClass}
              />
            </div>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('contacts.note')}
              rows={2}
              className={`${inputClass} mt-2 resize-y`}
            />
            {error ? <p className="mt-2 text-xs text-brand-strong">{error}</p> : null}
            <div className="mt-3 flex justify-end gap-2">
              {editingId ? (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:bg-slate-50"
                >
                  {t('common.cancel')}
                </button>
              ) : null}
              <button
                type="submit"
                disabled={
                  busy || !email.trim() || (!firstName.trim() && !lastName.trim())
                }
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {busy ? t('common.loading') : editingId ? t('common.save') : t('contacts.add')}
              </button>
            </div>
          </form>

          {message ? <p className="mt-3 text-xs text-emerald-700">{message}</p> : null}

          <div className="mt-4 space-y-1">
            {visible.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-muted">
                {contacts.length === 0 ? t('contacts.empty') : t('contacts.noResults')}
              </p>
            ) : null}
            {visible.map((contact) => (
              <div
                key={contact.id}
                className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-strong">
                  {initials(contact.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-medium text-slate-800">{contact.name}</p>
                    {contact.source === 'auto' ? (
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                        {t('contacts.otherContacts')}
                      </span>
                    ) : null}
                  </div>
                  {contact.company || contact.jobTitle ? (
                    <p className="truncate text-xs text-muted">
                      {[contact.company, contact.jobTitle].filter(Boolean).join(' · ')}
                    </p>
                  ) : null}
                  <p className="truncate text-[11px] text-muted">
                    {[contact.email, contact.phone].filter(Boolean).join(' · ')}
                  </p>
                  {contact.note ? (
                    <p className="truncate text-[11px] text-muted">{contact.note}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(contact)}
                    className={cn(
                      'rounded-full p-1.5 text-muted hover:bg-slate-100',
                      editingId === contact.id && 'bg-slate-100 text-slate-700',
                    )}
                    aria-label={t('contacts.edit')}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(contact.id)}
                    className="rounded-full p-1.5 text-muted hover:bg-red-50 hover:text-brand-strong"
                    aria-label={t('contacts.delete')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
