import { describe, expect, it } from 'vitest'
import type { Contact } from '../shared/types'
import { contactsToVCard, isVCard, parseVCards } from '../src/lib/vcard'

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: '1',
    name: 'Mario Rossi',
    email: 'mario@example.com',
    note: 'Note',
    source: 'manual',
    firstName: 'Mario',
    lastName: 'Rossi',
    company: 'ACME',
    jobTitle: 'Manager',
    phone: '+39 333 1234567',
    address: 'Via Roma 1, Milano',
    website: 'https://example.com',
    birthday: '1990-01-02',
    additionalEmails: ['mario.work@example.com'],
    additionalPhones: ['+39 02 123456'],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('vCard import', () => {
  it('detects and parses vCard 3.0 with folded lines', () => {
    const text = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Mario Rossi',
      'N:Rossi;Mario;;;',
      'EMAIL;TYPE=INTERNET,HOME:mario@example.com',
      'EMAIL;TYPE=INTERNET:mario.work@example.com',
      'TEL;TYPE=CELL:+39 333 1234567',
      'ADR;TYPE=WORK:;;Via Roma 1;Milano;;20100;Italia',
      'ORG:ACME',
      'TITLE:Manager',
      'URL:https://example.com',
      'BDAY:19900102',
      'NOTE:Line one',
      '  and line two',
      'END:VCARD',
    ].join('\r\n')
    expect(isVCard(text)).toBe(true)
    const [parsed] = parseVCards(text)
    expect(parsed).toMatchObject({
      name: 'Mario Rossi',
      email: 'mario@example.com',
      firstName: 'Mario',
      lastName: 'Rossi',
      phone: '+39 333 1234567',
      company: 'ACME',
      jobTitle: 'Manager',
      website: 'https://example.com',
      birthday: '1990-01-02',
      note: 'Line one and line two',
    })
    expect(parsed?.additionalEmails).toEqual(['mario.work@example.com'])
    expect(parsed?.address).toContain('Via Roma 1')
  })

  it('parses vCard 4.0 and ignores a card without an email', () => {
    const text = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Anna Bianchi',
      'N:Bianchi;Anna;;;',
      'EMAIL;TYPE=work:anna@example.com',
      'TEL;TYPE=cell:+39 111',
      'END:VCARD',
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:No Email',
      'END:VCARD',
    ].join('\n')
    const parsed = parseVCards(text)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({
      name: 'Anna Bianchi',
      email: 'anna@example.com',
      firstName: 'Anna',
      lastName: 'Bianchi',
      phone: '+39 111',
    })
  })

  it('unescapes separators in names and notes', () => {
    const text = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Rossi\\, Mario',
      'N:Rossi\\; Jr;Mario;;;',
      'EMAIL:mario@example.com',
      'NOTE:first\\nsecond',
      'END:VCARD',
    ].join('\n')
    const [parsed] = parseVCards(text)
    expect(parsed?.name).toBe('Rossi, Mario')
    expect(parsed?.lastName).toBe('Rossi; Jr')
    expect(parsed?.note).toBe('first\nsecond')
  })
})

describe('vCard export', () => {
  it('writes vCard 3.0 with the structured fields', () => {
    const text = contactsToVCard([contact()], '3.0')
    expect(text).toContain('BEGIN:VCARD\r\nVERSION:3.0')
    expect(text).toContain('FN;CHARSET=UTF-8:Mario Rossi')
    expect(text).toContain('N;CHARSET=UTF-8:Rossi;Mario;;;')
    expect(text).toContain('EMAIL;TYPE=INTERNET,HOME:mario@example.com')
    expect(text).toContain('EMAIL;TYPE=INTERNET:mario.work@example.com')
    expect(text).toContain('TEL;TYPE=CELL:+39 333 1234567')
    expect(text).toContain('ORG;CHARSET=UTF-8:ACME')
  })

  it('writes vCard 4.0 without CHARSET', () => {
    const text = contactsToVCard([contact()], '4.0')
    expect(text).toContain('VERSION:4.0')
    expect(text).toContain('FN:Mario Rossi')
    expect(text).not.toContain('CHARSET=UTF-8')
    expect(text).toContain('EMAIL;TYPE=home:mario@example.com')
  })

  it('round-trips the extra fields', () => {
    const parsed = parseVCards(contactsToVCard([contact()], '3.0'))
    expect(parsed[0]).toMatchObject({
      name: 'Mario Rossi',
      email: 'mario@example.com',
      firstName: 'Mario',
      lastName: 'Rossi',
      company: 'ACME',
      jobTitle: 'Manager',
      phone: '+39 333 1234567',
      website: 'https://example.com',
      birthday: '1990-01-02',
    })
    expect(parsed[0]?.additionalEmails).toEqual(['mario.work@example.com'])
    expect(parsed[0]?.additionalPhones).toEqual(['+39 02 123456'])
  })
})
