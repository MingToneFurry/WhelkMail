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
