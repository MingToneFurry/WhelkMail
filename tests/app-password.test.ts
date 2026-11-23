import { describe, expect, it } from 'vitest'
import { appPasswordProblem, MIN_APP_PASSWORD_LENGTH } from '../shared/app-password'

describe('APP_PASSWORD validation', () => {
  it('rejects an empty value', () => {
    expect(appPasswordProblem('')).toMatch(/empty/)
    expect(appPasswordProblem(undefined)).toMatch(/empty/)
    expect(appPasswordProblem('   ')).toMatch(/empty/)
  })

  it('rejects the value shipped in the Docker example', () => {
    // deploy/docker/.env.example: a container started from it would be public
    // with a password printed in the repository.
    expect(appPasswordProblem('change-me')).toMatch(/example value/)
    expect(appPasswordProblem('Change-Me')).toMatch(/example value/)
    expect(appPasswordProblem('changeme')).toMatch(/example value/)
  })

  it('rejects the other classic placeholders', () => {
    for (const value of ['password', 'secret', 'admin', 'whelkmail', 'qwerty', 'letmein']) {
      expect(appPasswordProblem(value)).not.toBeNull()
    }
  })

  it('rejects a password below the minimum length', () => {
    expect(appPasswordProblem('a'.repeat(MIN_APP_PASSWORD_LENGTH - 1))).toMatch(/shorter/)
    expect(appPasswordProblem('a'.repeat(MIN_APP_PASSWORD_LENGTH))).toBeNull()
  })

  it('accepts a real password', () => {
    expect(appPasswordProblem('correct horse battery staple')).toBeNull()
    expect(appPasswordProblem('Tr0ub4dor&3-long')).toBeNull()
  })
})
