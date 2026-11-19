/**
 * How often an IMAP account is checked for new mail.
 *
 * The cron worker wakes up every minute (see `worker/wrangler.toml.example`) and
 * each account is synced only when its own interval has elapsed, so a per-account
 * value is honest rather than rounded up by the trigger.
 */
export const SYNC_INTERVAL_OPTIONS = [1, 2, 5, 10, 15, 30] as const
export const DEFAULT_SYNC_INTERVAL_MINUTES = 5

export type SyncIntervalMinutes = (typeof SYNC_INTERVAL_OPTIONS)[number]

export function isSyncIntervalMinutes(value: unknown): value is SyncIntervalMinutes {
  return (
    typeof value === 'number' &&
    (SYNC_INTERVAL_OPTIONS as readonly number[]).includes(value)
  )
}

/**
 * Whether an account is due for its automatic sync.
 *
 * A missing or unreadable timestamp counts as due: it is better to sync once too
 * often than to skip an account forever because its state is broken.
 */
export function syncIntervalDue(
  lastSyncedAt: string | null | undefined,
  intervalMinutes: number,
  now = Date.now(),
): boolean {
  if (!lastSyncedAt) {
    return true
  }
  const last = Date.parse(lastSyncedAt)
  if (!Number.isFinite(last)) {
    return true
  }
  const interval = isSyncIntervalMinutes(intervalMinutes)
    ? intervalMinutes
    : DEFAULT_SYNC_INTERVAL_MINUTES
  return now - last >= interval * 60_000
}
