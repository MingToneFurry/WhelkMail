import net from 'node:net'
import tls from 'node:tls'
import {
  configureMailSocket,
  type MailSocketConfig,
  type MailSocketLike,
} from '../../../functions/_lib/mail/socket'

type RawSocket = net.Socket | tls.TLSSocket

function ignoreError(): void {
  // Attached permanently so a socket error before/after the readable stream is
  // consumed cannot become an uncaught exception in the Node process.
}

class NodeMailSocket implements MailSocketLike {
  readonly opened: Promise<unknown>

  private socket: RawSocket
  private readonly host: string
  private stream: ReadableStream<Uint8Array> | null = null
  private detachStream: (() => void) | null = null

  constructor(socket: RawSocket, host: string, secure: boolean) {
    this.socket = socket
    this.host = host
    socket.on('error', ignoreError)

    this.opened = new Promise<unknown>((resolve, reject) => {
      const event = secure ? 'secureConnect' : 'connect'
      const onOpen = () => {
        socket.off('error', onError)
        resolve(socket)
      }
      const onError = (error: Error) => {
        socket.off(event, onOpen)
        reject(error)
      }
      socket.once(event, onOpen)
      socket.once('error', onError)
    })
  }

  get readable(): ReadableStream<Uint8Array> {
    if (this.stream) {
      return this.stream
    }
    const socket = this.socket
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    let closed = false

    const finish = () => {
      if (closed) {
        return
      }
      closed = true
      try {
        controller?.close()
      } catch {
        // already closed by the consumer
      }
    }

    const stream = new ReadableStream<Uint8Array>({
      start: (streamController) => {
        controller = streamController
        const onData = (chunk: Buffer) => {
          try {
            streamController.enqueue(new Uint8Array(chunk))
          } catch {
            // The consumer went away; keep draining the socket.
          }
        }
        const onEnd = () => {
          detach()
          finish()
        }
        const onClose = () => {
          detach()
          finish()
        }
        const onError = (error: Error) => {
          detach()
          if (!closed) {
            closed = true
            try {
              streamController.error(error)
            } catch {
              // ignore
            }
          }
        }
        const detach = () => {
          socket.off('data', onData)
          socket.off('end', onEnd)
          socket.off('close', onClose)
          socket.off('error', onError)
          if (this.detachStream === detach) {
            this.detachStream = null
          }
        }
        this.detachStream = detach
        socket.on('data', onData)
        socket.once('end', onEnd)
        socket.once('close', onClose)
        socket.on('error', onError)
      },
      cancel: () => {
        this.detachReadable()
      },
    })
    this.stream = stream
    return stream
  }

  get writable(): WritableStream<Uint8Array> {
    const socket = this.socket
    return new WritableStream<Uint8Array>({
      write: (chunk) =>
        new Promise<void>((resolve, reject) => {
          socket.write(chunk, (error) => {
            if (error) {
              reject(error)
            } else {
              resolve()
            }
          })
        }),
      close: () => {
        socket.end()
      },
      abort: (reason) => {
        socket.destroy(reason instanceof Error ? reason : undefined)
      },
    })
  }

  startTls(): MailSocketLike {
    if ((this.socket as tls.TLSSocket).encrypted) {
      throw new Error('The mail socket is already using TLS')
    }
    this.detachReadable()
    const raw = this.socket
    raw.pause()
    const upgraded = tls.connect({
      socket: raw,
      servername: this.host,
    })
    return new NodeMailSocket(upgraded, this.host, true)
  }

  close(): void {
    this.detachReadable()
    this.socket.destroy()
  }

  private detachReadable(): void {
    try {
      this.detachStream?.()
    } catch {
      // ignore
    }
    this.detachStream = null
    this.stream = null
    this.socket.pause()
  }
}

export function createSocket(config: MailSocketConfig): MailSocketLike {
  if (config.security === 'tls') {
    const socket = tls.connect({
      host: config.host,
      port: config.port,
      servername: config.host,
    })
    return new NodeMailSocket(socket, config.host, true)
  }
  const socket = net.connect({ host: config.host, port: config.port })
  return new NodeMailSocket(socket, config.host, false)
}

export function registerNodeSockets(): void {
  configureMailSocket(createSocket)
}
