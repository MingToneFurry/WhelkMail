import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onPageResume } from '../src/lib/page-resume'

describe('onPageResume', () => {
  let page: EventTarget & { visibilityState: DocumentVisibilityState }
  let browser: EventTarget

  beforeEach(() => {
    page = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
    browser = new EventTarget()
    vi.stubGlobal('document', page)
    vi.stubGlobal('window', browser)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('refreshes when a hidden page returns to the foreground', () => {
    const refresh = vi.fn()
    const cleanup = onPageResume(refresh)
    page.visibilityState = 'hidden'
    page.dispatchEvent(new Event('visibilitychange'))
    browser.dispatchEvent(new Event('online'))
    browser.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    expect(refresh).not.toHaveBeenCalled()

    page.visibilityState = 'visible'
    page.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledOnce()
    cleanup()
  })

  it('refreshes when the browser restores the page from its back-forward cache', () => {
    const refresh = vi.fn()
    const cleanup = onPageResume(refresh)
    browser.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }))
    expect(refresh).not.toHaveBeenCalled()

    browser.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    expect(refresh).toHaveBeenCalledOnce()
    cleanup()
  })

  it('rechecks a visible page when the device reconnects', () => {
    const refresh = vi.fn()
    const cleanup = onPageResume(refresh)
    browser.dispatchEvent(new Event('online'))
    expect(refresh).toHaveBeenCalledOnce()
    cleanup()
  })

  it('detaches every listener on cleanup', () => {
    const refresh = vi.fn()
    const cleanup = onPageResume(refresh)
    cleanup()
    page.dispatchEvent(new Event('visibilitychange'))
    browser.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    browser.dispatchEvent(new Event('online'))
    expect(refresh).not.toHaveBeenCalled()
  })
})
