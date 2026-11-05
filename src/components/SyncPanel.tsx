import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react'
import type { Account, Folder, MailboxSyncState } from '../../shared/types'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import { errorText } from '../lib/errors'
import { cn, formatDate } from '../lib/utils'

interface SyncPanelProps {
  account: Account
  onSynced: () => void
}

const FOLDERS: Folder[] = ['inbox', 'sent', 'draft']

function folderLabel(folder: Folder, t: (key: string) => string): string {
  return folder === 'inbox' ? t('list.inbox') : folder === 'sent' ? t('list.sent') : t('list.drafts')
}

export function SyncPanel({ account, onSynced }: SyncPanelProps) {
  const { t, locale } = useI18n()
  const [states, setStates] = useState<MailboxSyncState[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .syncStatus(account.id)
      .then((response) => {
        if (!cancelled) {
          setStates(response.folders)
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(errorText(reason, t))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [account.id, t])

  async function runSync() {
    setRunning(true)
    setError(null)
    setMessage(null)
    let partial = false
    try {
      for (const folder of FOLDERS) {
        let result = await api.runSync(account.id, folder)
        setStates(result.folders)
        let guard = 0
        while (result.hasMore && guard < 8) {
          result = await api.runSync(account.id, folder)
          setStates(result.folders)
          guard += 1
        }
        if (result.error) {
          setError(result.error)
        }
        if (result.hasMore) {
          partial = true
        }
      }
      setMessage(partial ? t('sync.partialHint') : t('sync.done'))
    } catch (reason) {
      setError(errorText(reason, t))
    } finally {
      setRunning(false)
      onSynced()
    }
  }

  if (loading) {
    return <p className="mt-4 text-xs text-muted">{t('common.loading')}</p>
  }

  return (
    <div className="mt-4 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-slate-700">{t('sync.title')}</p>
          <p className="mt-0.5 max-w-md text-[11px] text-muted">{t('sync.hint')}</p>
        </div>
        <button
          type="button"
          disabled={running}
          onClick={() => void runSync()}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={13} className={cn(running && 'animate-spin')} />
          {running ? t('sync.running') : t('sync.button')}
        </button>
      </div>

      <div className="mt-3 space-y-1.5">
        {FOLDERS.map((folder) => {
          const state = states.find((item) => item.folder === folder)
          const status = state?.status ?? 'idle'
          return (
            <div
              key={folder}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px]"
            >
              <span className="font-medium text-slate-700">{folderLabel(folder, t)}</span>
              <span className="text-muted">
                {t('sync.progress', {
                  synced: state?.synced ?? 0,
                  total: state?.total ?? 0,
                })}
              </span>
              <span
                className={cn(
                  'flex items-center gap-1 rounded-full px-2 py-0.5',
                  status === 'done' && 'bg-emerald-50 text-emerald-700',
                  status === 'partial' && 'bg-amber-50 text-amber-800',
                  status === 'error' && 'bg-red-50 text-brand-strong',
                  status === 'idle' && 'bg-slate-100 text-muted',
                )}
              >
                {status === 'done' ? <CheckCircle2 size={11} /> : null}
                {status === 'error' ? <AlertCircle size={11} /> : null}
                {t(`sync.status.${status}`)}
              </span>
              <span className="w-full text-[10px] text-muted sm:w-auto">
                {state?.lastSyncedAt
                  ? t('sync.last', { date: formatDate(state.lastSyncedAt, locale) })
                  : t('sync.never')}
              </span>
            </div>
          )
        })}
      </div>

      {error ? <p className="mt-2 text-[11px] text-brand-strong">{error}</p> : null}
      {message ? <p className="mt-2 text-[11px] text-emerald-700">{message}</p> : null}
    </div>
  )
}
