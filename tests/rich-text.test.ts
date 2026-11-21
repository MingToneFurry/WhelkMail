import { describe, expect, it } from 'vitest'
import { plainTextToHtml } from '../src/lib/rich-text'

describe('compose text helpers', () => {
  it('escapes markup and keeps line breaks', () => {
    expect(plainTextToHtml('Ciao <Mario>\n"quote" & more')).toBe(
      'Ciao &lt;Mario&gt;<br>&quot;quote&quot; &amp; more',
    )
  })

  it('returns an empty string for an empty body', () => {
    expect(plainTextToHtml('')).toBe('')
  })
})
