import { describe, expect, it } from 'vitest'
import {
  normalizeMessageId,
  referenceIds,
  threadKeyFor,
} from '../functions/_lib/mail/thread-key'

const base = { messageId: '<new@x.it>', inReplyTo: null, references: null, fallback: 'hash:1' }

describe('normalizeMessageId', () => {
  it('strips brackets, lowercases and takes the first id', () => {
    expect(normalizeMessageId('<ABC@X.it>')).toBe('abc@x.it')
    expect(normalizeMessageId('  <a@b.it> <c@d.it> ')).toBe('a@b.it')
    expect(normalizeMessageId(null)).toBe('')
    expect(normalizeMessageId('   ')).toBe('')
  })
})

describe('referenceIds', () => {
  it('keeps every id in order', () => {
    expect(referenceIds('<1@x> <2@x>  <3@x>')).toEqual(['1@x', '2@x', '3@x'])
    expect(referenceIds(undefined)).toEqual([])
  })
})

describe('threadKeyFor', () => {
  it('makes a message without headers its own thread', () => {
    expect(threadKeyFor(base)).toBe('new@x.it')
  })

  it('adopts the root of References', () => {
    expect(
      threadKeyFor({ ...base, references: '<root@x.it> <mid@x.it>', inReplyTo: '<mid@x.it>' }),
    ).toBe('root@x.it')
  })

  it('falls back to In-Reply-To when References is missing', () => {
    expect(threadKeyFor({ ...base, inReplyTo: '<root@x.it>' })).toBe('root@x.it')
  })

  it('prefers the key already stored for the parent (truncated chains)', () => {
    expect(
      threadKeyFor({
        ...base,
        inReplyTo: '<mid@x.it>',
        references: '<mid@x.it>',
        parentKey: 'root@x.it',
      }),
    ).toBe('root@x.it')
  })

  it('uses the stable fallback when the message has no Message-ID', () => {
    expect(threadKeyFor({ ...base, messageId: null })).toBe('hash:1')
    expect(threadKeyFor({ ...base, messageId: '', fallback: 'mid:abc' })).toBe('mid:abc')
  })
})
