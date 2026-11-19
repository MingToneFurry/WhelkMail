import { toBase64 } from '../crypto'
import { errorDetail, readJson, relayHttpError } from './shared'
import type { RelayAdapter, RelayMessage, RelayResult } from './types'

interface BrevoResponse {
  messageId?: string
}

export class BrevoRelay implements RelayAdapter {
  provider = 'brevo'
  label = 'Brevo'
  maxAttachmentBytes = 8 * 1024 * 1024
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async send(message: RelayMessage): Promise<RelayResult> {
    const payload = {
      sender: { name: message.fromName, email: message.fromEmail },
      to: message.to.map((email) => ({ email })),
      // An empty array is not the same as "no carbon copy": Brevo rejects the
      // request with "cc is missing", so the keys only exist when used.
      ...(message.cc.length > 0 ? { cc: message.cc.map((email) => ({ email })) } : {}),
      ...(message.bcc.length > 0 ? { bcc: message.bcc.map((email) => ({ email })) } : {}),
      subject: message.subject,
      textContent: message.text,
      htmlContent: message.html,
      ...(message.attachments.length > 0
        ? {
            attachment: message.attachments.map((attachment) => ({
              name: attachment.filename,
              content: toBase64(attachment.content),
            })),
          }
        : {}),
    }
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    })
    const data = (await readJson(response)) as BrevoResponse | null
    if (!response.ok) {
      throw relayHttpError(`Brevo send failed: ${errorDetail(data, `HTTP ${response.status}`)}`, response.status)
    }
    return { providerMessageId: data?.messageId ?? null }
  }
}
