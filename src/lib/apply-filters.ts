/**
 * Drive the paged "apply filters to existing mail" endpoint.
 *
 * The server answers one page per request and returns the cursor for the next
 * one; the loop lives here so it can be tested without a browser. The first call
 * passes `null`: starting from `''` (as an earlier version did) means a falsy
 * value and the loop never runs at all.
 */
export interface ApplyFiltersPage {
  processed: number
  matched: number
  labelled: number
  forwarded: number
  nextCursor: string | null
}

export interface ApplyFiltersTotals {
  processed: number
  matched: number
  labelled: number
  forwarded: number
}

export async function runFilterApplication(
  fetchPage: (cursor: string | null) => Promise<ApplyFiltersPage>,
  onProgress?: (totals: ApplyFiltersTotals) => void,
): Promise<ApplyFiltersTotals> {
  const totals: ApplyFiltersTotals = { processed: 0, matched: 0, labelled: 0, forwarded: 0 }
  let cursor: string | null = null
  let pages = 0

  for (;;) {
    const page = await fetchPage(cursor)
    pages += 1
    totals.processed += page.processed
    totals.matched += page.matched
    totals.labelled += page.labelled
    totals.forwarded += page.forwarded
    onProgress?.({ ...totals })

    if (!page.nextCursor) {
      return totals
    }
    // A server that echoes the cursor back would loop forever: stop instead.
    if (page.nextCursor === cursor || pages > 10_000) {
      throw new Error('The filter run did not advance: stop before looping forever.')
    }
    cursor = page.nextCursor
  }
}
