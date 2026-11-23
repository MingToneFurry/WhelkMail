import type { RouteModule } from './types'

import * as health from '../functions/api/health'
import * as update from '../functions/api/update'
import * as accounts from '../functions/api/accounts/index'
import * as account from '../functions/api/accounts/[id]'
import * as accountDeletions from '../functions/api/accounts/[id]/deletions'
import * as accountSync from '../functions/api/accounts/[id]/sync'
import * as accountTest from '../functions/api/accounts/[id]/test'
import * as twoFactor from '../functions/api/auth/2fa'
import * as login from '../functions/api/auth/login'
import * as logout from '../functions/api/auth/logout'
import * as totp from '../functions/api/auth/totp'
import * as contacts from '../functions/api/contacts/index'
import * as contactsImport from '../functions/api/contacts/import'
import * as contact from '../functions/api/contacts/[id]'
import * as configExport from '../functions/api/config/export'
import * as configImport from '../functions/api/config/import'
import * as cronNotifications from '../functions/api/cron/notifications'
import * as drafts from '../functions/api/drafts/index'
import * as draft from '../functions/api/drafts/[id]'
import * as driveCallback from '../functions/api/drive/oauth/callback'
import * as driveStart from '../functions/api/drive/oauth/start'
import * as filters from '../functions/api/filters/index'
import * as filtersApply from '../functions/api/filters/apply'
import * as filter from '../functions/api/filters/[id]'
import * as googleCallback from '../functions/api/google/oauth/callback'
import * as googleStart from '../functions/api/google/oauth/start'
import * as labels from '../functions/api/labels/index'
import * as label from '../functions/api/labels/[id]'
import * as messages from '../functions/api/messages/index'
import * as messageActions from '../functions/api/messages/actions'
import * as messageSearch from '../functions/api/messages/search'
import * as messageSend from '../functions/api/messages/send'
import * as message from '../functions/api/messages/[id]/index'
import * as messageDraft from '../functions/api/messages/[id]/draft'
import * as messageLabels from '../functions/api/messages/[id]/labels'
import * as messageRaw from '../functions/api/messages/[id]/raw'
import * as messageAttachment from '../functions/api/messages/[id]/attachments/[index]'
import * as microsoftCallback from '../functions/api/microsoft/oauth/callback'
import * as microsoftStart from '../functions/api/microsoft/oauth/start'
import * as pushKey from '../functions/api/push/key'
import * as pushPrefs from '../functions/api/push/prefs'
import * as pushSubscribe from '../functions/api/push/subscribe'
import * as retention from '../functions/api/retention/index'
import * as settings from '../functions/api/settings/index'
import * as storageCleanup from '../functions/api/storage/cleanup'
import * as storageOptions from '../functions/api/storage/options'
import * as sync from '../functions/api/sync/index'
import * as threads from '../functions/api/threads/index'
import * as threadMessages from '../functions/api/threads/messages'
import * as threadRebuild from '../functions/api/threads/rebuild'

export interface RouteEntry {
  path: string
  module: RouteModule
}

function route(path: string, module: unknown): RouteEntry {
  return { path, module: module as RouteModule }
}

/**
 * One row per file under `functions/api`. The Pages deployment keeps using its
 * native file routing; the Workers and Node entrypoints share this table.
 * `tests/api-routes.test.ts` fails when a route file has no row here.
 */
export const routes: RouteEntry[] = [
  route('/api/health', health),
  route('/api/update', update),

  route('/api/accounts', accounts),
  route('/api/accounts/:id', account),
  route('/api/accounts/:id/deletions', accountDeletions),
  route('/api/accounts/:id/sync', accountSync),
  route('/api/accounts/:id/test', accountTest),

  route('/api/auth/2fa', twoFactor),
  route('/api/auth/login', login),
  route('/api/auth/logout', logout),
  route('/api/auth/totp', totp),

  route('/api/contacts', contacts),
  route('/api/contacts/import', contactsImport),
  route('/api/contacts/:id', contact),

  route('/api/config/export', configExport),
  route('/api/config/import', configImport),

  route('/api/cron/notifications', cronNotifications),

  route('/api/drafts', drafts),
  route('/api/drafts/:id', draft),

  route('/api/drive/oauth/callback', driveCallback),
  route('/api/drive/oauth/start', driveStart),

  route('/api/filters', filters),
  route('/api/filters/apply', filtersApply),
  route('/api/filters/:id', filter),

  route('/api/google/oauth/callback', googleCallback),
  route('/api/google/oauth/start', googleStart),

  route('/api/labels', labels),
  route('/api/labels/:id', label),

  route('/api/messages', messages),
  route('/api/messages/actions', messageActions),
  route('/api/messages/search', messageSearch),
  route('/api/messages/send', messageSend),
  route('/api/messages/:id', message),
  route('/api/messages/:id/draft', messageDraft),
  route('/api/messages/:id/labels', messageLabels),
  route('/api/messages/:id/raw', messageRaw),
  route('/api/messages/:id/attachments/:index', messageAttachment),

  route('/api/microsoft/oauth/callback', microsoftCallback),
  route('/api/microsoft/oauth/start', microsoftStart),

  route('/api/push/key', pushKey),
  route('/api/push/prefs', pushPrefs),
  route('/api/push/subscribe', pushSubscribe),

  route('/api/retention', retention),

  route('/api/settings', settings),

  route('/api/storage/cleanup', storageCleanup),
  route('/api/storage/options', storageOptions),

  route('/api/sync', sync),

  route('/api/threads', threads),
  route('/api/threads/messages', threadMessages),
  route('/api/threads/rebuild', threadRebuild),
]
