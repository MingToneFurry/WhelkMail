import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { matchRoute } from '../server/router'
import { routes } from '../server/routes'

const apiRoot = join(process.cwd(), 'functions', 'api')

function routeFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      routeFiles(full, files)
    } else if (entry.endsWith('.ts') && !entry.startsWith('_')) {
      files.push(full)
    }
  }
  return files
}

function expectedPath(file: string): string {
  const parts = relative(apiRoot, file)
    .replace(/\\/g, '/')
    .replace(/\.ts$/, '')
    .split('/')
    .filter((part) => part !== '' && part !== 'index')
    .map((part) => (part.startsWith('[') ? `:${part.slice(1, -1)}` : part))
  return `/api/${parts.join('/')}`
}

describe('API route table', () => {
  it('has one route per Pages Functions file', () => {
    const expected = routeFiles(apiRoot).map(expectedPath).sort()
    const actual = routes.map((route) => route.path).sort()
    expect(actual).toEqual(expected)
  })

  it('prefers static routes over dynamic ones', () => {
    expect(matchRoute('/api/messages/search')?.route.path).toBe('/api/messages/search')
    expect(matchRoute('/api/messages/42')?.route.path).toBe('/api/messages/:id')
  })

  it('extracts every dynamic parameter', () => {
    const matched = matchRoute('/api/messages/uid-1/attachments/2')
    expect(matched?.route.path).toBe('/api/messages/:id/attachments/:index')
    expect(matched?.params).toEqual({ id: 'uid-1', index: '2' })
  })

  it('ignores unknown paths', () => {
    expect(matchRoute('/api/nope')).toBeNull()
  })
})
