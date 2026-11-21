import { describe, expect, it } from 'vitest'
import { displayNameFromEmail, toContact } from '../functions/_lib/contacts'

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
        created_at: '2026-01-01T00:00:00.000Z',
      }).source,
    ).toBe('manual')
  })
})
