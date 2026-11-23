import { useRef, useState } from 'react'
import { Download, ShieldCheck, Upload } from 'lucide-react'
import type { ConfigEnvelope, ConfigImportCounts } from '../../shared/types'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import { errorText } from '../lib/errors'

const MIN_PASSPHRASE = 8

function downloadEnvelope(envelope: ConfigEnvelope) {
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `whelkmail-config-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/**
 * Export/import of the portable configuration (accounts, filters, labels,
 * contacts, notification prefs and settings). The file is encrypted with a
 * passphrase, so it is safe at rest and works across deployments that use a
 * different `TOKEN_ENC_KEY`.
 */
export function ConfigTransfer() {
  const { t } = useI18n()
  const fileInput = useRef<HTMLInputElement>(null)

  const [exportPass, setExportPass] = useState('')
  const [exportConfirm, setExportConfirm] = useState('')
  const [exportBusy, setExportBusy] = useState(false)
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const [importPass, setImportPass] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importNotice, setImportNotice] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [imported, setImported] = useState<ConfigImportCounts | null>(null)

  async function runExport() {
    setExportError(null)
    setExportNotice(null)
    if (exportPass.length < MIN_PASSPHRASE) {
      setExportError(t('settings.configPassphraseShort', { min: MIN_PASSPHRASE }))
      return
    }
    if (exportPass !== exportConfirm) {
      setExportError(t('settings.configPassphraseMismatch'))
      return
    }
    setExportBusy(true)
    try {
      const envelope = await api.exportConfig(exportPass)
      downloadEnvelope(envelope)
      setExportPass('')
      setExportConfirm('')
      setExportNotice(t('settings.configExportDone'))
    } catch (error) {
      setExportError(errorText(error, t))
    } finally {
      setExportBusy(false)
    }
  }

  async function runImport() {
    setImportError(null)
    setImportNotice(null)
    setImported(null)
    if (!importFile) {
      setImportError(t('settings.configNoFile'))
      return
    }
    if (importPass.length < MIN_PASSPHRASE) {
      setImportError(t('settings.configPassphraseShort', { min: MIN_PASSPHRASE }))
      return
    }
    if (!window.confirm(t('settings.configImportConfirm'))) {
      return
    }
    setImportBusy(true)
    try {
      const text = await importFile.text()
      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch {
        throw new Error(t('settings.configInvalidFile'))
      }
      const result = await api.importConfig(importPass, payload)
      setImportPass('')
      setImportFile(null)
      if (fileInput.current) {
        fileInput.current.value = ''
      }
      setImported(result.counts)
      setImportNotice(
        t('settings.configImportDone', {
          accounts: result.counts.accounts,
          labels: result.counts.labels,
          filters: result.counts.filters,
          contacts: result.counts.contacts,
        }),
      )
    } catch (error) {
      setImportError(errorText(error, t))
    } finally {
      setImportBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-2xl border border-line bg-white p-5">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <ShieldCheck size={15} /> {t('settings.configTransfer')}
      </p>
      <p className="mt-1 text-[11px] text-muted">{t('settings.configTransferHint')}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-line p-3">
          <p className="text-xs font-medium text-slate-700">{t('settings.configExportTitle')}</p>
          <p className="mt-1 text-[11px] text-muted">{t('settings.configPassphraseHint')}</p>
          <input
            type="password"
            autoComplete="new-password"
            value={exportPass}
            onChange={(event) => setExportPass(event.target.value)}
            placeholder={t('settings.configPassphrase')}
            className="mt-2 w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs outline-none focus:border-brand"
          />
          <input
            type="password"
            autoComplete="new-password"
            value={exportConfirm}
            onChange={(event) => setExportConfirm(event.target.value)}
            placeholder={t('settings.configPassphraseConfirm')}
            className="mt-2 w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs outline-none focus:border-brand"
          />
          <button
            type="button"
            disabled={exportBusy}
            onClick={() => void runExport()}
            className="mt-2 flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-strong disabled:opacity-50"
          >
            <Download size={13} className={exportBusy ? 'animate-pulse' : undefined} />
            {exportBusy ? t('settings.configExporting') : t('settings.configExport')}
          </button>
          {exportNotice ? <p className="mt-2 text-[11px] text-emerald-700">{exportNotice}</p> : null}
          {exportError ? <p className="mt-2 text-[11px] text-brand-strong">{exportError}</p> : null}
        </div>

        <div className="rounded-xl border border-line p-3">
          <p className="text-xs font-medium text-slate-700">{t('settings.configImportTitle')}</p>
          <p className="mt-1 text-[11px] text-muted">{t('settings.configImportHint')}</p>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            onChange={(event) => {
              setImportFile(event.target.files?.[0] ?? null)
              setImportError(null)
            }}
            className="mt-2 w-full text-[11px] text-slate-700 file:mr-2 file:rounded-lg file:border file:border-line file:bg-white file:px-2.5 file:py-1 file:text-xs file:text-slate-700 hover:file:bg-slate-100"
          />
          <input
            type="password"
            autoComplete="current-password"
            value={importPass}
            onChange={(event) => setImportPass(event.target.value)}
            placeholder={t('settings.configPassphrase')}
            className="mt-2 w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs outline-none focus:border-brand"
          />
          <button
            type="button"
            disabled={importBusy}
            onClick={() => void runImport()}
            className="mt-2 flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
          >
            <Upload size={13} className={importBusy ? 'animate-pulse' : undefined} />
            {importBusy ? t('settings.configImporting') : t('settings.configImport')}
          </button>
          {importNotice ? <p className="mt-2 text-[11px] text-emerald-700">{importNotice}</p> : null}
          {importError ? <p className="mt-2 text-[11px] text-brand-strong">{importError}</p> : null}
          {imported ? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-strong"
            >
              {t('settings.configImportReload')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
