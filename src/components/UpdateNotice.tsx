import { ArrowUpCircle, X } from 'lucide-react'
import type { UpdateStatus } from '../../shared/types'
import { RELEASES_URL, UPGRADE_DOC_URL } from '../../shared/update-links'
import { useI18n } from '../i18n'

interface UpdateNoticeProps {
  update: UpdateStatus | null
  /** Version compiled into the loaded bundle. */
  clientVersion: string
  /** Version the running server reports; differs when the tab is stale. */
  serverVersion: string | null
  onDismiss: (version: string) => void
}

export function UpdateNotice({
  update,
  clientVersion,
  serverVersion,
  onDismiss,
}: UpdateNoticeProps) {
  const { t } = useI18n()

  if (serverVersion && serverVersion !== clientVersion) {
    return (
      <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-900">
        <span className="min-w-0 flex-1">
          <span className="font-medium">{t('update.reloadTitle')}</span> {t('update.reloadBody')}
        </span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg border border-sky-300 bg-white px-2.5 py-1 font-medium hover:bg-sky-100"
        >
          {t('update.reload')}
        </button>
      </div>
    )
  }

  if (!update?.updateAvailable || update.dismissed) {
    return null
  }

  const latest = update.latest ?? ''

  return (
    <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
      <div className="flex items-start gap-2">
        <ArrowUpCircle size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{t('update.availableTitle', { version: latest })}</p>
          <p className="mt-0.5">{t('update.availableBody', { current: update.installed })}</p>
          <details className="mt-1.5">
            <summary className="cursor-pointer select-none font-medium">{t('update.howTo')}</summary>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4">
              <li>{t('update.stepSync', { version: latest })}</li>
              <li>{t('update.stepDeploy')}</li>
              <li>{t('update.stepMigrate')}</li>
            </ol>
          </details>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <a
              href={update.releaseUrl ?? RELEASES_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline"
            >
              {t('update.releaseNotes')}
            </a>
            <a href={UPGRADE_DOC_URL} target="_blank" rel="noreferrer" className="underline">
              {t('update.upgradeGuide')}
            </a>
            <button
              type="button"
              onClick={() => onDismiss(latest)}
              className="ml-auto flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2 py-1 font-medium hover:bg-amber-100"
            >
              <X size={12} /> {t('update.dismiss')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
