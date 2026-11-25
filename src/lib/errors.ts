import { ApiError } from './api'

type Translate = (key: string, vars?: Record<string, string | number>) => string

const oauthReasonKeys: Record<string, string> = {
  not_configured: 'errors.oauth_not_configured',
  account_not_found: 'errors.account_not_found',
  missing_code: 'oauth.missing_code',
  invalid_state: 'oauth.invalid_state',
  access_denied: 'oauth.access_denied',
  invalid_grant: 'oauth.invalid_grant',
  invalid_client: 'oauth.invalid_client',
  invalid_scope: 'oauth.invalid_scope',
  'Creating the Drive folder failed': 'oauth.drive_folder_failed',
  unknown: 'oauth.unknown',
}

export function oauthReasonText(reason: string | null, t: Translate): string {
  if (!reason) return t('oauth.unknown')
  if (Object.hasOwn(oauthReasonKeys, reason)) return t(oauthReasonKeys[reason])
  const providerError = /^(Google|Microsoft) (did not return a refresh token|code exchange failed)$/.exec(reason)
  if (providerError) {
    const key = providerError[2] === 'code exchange failed' ? 'oauth.code_exchange_failed' : 'oauth.refresh_token_missing'
    return t(key, { provider: providerError[1] })
  }
  // Keep the provider's own diagnostic when no localised description exists.
  return reason
}

export function errorText(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    if (error.code) {
      const key = `errors.${error.code}`
      const translated = t(key)
      if (translated !== key) {
        return error.detail ? `${translated}: ${error.detail}` : translated
      }
    }
    return error.detail ? `${error.message}: ${error.detail}` : error.message
  }
  if (!(error instanceof Error)) return t('errors.internal')
  if (error.name === 'TimeoutError') return t('errors.request_timeout')
  if (error instanceof TypeError && ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.'].includes(error.message)) {
    return t('errors.network_failed')
  }
  return error.message
}
