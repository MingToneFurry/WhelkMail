import { toBase64 } from '../crypto'
import { errorDetail, formatAddress, readJson, relayHttpError } from './shared'
import type { RelayAdapter, RelayMessage, RelayResult } from './types'

/**
 * Relay through Cloudflare Email Service's REST API.
 *
 * Per-account settings:
 * - API key: an account API token with the "Email Sending: Edit" permission.
 * - Domain field (`relay_domain`): the Cloudflare account ID, which is part
 *   of the URL. The preset labels this field "Account ID" (`domainLabel`).
 *   It can be left blank: account save fills it in from the token with
 *   findCloudflareAccount() below.
 *
 * The sender's domain must be onboarded to Email Sending in that account,
 * otherwise Cloudflare answers 403 with code 10203.
 *
 * Cloudflare's SMTP endpoint can't be used through the custom SMTP relay
 * instead: Workers refuse TCP sockets to Cloudflare's own IP ranges.
 *
 * Docs: https://developers.cloudflare.com/email-service/api/send-emails/rest-api/
 */

const API = 'https://api.cloudflare.com/client/v4'

/** Cloudflare's error list, e.g. [{ code: 10203, message: "email.sending.error..." }]. */
type CloudflareErrors = { code?: number; message?: string }[]

/** "10203 email.sending.error.email.sending_disabled; ...", or the fallback. */
function formatErrors(errors: CloudflareErrors | undefined, data: unknown, status: number): string {
  return (
    errors?.map((error) => `${error.code ?? ''} ${error.message ?? ''}`.trim()).join('; ') ||
    errorDetail(data, `HTTP ${status}`)
  )
}

/** The parts of Cloudflare's response this relay reads. */
interface CloudflareSendResponse {
  success?: boolean
  errors?: CloudflareErrors
  result?: {
    message_id?: string
    // Each recipient is listed under one of: delivered, queued,
    // permanent_bounces or suppressed_recipients.
    permanent_bounces?: string[]
    suppressed_recipients?: string[]
  } | null
}

export class CloudflareRelay implements RelayAdapter {
  provider = 'cloudflare'
  label = 'Cloudflare Email Service'
  // Cloudflare's limit is 25 MiB for the whole encoded message; base64 makes
  // attachments about a third larger, so 15 MiB of raw files stays well under.
  maxAttachmentBytes = 15 * 1024 * 1024
  // To, cc and bcc combined; Cloudflare rejects anything above this.
  // https://developers.cloudflare.com/email-service/platform/limits/#email-content-limits
  maxRecipients = 50
  private apiToken: string
  private accountId: string

  constructor(apiToken: string, accountId: string) {
    this.apiToken = apiToken
    this.accountId = accountId
  }

  async send(message: RelayMessage): Promise<RelayResult> {
    // Same request shape as Resend: plain address lists, base64 attachments.
    const payload = {
      from: formatAddress(message.fromName, message.fromEmail),
      to: message.to,
      cc: message.cc.length > 0 ? message.cc : undefined,
      bcc: message.bcc.length > 0 ? message.bcc : undefined,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments.map((attachment) => ({
        filename: attachment.filename,
        type: attachment.contentType,
        disposition: 'attachment',
        content: toBase64(attachment.content),
      })),
    }
    const response = await fetch(
      `${API}/accounts/${encodeURIComponent(this.accountId)}/email/sending/send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45_000),
      },
    )
    const data = (await readJson(response)) as CloudflareSendResponse | null
    if (!response.ok || !data?.success) {
      const detail = formatErrors(data?.errors, data, response.status)
      // The most likely setup mistake, so say what to do instead of only the code.
      if (data?.errors?.some((error) => error.code === 10203)) {
        const domain = message.fromEmail.split('@').pop()
        throw relayHttpError(
          `Cloudflare send failed: ${domain} isn't set up for Email Sending in this Cloudflare account. Onboard it under Email Service → Email Sending (${detail})`,
          response.status,
        )
      }
      throw relayHttpError(`Cloudflare send failed: ${detail}`, response.status)
    }
    // The message was accepted. Recipients that bounced permanently or are on
    // the suppression list don't fail the send: they are returned so the UI
    // can show "Sent, but these addresses were not delivered: ...".
    const undelivered = [
      ...(data.result?.permanent_bounces ?? []),
      ...(data.result?.suppressed_recipients ?? []),
    ]
    return {
      providerMessageId: data.result?.message_id ?? null,
      ...(undelivered.length > 0 ? { undelivered } : {}),
    }
  }
}

