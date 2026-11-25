import type { AccountRow } from '../db'
import type { Env } from '../env'
import { SmtpConnection, type SmtpConfig, type SmtpSecurity } from '../smtp/client'
import { getMailCredentials } from './credentials'

function configOf(account: AccountRow): SmtpConfig {
  if (!account.smtp_host || !account.smtp_port || !account.smtp_security) {
    throw new Error('SMTP configuration is missing')
  }
  return {
    host: account.smtp_host,
    port: account.smtp_port,
    security: account.smtp_security as SmtpSecurity,
  }
}

export async function sendWithAccount(
  env: Env,
  account: AccountRow,
  message: Uint8Array,
  recipients: string[],
): Promise<void> {
  // Applies to scheduled vacation replies and filter forwards as well as manual sends.
  if (env.PRIVACY_SENDER_DOMAIN?.trim()) {
    throw new Error('Privacy mode requires a domain sending relay')
  }
  const credentials = await getMailCredentials(env, account)
  const connection = await SmtpConnection.open(configOf(account))
  try {
    await connection.authenticate(credentials)
    await connection.sendRaw(message, account.email, recipients)
  } finally {
    await connection.quit()
  }
}
