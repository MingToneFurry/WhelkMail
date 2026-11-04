import type { Folder } from '../../../shared/types'
import type { AccountRow } from '../db'
import type { Env } from '../env'
import { ImapConnection, type ImapConfig, type ImapHeader, type ImapSecurity } from '../imap/client'
import { getMailCredentials } from './credentials'

function configOf(account: AccountRow): ImapConfig {
  if (!account.imap_host || !account.imap_port || !account.imap_security) {
    throw new Error('Configurazione IMAP mancante')
  }
  return {
    host: account.imap_host,
    port: account.imap_port,
    security: account.imap_security as ImapSecurity,
  }
}

export async function withImap<T>(
  env: Env,
  account: AccountRow,
  handler: (connection: ImapConnection) => Promise<T>,
): Promise<T> {
  const credentials = await getMailCredentials(env, account)
  const connection = await ImapConnection.open(configOf(account))
  try {
    if (credentials.mode === 'oauth2') {
      await connection.authenticateXoauth2(credentials.username, credentials.accessToken ?? '')
    } else {
      await connection.login(credentials.username, credentials.password ?? '')
    }
    return await handler(connection)
  } finally {
    await connection.logout()
  }
}

async function resolveSpecialFolder(
  connection: ImapConnection,
  flag: string,
  fallback: string,
  namePattern?: RegExp,
): Promise<string> {
  try {
    const folders = await connection.listFolders()
    const special = folders.find((folder) =>
      folder.flags.some((item) => item.toLowerCase() === flag.toLowerCase()),
    )
    if (special) {
      return special.name
    }
    if (namePattern) {
      const named = folders.find((folder) => namePattern.test(folder.name))
      if (named) {
        return named.name
      }
    }
  } catch {
    // fall back
  }
  return fallback
}

export async function resolveSentFolder(
  connection: ImapConnection,
  account: AccountRow,
): Promise<string> {
  return resolveSpecialFolder(
    connection,
    '\\Sent',
    account.sent_folder || 'Sent',
    /(^|[./])(sent|sent items|sent mail|sent messages|inviati|inviate|invio|posta inviata|inviata)$/i,
  )
}

export async function resolveDraftsFolder(connection: ImapConnection): Promise<string> {
  return resolveSpecialFolder(
    connection,
    '\\Drafts',
    'Drafts',
    /(^|[./])(draft|drafts|draft messages|bozza|bozze)$/i,
  )
}

const MISSING_FOLDER = /TRYCREATE|NONEXISTENT|doesn't exist|does not exist|Mailbox doesn't exist/i

