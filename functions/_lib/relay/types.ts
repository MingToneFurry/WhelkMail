export interface RelayAttachment {
  filename: string
  contentType: string
  content: Uint8Array
}

export interface RelayMessage {
  fromName: string
  fromEmail: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  html?: string
  attachments: RelayAttachment[]
}

export interface RelayResult {
  providerMessageId: string | null
  // Recipients the provider accepted the message for but will not deliver
  // to (permanent bounce, suppression list). The send still succeeds.
  undelivered?: string[]
}

export interface RelayAdapter {
  provider: string
  label: string
  maxAttachmentBytes: number
  // Most recipients one message may have, to + cc + bcc combined, for
  // providers that limit it. Checked in send.ts before anything is sent.
  maxRecipients?: number
  send(message: RelayMessage): Promise<RelayResult>
}

/**
 * The provider answered and refused the message: it was definitely not sent.
 *
 * Anything else (a fetch that throws, a socket that dies, a timeout) leaves the
 * outcome unknown: the request may have reached the provider and been accepted
 * before the answer was lost. Callers must not treat that as a failed send.
 */
export class RelayError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function isRelayRejection(error: unknown): error is RelayError {
  return error instanceof RelayError
}

/**
 * Whether an HTTP failure from a provider proves the message was refused.
 *
 * A 2xx with a failure body or a 4xx means the provider read the request and
 * said no. A 5xx means it broke while handling it: the message may already have
 * been accepted, so the outcome stays unknown and must not be reported as failed.
 */
export function isDefiniteRejectionStatus(status: number): boolean {
  return status < 500
}
