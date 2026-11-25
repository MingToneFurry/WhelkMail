import { domainOf } from './from-address'

interface PrivacyAccount {
  kind: string
  email: string
  relayProvider?: string | null
  smtpHost?: string | null
  smtpSecurity?: string | null
  username?: string | null
}

/** Which transports can submit a domain identity without using the receiving mailbox's SMTP login. */
export function privacyAccountAllowed(domain: string, account: PrivacyAccount, trustedSmtpHost?: string | null): boolean {
  if (!domain || account.kind !== 'relay' || domainOf(account.email) !== domain) return false
  if (account.relayProvider?.trim().toLowerCase() !== 'custom') return true

  const host = account.smtpHost?.trim().toLowerCase()
  if (!host || (account.smtpSecurity !== 'tls' && account.smtpSecurity !== 'starttls')) return false
  // Some SMTP relays add their authenticated username to trace headers.
  if (account.username?.includes('@') && domainOf(account.username) !== domain) return false
  return host === 'mail.smtp2go.com' || host === 'smtp.resend.com' || host === trustedSmtpHost?.trim().toLowerCase()
}
