import { canSendFrom, domainOf, SENDABLE_ADDRESS, type FromAccount } from '../../shared/from-address'
import { mailboxIdentity } from '../../shared/private-recipient'
import type { MessageDetail } from '../../shared/types'
import { displayAddress } from './utils'

/** Build the visible To, Cc and quote attribution for a reply. */
export function replyParticipants(
  message: Pick<MessageDetail, 'folder' | 'from' | 'to' | 'cc'>,
  all: boolean,
  ownAddresses: string[],
  privateAddresses?: string[],
) {
  const seen = new Set(ownAddresses.map(address => address.trim().toLowerCase()))
  const privateMailboxes = privateAddresses && new Set(privateAddresses.map(mailboxIdentity))
  const visible = (addresses: string[]): string[] => {
    const result: string[] = []
    for (const value of addresses) {
      const email = value.trim()
      const key = email.toLowerCase()
      if (!email || seen.has(key) || privateMailboxes?.has(mailboxIdentity(email))) continue
      seen.add(key)
      result.push(email)
    }
    return result
  }
  const originalTo = message.to.map(item => item.email)
  const targets = message.folder === 'sent' ? originalTo : [message.from.email]
  const to = visible(all ? [...targets, ...originalTo] : targets)
  const cc = all ? visible(message.cc.map(item => item.email)) : []
  let quotedSender = displayAddress(message.from)
  if (privateMailboxes) {
    // A sender's display name can itself contain the private delivery address.
    const email = message.from.email.trim()
    quotedSender = SENDABLE_ADDRESS.test(email) && !privateMailboxes.has(mailboxIdentity(email)) ? email : ''
  }
  return { to, cc, quotedSender }
}

/** Strict mode only suggests addresses from the verified forwarding path.
 * To and Cc are authored by the sender and cannot prove which alias received the mail. */
export function privateReplyAlias(
  message: Pick<MessageDetail, 'folder' | 'aliasAddresses' | 'verifiedDomains'>,
  domain: string,
): string | null {
  if (message.folder === 'sent' || !message.verifiedDomains?.includes(domain)) return null
  const addresses = new Set(
    (message.aliasAddresses ?? []).map(address => address.trim().toLowerCase()).filter(address => domainOf(address) === domain),
  )
  const [alias] = addresses
  return addresses.size === 1 && SENDABLE_ADDRESS.test(alias) ? alias : null
}

/** Only prefiltered privacy relays are passed here. Prefer an exact sender
 * account, and never resolve two possible catch-all relays by array order. */
export function privateSenderAccount<T extends FromAccount>(accounts: T[], address: string, domain: string): T | null {
  const sender = address.trim().toLowerCase()
  if (!SENDABLE_ADDRESS.test(sender) || domainOf(sender) !== domain) return null
  const eligible = accounts.filter(account => account.kind === 'relay' && canSendFrom(account, sender))
  const exact = eligible.filter(account => account.email.toLowerCase() === sender)
  const routes = exact.length ? exact : eligible
  return routes.length === 1 ? routes[0] : null
}

/**
 * Which account sends a reply.
 *
 * Order of preference:
 * 1. the account configured on the mailbox that received the message
 *    (`replyAccountId`), an explicit override;
 * 2. the account whose address is the alias the message was sent to
 *    (`aliasAccountId`): a domain that only forwards to a provider mailbox leaves
 *    that address in To/Cc or Delivered-To, and the reply should leave from it,
 *    like Gmail does;
 * 3. the global "reply sender" preference, when it is not `auto`;
 * 4. the account that received the message.
 */
export interface ReplySenderInput {
  messageAccountId: string
  replyAccountId: string | null
  aliasAccountId?: string | null
  defaultSender: string
  accountIds: string[]
}

export function pickReplySender(input: ReplySenderInput): string {
  const { accountIds } = input
  if (input.replyAccountId && accountIds.includes(input.replyAccountId)) {
    return input.replyAccountId
  }
  if (input.aliasAccountId && accountIds.includes(input.aliasAccountId)) {
    return input.aliasAccountId
  }
  if (input.defaultSender !== 'auto' && accountIds.includes(input.defaultSender)) {
    return input.defaultSender
  }
  return input.messageAccountId
}
