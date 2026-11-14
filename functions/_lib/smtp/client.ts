import { connect } from 'cloudflare:sockets'
import { toBase64 } from '../crypto'

export type SmtpSecurity = 'tls' | 'starttls'

export interface SmtpConfig {
  host: string
  port: number
  security: SmtpSecurity
}

export interface SmtpCredentials {
  username: string
  mode: 'password' | 'oauth2'
  password?: string
  accessToken?: string
}

interface SmtpResponse {
  code: number
  lines: string[]
}

/** The slice of `cloudflare:sockets` this client relies on (swappable in tests). */
export interface SmtpSocketLike {
  opened: Promise<unknown>
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
  startTls(): SmtpSocketLike
  close(): void
}

export type SmtpConnector = (config: SmtpConfig) => SmtpSocketLike

export const DEFAULT_TIMEOUT_MS = 20_000
/** QUIT is courtesy: never let it outlive the response we already sent. */
const QUIT_TIMEOUT_MS = 5_000

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class SmtpError extends Error {}

/**
 * Race `promise` against a deadline.
 *
 * The timer is always cleared, and `onTimeout` runs before the rejection so the
 * caller can tear the socket down: an SMTP server that stops answering must not
 * keep a request (or a `finally` block) busy forever.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return promise
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout?.()
      } catch {
        // ignore
      }
      reject(new SmtpError(message))
    }, ms)
  })
  return Promise.race([promise, deadline]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  })
}

function indexOfCrlf(buffer: Uint8Array): number {
  for (let i = 0; i + 1 < buffer.length; i += 1) {
    if (buffer[i] === 13 && buffer[i + 1] === 10) {
      return i
    }
  }
  return -1
}

const defaultConnector: SmtpConnector = (config) =>
  connect(
    { hostname: config.host, port: config.port },
    { secureTransport: config.security === 'tls' ? 'on' : 'starttls', allowHalfOpen: false },
  )

export class SmtpConnection {
  private socket: SmtpSocketLike
  private reader!: ReadableStreamDefaultReader<Uint8Array>
  private writer!: WritableStreamDefaultWriter<Uint8Array>
  private buffer = new Uint8Array(0)
  private capabilities: string[] = []
  private timeoutMs: number
  private closed = false

  constructor(socket: SmtpSocketLike, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.socket = socket
    this.timeoutMs = timeoutMs
  }

  static async open(
    config: SmtpConfig,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    connector: SmtpConnector = defaultConnector,
  ): Promise<SmtpConnection> {
    const socket = connector(config)
    const connection = new SmtpConnection(socket, timeoutMs)
    try {
      await withTimeout(socket.opened, timeoutMs, 'SMTP connection timed out', () =>
        connection.close(),
      )
      connection.attach()
      const greeting = await connection.readResponse()
      if (greeting.code !== 220) {
        throw new SmtpError(`Unexpected SMTP greeting: ${greeting.lines.join(' | ')}`)
      }
      await connection.ehlo()
      if (config.security === 'starttls') {
        await connection.startTls()
      }
      return connection
    } catch (error) {
      connection.close()
      throw error
    }
  }

  private attach(): void {
    this.buffer = new Uint8Array(0)
    this.reader = this.socket.readable.getReader()
    this.writer = this.socket.writable.getWriter()
  }

  private async startTls(): Promise<void> {
    await this.write('STARTTLS')
    await this.expect([220], 'STARTTLS')
    try {
      this.reader.releaseLock()
    } catch {
      // ignore
    }
    try {
      this.writer.releaseLock()
    } catch {
      // ignore
    }
    const upgraded = this.socket.startTls()
    this.socket = upgraded
    await withTimeout(upgraded.opened, this.timeoutMs, 'SMTP TLS upgrade timed out', () =>
      this.close(),
    )
    this.attach()
    await this.ehlo()
  }

  private async fill(): Promise<void> {
    const { value, done } = await this.reader.read()
    if (done || !value) {
      throw new SmtpError('SMTP connection closed')
    }
    const merged = new Uint8Array(this.buffer.length + value.length)
    merged.set(this.buffer)
    merged.set(value, this.buffer.length)
    this.buffer = merged
  }

  private async readLine(): Promise<string> {
    while (true) {
      const index = indexOfCrlf(this.buffer)
      if (index >= 0) {
        const line = decoder.decode(this.buffer.subarray(0, index))
        this.buffer = this.buffer.subarray(index + 2)
        return line
      }
      await this.fill()
    }
  }

  /**
   * Read one full SMTP reply. Every command awaits its answer, so the deadline
   * (and the socket close that follows it) is what keeps a silent server from
   * blocking the request indefinitely.
   */
  private readResponse(timeoutMs = this.timeoutMs): Promise<SmtpResponse> {
    return withTimeout(this.readResponseInner(), timeoutMs, 'SMTP response timed out', () =>
      this.close(),
    )
  }

  private async readResponseInner(): Promise<SmtpResponse> {
    const lines: string[] = []
    let code = 0
    while (true) {
      const line = await this.readLine()
      lines.push(line)
      const match = line.match(/^(\d{3})([ -])(.*)$/)
      if (!match) {
        continue
      }
      code = Number(match[1])
      if (match[2] === ' ') {
        break
      }
    }
    return { code, lines }
  }

  private async write(line: string): Promise<void> {
    await this.writer.write(encoder.encode(`${line}\r\n`))
  }

  private async expect(codes: number[], context: string): Promise<SmtpResponse> {
    const response = await this.readResponse()
    if (!codes.includes(response.code)) {
      throw new SmtpError(`${context}: ${response.lines.join(' | ')}`)
    }
    return response
  }

  private async ehlo(): Promise<void> {
    await this.write('EHLO whelkmail')
    const response = await this.expect([250], 'EHLO')
    this.capabilities = response.lines
      .map((line) => line.slice(4).trim())
      .filter(Boolean)
  }

  private advertisedAuth(): string[] {
    const line = this.capabilities.find((item) => item.toUpperCase().startsWith('AUTH '))
    if (!line) {
      return []
    }
    return line.slice(5).toUpperCase().split(/\s+/).filter(Boolean)
  }

  authenticate(credentials: SmtpCredentials): Promise<void> {
    return withTimeout(
      this.authenticateInner(credentials),
      this.timeoutMs,
      'SMTP authentication timed out',
      () => this.close(),
    )
  }

  private async authenticateInner(credentials: SmtpCredentials): Promise<void> {
    if (credentials.mode === 'oauth2') {
      const payload = `user=${credentials.username}\x01auth=Bearer ${credentials.accessToken ?? ''}\x01\x01`
      await this.write(`AUTH XOAUTH2 ${toBase64(encoder.encode(payload))}`)
      await this.expect([235], 'AUTH XOAUTH2')
      return
    }
    const mechanisms = this.advertisedAuth()
    if (mechanisms.includes('PLAIN') || mechanisms.length === 0) {
      const payload = `\x00${credentials.username}\x00${credentials.password ?? ''}`
      await this.write(`AUTH PLAIN ${toBase64(encoder.encode(payload))}`)
      const response = await this.readResponse()
      if (response.code === 235) {
        return
      }
    }
    await this.write('AUTH LOGIN')
    await this.expect([334], 'AUTH LOGIN')
    await this.write(toBase64(encoder.encode(credentials.username)))
    await this.expect([334], 'AUTH LOGIN username')
    await this.write(toBase64(encoder.encode(credentials.password ?? '')))
    await this.expect([235], 'AUTH LOGIN password')
  }

  sendRaw(message: Uint8Array, from: string, recipients: string[]): Promise<void> {
    return withTimeout(
      this.sendRawInner(message, from, recipients),
      this.timeoutMs,
      'SMTP send timed out',
      () => this.close(),
    )
  }

  private async sendRawInner(
    message: Uint8Array,
    from: string,
    recipients: string[],
  ): Promise<void> {
    await this.write(`MAIL FROM:<${from}>`)
    await this.expect([250], 'MAIL FROM')
    for (const recipient of recipients) {
      await this.write(`RCPT TO:<${recipient}>`)
      await this.expect([250, 251], 'RCPT TO')
    }
    await this.write('DATA')
    await this.expect([354], 'DATA')
    const raw = decoder.decode(message).replace(/\r?\n/g, '\r\n').replace(/\r\n$/, '')
    const stuffed = raw
      .split('\r\n')
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n')
    await this.writer.write(encoder.encode(`${stuffed}\r\n.\r\n`))
    await this.expect([250], 'Message body')
  }

  /** Best-effort close: bounded, never throws, always closes the socket. */
  async quit(timeoutMs = QUIT_TIMEOUT_MS): Promise<void> {
    if (this.closed) {
      return
    }
    try {
      await withTimeout(
        (async () => {
          await this.write('QUIT')
          await this.readResponseInner()
        })(),
        timeoutMs,
        'SMTP QUIT timed out',
      )
    } catch {
      // ignore: the message was already accepted
    } finally {
      this.close()
    }
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    try {
      this.reader?.releaseLock()
    } catch {
      // ignore
    }
    try {
      // close() returns a promise that rejects when the stream already errored.
      void this.writer?.close().catch(() => undefined)
    } catch {
      // ignore
    }
    try {
      this.socket.close()
    } catch {
      // ignore
    }
  }
}
