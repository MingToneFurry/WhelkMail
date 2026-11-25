import { messages } from '../src/i18n'
import { describe, expect, it } from 'vitest'
import { MAIL_PRESETS, RELAY_PROVIDERS } from '../shared/presets'

// Preset labelKey/noteKey values are passed to t() as variables, which
// tests/i18n-keys.test.ts can't see (it only finds literal t('...') keys).
// Check them against the locale dictionaries here instead.
describe('preset translations', () => {
  it('has every preset label and note key in every locale', () => {
    const keys = [
      ...MAIL_PRESETS.flatMap((preset) => [preset.labelKey, preset.noteKey]),
      ...RELAY_PROVIDERS.map((provider) => provider.labelKey),
    ].filter((key): key is string => Boolean(key))
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      for (const [locale, dictionary] of Object.entries(messages)) {
        expect(dictionary[key], `${locale} is missing ${key}`).toBeTruthy()
      }
    }
  })
})
