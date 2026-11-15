/**
 * Sending from another address on a relay account's domain.
 *
 * A domain that forwards many addresses (shop@DOMAIN.IT, bank@DOMAIN.IT, ...)
 * to one mailbox needs replies to leave from the address each message was sent
 * to. A relay account with `relayAnyAddress` may do that, but only on its own
 * exact domain: subdomains and other domains are refused. The client picks the
 * address; the server checks it again before sending.
 */

/**
 * Addresses the send endpoint accepts: the same pattern as zod's email check
 * (`z.regexes.email`), which `sendSchema` applies to `fromEmail`. Copied so
 * the client doesn't need zod; a test keeps the two in step. An alias outside
 * it (shop=orders@DOMAIN.IT) can't be sent from, so it isn't offered.
 */
export const SENDABLE_ADDRESS =
  /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/

const sendable = (email: string | null): string | null => (email && SENDABLE_ADDRESS.test(email) ? email : null)

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
  /**
   * Address of the mailbox that received the message. On a shared domain it
   * usually heads the headers (Delivered-To), so other addresses are preferred
   * and it's only used when it's the sole candidate.
   */
  receivingEmail?: string
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
  const receiving = input.receivingEmail?.trim().toLowerCase() ?? ''
  let receivingSeen = false
  if (input.verifiedDomains.some((verified) => verified.toLowerCase() === domain)) {
    const onDomainForwarded = input.forwarded.map((email) => email.trim().toLowerCase()).filter(onDomain)
    receivingSeen = onDomainForwarded.includes(receiving)
    const forwarded = onDomainForwarded.find((email) => email !== receiving)
    if (forwarded) {
      // The forwarder's record wins even when it can't be sent from: falling
      // through to a lower header or To/Cc would pick a different address.
      return sendable(forwarded)
    }
  }
  const recipients = new Set(
    input.recipients.map((email) => email.trim().toLowerCase()).filter(onDomain),
  )
  receivingSeen ||= recipients.delete(receiving)
  if (recipients.size === 1) {
    return sendable([...recipients][0])
  }
  return recipients.size === 0 && receivingSeen ? sendable(receiving) : null
}

export interface DomainRelayInput {
  /** Relays that can send and have `relayAnyAddress` on, in account order. */
  relays: { id: string; email: string }[]
  /** Address of the account that received the message. */
  receivingEmail: string
  /** True for a message in Sent: its From is our own address. */
  sent: boolean
  /** From of the message. */
  from: string
  forwarded: string[]
  verifiedDomains: string[]
  recipients: string[]
}

/**
 * Which relay, if any, replies as the address a message was sent to, and as
 * which address. Used when no account has exactly that address.
 *
 * - In Sent, the message's own From is the address to keep, when a relay
 *   covers its domain. To/Cc there are the recipients, not us.
 * - Otherwise trusted forwarding headers are searched across all relays first,
 *   top-down, and To/Cc only if none matches, so a Cc on one relay's domain
 *   can't beat the forwarding record of another. To/Cc only count when they
 *   name exactly one address across all relay domains.
 * - An address that belongs to the receiving account itself stays with it:
 *   ordinary mail to me@DOMAIN.IT is answered by that account, not a relay.
 */
export function pickDomainRelay(input: DomainRelayInput): { accountId: string; alias: string } | null {
  const relayFor = (email: string) => input.relays.find((relay) => domainOf(relay.email) === domainOf(email))
  const receiving = input.receivingEmail.trim().toLowerCase()
  const result = (relay: { id: string } | undefined, alias: string | null) =>
    relay && alias && alias !== receiving ? { accountId: relay.id, alias } : null

  if (input.sent) {
    const from = input.from.trim().toLowerCase()
    return result(relayFor(from), sendable(from))
  }
  const verified = new Set(input.verifiedDomains.map((domain) => domain.toLowerCase()))
  for (const email of input.forwarded) {
    const address = email.trim().toLowerCase()
    const relay = relayFor(address)
    // The receiving mailbox's own address often heads the headers on a shared
    // domain (Delivered-To): look past it for the alias.
    if (address === receiving) {
      continue
    }
    if (relay && verified.has(domainOf(address))) {
      return result(relay, sendable(address))
    }
  }
  // To/Cc across every relay domain: only an unambiguous match counts, so
  // account order can't decide between contact@a.example and shop@b.example.
  const candidates = input.relays.flatMap((relay) => {
    const alias = pickDomainAlias({
      forwarded: [],
      verifiedDomains: [],
      recipients: input.recipients,
      domain: domainOf(relay.email),
      receivingEmail: receiving,
    })
    return alias ? [{ relay, alias }] : []
  })
  const aliases = new Set(candidates.map((candidate) => candidate.alias))
  return aliases.size === 1 ? result(candidates[0].relay, candidates[0].alias) : null
}
