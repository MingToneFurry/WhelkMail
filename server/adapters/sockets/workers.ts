import { connect } from 'cloudflare:sockets'
import {
  configureMailSocket,
  type MailConnector,
  type MailSocketConfig,
  type MailSocketLike,
} from '../../../functions/_lib/mail/socket'

const workerConnector: MailConnector = (config: MailSocketConfig) =>
  connect(
    { hostname: config.host, port: config.port },
    { secureTransport: config.security === 'tls' ? 'on' : 'starttls', allowHalfOpen: false },
  ) as unknown as MailSocketLike

export function registerWorkersSockets(): void {
  configureMailSocket(workerConnector)
}
