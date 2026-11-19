import { toBase64 } from '../crypto'
import { errorDetail, formatAddress, readJson, relayHttpError } from './shared'
import type { RelayAdapter, RelayMessage, RelayResult } from './types'

interface PostmarkResponse {
  ErrorCode?: number
  Message?: string
  MessageID?: string
}

export class PostmarkRelay implements RelayAdapter {
  provider = 'postmark'
  label = 'Postmark'
  maxAttachmentBytes = 15 * 1024 * 1024
  private token: string

  constructor(token: string) {
    this.token = token
  }

  async send(message: RelayMessage): Promise<RelayResult> {
    const payload = {
      From: formatAddress(message.fromName, message.fromEmail),
      To: message.to.join(', '),
      // An empty string is not "no carbon copy" for every provider.
      ...(message.cc.length > 0 ? { Cc: message.cc.join(', ') } : {}),
      ...(message.bcc.length > 0 ? { Bcc: message.bcc.join(', ') } : {}),
      Subject: message.subject,
      TextBody: message.text,
      HtmlBody: message.html,
      ...(message.attachments.length > 0
        ? {
            Attachments: message.attachments.map((attachment) => ({
              Name: attachment.filename,
              Content: toBase64(attachment.content),
              ContentType: attachment.contentType,
            })),
          }
        : {}),
    }
    const response = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'X-Postmark-Server-Token': this.token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    })
    const data = (await readJson(response)) as PostmarkResponse | null
    if (!response.ok || (data?.ErrorCode ?? 0) !== 0) {
      throw relayHttpError(`Postmark send failed: ${errorDetail(data, `HTTP ${response.status}`)}`, response.status)
    }
    return { providerMessageId: data?.MessageID ?? null }
  }
}
