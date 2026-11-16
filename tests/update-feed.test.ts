import { describe, expect, it } from 'vitest'
import { parseLatestReleaseFeed } from '../functions/_lib/update-check'

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Release notes from WhelkMail</title>
  <entry>
    <id>tag:github.com,2008:Repository/1/v1.1.0-beta.1</id>
    <updated>2026-12-01T10:00:00Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/WhelkMail/WhelkMail/releases/tag/v1.1.0-beta.1"/>
    <title>WhelkMail 1.1.0 beta</title>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/1/v1.0.0</id>
    <updated>2026-11-16T14:55:07Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/WhelkMail/WhelkMail/releases/tag/v1.0.0"/>
    <title>WhelkMail 1.0.0 — first stable release</title>
  </entry>
</feed>`

describe('parseLatestReleaseFeed', () => {
  it('reads the tag from the release URL and skips prereleases', () => {
    expect(parseLatestReleaseFeed(feed)).toEqual({
      version: '1.0.0',
      name: 'WhelkMail 1.0.0 — first stable release',
      url: 'https://github.com/WhelkMail/WhelkMail/releases/tag/v1.0.0',
      publishedAt: '2026-11-16T14:55:07Z',
    })
  })

  it('falls back to a bare version title when the URL has no tag', () => {
    const xml = `<feed><entry><title>1.2.3</title><link href="/whatever"/></entry></feed>`
    expect(parseLatestReleaseFeed(xml)?.version).toBe('1.2.3')
  })

  it('returns null for an empty or unparsable feed', () => {
    expect(parseLatestReleaseFeed('<feed></feed>')).toBeNull()
    expect(parseLatestReleaseFeed('<entry><title>WhelkMail</title></entry>')).toBeNull()
  })
})
