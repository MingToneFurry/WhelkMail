import { useState } from 'react'
import { Filter, Loader2, Pencil, Plus, Send, Tag, Trash2 } from 'lucide-react'
import type { Account, FilterInput, Label, LabelColor, MailFilter } from '../../shared/types'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import { errorText } from '../lib/errors'
import { runFilterApplication } from '../lib/apply-filters'
import { cn, labelStyle, parseAddresses } from '../lib/utils'

interface FiltersSettingsProps {
  accounts: Account[]
  labels: Label[]
  filters: MailFilter[]
  onCreateFilter: (input: FilterInput) => Promise<boolean>
  onUpdateFilter: (id: string, input: FilterInput) => void
  onDeleteFilter: (id: string) => void
  onCreateLabel: (name: string, color: LabelColor) => Promise<Label | null>
}

function criteriaSummary(filter: MailFilter, allMail: string): string {
  const parts: string[] = []
  if (filter.from) parts.push(`From: ${filter.from}`)
  if (filter.to) parts.push(`To: ${filter.to}`)
  if (filter.subject) parts.push(`Subject: ${filter.subject}`)
  if (filter.hasWords) parts.push(`+ ${filter.hasWords}`)
  if (filter.doesntHave) parts.push(`- ${filter.doesntHave}`)
  if (filter.hasAttachment) parts.push('Attachment')
  return parts.length > 0 ? parts.join(' · ') : allMail
}

