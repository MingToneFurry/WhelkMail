/**
 * Mail transports differ per runtime: Cloudflare exposes `cloudflare:sockets`,
 * Node uses `node:net`/`node:tls`. The IMAP and SMTP clients only depend on this
 * small surface, so an entrypoint installs the implementation once at startup.
 */
export type MailSecurity = 'tls' | 'starttls'

export interface MailSocketConfig {
  host: string
  port: number
  security: MailSecurity
}

export interface MailSocketLike {
  opened: Promise<unknown>
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
  startTls(): MailSocketLike
  close(): void
}

export type MailConnector = (config: MailSocketConfig) => MailSocketLike

let connector: MailConnector | null = null

export function configureMailSocket(next: MailConnector): void {
  connector = next
}

export function mailSocketConnector(): MailConnector {
  if (!connector) {
    throw new Error('No mail socket connector is configured for this runtime')
  }
  return connector
}
