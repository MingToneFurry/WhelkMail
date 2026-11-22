/**
 * The version baked into every build and shown in Settings → System.
 *
 * This is the single source of truth at runtime: the Pages Functions cannot
 * read package.json at runtime, so this constant is what the update check
 * compares against the latest GitHub release. `tests/version.test.ts` keeps it
 * in step with package.json.
 */
export const APP_VERSION = '1.3.4'

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

const VERSION_PATTERN =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Accepts `1.2.3`, `v1.2.3`, `1.2.3-beta.1` and build metadata. */
export function parseVersion(value: string | null | undefined): ParsedVersion | null {
  if (!value) {
    return null
  }
  const match = VERSION_PATTERN.exec(value.trim())
  if (!match) {
    return null
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

function compareNumbers(a: number, b: number): number {
  if (a === b) {
    return 0
  }
  return a < b ? -1 : 1
}

/** Semver identifier ordering: numeric < alphanumeric, numeric by value. */
function compareIdentifiers(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a)
  const bNumeric = /^\d+$/.test(b)
  if (aNumeric && bNumeric) {
    return compareNumbers(Number(a), Number(b))
  }
  if (aNumeric) {
    return -1
  }
  if (bNumeric) {
    return 1
  }
  if (a === b) {
    return 0
  }
  return a < b ? -1 : 1
}

/**
 * `-1`, `0` or `1` like a sort comparator. Returns `null` when either side is
 * not a version, so callers can avoid a false "up to date" claim.
 */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) {
    return null
  }
  const core = compareNumbers(left.major, right.major)
  if (core !== 0) {
    return core
  }
  const minor = compareNumbers(left.minor, right.minor)
  if (minor !== 0) {
    return minor
  }
  const patch = compareNumbers(left.patch, right.patch)
  if (patch !== 0) {
    return patch
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) {
    return 0
  }
  // A release outranks any prerelease of the same core version.
  if (left.prerelease.length === 0) {
    return 1
  }
  if (right.prerelease.length === 0) {
    return -1
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const aPart = left.prerelease[index]
    const bPart = right.prerelease[index]
    if (aPart === undefined) {
      return -1
    }
    if (bPart === undefined) {
      return 1
    }
    const order = compareIdentifiers(aPart, bPart)
    if (order !== 0) {
      return order
    }
  }
  return 0
}

/** True only when both sides parse and `candidate` is strictly newer. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) === 1
}