function uniqueFolders(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function folderCandidates(preferred: string, kind: 'sent' | 'draft'): string[] {
  const names =
    kind === 'sent'
      ? [
          preferred,
          `INBOX.${preferred}`,
          `INBOX/${preferred}`,
          'Sent',
          'INBOX.Sent',
          'INBOX/Sent',
          'Sent Items',
          'INBOX.Sent Items',
          'Sent Mail',
          'INBOX.Sent Mail',
          'Sent Messages',
          'INBOX.Sent Messages',
          'Posta inviata',
          'INBOX.Posta inviata',
          'Inviati',
          'INBOX.Inviati',
          'Inviate',
          'INBOX.Inviate',
        ]
      : [
          preferred,
          `INBOX.${preferred}`,
          `INBOX/${preferred}`,
          'Drafts',
          'INBOX.Drafts',
          'INBOX/Drafts',
          'Bozze',
          'INBOX.Bozze',
          'Bozza',
          'INBOX.Bozza',
          'Draft',
          'INBOX.Draft',
        ]
  return uniqueFolders(names)
}

async function appendWithCreate(
  connection: ImapConnection,
  preferred: string,
  message: Uint8Array,
  flags: string,
  kind: 'sent' | 'draft',
): Promise<{ uid: number | null; folder: string }> {
  let lastError: unknown = null
  for (const folder of folderCandidates(preferred, kind)) {
    try {
      const result = await connection.append(folder, message, flags)
      return { uid: result.uid, folder }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (!MISSING_FOLDER.test(detail)) {
        throw error
      }
      lastError = error
      try {
        await connection.create(folder)
      } catch {
        // It may already exist or the server may not allow CREATE; retry anyway.
      }
      try {
        const result = await connection.append(folder, message, flags)
        return { uid: result.uid, folder }
      } catch (retryError) {
        const retryDetail = retryError instanceof Error ? retryError.message : String(retryError)
        if (!MISSING_FOLDER.test(retryDetail)) {
          throw retryError
        }
        lastError = retryError
      }
    }
  }
  let available = ''
  try {
    available = (await connection.listFolders())
      .slice(0, 30)
      .map((folder) => folder.name)
      .join(', ')
  } catch {
    // ignore
  }
  const detail = lastError instanceof Error ? lastError.message : 'Folder not available'
  throw new Error(
    available ? `${detail} | Available folders: ${available}` : detail,
  )
}

async function targetFolder(
  connection: ImapConnection,
  account: AccountRow,
  folder: Folder,
): Promise<string> {
  if (folder === 'inbox') {
    return 'INBOX'
  }
  if (folder === 'sent') {
    return resolveSentFolder(connection, account)
  }
  return resolveDraftsFolder(connection)
}

async function selectForRead(
  connection: ImapConnection,
  folder: string,
  allowCreate: boolean,
): Promise<boolean> {
  try {
    await connection.select(folder)
    return true
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (!MISSING_FOLDER.test(detail)) {
      throw error
    }
    if (!allowCreate) {
      throw error
    }
    try {
      await connection.create(folder)
    } catch {
      // ignore; try selecting again in case it already exists
    }
    try {
      await connection.select(folder)
      return true
    } catch {
      return false
    }
  }
}

export async function listFolder(
  env: Env,
  account: AccountRow,
  folder: Folder,
  limit = 30,
): Promise<ImapHeader[]> {
  return withImap(env, account, async (connection) => {
    const target = await targetFolder(connection, account, folder)
    const selected = await selectForRead(connection, target, folder !== 'inbox')
    if (!selected) {
      return []
    }
    const uids = await connection.searchAll()
    return connection.fetchHeaders(uids.slice(-limit))
  })
}

export async function fetchMessage(
  env: Env,
  account: AccountRow,
  folder: Folder,
  uid: number,
  markRead = false,
): Promise<Uint8Array> {
  return withImap(env, account, async (connection) => {
    const target = await targetFolder(connection, account, folder)
    await connection.select(target)
    const bytes = await connection.fetchFull(uid)
    if (markRead && folder === 'inbox') {
      try {
        await connection.markSeen(uid)
      } catch {
        // non-blocking
      }
    }
    return bytes
  })
}

export async function appendToSent(
  env: Env,
  account: AccountRow,
  message: Uint8Array,
): Promise<void> {
  await withImap(env, account, async (connection) => {
    const folder = await resolveSentFolder(connection, account)
    await appendWithCreate(connection, folder, message, '(\\Seen)', 'sent')
  })
}

export async function saveDraft(
  env: Env,
  account: AccountRow,
  message: Uint8Array,
): Promise<{ uid: number }> {
  return withImap(env, account, async (connection) => {
    const folder = await resolveDraftsFolder(connection)
    const result = await appendWithCreate(connection, folder, message, '(\\Draft \\Seen)', 'draft')
    if (result.uid) {
      return { uid: result.uid }
    }
    await connection.select(result.folder)
    const uids = await connection.searchAll()
    if (uids.length === 0) {
      throw new Error('Bozza non trovata dopo APPEND')
    }
    return { uid: Math.max(...uids) }
  })
}

export async function deleteDraft(
  env: Env,
  account: AccountRow,
  uid: number,
): Promise<void> {
  await withImap(env, account, async (connection) => {
    const folder = await resolveDraftsFolder(connection)
    await connection.select(folder)
    await connection.deleteMessage(uid)
  })
}
