import { describe, expect, it, vi } from 'vitest'
import { runFilterApplication, type ApplyFiltersPage } from '../src/lib/apply-filters'

function page(overrides: Partial<ApplyFiltersPage> = {}): ApplyFiltersPage {
  return {
    processed: 10,
    matched: 3,
    labelled: 4,
    forwarded: 0,
    nextCursor: null,
    ...overrides,
  }
}

describe('filter application loop', () => {
  it('asks for the first page with a null cursor', async () => {
    // '' is falsy: an earlier version started with it and never sent a request.
    const fetchPage = vi.fn(async () => page())

    await runFilterApplication(fetchPage)

    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(fetchPage).toHaveBeenCalledWith(null)
  })

  it('follows the cursor until the server has nothing left', async () => {
    const cursors: (string | null)[] = []
    const fetchPage = vi.fn(async (cursor: string | null) => {
      cursors.push(cursor)
      return cursor === null
        ? page({ processed: 200, labelled: 5, nextCursor: 'a' })
        : page({ processed: 50, labelled: 1, nextCursor: null })
    })

    const totals = await runFilterApplication(fetchPage)

    expect(cursors).toEqual([null, 'a'])
    expect(totals).toEqual({ processed: 250, matched: 6, labelled: 6, forwarded: 0 })
  })

  it('reports progress after every page', async () => {
    const seen: number[] = []
    const fetchPage = vi
      .fn<(cursor: string | null) => Promise<ApplyFiltersPage>>()
      .mockResolvedValueOnce(page({ processed: 200, nextCursor: 'b' }))
      .mockResolvedValueOnce(page({ processed: 20, nextCursor: null }))

    await runFilterApplication(fetchPage, (totals) => seen.push(totals.processed))

    expect(seen).toEqual([200, 220])
  })

  it('stops when the server echoes the same cursor', async () => {
    const fetchPage = vi.fn(async () => page({ nextCursor: 'same' }))
    fetchPage.mockResolvedValueOnce(page({ nextCursor: 'same' }))

    await expect(runFilterApplication(fetchPage)).rejects.toThrow(/did not advance/)
  })

  it('propagates a failing page', async () => {
    const fetchPage = vi.fn(async () => {
      throw new Error('HTTP 502')
    })

    await expect(runFilterApplication(fetchPage)).rejects.toThrow('HTTP 502')
  })
})
