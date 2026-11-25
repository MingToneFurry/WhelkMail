/** A mobile tab can resume from the background, browser history, or an offline period. */
export function onPageResume(refresh: () => void): () => void {
  function onVisible() {
    if (document.visibilityState === 'visible') {
      refresh()
    }
  }

  function onPageShow(event: PageTransitionEvent) {
    if (event.persisted) {
      onVisible()
    }
  }

  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('pageshow', onPageShow)
  window.addEventListener('online', onVisible)
  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('pageshow', onPageShow)
    window.removeEventListener('online', onVisible)
  }
}
