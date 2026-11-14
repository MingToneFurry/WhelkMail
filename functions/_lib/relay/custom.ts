import { buildMime } from '../mime'
import { SmtpConnection, SmtpError, type SmtpSecurity } from '../smtp/client'
import { RelayError } from './types'
import type { RelayAdapter, RelayMessage, RelayResult } from './types'

/**
 * Map an SMTP failure to a relay failure.
 *
 * A negative reply means the server refused the message, so it is definitely not
 * sent. A closed socket, a timeout or a stalled write leaves the outcome
 * unknown: the message may have been accepted before the answer was lost, and
 * the caller must not report it as failed.
 */
export function relayErrorFromSmtp(error: unknown): unknown {
  if (error instanceof SmtpError && error.replyCode) {
    return new RelayError(error.message, error.replyCode)
  }
  return error
}

export interface CustomSmtpConfig {
  host: string
  port: number
  security: SmtpSecurity
  username: string
  password: string
}

export class CustomSmtpRelay implements RelayAdapter {
  provider = 'custom'
  label = 'SMTP'
  maxAttachmentBytes = 15 * 1024 * 1024
  private config: CustomSmtpConfig

  constructor(config: CustomSmtpConfig) {
    this.config = config
  }

  async send(message: RelayMessage): Promise<RelayResult> {
    const domain = message.fromEmail.split('@')[1] ?? 'localhost'
    const mime = buildMime({
      from: { name: message.fromName, email: message.fromEmail },
      to: message.to.map((email) => ({ email })),
      cc: message.cc.map((email) => ({ email })),
      bcc: message.bcc.map((email) => ({ email })),
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments,
      messageId: `<${crypto.randomUUID()}@${domain}>`,
      date: new Date(),
      includeBcc: false,
    })
    // The connection is opened inside the guard too: a server that refuses the
    // connection or the EHLO with a negative reply is a definite rejection, not
    // an unknown outcome.
    let connection: SmtpConnection | null = null
    try {
      connection = await SmtpConnection.open({
        host: this.config.host,
        port: this.config.port,
        security: this.config.security,
      })
      await connection.authenticate({
        username: this.config.username,
        mode: 'password',
        password: this.config.password,
      })
      await connection.sendRaw(mime, message.fromEmail, [
        ...message.to,
        ...message.cc,
        ...message.bcc,
      ])
    } catch (error) {
      throw relayErrorFromSmtp(error)
    } finally {
      await connection?.quit()
    }
    return { providerMessageId: null }
  }
}
