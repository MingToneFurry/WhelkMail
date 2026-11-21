import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import type { Contact } from '../../shared/types'
import { useI18n } from '../i18n'
import { displayAddress, isValidEmail } from '../lib/utils'

interface RecipientFieldProps {
  value: string
  contacts: Contact[]
  onChange: (value: string) => void
  onAddContact?: (email: string) => Promise<Contact | null>
  placeholder?: string
  inputClassName?: string
}

export function RecipientField({
  value,
  contacts,
  onChange,
  onAddContact,
  placeholder,
  inputClassName,
}: RecipientFieldProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [adding, setAdding] = useState(false)

  const lastComma = value.lastIndexOf(',')
  const prefix = lastComma >= 0 ? value.slice(0, lastComma + 1) : ''
  const token = (lastComma >= 0 ? value.slice(lastComma + 1) : value).trim()
  const usedEmails = new Set(
    value
      .toLowerCase()
      .match(/[^\s,<>]+@[^\s,<>]+/g)
      ?.map((email) => email.replace(/[>,;]+$/, '')) ?? [],
  )
  const needle = token.toLowerCase()
  const suggestions = contacts
    .filter((contact) => {
      if (usedEmails.has(contact.email.toLowerCase())) {
        return false
      }
      return (
        needle.length === 0 || `${contact.name} ${contact.email}`.toLowerCase().includes(needle)
      )
    })
    .slice(0, 8)
  const tokenEmail = token.match(/[^\s,<>]+@[^\s,<>]+\.[^\s,<>]+/)?.[0].replace(/[>,;]+$/, '')
  const known = tokenEmail
    ? contacts.some((contact) => contact.email.toLowerCase() === tokenEmail.toLowerCase())
    : false
  const addEmail =
    onAddContact && tokenEmail && isValidEmail(tokenEmail) && !known
      ? tokenEmail.toLowerCase()
      : null
  const options: ({ kind: 'add'; email: string } | { kind: 'contact'; contact: Contact })[] = [
    ...(addEmail ? [{ kind: 'add' as const, email: addEmail }] : []),
    ...suggestions.map((contact) => ({ kind: 'contact' as const, contact })),
  ]

  function choose(contact: Contact) {
    const separator = prefix ? `${prefix.trimEnd()} ` : ''
    onChange(`${separator}${displayAddress(contact)}, `)
    setOpen(false)
    setActive(0)
  }

  function commitToken() {
    const trimmed = token.trim()
    if (!trimmed || !tokenEmail || !isValidEmail(tokenEmail)) {
      return
    }
    const separator = prefix ? `${prefix.trimEnd()} ` : ''
    const next = `${separator}${trimmed}, `
    if (next !== value) {
      onChange(next)
    }
    setOpen(false)
    setActive(0)
  }

  async function addToContacts(email: string) {
    if (!onAddContact || adding) {
      return
    }
    setAdding(true)
    await onAddContact(email)
    setAdding(false)
    commitToken()
  }

  function chooseOption(option: (typeof options)[number] | undefined) {
    if (!option) {
      return
    }
    if (option.kind === 'add') {
      void addToContacts(option.email)
    } else {
      choose(option.contact)
    }
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            // Enter only commits the address (or picks a suggestion). It must
            // never reach the form and send the message.
            event.preventDefault()
            if (tokenEmail && isValidEmail(tokenEmail)) {
              commitToken()
            } else if (open && options.length > 0) {
              chooseOption(options[active] ?? options[0])
            }
            return
          }
          if (event.key === 'Tab') {
            if (open && options.length > 0) {
              event.preventDefault()
              chooseOption(options[active] ?? options[0])
            }
            return
          }
          if (!open || options.length === 0) {
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive((current) => (current + 1) % options.length)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((current) => (current - 1 + options.length) % options.length)
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
        placeholder={placeholder}
        className={inputClassName}
        autoComplete="off"
      />
      {open && options.length > 0 ? (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-lg">
          {options.map((option, index) => (
            <button
              key={option.kind === 'add' ? `add:${option.email}` : option.contact.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseOption(option)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${
                index === active ? 'bg-slate-100' : 'hover:bg-slate-50'
              }`}
            >
              {option.kind === 'add' ? (
                <>
                  <UserPlus size={16} className="shrink-0 text-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800">
                      {adding
                        ? t('common.loading')
                        : t('compose.addContact', { email: option.email })}
                    </span>
                    <span className="block truncate text-muted">{option.email}</span>
                  </span>
                </>
              ) : (
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-800">
                    {option.contact.name}
                  </span>
                  <span className="block truncate text-muted">{option.contact.email}</span>
                </span>
              )}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
