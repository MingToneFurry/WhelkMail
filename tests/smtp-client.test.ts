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
  /** Never resolve writes, to simulate a full send buffer. */
  blockWrites?: boolean
  /** Close the read side after this line, to simulate a mid-command drop. */
  dropAfter?: (line: string) => boolean
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
      if (options.blockWrites) {
        return new Promise(() => undefined)
      }
      for (const line of decoder.decode(chunk).split('\r\n')) {
        if (!line) {
          continue
        }
        state.sent.push(line)
        const reply = options.respond?.(line)
        if (reply) {
          push(reply)
        }
        if (options.dropAfter?.(line)) {
          controller.close()
        }
      }
      return undefined
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

describe('SMTP authentication', () => {
  it('authenticates with XOAUTH2', async () => {
    const { socket, state } = fakeSocket({
      greeting: '220 mail.example ESMTP\r\n',
      respond: (line) => {
        if (line.startsWith('EHLO')) {
          return '250-mail.example\r\n250 AUTH XOAUTH2\r\n'
        }
        if (line.startsWith('AUTH XOAUTH2')) {
          return '235 accepted\r\n'
        }
        return null
      },
    })

    const connection = await SmtpConnection.open(config, 200, connectorOf(socket))
    await expect(
      connection.authenticate({ username: 'a@example.com', mode: 'oauth2', accessToken: 'tok' }),
    ).resolves.toBeUndefined()
    expect(state.sent.some((line) => line.startsWith('AUTH XOAUTH2 '))).toBe(true)
    connection.close()
  })

  it('falls back to AUTH LOGIN when PLAIN is not advertised', async () => {
    let credentialsAsked = 0
    const { socket, state } = fakeSocket({
      greeting: '220 mail.example ESMTP\r\n',
      respond: (line) => {
        if (line.startsWith('EHLO')) {
          return '250-mail.example\r\n250 AUTH LOGIN\r\n'
        }
        if (line === 'AUTH LOGIN') {
          return '334 VXNlcm5hbWU6\r\n'
        }
        // The next two lines are the base64 username and password.
        credentialsAsked += 1
        return credentialsAsked === 1 ? '334 UGFzc3dvcmQ6\r\n' : '235 accepted\r\n'
      },
    })

    const connection = await SmtpConnection.open(config, 200, connectorOf(socket))
    await expect(
      connection.authenticate({ username: 'a@example.com', mode: 'password', password: 'x' }),
    ).resolves.toBeUndefined()
    expect(state.sent).toContain('AUTH LOGIN')
    connection.close()
  })

  it('surfaces a rejected AUTH', async () => {
    const { socket } = fakeSocket({
      greeting: '220 mail.example ESMTP\r\n',
      respond: (line) => {
        if (line.startsWith('EHLO')) {
          return '250-mail.example\r\n250 AUTH PLAIN\r\n'
        }
        return '535 bad credentials\r\n'
      },
    })

    const connection = await SmtpConnection.open(config, 200, connectorOf(socket))
    await expect(
      connection.authenticate({ username: 'a@example.com', mode: 'password', password: 'x' }),
    ).rejects.toThrow(/535/)
    connection.close()
  })
})

describe('SMTP recipient replies', () => {
  it('accepts 252 (cannot verify the recipient)', async () => {
    const { socket } = fakeSocket({
      ...ehloOnly(),
      respond: (line) => {
        if (line.startsWith('EHLO')) {
          return '250-mail.example\r\n250 AUTH PLAIN\r\n'
        }
        if (line.startsWith('MAIL FROM')) {
          return '250 ok\r\n'
        }
        if (line.startsWith('RCPT TO')) {
          return '252 cannot verify user, will accept\r\n'
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
    connection.close()
  })
})

describe('SMTP edge cases', () => {
  it('times out when a command cannot be written', async () => {
    const { socket, state } = fakeSocket({
      greeting: '220 mail.example ESMTP\r\n',
      blockWrites: true,
    })

    await expect(SmtpConnection.open(config, 60, connectorOf(socket))).rejects.toThrow(
      /SMTP command timed out/,
    )
    expect(state.closed).toBe(true)
  })

  it('surfaces a rejected recipient', async () => {
    const { socket } = fakeSocket({
      ...ehloOnly(),
      respond: (line) => {
        if (line.startsWith('EHLO')) {
          return '250-mail.example\r\n250 AUTH PLAIN\r\n'
        }
        if (line.startsWith('MAIL FROM')) {
          return '250 ok\r\n'
        }
        if (line.startsWith('RCPT TO')) {
          return '550 no such user\r\n'
        }
        return null
      },
    })

    const connection = await SmtpConnection.open(config, 200, connectorOf(socket))
    await expect(
      connection.sendRaw(encoder.encode('Subject: hi\r\n\r\nbody'), 'a@example.com', [
        'missing@example.com',
      ]),
    ).rejects.toThrow(/550 no such user/)
    connection.close()
  })

  it('reports a dropped connection while the body is being accepted', async () => {
    const { socket } = fakeSocket({
      ...ehloOnly(),
      respond: (line) => {
        if (line.startsWith('EHLO')) {
          return '250-mail.example\r\n250 AUTH PLAIN\r\n'
        }
        if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) {
          return '250 ok\r\n'
        }
        if (line === 'DATA') {
          return '354 go ahead\r\n'
        }
        return null
      },
      dropAfter: (line) => line === 'DATA',
    })

    const connection = await SmtpConnection.open(config, 200, connectorOf(socket))
    await expect(
      connection.sendRaw(encoder.encode('Subject: hi\r\n\r\nbody'), 'a@example.com', [
        'b@example.com',
      ]),
    ).rejects.toThrow(/closed/)
  })
})
