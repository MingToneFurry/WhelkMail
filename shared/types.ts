export type AccountKind = 'imap' | 'relay'
export type StorageDriver = 'provider' | 'drive' | 'r2'
export type AuthType = 'password' | 'oauth2'
export type MailSecurity = 'tls' | 'starttls'
export type Folder = 'inbox' | 'sent' | 'draft'
export type MessageStatus = 'sent' | 'failed' | 'draft'

export interface Mailbox {
  name: string | null
  email: string
}

export interface AttachmentMeta {
  index: number
  filename: string
  contentType: string
  size: number
}

export interface Account {
  id: string
  email: string
  displayName: string
  kind: AccountKind
  imapHost: string | null
  imapPort: number | null
  imapSecurity: MailSecurity | null
  smtpHost: string | null
  smtpPort: number | null
  smtpSecurity: MailSecurity | null
  username: string
  authType: AuthType
  oauthProvider: 'google' | 'microsoft' | null
  connected: boolean
  sentFolder: string
  autoSavesSent: boolean
  maxAttachmentBytes: number
  storageDriver: StorageDriver
  relayProvider: string | null
  relayConfigured: boolean
  driveConnected: boolean
  r2Available: boolean
  createdAt: string
}

export interface MessageSummary {
  id: string
  accountId: string
  accountEmail: string
  accountName: string
  folder: Folder
  from: Mailbox
  to: Mailbox[]
  cc: Mailbox[]
  bcc: Mailbox[]
  subject: string
  snippet: string
  date: string
  unread: boolean
  hasAttachments: boolean
  status: MessageStatus
}

export interface MessageDetail extends MessageSummary {
  text: string
  html: string | null
  attachments: AttachmentMeta[]
  size: number
}

export interface StorageOptions {
  drive: boolean
  r2: boolean
}

export interface AttachmentInput {
  filename: string
  contentType: string
  dataBase64: string
}

export interface SendPayload {
  accountId: string
  draftId?: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  text: string
  html?: string
  attachments: AttachmentInput[]
}

export interface ComposeSeed {
  accountId: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
}

export interface DraftPayload {
  id: string
  accountId: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  html: string | null
  attachments: AttachmentInput[]
}

export interface DraftSavePayload {
  accountId: string
  draftId?: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  html?: string
  attachments: AttachmentInput[]
}

export interface HealthStatus {
  ok: boolean
  driveConfigured: boolean
  r2Configured: boolean
  relayConfigured: boolean
  relayProvider: string
  relayLabel: string
  maxAttachmentBytes: number
  microsoftConfigured: boolean
  googleMailConfigured: boolean
}

export interface AccountCreateInput {
  kind: AccountKind
  email: string
  displayName: string
  preset?: string
  imapHost?: string
  imapPort?: number
  imapSecurity?: MailSecurity
  smtpHost?: string
  smtpPort?: number
  smtpSecurity?: MailSecurity
  username?: string
  authType?: AuthType
  oauthProvider?: 'google' | 'microsoft'
  password?: string
  autoSavesSent?: boolean
  storageDriver?: StorageDriver
  relayProvider?: string
  relayApiKey?: string
  relayApiSecret?: string
  relayDomain?: string
  relayRegion?: string
}

export interface AccountPatch {
  displayName?: string
  sentFolder?: string
  autoSavesSent?: boolean
  storageDriver?: StorageDriver
  password?: string
  username?: string
  imapHost?: string
  imapPort?: number
  imapSecurity?: MailSecurity
  smtpHost?: string
  smtpPort?: number
  smtpSecurity?: MailSecurity
  relayProvider?: string
  relayApiKey?: string
  relayApiSecret?: string
  relayDomain?: string
  relayRegion?: string
}