export function FiltersSettings({
  accounts,
  labels,
  filters,
  onCreateFilter,
  onUpdateFilter,
  onDeleteFilter,
  onCreateLabel,
}: FiltersSettingsProps) {
  const { t } = useI18n()
  const [applyingAll, setApplyingAll] = useState(false)
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [applyForward, setApplyForward] = useState(false)
  const [applyProgress, setApplyProgress] = useState<{ processed: number; labelled: number; forwarded: number } | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [hasWords, setHasWords] = useState('')
  const [doesntHave, setDoesntHave] = useState('')
  const [hasAttachment, setHasAttachment] = useState(false)
  const [labelIds, setLabelIds] = useState<string[]>([])
  const [forwardTo, setForwardTo] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editingFilter = editingId ? (filters.find((filter) => filter.id === editingId) ?? null) : null

  function toggleLabel(id: string) {
    setLabelIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  async function addLabel() {
    if (!newLabel.trim()) {
      return
    }
    const created = await onCreateLabel(newLabel.trim(), 'blue')
    if (created) {
      setLabelIds((current) => [...current, created.id])
      setNewLabel('')
    }
  }

  function resetForm() {
    setEditingId(null)
    setName('')
    setFrom('')
    setTo('')
    setSubject('')
    setHasWords('')
    setDoesntHave('')
    setHasAttachment(false)
    setLabelIds([])
    setForwardTo('')
    setNewLabel('')
    setError(null)
  }

  function startEdit(filter: MailFilter) {
    setEditingId(filter.id)
    setName(filter.name)
    setFrom(filter.from ?? '')
    setTo(filter.to ?? '')
    setSubject(filter.subject ?? '')
    setHasWords(filter.hasWords ?? '')
    setDoesntHave(filter.doesntHave ?? '')
    setHasAttachment(filter.hasAttachment)
    const account = filter.accountId
      ? accounts.find((item) => item.id === filter.accountId)
      : null
    // Defensive fallback: an automatic filter must still show its label even if
    // an older row was saved before the label was mirrored into labelIds.
    setLabelIds(
      filter.labelIds.length > 0 || !account?.incomingLabelId
        ? filter.labelIds
        : [account.incomingLabelId],
    )
    setForwardTo(filter.forwardTo.join(', '))
    setError(null)
  }

  async function submit() {
    setError(null)
    const hasCriteria = Boolean(
      from.trim() ||
        to.trim() ||
        subject.trim() ||
        hasWords.trim() ||
        doesntHave.trim() ||
        hasAttachment,
    )
    // The automatic account label is a match-all account filter: editing it
    // without adding criteria must keep working.
    const matchAll = Boolean(editingFilter && (editingFilter.autoLabel || editingFilter.accountId))
    const recipients = [...new Set(parseAddresses(forwardTo))]
    if (!hasCriteria && !matchAll) {
      setError(t('filters.criteriaRequired'))
      return
    }
    if (labelIds.length === 0 && recipients.length === 0) {
      setError(t('filters.actionRequired'))
      return
    }
    if (recipients.some((email) => !email.includes('@'))) {
      setError(t('filters.invalidForward'))
      return
    }
    const input: FilterInput = {
      name: name.trim() || undefined,
      from: from.trim() || null,
      to: to.trim() || null,
      subject: subject.trim() || null,
      hasWords: hasWords.trim() || null,
      doesntHave: doesntHave.trim() || null,
      hasAttachment,
      labelIds,
      forwardTo: recipients,
    }
    setBusy(true)
    if (editingId) {
      onUpdateFilter(editingId, input)
      setBusy(false)
      resetForm()
      return
    }
    const created = await onCreateFilter(input)
    setBusy(false)
    if (created) {
      resetForm()
    }
  }

  const inputClass =
    'w-full rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-brand'

  /**
   * `target` is one filter id, or null for every enabled filter.
   * Forwarding only exists for the "all" run: it is a deliberate choice, not
   * something a per-filter button should do behind your back.
   */
  async function applyFilters(target: string | null) {
    const forward = target === null ? applyForward : false
    if (target === null) {
      setApplyingAll(true)
    } else {
      setApplyingId(target)
    }
    setApplyError(null)
    setApplyProgress(null)
    try {
      const totals = await runFilterApplication(
        (cursor) => api.applyFilters({ cursor, filterId: target ?? undefined, forward }),
        (progress) => setApplyProgress(progress),
      )
      setApplyProgress(totals)
    } catch (error) {
      setApplyError(errorText(error, t))
    } finally {
      setApplyingId(null)
      setApplyingAll(false)
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-line bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <Filter size={16} className="text-muted" />
        <p className="text-sm font-medium">{t('filters.title')}</p>
      </div>
      <p className="mb-4 text-[11px] text-muted">{t('filters.hint')}</p>

      <div className="space-y-2">
        {filters.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted">
            {t('filters.empty')}
          </p>
        ) : null}
        {filters.map((filter) => (
          <div
            key={filter.id}
            className={cn(
              'flex flex-wrap items-start justify-between gap-2 rounded-xl border border-line px-3 py-2',
              !filter.enabled && 'opacity-60',
            )}
          >
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-700">{filter.name}</p>
              {filter.autoLabel || filter.accountId ? (
                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                  {filter.autoLabel ? (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      {t('filters.automatic')}
                    </span>
                  ) : null}
                  {filter.accountId ? (
                    <span className="text-[10px] text-muted">
                      {t('filters.account')}:{' '}
                      {accounts.find((account) => account.id === filter.accountId)?.email ??
                        filter.accountId}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <p className="text-[11px] text-muted">
                {criteriaSummary(filter, t('filters.allMail'))}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {filter.labelIds.map((id) => {
                  const label = labels.find((item) => item.id === id)
                  return label ? (
                    <span
                      key={id}
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] font-medium',
                        labelStyle(label.color),
                      )}
                    >
                      {label.name}
                    </span>
                  ) : null
                })}
              </div>
              {filter.forwardTo.length > 0 ? (
                <p className="mt-1 text-[11px] text-muted">
                  {t('filters.forwardToLabel')}: {filter.forwardTo.join(', ')}
                </p>
              ) : null}
              {filter.lastForwardStatus ? (
                <p className="mt-1 text-[11px] text-muted">
                  {t('filters.lastForward')}: {filter.lastForwardStatus}
                  {filter.lastForwardError ? ` — ${filter.lastForwardError}` : ''}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={applyingAll || applyingId !== null}
                onClick={() => void applyFilters(filter.id)}
                title={t('filters.applyOne')}
                aria-label={t('filters.applyOne')}
                className="rounded-full p-1.5 text-muted hover:bg-slate-100 disabled:opacity-40"
              >
                {applyingId === filter.id ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Tag size={13} />
                )}
              </button>
              <button
                type="button"
                onClick={() => startEdit(filter)}
                className="rounded-full p-1.5 text-muted hover:bg-slate-100"
                aria-label={t('filters.edit')}
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                onClick={() => onUpdateFilter(filter.id, { enabled: !filter.enabled })}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px]',
                  filter.enabled
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-muted',
                )}
              >
                {filter.enabled ? t('filters.enabled') : t('filters.disabled')}
              </button>
              <button
                type="button"
                onClick={() => onDeleteFilter(filter.id)}
                className="rounded-full p-1.5 text-muted hover:bg-red-50 hover:text-brand-strong"
                aria-label={t('filters.delete')}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-line p-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-700">
          <Plus size={13} /> {editingId ? t('filters.editTitle') : t('filters.new')}
        </p>
        {editingFilter?.autoLabel ? (
          <div className="mb-3 rounded-lg border border-line bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            <p className="font-medium text-slate-700">{t('filters.autoLabelTitle')}</p>
            <p className="mt-0.5">
              {t('filters.autoLabelHint', {
                label:
                  labels.find((item) => item.id === editingFilter.labelIds[0])?.name ?? '—',
                email:
                  accounts.find((account) => account.id === editingFilter.accountId)?.email ??
                  editingFilter.accountId,
              })}
            </p>
          </div>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('filters.name')}
            className={inputClass}
          />
          <input
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            placeholder={t('filters.from')}
            className={inputClass}
          />
          <input
            value={to}
            onChange={(event) => setTo(event.target.value)}
            placeholder={t('filters.to')}
            className={inputClass}
          />
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder={t('filters.subject')}
            className={inputClass}
          />
          <input
            value={hasWords}
            onChange={(event) => setHasWords(event.target.value)}
            placeholder={t('filters.hasWords')}
            className={inputClass}
          />
          <input
            value={doesntHave}
            onChange={(event) => setDoesntHave(event.target.value)}
            placeholder={t('filters.doesntHave')}
            className={inputClass}
          />
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={hasAttachment}
            onChange={(event) => setHasAttachment(event.target.checked)}
            className="h-3.5 w-3.5"
          />
          {t('filters.hasAttachment')}
        </label>

        <p className="mt-3 mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-700">
          <Tag size={13} /> {t('filters.applyLabel')}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {labels.length === 0 ? (
            <p className="text-[11px] text-muted">{t('labels.empty')}</p>
          ) : null}
          {labels.map((label) => {
            const checked = labelIds.includes(label.id)
            return (
              <button
                key={label.id}
                type="button"
                onClick={() => toggleLabel(label.id)}
                className={cn(
                  'rounded-full border px-2 py-1 text-[11px]',
                  checked
                    ? 'border-transparent ' + labelStyle(label.color)
                    : 'border-line text-slate-600 hover:bg-slate-50',
                )}
              >
                {label.name}
              </button>
            )
          })}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            placeholder={t('filters.newLabel')}
            className={inputClass}
          />
          <button
            type="button"
            disabled={!newLabel.trim()}
            onClick={() => void addLabel()}
            className="shrink-0 rounded-lg border border-line px-2 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
          >
            {t('filters.createLabel')}
          </button>
        </div>

        <p className="mt-3 mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-700">
          <Send size={13} /> {t('filters.forwardTo')}
        </p>
        <input
          value={forwardTo}
          onChange={(event) => setForwardTo(event.target.value)}
          placeholder={t('filters.forwardToPlaceholder')}
          className={inputClass}
        />
        <p className="mt-1 text-[11px] text-muted">{t('filters.forwardHint')}</p>

        {error ? <p className="mt-2 text-xs text-brand-strong">{error}</p> : null}

        <div className="mt-3 flex justify-end gap-2">
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:bg-slate-50"
            >
              {t('common.cancel')}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {busy ? t('common.loading') : editingId ? t('filters.save') : t('filters.create')}
          </button>
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-line bg-white p-5">
        <p className="text-sm font-medium">{t('filters.applyAllTitle')}</p>
        <p className="mt-1 text-[11px] text-muted">{t('filters.applyAllHint')}</p>
        <label className="mt-2 flex items-start gap-2 text-[11px] text-slate-700">
          <input
            type="checkbox"
            checked={applyForward}
            onChange={(event) => setApplyForward(event.target.checked)}
            disabled={applyingAll}
            className="mt-0.5 h-3.5 w-3.5"
          />
          <span>
            <span className="block font-medium">{t('filters.applyForward')}</span>
            <span className="text-muted">{t('filters.applyForwardHint')}</span>
          </span>
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={applyingAll || applyingId !== null || filters.length === 0}
            onClick={() => void applyFilters(null)}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {applyingAll ? t('filters.applying') : t('filters.applyAllButton')}
          </button>
          {applyProgress ? (
            <span className="text-[11px] text-muted">
              {t('filters.applyResult', {
                processed: applyProgress.processed,
                labelled: applyProgress.labelled,
                forwarded: applyProgress.forwarded,
              })}
            </span>
          ) : null}
        </div>
        {applyError ? <p className="mt-2 text-[11px] text-brand-strong">{applyError}</p> : null}
      </div>
    </div>
  )
}
