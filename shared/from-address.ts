/**
 * Sending from another address on a relay account's domain.
 *
 * A domain that forwards many addresses (shop@DOMAIN.IT, bank@DOMAIN.IT, ...)
 * to one mailbox needs replies to leave from the address each message was sent
 * to. A relay account with `relayAnyAddress` may do that, but only on its own
 * exact domain: subdomains and other domains are refused. The client picks the
 * address; the server checks it again before sending.
 */

export function domainOf(email: string): string {
  const at = email.lastIndexOf('@')
  return at === -1 ? '' : email.slice(at + 1).trim().toLowerCase()
}

export interface FromAccount {
  kind: string
  email: string
  relayAnyAddress: boolean
}

/** Whether `account` may send with `fromEmail` as its From address. */
export function canSendFrom(account: FromAccount, fromEmail: string): boolean {
  const from = fromEmail.trim().toLowerCase()
  if (from === account.email.trim().toLowerCase()) {
    return true
  }
  const domain = domainOf(account.email)
  return (
    account.kind === 'relay' &&
    account.relayAnyAddress &&
    domain !== '' &&
    domainOf(from) === domain
  )
}

export interface DomainAliasInput {
  /**
   * Addresses from the forwarding headers (`X-Forwarded-For`, `Delivered-To`,
   * `Received ... for`, ...), in header order: the topmost first.
   */
  forwarded: string[]
  /**
   * Domains the receiving server reports a passing DKIM signature for
   * (`verifiedDomains()`). Forwarding headers only count for these.
   */
  verifiedDomains: string[]
  /** To and Cc of the message. */
  recipients: string[]
  /** Domain of the sending account. */
  domain: string
}

/**
 * The address on `domain` that a message was sent to, or null.
 *
 * Forwarding headers are only read when the receiving server vouches for the
 * domain: a forwarder that signs with it (Cloudflare Email Routing does) leaves
 * a passing DKIM result, which mail delivered straight to the mailbox can't
 * have. Then every server a message passes through adds its headers above the
 * ones already there, so reading top-down and taking the first address on the
 * domain finds the forwarder's record before any forged copy further down.
 *
 * To/Cc are written by the sender, so they are only a fallback when no trusted
 * forwarding header names an address on the domain, and only when exactly one
 * of them is on it: with several there's no telling which one is ours.
 */
export function pickDomainAlias(input: DomainAliasInput): string | null {
  const domain = input.domain.trim().toLowerCase()
  if (!domain) {
    return null
  }
  const onDomain = (email: string): boolean => domainOf(email) === domain
  if (input.verifiedDomains.some((verified) => verified.toLowerCase() === domain)) {
    const forwarded = input.forwarded.map((email) => email.trim().toLowerCase()).find(onDomain)
    if (forwarded) {
      return forwarded
    }
  }
  const recipients = new Set(
    input.recipients.map((email) => email.trim().toLowerCase()).filter(onDomain),
  )
  return recipients.size === 1 ? [...recipients][0] : null
}
