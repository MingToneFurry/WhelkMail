import { LogOut, Menu, Search, Settings } from 'lucide-react'
import type { Account } from '../../shared/types'
import { useI18n } from '../i18n'
import { initials } from '../lib/utils'

interface TopbarProps {
  accounts: Account[]
  selectedAccountId: string
  query: string
  onSelectAccount: (id: string) => void
  onQuery: (value: string) => void
  onOpenSettings: () => void
  onLogout: () => void
  onMenu: () => void
}

export function Topbar({
  accounts,
  selectedAccountId,
  query,
  onSelectAccount,
  onQuery,
  onOpenSettings,
  onLogout,
  onMenu,
}: TopbarProps) {
  const { t } = useI18n()
  const account = accounts.find((item) => item.id === selectedAccountId) ?? null

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 px-2 sm:gap-3 sm:px-4">
      <button
        type="button"
        onClick={onMenu}
        title={t('topbar.menu')}
        aria-label={t('topbar.menu')}
        className="rounded-full p-2 text-muted hover:bg-slate-200/60 md:hidden"
      >
        <Menu size={20} />
      </button>
      <div className="flex h-11 max-w-2xl flex-1 items-center gap-3 rounded-full bg-[#eaf1fb] px-4 focus-within:bg-white focus-within:shadow-md">
        <Search size={18} className="text-muted" />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={t('topbar.searchPlaceholder')}
          className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted"
        />
      </div>

      <select
        value={selectedAccountId}
        onChange={(event) => onSelectAccount(event.target.value)}
        className="max-w-24 rounded-lg border border-line bg-white px-1.5 py-2 text-xs outline-none sm:max-w-56 sm:px-2"
      >
        <option value="all">{t('topbar.allAccounts')}</option>
        {accounts.map((item) => (
          <option key={item.id} value={item.id}>
            {item.email}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={onOpenSettings}
        title={t('topbar.settings')}
        className="rounded-full p-2 text-muted hover:bg-slate-200/60"
      >
        <Settings size={20} />
      </button>
      <button
        type="button"
        onClick={onLogout}
        title={t('topbar.logout')}
        className="hidden rounded-full p-2 text-muted hover:bg-slate-200/60 sm:block"
      >
        <LogOut size={20} />
      </button>
      <div className="hidden h-9 w-9 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white sm:flex">
        {initials(account?.displayName ?? account?.email ?? t('sidebar.all'))}
      </div>
    </header>
  )
}
