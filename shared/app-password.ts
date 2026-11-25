/**
 * Rules for the single login password of an installation.
 *
 * The Docker example ships `APP_PASSWORD=change-me`, and until now any non-empty
 * value was accepted: a deployment that forgot to change it was publicly reachable
 * with a password printed in the repository. The Node entry refuses to start in
 * production when this check fails; Workers deployments get the same check at
 * startup of the request pipeline is not possible, so they are warned in the docs.
 */
export const MIN_APP_PASSWORD_LENGTH = 10

/** Values that appear in examples, tutorials and default configurations. */
const KNOWN_PLACEHOLDERS = new Set([
  'change-me',
  'change me',
  'changeme',
  'change-me-please',
  'password',
  'password1',
  'secret',
  'admin',
  'whelkmail',
  'test',
  'letmein',
  'qwerty',
])

export type PasswordIssue = 'empty' | 'example' | 'short'

export function appPasswordIssue(value: string | undefined | null): PasswordIssue | null {
  const password = (value ?? '').trim()
  if (!password) {
    return 'empty'
  }
  if (KNOWN_PLACEHOLDERS.has(password.toLowerCase())) {
    return 'example'
  }
  if (password.length < MIN_APP_PASSWORD_LENGTH) {
    return 'short'
  }
  return null
}

/** Diagnostic for the Node startup log. The web guard localizes these same issues. */
export function appPasswordProblem(value: string | undefined | null): string | null {
  switch (appPasswordIssue(value)) {
    case 'empty': return 'APP_PASSWORD is empty.'
    case 'example': return `APP_PASSWORD is still the example value "${value?.trim()}".`
    case 'short': return `APP_PASSWORD is shorter than ${MIN_APP_PASSWORD_LENGTH} characters.`
    default: return null
  }
}
