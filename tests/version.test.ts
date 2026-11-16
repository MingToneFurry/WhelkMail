import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APP_VERSION, compareVersions, isNewerVersion, parseVersion } from '../shared/version'

describe('app version', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
    expect(APP_VERSION).toBe(pkg.version)
  })

  it('is a semantic version', () => {
    expect(parseVersion(APP_VERSION)).not.toBeNull()
  })
})

describe('parseVersion', () => {
  it('accepts a plain, prefixed or prerelease version', () => {
    expect(parseVersion('1.2.3')).toMatchObject({ major: 1, minor: 2, patch: 3, prerelease: [] })
    expect(parseVersion('v1.2.3')).toMatchObject({ major: 1, minor: 2, patch: 3 })
    expect(parseVersion('1.2.3-beta.2')).toMatchObject({ prerelease: ['beta', '2'] })
    expect(parseVersion('1.2.3+build.5')).toMatchObject({ prerelease: [] })
  })

  it('rejects anything else', () => {
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('dev')).toBeNull()
    expect(parseVersion('1.2')).toBeNull()
    expect(parseVersion(null)).toBeNull()
  })
})

describe('compareVersions', () => {
  it('orders core versions', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1)
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1)
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1)
  })

  it('ignores a leading v and build metadata', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('1.2.3+build', 'v1.2.3')).toBe(0)
  })

  it('ranks a release above its prereleases', () => {
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBe(1)
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1)
    expect(compareVersions('1.0.0-beta', '1.0.0-alpha')).toBe(1)
  })

  it('returns null when a side is not a version', () => {
    expect(compareVersions('unknown', '1.0.0')).toBeNull()
    expect(compareVersions('1.0.0', 'dev')).toBeNull()
  })
})

describe('isNewerVersion', () => {
  it('is true only for a strictly newer release', () => {
    expect(isNewerVersion('1.2.0', '1.0.0')).toBe(true)
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
    expect(isNewerVersion('0.9.9', '1.0.0')).toBe(false)
    expect(isNewerVersion('1.0.0-beta', '1.0.0')).toBe(false)
    expect(isNewerVersion('bogus', '1.0.0')).toBe(false)
  })
})
