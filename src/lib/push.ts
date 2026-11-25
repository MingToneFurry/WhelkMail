import { api } from './api'

/** Service workers cannot read the language preference from localStorage. */
export function syncPushLanguage(locale: string, noSubject: string): void {
  if (!('serviceWorker' in navigator)) return
  void navigator.serviceWorker.ready
    .then(({ active }) => active?.postMessage({ type: 'push-language', locale, noSubject }))
    .catch(() => undefined)
}

/**
 * Re-registers the existing Web Push subscription on every app start.
 *
 * Browsers can rotate or drop the subscription while the PWA is closed (or the
 * user can clear site data), leaving the server with an endpoint that answers
 * 410. `PushSettings` already resyncs, but only when the user opens it.
 */
export async function syncPushSubscription(): Promise<void> {
  if (typeof window === 'undefined') {
    return
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return
  }
  if (Notification.permission !== 'granted') {
    return
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription) {
      return
    }
    const json = subscription.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
      return
    }
    await api.subscribePush({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      userAgent: navigator.userAgent,
    })
  } catch {
    // Logged out, offline, or push not configured: the next start retries.
  }
}
