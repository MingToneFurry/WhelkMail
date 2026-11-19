import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SYNC_INTERVAL_MINUTES,
  isSyncIntervalMinutes,
  SYNC_INTERVAL_OPTIONS,
  syncIntervalDue,
} from '../shared/sync-interval'

const now = Date.parse('2026-11-16T12:00:00.000Z')

function ago(minutes: number): string {
  return new Date(now - minutes * 60_000).toISOString()
}

describe('sync interval options', () => {
  it('offers exactly the values the settings menu shows', () => {
    expect([...SYNC_INTERVAL_OPTIONS]).toEqual([1, 2, 5, 10, 15, 30])
  })

  it('defaults to five minutes', () => {
    expect(DEFAULT_SYNC_INTERVAL_MINUTES).toBe(5)
  })

  it('accepts only the offered values', () => {
    for (const value of SYNC_INTERVAL_OPTIONS) {
      expect(isSyncIntervalMinutes(value)).toBe(true)
    }
    for (const value of [0, 3, 4, 7, 60, -5, 2.5]) {
      expect(isSyncIntervalMinutes(value)).toBe(false)
    }
    expect(isSyncIntervalMinutes('5')).toBe(false)
    expect(isSyncIntervalMinutes(undefined)).toBe(false)
  })
})

describe('syncIntervalDue', () => {
  it('is due when the account was never synced', () => {
    expect(syncIntervalDue(null, 5, now)).toBe(true)
    expect(syncIntervalDue(undefined, 5, now)).toBe(true)
  })

  it('is due when the stored timestamp is unreadable', () => {
    // Better one sync too many than an account that never syncs again.
    expect(syncIntervalDue('not a date', 5, now)).toBe(true)
  })

  it('waits for the interval of that account', () => {
    expect(syncIntervalDue(ago(4), 5, now)).toBe(false)
    expect(syncIntervalDue(ago(5), 5, now)).toBe(true)

    expect(syncIntervalDue(ago(1), 2, now)).toBe(false)
    expect(syncIntervalDue(ago(2), 2, now)).toBe(true)

    expect(syncIntervalDue(ago(29), 30, now)).toBe(false)
    expect(syncIntervalDue(ago(30), 30, now)).toBe(true)
  })

  it('honours a one minute interval', () => {
    expect(syncIntervalDue(ago(0.5), 1, now)).toBe(false)
    expect(syncIntervalDue(ago(1), 1, now)).toBe(true)
  })

  it('falls back to the default for an unexpected value', () => {
    expect(syncIntervalDue(ago(3), 7, now)).toBe(false)
    expect(syncIntervalDue(ago(5), 7, now)).toBe(true)
  })
})
