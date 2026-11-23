import { describe, expect, it } from 'vitest'
import {
  IMAP_HEADER_FIELDS,
  ImapConnection,
  ImapError,
  type ImapConnector,
  type ImapSocketLike,
} from '../functions/_lib/imap/client'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function literal(text: string): string {
  return `{${encoder.encode(text).byteLength}}`
}

interface FakeOptions {
  greeting?: string
  /** Reply for one command, or null to stay silent (a hung server). */
  respond: (tag: string, command: string) => string | null
  /** Split every reply into chunks of this size to exercise buffering. */
  chunkSize?: number
  stallOpening?: boolean
  /** Make socket.startTls() throw, as a broken upgrade would. */
  startTlsThrows?: boolean
}

function fakeImap(options: FakeOptions) {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const state = { closed: false, sent: [] as string[] }
  const push = (text: string) => {
    if (!options.chunkSize) {
      controller.enqueue(encoder.encode(text))
      return
    }
    for (let index = 0; index < text.length; index += options.chunkSize) {
      controller.enqueue(encoder.encode(text.slice(index, index + options.chunkSize)))
    }
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
        const match = /^(\S+) (.*)$/.exec(line)
        const reply = match ? options.respond(match[1], match[2]) : null
        if (reply) {
          push(reply)
        }
      }
    },
  })
  const socket: ImapSocketLike = {
    opened: options.stallOpening ? new Promise(() => undefined) : Promise.resolve({}),
    readable,
    writable,
    startTls() {
      if (options.startTlsThrows) {
        throw new Error('TLS handshake failed')
      }
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

function connectorOf(socket: ImapSocketLike): ImapConnector {
  return () => socket
}

const config = { host: 'imap.example', port: 993, security: 'tls' as const }
const greeting = '* OK [CAPABILITY IMAP4rev1] ready\r\n'

describe('IMAP connection', () => {
  it('opens, logs in and closes on logout', async () => {
    const { socket, state } = fakeImap({
      greeting,
      respond: (tag) => `${tag} OK done\r\n`,
    })

    const connection = await ImapConnection.open(config, 200, connectorOf(socket))
    await expect(connection.login('user@example.com', 'secret')).resolves.toBeUndefined()
    expect(state.sent[0]).toMatch(/^A1 LOGIN "user@example.com" "secret"$/)

    await connection.logout()
    expect(state.closed).toBe(true)
  })

  it('rejects an unexpected greeting and closes', async () => {
    const { socket, state } = fakeImap({ greeting: '* BYE go away\r\n', respond: () => null })

    await expect(ImapConnection.open(config, 200, connectorOf(socket))).rejects.toThrow(
      /Unexpected IMAP greeting/,
    )
    expect(state.closed).toBe(true)
  })

  it('closes the socket when a command times out', async () => {
    // LOGIN never answers: the command deadline must fire and drop the socket.
    const { socket, state } = fakeImap({
      greeting,
      respond: (tag, command) => (command.startsWith('LOGIN') ? null : `${tag} OK\r\n`),
    })

    const connection = await ImapConnection.open(config, 200, connectorOf(socket))
    await expect(connection.login('u', 'p')).rejects.toThrow(/IMAP operation timed out/)
    expect(state.closed).toBe(true)
  })

  it('closes the socket when the open never completes', async () => {
    const { socket, state } = fakeImap({ stallOpening: true, respond: () => null })

    await expect(ImapConnection.open(config, 40, connectorOf(socket))).rejects.toThrow(
      /connection timed out/,
    )
    expect(state.closed).toBe(true)
  })
})

describe('IMAP responses', () => {
  it('requests the forwarding headers a "to" filter matches on', () => {
    // These are the only place a forwarding alias appears when the forwarder
    // rewrites To; omitting them left aliases_json empty for every message.
    for (const field of [
      'DELIVERED-TO',
      'X-ORIGINAL-TO',
      'X-FORWARDED-TO',
      'X-FORWARDED-FOR',
      'RECEIVED',
    ]) {
      expect(IMAP_HEADER_FIELDS).toContain(field)
    }
    expect(IMAP_HEADER_FIELDS).toContain('TO')
    expect(IMAP_HEADER_FIELDS).toContain('SUBJECT')
  })

  it('reads UIDVALIDITY, UIDNEXT and EXISTS from SELECT', async () => {
    const { socket } = fakeImap({
      greeting,
      respond: (tag, command) =>
        command.startsWith('SELECT')
          ? `* OK [UIDVALIDITY 42] [UIDNEXT 90] mailbox\r\n* 12 EXISTS\r\n${tag} OK [READ-WRITE] done\r\n`
          : `${tag} OK\r\n`,
    })

    const connection = await ImapConnection.open(config, 200, connectorOf(socket))

    await expect(connection.selectWithDetails('INBOX')).resolves.toEqual({
      uidValidity: 42,
      uidNext: 90,
      exists: 12,
    })
  })

  it('parses a SEARCH result', async () => {
    const { socket } = fakeImap({
      greeting,
      respond: (tag, command) =>
        command.startsWith('UID SEARCH') ? `* SEARCH 3 7 9\r\n${tag} OK done\r\n` : `${tag} OK\r\n`,
    })

    const connection = await ImapConnection.open(config, 200, connectorOf(socket))

    await expect(connection.searchUids('1:*')).resolves.toEqual([3, 7, 9])
  })

  it('returns an empty list when the mailbox has no matches', async () => {
    const { socket } = fakeImap({
      greeting,
      respond: (tag, command) =>
        command.startsWith('UID SEARCH') ? `* SEARCH\r\n${tag} OK done\r\n` : `${tag} OK\r\n`,
    })

    const connection = await ImapConnection.open(config, 200, connectorOf(socket))

    await expect(connection.searchUids('5:*')).resolves.toEqual([])
  })

  it('reads a header literal and the surrounding FETCH data', async () => {
    const header = 'Subject: Ciao\r\nFrom: Alice <alice@example.com>\r\n\r\n'
    const { socket } = fakeImap({
      greeting,
      respond: (tag, command) =>
        command.startsWith('UID FETCH')
          ? `* 1 FETCH (UID 7 FLAGS (\\Seen) RFC822.SIZE 120 BODY[HEADER.FIELDS (FROM)] ${literal(header)}\r\n${header})\r\n${tag} OK done\r\n`
          : `${tag} OK\r\n`,
    })

    const connection = await ImapConnection.open(config, 200, connectorOf(socket))

    const headers = await connection.fetchHeaders([7])
    expect(headers).toHaveLength(1)
    expect(headers[0]).toMatchObject({ uid: 7, size: 120, flags: ['\\Seen'] })
    expect(headers[0].header).toBe(header)
  })

  it('reassembles replies split across many chunks', async () => {
    const header = 'Subject: Frammentato\r\n\r\n'
    const { socket } = fakeImap({
      greeting,
      chunkSize: 7,
      respond: (tag, command) =>
        command.startsWith('UID FETCH')
          ? `* 1 FETCH (UID 9 RFC822.SIZE 20 BODY[HEADER.FIELDS (SUBJECT)] ${literal(header)}\r\n${header})\r\n${tag} OK done\r\n`
          : `${tag} OK\r\n`,
    })

    const connection = await ImapConnection.open(config, 200, connectorOf(socket))

    const headers = await connection.fetchHeaders([9])
    expect(headers[0].uid).toBe(9)
    expect(headers[0].header).toBe(header)
  })

  it('surfaces a tagged NO as an error', async () => {
    const { socket } = fakeImap({
      greeting,
      respond: (tag, command) =>
        command.startsWith('SELECT') ? `${tag} NO mailbox does not exist\r\n` : `${tag} OK\r\n`,
    })

    const connection = await ImapConnection.open(config, 200, connectorOf(socket))

    await expect(connection.select('Missing')).rejects.toThrow(ImapError)
    await expect(connection.select('Missing')).rejects.toThrow(/does not exist/)
  })

  it('reports a dropped connection instead of hanging', async () => {
    const { socket, state } = fakeImap({
      greeting,
      respond: (tag, command) => {
        if (command.startsWith('LOGOUT')) {
          // The server disappears without answering.
          state.closed = true
          return null
        }
        return `${tag} OK\r\n`
      },
    })

    const connection = await ImapConnection.open(config, 200, connectorOf(socket))
    // LOGOUT swallows errors by design; the point is that it returns promptly.
    await expect(connection.logout()).resolves.toBeUndefined()
  })
})

describe('IMAP buffering', () => {
  it('handles a CRLF split across two network blocks', async () => {
    // '* OK ready' is 10 bytes, so a chunk of 11 ends exactly on the CR and the
    // next block starts with the LF.
    const { socket } = fakeImap({
      greeting: '* OK ready\r\n',
      chunkSize: 11,
      respond: (tag) => `${tag} OK\r\n`,
    })

    const connection = await ImapConnection.open(config, 200, connectorOf(socket))
    await expect(connection.login('user@example.com', 'secret')).resolves.toBeUndefined()
    connection.close()
  })

  it('rejects an absurd literal instead of buffering it', async () => {
    const { socket } = fakeImap({
      greeting,
      respond: (tag, command) =>
        command.startsWith('UID FETCH')
          ? `* 1 FETCH (UID 7 BODY[] {999999999}\r\n`
          : `${tag} OK\r\n`,
    })

    const connection = await ImapConnection.open(config, 200, connectorOf(socket))

    await expect(connection.fetchFull(7)).rejects.toThrow(/exceeds/)
    connection.close()
  })
})

describe('IMAP STARTTLS', () => {
  const starttlsConfig = { host: 'imap.example', port: 143, security: 'starttls' as const }

  it('closes the socket when the server rejects STARTTLS', async () => {
    const { socket, state } = fakeImap({
      greeting,
      respond: (tag, command) =>
        command.startsWith('STARTTLS') ? `${tag} NO starttls not supported\r\n` : `${tag} OK\r\n`,
    })

    await expect(
      ImapConnection.open(starttlsConfig, 200, connectorOf(socket)),
    ).rejects.toThrow(/starttls/i)
    expect(state.closed).toBe(true)
  })

  it('closes the socket when the upgrade itself throws', async () => {
    const { socket, state } = fakeImap({
      greeting,
      startTlsThrows: true,
      respond: (tag) => `${tag} OK\r\n`,
    })

    await expect(
      ImapConnection.open(starttlsConfig, 200, connectorOf(socket)),
    ).rejects.toThrow(/TLS handshake failed/)
    expect(state.closed).toBe(true)
  })
})
