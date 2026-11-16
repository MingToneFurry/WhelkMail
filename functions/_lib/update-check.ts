import type { UpdateStatus } from '../../shared/types'
import { UPSTREAM_REPO } from '../../shared/update-links'
import { APP_VERSION, isNewerVersion, parseVersion } from '../../shared/version'
import type { Env } from './env'

const CACHE_KEY = 'update_check'
const DISMISSED_KEY = 'update_notice_dismissed'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
/** A failed call is retried after a while instead of on every page load. */
const FAILURE_TTL_MS = 15 * 60 * 1000
const REQUEST_TIMEOUT_MS = 8000
const LATEST_RELEASE_URL = `https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest`

interface ReleaseInfo {
  version: string
  name: string | null
  url: string | null
  publishedAt: string | null
}

interface Cache {
  checkedAt: number
  ok: boolean
  release: ReleaseInfo | null
}

interface GitHubRelease {
  tag_name?: unknown
  name?: unknown
  html_url?: unknown
  published_at?: unknown
  draft?: unknown
  prerelease?: unknown
}

function checksEnabled(env: Env): boolean {
  return (env.UPDATE_CHECK ?? '').trim().toLowerCase() !== 'off'
}

async function readSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>()
  return row?.value ?? null
}

async function writeSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
    .bind(key, value)
    .run()
}

function parseCache(raw: string | null): Cache | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Cache>
    if (typeof parsed.checkedAt !== 'number') {
      return null
    }
    let release: ReleaseInfo | null = null
    if (parsed.release) {
      const candidate = parsed.release as Partial<ReleaseInfo>
      if (typeof candidate.version !== 'string' || !parseVersion(candidate.version)) {
        return null
      }
      release = {
        version: candidate.version,
        name: typeof candidate.name === 'string' ? candidate.name : null,
        url: typeof candidate.url === 'string' ? candidate.url : null,
        publishedAt: typeof candidate.publishedAt === 'string' ? candidate.publishedAt : null,
      }
    }
    return { checkedAt: parsed.checkedAt, ok: parsed.ok !== false, release }
  } catch {
    return null
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

async function fetchLatestRelease(env: Env): Promise<ReleaseInfo | null> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': `WhelkMail/${APP_VERSION}`,
  }
  if (env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`
  }
  const response = await fetch(LATEST_RELEASE_URL, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (response.status === 404) {
    // The repository has no published release yet.
    return null
  }
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status}`)
  }
  const data = (await response.json()) as GitHubRelease
  if (data.draft === true || data.prerelease === true) {
    return null
  }
  const version = stringOrNull(data.tag_name)?.trim().replace(/^v/i, '') ?? ''
  if (!parseVersion(version)) {
    throw new Error('GitHub returned an invalid release tag')
  }
  return {
    version,
    name: stringOrNull(data.name),
    url: stringOrNull(data.html_url),
    publishedAt: stringOrNull(data.published_at),
  }
}

/**
 * Compares the version baked into this deployment with the latest upstream
 * release. The GitHub call runs from the worker, never from the browser, and
 * the answer is cached in D1 for a day so a popular release cannot exhaust the
 * unauthenticated GitHub rate limit.
 */
export async function getUpdateStatus(env: Env): Promise<UpdateStatus> {
  const installed = APP_VERSION
  if (!checksEnabled(env)) {
    return {
      installed,
      latest: null,
      releaseName: null,
      releaseUrl: null,
      publishedAt: null,
      updateAvailable: false,
      dismissed: false,
      checkEnabled: false,
      error: null,
    }
  }

  const [cacheRaw, dismissed] = await Promise.all([
    readSetting(env, CACHE_KEY),
    readSetting(env, DISMISSED_KEY),
  ])
  let cache = parseCache(cacheRaw)

  // A failed check, or a repository with no published release yet, is retried
  // sooner so the first release is announced without waiting a full day.
  const ttl = cache?.ok === false || cache?.release === null ? FAILURE_TTL_MS : CACHE_TTL_MS
  const fresh = cache !== null && Date.now() - cache.checkedAt < ttl
  if (!fresh) {
    try {
      const release = await fetchLatestRelease(env)
      cache = { checkedAt: Date.now(), ok: true, release }
      await writeSetting(env, CACHE_KEY, JSON.stringify(cache))
    } catch {
      // Keep the last known release, if any, instead of failing the page.
      cache = { checkedAt: Date.now(), ok: false, release: cache?.release ?? null }
      await writeSetting(env, CACHE_KEY, JSON.stringify(cache))
    }
  }

  const latest = cache?.release?.version ?? null
  return {
    installed,
    latest,
    releaseName: cache?.release?.name ?? null,
    releaseUrl: cache?.release?.url ?? null,
    publishedAt: cache?.release?.publishedAt ?? null,
    updateAvailable: latest !== null && isNewerVersion(latest, installed),
    dismissed: latest !== null && dismissed === latest,
    checkEnabled: true,
    // A cached success with no release means GitHub has published none (or only
    // prereleases); a failed check is the other reason for a missing answer.
    error: latest === null && cache?.ok === false ? 'unreachable' : null,
  }
}

/** Stores (or clears) the version whose notice the user dismissed. */
export async function setUpdateDismissed(env: Env, version: string | null): Promise<void> {
  if (!version) {
    await env.DB.prepare('DELETE FROM app_settings WHERE key = ?').bind(DISMISSED_KEY).run()
    return
  }
  await writeSetting(env, DISMISSED_KEY, version)
}
