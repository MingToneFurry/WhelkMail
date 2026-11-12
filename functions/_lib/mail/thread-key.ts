/**
 * Conversation keys.
 *
 * `thread_key` is the Message-ID of the root of a conversation, lowercased and
 * without angle brackets. A message that is not a reply is its own root, so
 * nothing is ever rewritten when a reply arrives later: the reply adopts the key
 * of its parent. Threads are per account.
 *
 * Pure and dependency free so the rules can be tested without IMAP or D1.
 */

/** `"<ABC@x.it>"` → `abc@x.it`. */
export function normalizeMessageId(value: string | null | undefined): string {
  if (!value) {
    return ''
  }
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim().replace(/^</, '').replace(/>$/, '').trim().toLowerCase())
    .filter(Boolean)[0] ?? ''
}

/** Every id in a `References` header, in order, normalized. */
export function referenceIds(value: string | null | undefined): string[] {
  if (!value) {
    return []
  }
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim().replace(/^</, '').replace(/>$/, '').trim().toLowerCase())
    .filter(Boolean)
}

export interface ThreadKeyInput {
  messageId: string | null | undefined
  inReplyTo: string | null | undefined
  references: string | null | undefined
  /** Key already stored for the parent, when the mirror knows it. */
  parentKey?: string | null
  /** Stable fallback (hash) for messages without a Message-ID. */
  fallback: string
}

/**
 * Root of the conversation this message belongs to.
 *
 * `References[0]` is the root by RFC 5322; clients truncate long chains, so when
 * the mirror already knows the parent's key we trust it instead. A message
 * without threading headers becomes the root of its own conversation.
 */
export function threadKeyFor(input: ThreadKeyInput): string {
  const own = normalizeMessageId(input.messageId)
  const parent = normalizeMessageId(input.inReplyTo)
  const root = referenceIds(input.references)[0] ?? parent
  const candidate = input.parentKey?.trim() || root || own
  return candidate || input.fallback
}
