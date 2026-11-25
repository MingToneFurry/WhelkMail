import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { LOCALES, messages } from '../src/i18n'
import { describe, expect, it } from 'vitest'

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      sourceFiles(path, acc)
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(path)
    }
  }
  return acc
}

/** Every key passed to `t('…')` in the app. */
function usedKeys(): Set<string> {
  const keys = new Set<string>()
  for (const file of sourceFiles('src')) {
    for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
      keys.add(match[1])
    }
  }
  return keys
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
}

describe('i18n dictionaries', () => {
  const used = usedKeys()
  const englishKeys = Object.keys(messages.en).sort()

  for (const { id } of LOCALES) {
    it(`provides every UI key and substitution in ${id}`, () => {
      const dictionary = messages[id]
      expect(used.size).toBeGreaterThan(100)
      expect([...used].filter((key) => !dictionary[key])).toEqual([])
      expect(Object.keys(dictionary).sort()).toEqual(englishKeys)
      for (const key of englishKeys) {
        expect(dictionary[key].trim(), key).not.toBe('')
        expect(placeholders(dictionary[key]), key).toEqual(placeholders(messages.en[key]))
      }
    })
  }
})
