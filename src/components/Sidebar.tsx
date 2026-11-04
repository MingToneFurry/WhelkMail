import { Cloud, FileText, HardDrive, Inbox, Mail, Pencil, Plus, Send, Server, Settings } from 'lucide-react'
import type { Account, Folder } from '../../shared/types'
import { useI18n } from '../i18n'
import { cn } from '../lib/utils'

interface SidebarProps {
  account: Account | null
  view: 'mail' | 'settings'
  folder: Folder
  onCompose: () => void
  onFolder: (folder: Folder) => void
  onSettings: () => void
  onAddAccount: () => void
}

export function Sidebar({
  account,
  view,
  folder,
  onCompose,
  onFolder,
  onSettings,
  onAddAccount,
}: SidebarProps) {
  const { t } = useI18n()
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-2 px-3 py-4">
      <div className="mb-4 flex items-center gap-2 px-3">
        <Mail size={22} className="text-brand" />
        <span className="text-xl font-medium tracking-tight">{t('app.name')}</span>
      </div>

      <button
        type="button"
        onClick={onCompose}
        className="mb-4 flex w-fit items-center gap-3 rounded-2xl bg-brand-soft px-5 py-3 text-sm font-medium text-brand-strong shadow-sm transition hover:bg-red-100"
      >
        <Pencil size={18} />
        {t('sidebar.compose')}
      </button>

      <nav className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => onFolder('inbox')}
          className={cn(
            'flex items-center gap-3 rounded-full px-4 py-2 text-sm',
            view === 'mail' && folder === 'inbox'
              ? 'bg-brand-soft font-medium text-brand-strong'
              : 'text-slate-700 hover:bg-slate-200/60',
          )}
        >
          <Inbox size={18} />
          {t('sidebar.inbox')}
        </button>
        <button
          type="button"
          onClick={() => onFolder('sent')}
          className={cn(
            'flex items-center gap-3 rounded-full px-4 py-2 text-sm',
            view === 'mail' && folder === 'sent'
              ? 'bg-brand-soft font-medium text-brand-strong'
              : 'text-slate-700 hover:bg-slate-200/60',
          )}
        >
          <Send size={18} />
          {t('sidebar.sent')}
        </button>
        <button
          type="button"
          onClick={() => onFolder('draft')}
          className={cn(
            'flex items-center gap-3 rounded-full px-4 py-2 text-sm',
            view === 'mail' && folder === 'draft'
              ? 'bg-brand-soft font-medium text-brand-strong'
              : 'text-slate-700 hover:bg-slate-200/60',
          )}
        >
          <FileText size={18} />
          {t('sidebar.drafts')}
        </button>
        <button
          type="button"
          onClick={onSettings}
          className={cn(
            'flex items-center gap-3 rounded-full px-4 py-2 text-sm',
            view === 'settings' ? 'bg-brand-soft font-medium text-brand-strong' : 'text-slate-700 hover:bg-slate-200/60',
          )}
        >
          <Settings size={18} />
          {t('sidebar.settings')}
        </button>
        <button
          type="button"
          onClick={onAddAccount}
          className="flex items-center gap-3 rounded-full px-4 py-2 text-sm text-slate-700 hover:bg-slate-200/60"
        >
          <Plus size={18} />
          {t('sidebar.addAccount')}
        </button>
      </nav>

      <div className="mt-auto rounded-xl border border-line bg-white/70 p-3 text-xs text-muted">
        {account ? (
          <>
            <p className="flex items-center gap-1.5 font-medium text-slate-700">
              {account.kind === 'imap' ? (
                <Server size={14} />
              ) : account.storageDriver === 'drive' ? (
                <Cloud size={14} />
              ) : (
                <HardDrive size={14} />
              )}
              {account.kind === 'imap' ? t('sidebar.imap') : t('sidebar.relay')}
            </p>
            <p className="mt-1 truncate">{account.email}</p>
          </>
        ) : (
          <p>{t('sidebar.all')}</p>
        )}
      </div>
    </aside>
  )
}
