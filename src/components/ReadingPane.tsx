import {
  AlertCircle,
  ArrowLeft,
  Download,
  FileText,
  Mail,
  Reply,
  ReplyAll,
  Tag,
} from 'lucide-react'
import type { Label, MessageDetail } from '../../shared/types'
import { useI18n } from '../i18n'
import { cn, displayAddress, formatBytes, formatDate, labelStyle } from '../lib/utils'

interface ReadingPaneProps {
  message: MessageDetail | null
  labels: Label[]
  loading: boolean
  error: string | null
  rawUrl: string | null
  attachmentUrl: (index: number) => string
  onBack?: () => void
  onReply: (all: boolean) => void
  onSetLabels: (labelIds: string[]) => void
}

export function ReadingPane({
  message,
  labels,
  loading,
  error,
  rawUrl,
  attachmentUrl,
  onBack,
  onReply,
  onSetLabels,
}: ReadingPaneProps) {
  const { t, locale } = useI18n()

  if (loading) {
    return (
      <section className="flex min-w-0 flex-1 flex-col border-t border-line bg-white/60">
        {onBack ? (
          <div className="px-4 pt-4">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-slate-100"
            >
              <ArrowLeft size={16} /> {t('reading.back')}
            </button>
          </div>
        ) : null}
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-lg animate-pulse space-y-3 px-8">
            <div className="h-5 w-2/3 rounded bg-slate-200" />
            <div className="h-3 w-1/2 rounded bg-slate-100" />
            <div className="h-3 w-1/3 rounded bg-slate-100" />
          </div>
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="flex min-w-0 flex-1 flex-col border-t border-line bg-white/60">
        {onBack ? (
          <div className="px-4 pt-4">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-slate-100"
            >
              <ArrowLeft size={16} /> {t('reading.back')}
            </button>
          </div>
        ) : null}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <AlertCircle size={28} className="text-brand" />
          <p className="text-sm text-slate-700">{error}</p>
        </div>
      </section>
    )
  }

  if (!message) {
    return (
      <section className="hidden min-w-0 flex-1 items-center justify-center border-t border-line bg-white/60 lg:flex">
        <div className="flex flex-col items-center gap-3 text-muted">
          <Mail size={44} className="text-slate-300" />
          <p className="text-sm">{t('reading.select')}</p>
        </div>
      </section>
    )
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-tl-2xl border-t border-l border-line bg-white">
      <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
        <div className="flex min-w-0 items-start gap-3">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="mt-0.5 flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-slate-100"
            >
              <ArrowLeft size={16} /> {t('reading.back')}
            </button>
          ) : null}
          <div className="min-w-0">
            <h2 className="truncate text-xl font-medium">{message.subject || t('list.noSubject')}</h2>
            {message.labelIds.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {message.labelIds.map((id) => {
                  const item = labels.find((label) => label.id === id)
                  return item ? (
                    <span
                      key={id}
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] font-medium',
                        labelStyle(item.color),
                      )}
                    >
                      {item.name}
                    </span>
                  ) : null
                })}
              </div>
            ) : null}
            <div className="mt-2 space-y-0.5 text-xs text-muted">
            <p>
              <span className="font-medium text-slate-600">{t('reading.from')}</span>{' '}
              {displayAddress(message.from)}
            </p>
            <p>
              <span className="font-medium text-slate-600">{t('reading.to')}</span>{' '}
              {message.to.map((item) => displayAddress(item)).join(', ')}
            </p>
            {message.cc.length > 0 ? (
              <p>
                <span className="font-medium text-slate-600">{t('reading.cc')}</span>{' '}
                {message.cc.map((item) => displayAddress(item)).join(', ')}
              </p>
            ) : null}
            <p>
              {formatDate(message.date, locale)} · {formatBytes(message.size)} · {message.accountEmail}
            </p>
          </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onReply(false)}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Reply size={14} />
            {t('reading.reply')}
          </button>
          <button
            type="button"
            onClick={() => onReply(true)}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <ReplyAll size={14} />
            {t('reading.replyAll')}
          </button>
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
              <Tag size={14} />
              {t('reading.labels')}
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-60 rounded-xl border border-line bg-white p-2 shadow-lg">
              {labels.length === 0 ? (
                <p className="px-2 py-1 text-xs text-muted">{t('reading.noLabels')}</p>
              ) : (
                labels.map((label) => {
                  const checked = message.labelIds.includes(label.id)
                  return (
                    <label
                      key={label.id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          onSetLabels(
                            checked
                              ? message.labelIds.filter((id) => id !== label.id)
                              : [...message.labelIds, label.id],
                          )
                        }
                        className="h-3.5 w-3.5"
                      />
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-medium',
                          labelStyle(label.color),
                        )}
                      >
                        {label.name}
                      </span>
                    </label>
                  )
                })
              )}
            </div>
          </details>
          {rawUrl ? (
            <a
              href={rawUrl}
              className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Download size={14} />
              {t('reading.downloadEml')}
            </a>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {message.text ? (
          <div className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{message.text}</div>
        ) : (
          <p className="text-sm text-muted">{t('reading.noText')}</p>
        )}

        {message.attachments.length > 0 ? (
          <div className="mt-6 border-t border-line pt-4">
            <p className="mb-2 text-xs font-medium text-muted">
              {t('reading.attachments', { count: message.attachments.length })}
            </p>
            <div className="flex flex-wrap gap-2">
              {message.attachments.map((attachment) => (
                <a
                  key={`${attachment.index}-${attachment.filename}`}
                  href={attachmentUrl(attachment.index)}
                  className="flex items-center gap-2 rounded-lg border border-line bg-slate-50 px-3 py-2 hover:border-slate-300 hover:bg-slate-100"
                >
                  <FileText size={16} className="text-slate-500" />
                  <div className="min-w-0">
                    <p className="max-w-56 truncate text-xs font-medium">{attachment.filename}</p>
                    <p className="text-[10px] text-muted">{formatBytes(attachment.size)}</p>
                  </div>
                  <Download size={13} className="ml-2 text-muted" />
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
