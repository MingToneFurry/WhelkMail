import { describe, expect, it } from 'vitest'
import { contactValues, displayNameFromEmail, toContact } from '../functions/_lib/contacts'

describe('contacts', () => {
  it('builds a readable name from an address with no display name', () => {
    expect(displayNameFromEmail('mario.rossi@example.com')).toBe('Mario Rossi')
    expect(displayNameFromEmail('shop+orders@example.com')).toBe('Shop Orders')
  })

  it('keeps the Gmail-style source when reading rows', () => {
    expect(
      toContact({
        id: '1',
        name: 'Mario',
        email: 'mario@example.com',
        note: null,
        source: 'auto',
        first_name: null,
        last_name: null,
        company: null,
        job_title: null,
        phone: null,
        address: null,
        website: null,
        birthday: null,
        emails_json: null,
        phones_json: null,
        created_at: '2026-01-01T00:00:00.000Z',
      }).source,
    ).toBe('auto')
    expect(
      toContact({
        id: '2',
        name: 'Anna',
        email: 'anna@example.com',
        note: null,
        source: null,
        first_name: null,
        last_name: null,
        company: null,
        job_title: null,
        phone: null,
        address: null,
        website: null,
        birthday: null,
        emails_json: null,
        phones_json: null,
        created_at: '2026-01-01T00:00:00.000Z',
      }).source,
    ).toBe('manual')
  })

  it('normalizes extra emails and keeps omitted fields on update', () => {
    const values = contactValues(
      {
        name: 'Mario Rossi',
        email: 'Mario@Example.com',
        additionalEmails: ['A@Example.com', 'a@example.com', 'mario@example.com'],
        phone: ' 123 ',
      },
      {
        id: '1',
        name: 'Mario',
        email: 'mario@example.com',
        note: 'old',
        source: 'manual',
        first_name: 'Mario',
        last_name: 'Rossi',
        company: 'ACME',
        job_title: 'Manager',
        phone: '999',
        address: 'Via Roma',
        website: 'https://example.com',
        birthday: '1990-01-01',
        emails_json: '[]',
        phones_json: '[]',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    )
    expect(values.email).toBe('mario@example.com')
    expect(values.additionalEmails).toEqual(['a@example.com'])
    expect(values.company).toBe('ACME')
    expect(values.address).toBe('Via Roma')
    expect(values.phone).toBe('123')
    expect(values.note).toBe('old')
  })
})
