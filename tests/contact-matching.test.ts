import { describe, expect, it } from 'vitest'
import { matchesContactPrefix } from '../src/lib/utils'

const mario = { name: 'Mario Rossi', email: 'mario@example.com', company: 'ACME' }

describe('recipient prefix matching', () => {
  it('matches the start of a name word', () => {
    expect(matchesContactPrefix(mario, 'm')).toBe(true)
    expect(matchesContactPrefix(mario, 'mar')).toBe(true)
  })

  it('matches a last name word', () => {
    expect(matchesContactPrefix(mario, 'rossi')).toBe(true)
  })

  it('matches multiple tokens by prefix', () => {
    expect(matchesContactPrefix(mario, 'mario r')).toBe(true)
    expect(matchesContactPrefix(mario, 'r m')).toBe(true)
  })

  it('matches an email only from its start', () => {
    expect(matchesContactPrefix(mario, 'mario@')).toBe(true)
    expect(
      matchesContactPrefix({ name: 'Indirizzo', email: 'indirizzo@gmail.com' }, 'm'),
    ).toBe(false)
    expect(
      matchesContactPrefix({ name: 'Indirizzo', email: 'indirizzo@gmail.com' }, 'gmail'),
    ).toBe(false)
  })

  it('matches the company only by word prefix', () => {
    expect(matchesContactPrefix(mario, 'acme')).toBe(true)
    expect(matchesContactPrefix(mario, 'cme')).toBe(false)
  })

  it('does not suggest anything for an empty query', () => {
    expect(matchesContactPrefix(mario, '')).toBe(false)
    expect(matchesContactPrefix(mario, '   ')).toBe(false)
  })
})
