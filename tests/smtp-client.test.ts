import { describe, expect, it } from 'vitest'
import {
  SmtpConnection,
  SmtpError,
  type SmtpConnector,
  type SmtpSocketLike,
} from '../functions/_lib/smtp/client'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

interface FakeOptions {
  /** Sent as soon as the socket is created (the server greeting). */
  greeting?: string
  /** Reply for one command line, or null to stay silent. */
  respond?: (line: string) => string | null
  /** Never resolve `opened`, to simulate a connect that hangs. */
  stallOpening?: boolean
}

function fakeSocket(options: FakeOptions = {}) {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const state = { closed: false, sent: [] as string[], startTlsCalls: 0 }
  const push = (text: string) => {
    controller.enqueue(encoder.encode(text))
  }
  const readable = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController
      if (options.greeting) {
        streamController.enqueue(encoder.encode(options.greeting))
      }
    },
  })
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      for (const line of decoder.decode(chunk).split('\r\n')) {
        if (!line) {
          continue
        }
        state.sent.push(line)
        const reply = options.respond?.(line)
        if (reply) {
          push(reply)
        }
      }
    },
  })
  const socket: SmtpSocketLike = {
    opened: options.stallOpening ? new Promise(() => undefined) : Promise.resolve({}),
    readable,
    writable,
    startTls() {
      state.startTlsCalls += 1
      return socket
    },
    close() {
      state.closed = true
      try {
        controller.close()
      } catch {
        // already closed
      }
    },
  }
  return { socket, state }
}

function connectorOf(socket: SmtpSocketLike): SmtpConnector {
  return () => socket
}

const config = { host: 'smtp.example', port: 465, security: 'tls' as const }

/** A server that accepts EHLO and nothing else. */
function ehloOnly(greeting = '220 mail.example ESMTP\r\n'): FakeOptions {
  return {
    greeting,
    respond: (line) =>
      line.startsWith('EHLO') ? '250-mail.example\r\n250 AUTH PLAIN LOGIN\r\n' : null,
  }
}

describe('SMTP connection timeouts', () => {
  it('closes the socket when the connect never completes', async () => {
    const { socket, state } = fakeSocket({ stallOpening: true })

    await expect(SmtpConnection.open(config, 40, connectorOf(socket))).rejects.toThrow(
      /SMTP connection timed out/,
    )
    expect(state.closed).toBe(true)
  })

  it('closes the socket when the server never sends a greeting', async () => {
    const { socket, state } = fakeSocket()

    await expect(SmtpConnection.open(config, 40, connectorOf(socket))).rejects.toThrow(
      /SMTP response timed out/,
    )
    expect(state.closed).toBe(true)
  })

  it('rejects an unexpected greeting and closes', async () => {
    const { socket, state } = fakeSocket({ greeting: '554 go away\r\n' })

    await expect(SmtpConnection.open(config, 40, connectorOf(socket))).rejects.toThrow(SmtpError)
    expect(state.closed).toBe(true)
  })

  it('opens and negotiates EHLO', async () => {
    const { socket, state } = fakeSocket(ehloOnly())

    const connection = await SmtpConnection.open(config, 200, connectorOf(socket))
    expect(state.sent[0]).toBe('EHLO whelkmail')
    connection.close()
    expect(state.closed).toBe(true)
  })

  it('upgrades to TLS and closes when the upgrade hangs', async () => {
    let upgraded = false
    const { socket } = fakeSocket({
      greeting: '220 mail.example ESMTP\r\n',
      respond: (line) => {
        if (line === 'STARTTLS') {
          return '220 go ahead\r\n'
        }
        if (line.startsWith('EHLO')) {
          // The first EHLO advertises STARTTLS; the second one happens after the
          // upgrade, which never completes.
          return upgraded ? null : '250-mail.example\r\n250 STARTTLS\r\n'
        }
        return null
      },
    })
    const original = socket.startTls.bind(socket)
    socket.startTls = () => {
      upgraded = true
      const next = original()
      return { ...next, opened: new Promise(() => undefined) }
    }

    await expect(
      SmtpConnection.open(
        { host: 'smtp.example', port: 587, security: 'starttls' },
        60,
        connectorOf(socket),
      ),
    ).rejects.toThrow(/SMTP TLS upgrade timed out/)
  })
})

describe('SMTP send timeouts', () => {
  it('times out when the server never accepts the message body', async () => {
    const { socket, state } = fakeSocket({
      ...ehloOnly(),
      respond: (line) => {
        if (line.startsWith('EHLO')) {
          return '250-mail.example\r\n250 AUTH PLAIN\r\n\r\n'
        }
        if (line.startsWith('MAIL FROM')) {
          return '250 ok\r\n'
        }
        if (line.startsWith('RCPT TO')) {
          return '250 ok\r\n'
        }
        if (line === 'DATA') {
          return '354 go ahead\r\n'
        }
        // The body is sent, then the server goes silent.
        return null
      },
    })

    const connection = await SmtpConnection.open(config, 200, connectorOf(socket))
    await expect(
      connection.sendRaw(encoder.encode('Subject: hi\r\n\r\nbody'), 'a@example.com', [
        'b@example.com',
      ]),
    ).rejects.toThrow(/SMTP send timed out/)
    expect(state.closed).toBe(true)
    expect(state.sent).toContain('DATA')
  })

  it('completes a full transaction', async () => {
    const { socket, state } = fakeSocket({
      ...ehloOnly(),
      respond: (line) => {
        if (line.startsWith('EHLO')) {
          return '250-mail.example\r\n250 AUTH PLAIN\r\n\r\n'
        }
        if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) {
          return '250 ok\r\n'
        }
        if (line === 'DATA') {
          return '354 go ahead\r\n'
        }
        if (line === '.') {
          return '250 queued\r\n'
        }
        return null
      },
    })

    const connection = await SmtpConnection.open(config, 200, connectorOf(socket))
    await expect(
      connection.sendRaw(encoder.encode('Subject: hi\r\n\r\nbody'), 'a@example.com', [
        'b@example.com',
      ]),
    ).resolves.toBeUndefined()
    expect(state.sent).toContain('DATA')
    expect(state.sent).toContain('.')
  })
})

describe('SMTP quit', () => {
  it('is bounded and always closes the socket', async () => {
    const { socket, state } = fakeSocket(ehloOnly())
    const connection = await SmtpConnection.open(config, 200, connectorOf(socket))

    const started = Date.now()
    await connection.quit(30)
    const elapsed = Date.now() - started

    expect(state.closed).toBe(true)
    expect(elapsed).toBeLessThan(1000)
    expect(state.sent).toContain('QUIT')
  })

  it('does not try to quit twice', async () => {
    const { socket } = fakeSocket(ehloOnly())
    const connection = await SmtpConnection.open(config, 200, connectorOf(socket))
    await connection.quit(30)
    await expect(connection.quit(30)).resolves.toBeUndefined()
  })
})
