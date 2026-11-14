/**
 * Stub for the workerd-only `cloudflare:sockets` module.
 *
 * Vitest runs in Node, where the module does not exist. Tests inject their own
 * connector (`SmtpConnection.open(config, timeout, connector)`), so reaching
 * this function means a production path was executed without a fake.
 */
export function connect(): never {
  throw new Error('cloudflare:sockets is only available in the Workers runtime')
}