/** The parts of GET /accounts that findCloudflareAccount() reads. */
interface CloudflareAccountsResponse {
  success?: boolean
  errors?: CloudflareErrors
  result?: { id?: string }[] | null
  result_info?: { total_pages?: number } | null
}

export type CloudflareAccountLookup =
  | { ok: true; accountId: string }
  | {
      ok: false
      // rejected: Cloudflare refused the token. count: the token doesn't
      // reach exactly one account, so the ID has to be entered. denied: the
      // entered ID isn't one the token reaches. unreachable: no usable answer.
      reason: 'rejected' | 'count' | 'denied' | 'unreachable'
      detail: string
    }

/**
 * Find the account a sending token belongs to, or check that it can reach
 * the account ID the user entered.
 *
 * Uses GET /accounts, the only account endpoint an "Email Sending: Edit"
 * token can read: GET /accounts/{id} answers 403 even for its own account.
 * An account token lists exactly its own account. A user token lists every
 * account it was given, which can be several, so then the ID has to be
 * entered rather than guessed.
 */
export async function findCloudflareAccount(apiToken: string, enteredId?: string): Promise<CloudflareAccountLookup> {
  // Cloudflare's IDs are lowercase hex; accept one typed or pasted in capitals.
  const accountId = enteredId?.toLowerCase()
  // A user token can reach many accounts; stop paging after this many. Each
  // page is a subrequest, and a Worker only gets so many per invocation.
  const maxPages = 10
  const ids: string[] = []
  let complete = false
  for (let page = 1; page <= maxPages; page++) {
    let response: Response
    let data: CloudflareAccountsResponse | null
    try {
      response = await fetch(`${API}/accounts?per_page=50&page=${page}`, {
        headers: { Authorization: `Bearer ${apiToken}` },
        signal: AbortSignal.timeout(15_000),
      })
      // Inside the try too: the body can still fail after the headers arrived
      // (a dropped connection, or the timeout expiring while it's read).
      data = (await readJson(response)) as CloudflareAccountsResponse | null
    } catch (error) {
      return { ok: false, reason: 'unreachable', detail: error instanceof Error ? error.message : String(error) }
    }
    if (!response.ok || !data?.success) {
      const detail = formatErrors(data?.errors, data, response.status)
      // Rate limiting and server errors say nothing about the token: report
      // them as a failed check, not as a rejected key.
      const temporary = response.status >= 500 || response.status === 429 || response.status === 408
      return { ok: false, reason: temporary ? 'unreachable' : 'rejected', detail }
    }
    ids.push(...(data.result ?? []).flatMap((account) => (account.id ? [account.id] : [])))
    if (accountId && ids.includes(accountId)) {
      return { ok: true, accountId }
    }
    if (page >= (data.result_info?.total_pages ?? 1)) {
      complete = true
      break
    }
  }
  if (accountId) {
    // Past the paging limit the list is incomplete, so not finding the ID
    // proves nothing either way: say so instead of denying it, and point to an
    // account token, which always lists exactly its own account.
    if (!complete) {
      return {
        ok: false,
        reason: 'unreachable',
        detail: `Couldn't verify access to ${accountId} within the account lookup paging limit. Use an account API token, which reaches only its own account, and try again.`,
      }
    }
    return { ok: false, reason: 'denied', detail: `${accountId} isn't one of the accounts this API token can reach.` }
  }
  if (ids.length === 1) {
    return { ok: true, accountId: ids[0] }
  }
  return {
    ok: false,
    reason: 'count',
    detail:
      ids.length === 0
        ? "This API token doesn't list any Cloudflare accounts, so enter the account ID."
        : `This API token can reach ${complete ? '' : 'more than '}${ids.length} Cloudflare accounts, so enter the ID of the one to send from.`,
  }
}
