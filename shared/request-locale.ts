export type RequestLocale = 'zh-CN' | 'en' | 'it'

export function preferredLocale(header: string | null): RequestLocale {
  let best: RequestLocale = 'zh-CN'
  let highest = 0
  for (const part of (header ?? '').toLowerCase().split(',')) {
    const match = /^\s*(zh|en|it)(?:-[a-z0-9-]+)?\s*(?:;\s*q=([01](?:\.\d+)?))?\s*$/.exec(part)
    if (!match) continue
    const quality = Number(match[2] ?? 1)
    if (quality > highest && quality <= 1) {
      highest = quality
      best = match[1] === 'en' || match[1] === 'it' ? match[1] : 'zh-CN'
    }
  }
  return best
}
