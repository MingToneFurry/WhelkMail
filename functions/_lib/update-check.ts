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
const RELEASES_FEED_URL = `https://github.com/${UPSTREAM_REPO}/releases.atom`

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

function firstMatch(source: string, pattern: RegExp): string | null {
  const match = pattern.exec(source)
  return match ? match[1] : null
}

/**
 * Latest stable release from the releases Atom feed.
 *
 * The feed is served by github.com, not the API, so it keeps working when the
 * unauthenticated API rate limit (shared Cloudflare egress IPs) is exhausted.
 * Entries are newest-first and include prereleases, which are skipped: they are
 * not announced to installations.
 */
export function parseLatestReleaseFeed(xml: string): ReleaseInfo | null {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []
  for (const entry of entries) {
    const title = firstMatch(entry, /<title[^>]*>([\s\S]*?)<\/title>/)
    const link =
      firstMatch(entry, /<link[^>]*\brel="alternate"[^>]*\bhref="([^"]+)"/) ??
      firstMatch(entry, /<link[^>]*\bhref="([^"]+)"/)
    // The feed title is the release name ("WhelkMail 1.0.0 — first stable
    // release"), not the tag: read the tag from the release URL instead.
    const tag = link ? /\/releases\/tag\/([^/?#]+)/.exec(link)?.[1] : null
    const raw = tag ?? title?.trim() ?? ''
    let version = raw
    try {
      version = decodeURIComponent(raw)
    } catch {
      // Keep the raw tag if it is not valid percent-encoding.
    }
    version = version.replace(/^v/i, '')
    const parsed = parseVersion(version)
    if (!parsed || parsed.prerelease.length > 0) {
      continue
    }
    return {
      version,
      name: title?.trim() ?? null,
      url: link,
      publishedAt: firstMatch(entry, /<updated>([^<]*)<\/updated>/),
    }
  }
  return null
}

async function fetchApiRelease(env: Env): Promise<ReleaseInfo | null> {
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
    throw new Error(`GitHub API returned ${response.status}`)
  }
  const data = (await response.json()) as GitHubRelease
  if (data.draft === true || data.prerelease === true) {
    return null
  }
  const version = stringOrNull(data.tag_name)?.trim().replace(/^v/i, '') ?? ''
  if (!parseVersion(version)) {
    throw new Error('GitHub API returned an invalid release tag')
  }
  return {
    version,
    name: stringOrNull(data.name),
    url: stringOrNull(data.html_url),
    publishedAt: stringOrNull(data.published_at),
  }
}

async function fetchFeedRelease(): Promise<ReleaseInfo | null> {
  const response = await fetch(RELEASES_FEED_URL, {
    headers: {
      Accept: 'application/atom+xml',
      'User-Agent': `WhelkMail/${APP_VERSION}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`GitHub releases feed returned ${response.status}`)
  }
  return parseLatestReleaseFeed(await response.text())
}

async function fetchLatestRelease(env: Env): Promise<ReleaseInfo | null> {
  try {
    return await fetchApiRelease(env)
  } catch (error) {
    console.error(
      '[update] GitHub API release check failed, trying the releases feed:',
      error instanceof Error ? error.message : error,
    )
    return fetchFeedRelease()
  }
}

/**
 * Compares the version baked into this deployment with the latest upstream
 * release. The GitHub call runs from the worker, never from the browser, and
 * the answer is cached in D1 for a day so a popular release cannot exhaust the
 * unauthenticated GitHub rate limit.
 */
export async function getUpdateStatus(env: Env, refresh = false): Promise<UpdateStatus> {
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
  const fresh = !refresh && cache !== null && Date.now() - cache.checkedAt < ttl
  if (!fresh) {
    try {
      const release = await fetchLatestRelease(env)
      cache = { checkedAt: Date.now(), ok: true, release }
    } catch (error) {
      // Keep the last known release, if any, instead of failing the page.
      console.error(
        '[update] release check failed:',
        error instanceof Error ? error.message : error,
      )
      cache = { checkedAt: Date.now(), ok: false, release: cache?.release ?? null }
    }
    try {
      await writeSetting(env, CACHE_KEY, JSON.stringify(cache))
    } catch (error) {
      // A cache write must not make a successful check look unreachable.
      console.error(
        '[update] cannot cache the release check:',
        error instanceof Error ? error.message : error,
      )
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
