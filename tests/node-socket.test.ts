import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createSocket } from '../server/adapters/sockets/node'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const servers: net.Server[] = []

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections?.()
    server.close()
  }
})

function listen(server: net.Server): Promise<number> {
  servers.push(server)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        resolve(address.port)
      } else {
        reject(new Error('unexpected address'))
      }
    })
  })
}

describe('Node mail socket', () => {
  it('reads, writes and closes a plain connection', async () => {
    const server = net.createServer((connection) => {
      connection.write('hello\r\n')
      connection.on('data', (chunk) => {
        connection.write(chunk)
      })
    })
    const port = await listen(server)

    const socket = createSocket({ host: '127.0.0.1', port, security: 'starttls' })
    try {
      await socket.opened
      const reader = socket.readable.getReader()
      const greeting = await reader.read()
      expect(decoder.decode(greeting.value)).toBe('hello\r\n')

      const writer = socket.writable.getWriter()
      await writer.write(encoder.encode('ping\r\n'))
      await writer.releaseLock()

      const echo = await reader.read()
      expect(decoder.decode(echo.value)).toBe('ping\r\n')
      reader.releaseLock()
    } finally {
      socket.close()
    }
  })
})
